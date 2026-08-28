<!-- covers: icalendar -->

# `icalendar`

Pure, dependency-free iCalendar (RFC 5545) building and parsing. One implementation shared
by every connector that speaks calendar data, so the same malformed-input behavior is
guaranteed everywhere.

## When you reach for it

You are writing a connector that reads or emits `.ics` payloads and you need event fields
as data rather than as text.

## Constraints that are load-bearing

- **Never throws on malformed input.** Parsing is best-effort: unparseable components are
  skipped, not raised. A calendar feed with one broken event still yields the others.
- **No clock.** `buildVEvent` takes `now` as a parameter for the `DTSTAMP` it writes, so
  tests are deterministic. See the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
- **No I/O.** Fetching the feed is the caller's job.
- **Times stay strings.** `ParsedEvent` hands back the RFC 5545 text it found rather than a
  `Date`, so no timezone interpretation is imposed on you.
- **Attendees are bare addresses.** `buildVEvent` writes `ATTENDEE:mailto:<addr>` itself, so
  pass `"ana@example.com"`. Passing `"mailto:ana@example.com"` produces
  `ATTENDEE:mailto:mailto:ana@example.com`, which is not a valid RFC 5545 CAL-ADDRESS: every
  *other* consumer of the feed — the calendar server, the recipient's client — reads a
  malformed address, and that is the damage. Nimbus's own round trip conceals it rather than
  catching it, because `parseICalendar` strips the leading `mailto:` exactly once and hands
  back the doubled string you passed in. The two ends agree with each other while agreeing
  with nobody else, so a round-trip test is not the test that would find this.

## Example

```ts
import { buildVEvent, parseICalendar } from "@nimbus-dev/sdk";

const feed = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:standup-1",
  "SUMMARY:Standup",
  "DTSTART:20260701T090000Z",
  "DTEND:20260701T091500Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** A broken VEVENT in the feed would be skipped, not thrown. */
export const summaries: (string | null)[] = parseICalendar(feed).map((event) => event.summary);

export const retro: string = buildVEvent(
  {
    uid: "retro-1",
    summary: "Retro",
    start: "20260702T090000Z",
    end: "20260702T100000Z",
    // Bare address — buildVEvent adds the `mailto:` prefix.
    attendees: ["ana@example.com"],
  },
  "20260701T120000Z",
);
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.

## Python binding

`nimbus_sdk.icalendar` (`sdks/python/src/nimbus_sdk/icalendar/`) publishes **4** names —
`ParsedEvent`, `BuildEventInput`, `parse_icalendar`, `build_vevent` — and runs the **59-case**
corpus of [`batteries/v1/icalendar.md`](../spec/batteries/v1/icalendar.md).

The implementation module is `events.py`, not `calendar.py`: a module named `calendar` inside
the package would sit one relative import away from shadowing the standard library's, for no
benefit.

Three things it does not delegate to Python:

- **`_fold_ascii` maps U+0041–U+005A only** (§5.3), never `str.lower()`.
- **`_trim` implements §R7's set**, never `str.strip()`.
- **`_unescape` is a single left-to-right pass** (§4.2). Sequential `str.replace` calls are
  wrong at *every* ordering: the wire value `\\n` must yield the two characters `\` and `n`,
  and a `\\`→`\` pass followed by a `\n`→newline pass collapses it to one newline.

## Go binding

`icalendar` (`sdks/go/icalendar/`) publishes **4** declarations, matching Python's count
exactly — unusual among these bindings, and only because `ParsedEvent`'s members are fields
rather than methods.

**Two names are spelled differently from Python's**: `Parse` and `Build`, where Python has
`parse_icalendar` and `build_vevent`. The rule is trim-what-the-package-says — `icalendar`
already supplies the noun, so `icalendar.ParseICalendar` stutters. These join
`contract.HandshakeExit` and `contract.Negotiate` as the module's only spelling divergences.
Note `jmapfastmail` does **not** trim, for the same reason: that package name supplies neither
Session nor Email nor Request, so `jmapfastmail.Parse` would name nothing.

Two things it does that the obvious Go does not:

- **`ParsedEvent`'s nine optional string members are `*string`, not `string`.** §R6's
  zero-value rule is wrong here: `SUMMARY:` with an empty value is a reachable, real answer
  that a zero-valued string cannot tell from no `SUMMARY` line at all. Measured: collapsing an
  absence into `""` fails **42 of the corpus's 48 parse cases**.
- **`foldASCII` iterates BYTES**, not runes, for §5.3's `mailto:` search. `strings.ToLower` is
  wrong twice over: it applies simple case mapping, so `İ` becomes one byte where JavaScript
  and Python produce two, and Go indexes bytes, so the resulting index is short rather than
  long. UTF-8 guarantees every byte of a multi-byte sequence is ≥ 0x80, so a byte loop cannot
  corrupt a character and is length-preserving by construction.

The `İ` correction here is the **opposite** of `connectorkit`'s `foldForSearch`: there the
goal is to *match* the other two languages' full case mapping, here it is to preserve length.
