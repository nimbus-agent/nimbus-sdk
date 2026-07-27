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
