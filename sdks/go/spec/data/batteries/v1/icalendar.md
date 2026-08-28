# Nimbus icalendar battery contract v1

**Status:** normative. **Contract version:** `v1`.

This document specifies the `icalendar` battery: parsing VEVENT blocks out of an iCalendar
(ICS) document, and building one. It is a deliberately partial implementation of
[RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) — §9 says exactly which parts, and why
that is specified rather than apologised for.

Read [`./README.md`](./README.md) first — its rules §R1–§R7 apply here and are not repeated.
The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is
[`sdks/typescript/src/icalendar.ts`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/sdks/typescript/src/icalendar.ts),
published from the `.` entry point. The executable form of this document is the corpus at
[`../../conformance/v1/icalendar/`](../../conformance/v1/icalendar/). Where prose and corpus
appear to disagree, the corpus is the tiebreaker.

## §1 Scope

Two functions and two shapes.

```
parseICalendar(ics: string) -> ParsedEvent[]
buildVEvent(input: BuildEventInput, now: string) -> string
```

`ParsedEvent` has thirteen members, every one of them present on every returned event:

| Member | Type | Absence |
|---|---|---|
| `uid` | string | never absent — a block without one is dropped (§5.1) |
| `recurrenceId` | string or absent | absent |
| `summary` | string or absent | absent |
| `description` | string or absent | absent |
| `location` | string or absent | absent |
| `start` | string or absent | absent |
| `end` | string or absent | absent |
| `allDay` | boolean | `false` — never absent |
| `status` | string or absent | absent |
| `organizer` | string or absent | absent |
| `attendees` | list of string | empty list, never absent |
| `rrule` | string or absent | absent |
| `dtstamp` | string or absent | absent |

`BuildEventInput` has seven, three of them optional:

```
uid, summary, start, end          -- required strings
description, location             -- optional strings
attendees                         -- optional list of strings
```

Date-time values are carried as **opaque strings**. This battery does not parse, validate,
normalise or convert them, and MUST NOT: `start`, `end`, `dtstamp` and `now` pass through
unexamined. A binding that reaches for its language's date type here will disagree with the
other two about time zones, leap seconds and formatting, none of which this contract has an
opinion about.

`buildVEvent` takes `now` as an argument and MUST NOT read a clock — §R1.

## §2 Unfolding

Before anything else, `parseICalendar` unfolds, in two steps and this order:

1. **Normalise line endings.** Every `\r\n` or bare `\n` becomes `\r\n`. A lone `\r` is not a
   line ending and is left alone.
2. **Unfold.** Every occurrence of `\r\n` immediately followed by a SPACE (U+0020) or HTAB
   (U+0009) is removed in its entirety — **all three characters**, the CRLF and the
   whitespace that follows it.

This matches RFC 5545 §3.1: a fold inserts CRLF plus one whitespace character, and unfolding
discards both, so the logical line resumes at the character after the whitespace. A binding
that removes only the CRLF leaves a spurious space at every fold point, which is a silent
corruption of the user's text — `SUMMARY:Hello\r\n World` must yield `HelloWorld`, not
`Hello World`.

Step 1 accepting a bare `\n` is deliberate: real calendar servers emit LF-only ICS, and
rejecting it would fail on documents every other client reads. A lone `\r` is not a line
ending here, so `\r` followed by a space is not a fold.

## §3 Content line structure

A **content line** has the form `NAME[;PARAM=VALUE[;PARAM=VALUE...]]:VALUE`.

### §3.1 The name

Everything before the first `;` or the first `:`, whichever comes first, **uppercased**.
Property names are case-insensitive, and a binding MUST uppercase rather than compare
case-insensitively, because the uppercased form is what §5's table is keyed by.

If the line contains no `:` at all, the name is the entire line, uppercased, and its value is
the empty string.

### §3.2 The value

Everything after the **first `:` in the line**.

The reference implementation's comment claims this is the first *unescaped* colon. It is not
— the code takes the first colon unconditionally, and this document specifies the code. The
difference is reachable: RFC 5545 permits a colon inside a double-quoted parameter value, so
`ATTENDEE;CN="Doe: Jane":mailto:jane@example.com` has its name and value split at the colon
inside the quotes.

This is specified as the first colon rather than corrected, for the same reason
`data-profile` §3.1 keeps its naive CSV split: the failure mode is a mis-parsed property on
an unusual input, all three bindings agree on it exactly, and a binding that implemented
quoted-parameter awareness would return different events from the same document. §9 records
it.

### §3.3 Parameters

A line carries the parameter `NAME=VALUE` when **all** of:

- the line contains a `:`;
- the line contains a `;`, and that `;` comes **before** the first `:`;
- the section between that first `;` and the first `:`, uppercased and split on `;`, contains
  `NAME=VALUE` uppercased as a **whole element**.

Whole-element matching is load-bearing. A substring test would make `VALUE=DATE` match
`VALUE=DATE-TIME`, turning every timed event into an all-day one.

## §4 Escaping

The two directions are **not symmetric**, and neither is the inverse of the other. A binding
MUST implement both as specified rather than deriving one from the other.

### §4.1 Escaping, for building

Applied to `SUMMARY`, `DESCRIPTION` and `LOCATION` values only (§6). Four replacements, **in
this order**:

1. `\` becomes `\\`
2. `;` becomes `\;`
3. `,` becomes `\,`
4. `\r\n` or a bare `\n` becomes `\n` (backslash, lowercase n)

Order is load-bearing. Escaping backslashes first is what stops step 4's emitted backslash
from being escaped again; any other order corrupts a value containing a literal backslash.

A colon is **not** escaped. RFC 5545 does not require it in a TEXT value, and §3.2 splits on
the first colon, which is always the property's own separator in a line this function builds.

### §4.2 Unescaping, for parsing

Applied to `SUMMARY`, `DESCRIPTION` and `LOCATION` (§5). A **single left-to-right pass**, not
a sequence of global replacements:

- At a `\` that is not the last character, consume it and the character after it, and emit:
  a newline (U+000A) if that character is `n` or `N`; otherwise that character literally. So
  `\\` yields `\`, `\;` yields `;`, `\,` yields `,`, and `\q` yields `q`.
- A `\` that **is** the last character of the value is emitted as itself.
- Every other character is emitted as itself.

A binding MUST NOT implement this as sequential global replacements at any ordering. The wire
value `\\n` — an escaped backslash followed by a literal `n` — must yield the two characters
`\` and `n`; a `\\` → `\` pass followed by a `\n` → newline pass collapses it to a single
newline instead. Only a single pass that consumes the escaped character is correct.

Note that unescaping accepts escapes escaping does not produce (`\q` yields `q`) and maps two
sequences to one result (`\n` and `\N` both yield a newline). It is deliberately lenient,
because it reads documents this library did not write.

## §5 Parsing

`parseICalendar` unfolds (§2), splits into VEVENT blocks, and parses each.

### §5.1 Block extraction

The unfolded text is split on `\r\n`. A line whose uppercased form is exactly `BEGIN:VEVENT`
opens a block and discards anything accumulated; a line whose uppercased form is exactly
`END:VEVENT` closes it. Lines between them are the block; lines outside any block are
discarded, which is how `VCALENDAR` headers, `VTIMEZONE` components and trailing content are
ignored.

An unterminated final block — `BEGIN:VEVENT` with no matching `END:VEVENT` — is **discarded**,
not emitted.

Each block is then parsed by §5.2. A block that yields no event is skipped, and parsing
continues with the next.

### §5.2 Property mapping

Within a block, empty lines and lines that are entirely whitespace per §R7 are skipped. Each
remaining line's name (§3.1) selects a member:

| Name | Member | Treatment of the value |
|---|---|---|
| `UID` | `uid` | trimmed (§R7) |
| `RECURRENCE-ID` | `recurrenceId` | trimmed |
| `SUMMARY` | `summary` | unescaped (§4.2) — **not** trimmed |
| `DESCRIPTION` | `description` | unescaped — not trimmed |
| `LOCATION` | `location` | unescaped — not trimmed |
| `DTSTART` | `start`, and `allDay` | trimmed; `allDay` is set to whether this line carries `VALUE=DATE` per §3.3 |
| `DTEND` | `end` | trimmed |
| `STATUS` | `status` | trimmed |
| `ORGANIZER` | `organizer` | §5.3 |
| `ATTENDEE` | appended to `attendees` | §5.3 |
| `RRULE` | `rrule` | trimmed |
| `DTSTAMP` | `dtstamp` | trimmed |

Any other name is **ignored**. Unknown properties are not an error and are not retained.

The trimmed/not-trimmed split is not an oversight: leading or trailing whitespace in a
`SUMMARY` is part of the text a user typed, where whitespace around a `UID` or a timestamp is
noise. A binding MUST NOT trim the three text properties.

**Repeats: last wins, except attendees.** A block with two `SUMMARY` lines keeps the second.
A block with two `DTSTART` lines keeps the second — including its `allDay`, which is
recomputed per line and therefore reflects the last `DTSTART` only. `ATTENDEE` accumulates in
document order.

### §5.3 Addresses

`ORGANIZER` and `ATTENDEE` values are searched **case-insensitively** for the first occurrence
of `mailto:`. The address is everything after it, trimmed (§R7). If the value contains no
`mailto:`, the result is an absence.

The fold used for that search is **ASCII only**: U+0041–U+005A map to U+0061–U+007A, and
every other code point is compared as written. A binding MUST NOT delegate to its host
language's lowercase, for the reason §R7 gives for trimming — the three hosts disagree — and
here they disagree about **length**, which corrupts the index the address is sliced at.
U+0130 (`İ`) is the only code point where this is observable, and it is observable three
different ways: JavaScript's `toLowerCase()` and Python's `.lower()` both expand it to two
code points, while Go's `strings.ToLower` applies simple case mapping and *contracts* it to
one byte. A binding searching a folded copy and slicing the original therefore drops a
leading character in two languages and gains one in the third.

Restricting the fold to ASCII never loses a match: no code point outside U+0041–U+005A has a
lowercase mapping that reaches any character of `mailto:`, and the one multi-character
lowercase expansion in Unicode inserts a combining mark that breaks the needle rather than
completing it. An ASCII fold is also length-preserving in UTF-16 code units, in code points
and in bytes alike, so one rule is correct under all three languages' indexing.

- `organizer` is set to that result, absence included.
- An `ATTENDEE` is appended only when the extraction produced a non-empty string. An attendee
  line with no `mailto:`, or with nothing after it, contributes nothing — `attendees` never
  contains an absence or an empty string.

The search is over the whole value, so prefix text ahead of the address is tolerated.

Note what this does **not** mean: in `ATTENDEE;CN=Jane:mailto:…` the parameters do not reach
this search at all, because §3.2 removes everything up to and including the first colon, and
the parameter section sits before it. A parameter reaches the value only when the first colon
is *not* the property separator — §9 divergence 1, a colon inside a quoted parameter value.
That is worth stating precisely, because it decides which inputs can exercise the ASCII-fold
rule above: an ordinary `CN=İstanbul` parameter cannot, and a corpus case built on one would
pin nothing.

### §5.4 Dropping a block

A block is dropped, contributing no event, when its `uid` is absent or is the empty string
after trimming. Everything else parsed from that block is discarded with it.

An event without a UID cannot be correlated with an update or a cancellation, so a caller
that received one could not do anything correct with it.

### §5.5 Never raises

`parseICalendar` MUST NOT raise for any input string. A block that fails to parse is skipped
and the remaining blocks are still returned; a failure spanning the whole document yields an
empty list. Malformed input produces fewer events, never an error (§R6).

## §6 Building

`buildVEvent(input, now)` returns the concatenation of the following lines, each terminated
by CRLF — **including the last**, so the returned string always ends with CRLF.

| # | Line | Present |
|---|---|---|
| 1 | `BEGIN:VCALENDAR` | always |
| 2 | `VERSION:2.0` | always |
| 3 | `BEGIN:VEVENT` | always |
| 4 | `UID:` + `input.uid` | always |
| 5 | `DTSTAMP:` + `now` | always |
| 6 | `DTSTART:` + `input.start` | always |
| 7 | `DTEND:` + `input.end` | always |
| 8 | `SUMMARY:` + escape(`input.summary`) | always |
| 9 | `DESCRIPTION:` + escape(`input.description`) | when `description` is supplied |
| 10 | `LOCATION:` + escape(`input.location`) | when `location` is supplied |
| 11… | `ATTENDEE:mailto:` + address, one line per address, in order | when `attendees` is supplied |
| n−1 | `END:VEVENT` | always |
| n | `END:VCALENDAR` | always |

Per §R5 this is pinned byte for byte.

Four properties of this list a binding MUST reproduce exactly:

- **Only lines 8, 9 and 10 are escaped.** `uid`, `now`, `start`, `end` and each attendee
  address are interpolated raw. A caller supplying a `uid` containing a newline produces an
  invalid document, and that is the caller's error, not this function's to repair.
- **`PRODID` is absent**, though RFC 5545 §3.6 requires it in a VCALENDAR. §9 records this.
- **An empty `attendees` list contributes no lines**, and is indistinguishable in the output
  from `attendees` being omitted.
- **A supplied-but-empty `description` still emits `DESCRIPTION:`** with an empty value.
  Presence is tested, not truthiness — a binding testing for a non-empty string omits the
  line and does not conform.

## §7 Folding: not performed

**`buildVEvent` does not fold.** A line of any length is emitted whole.

RFC 5545 §3.1 says a content line SHOULD be folded so that no line exceeds 75 octets, so this
is a divergence from the RFC and not merely an unspecified area. It is **settled** by
[RFC-0018](../../../rfcs/0018-icalendar-line-folding.md), which decided against folding for
`v1`: RFC 5545 makes folding a SHOULD while making unfolding unconditional for every reader,
so no conformant consumer can observe the difference; §6 already declines this class of
repair for an embedded newline; and the naive implementation differs per language (§7.1).
The behaviour is what ships, and a binding MUST reproduce it.

Two conformance cases pin this directly — a `SUMMARY` exceeding 75 octets in ASCII, and one
exceeding it with multi-octet characters straddling the boundary — each expecting an output
with no CRLF-plus-whitespace sequence anywhere. A binding that folded would fail both.

### §7.1 What a future revision is constrained to, if folding is added

Should folding ever be added, it MUST be code-point aligned: the fold point is the **last
code-point boundary at or before 75 octets**, never a blind cut at octet 75.

RFC 5545 §3.1 anticipates the failure:

> It is possible for very simple implementations to generate improperly folded lines in the
> middle of a UTF-8 multi-octet sequence. For this reason, implementations need to unfold
> lines in such a way to properly restore the original sequence.

Placing the burden on the unfolder is not sufficient here, because the prohibition is
unconditional: RFC 5545 forbids generating such a fold in the first place, and a document
that contains one is malformed whatever any particular reader does with it.

The consequence lands on any consumer that streams raw ICS through a **line-oriented
decoder**, which is an ordinary way to read an `.ics` file: each folded segment reaches the
decoder as an individually invalid UTF-8 line, with no way to know a continuation is coming.
That yields a U+FFFD substitution in the middle of a user's text, and — where the decoder
also enforces a length limit measured on decoded octets, as `ipc`'s framing does — a longer
line than the fold was meant to produce.

> **This paragraph previously claimed the hazard was reachable through `ipc`'s own NDJSON
> line reader.** It is not. The reader does decode before any unfolding, but an ICS document
> travelling through this SDK is carried as a **JSON string value inside an NDJSON frame**,
> so its own CRLFs are escaped within that string and the reader never splits on them — it
> sees one frame, not one line per folded segment. The rule above is unchanged; only its
> justification is corrected, by
> [RFC-0018](../../../rfcs/0018-icalendar-line-folding.md), which records why.

A second reason the alignment must be specified rather than assumed: the naive
implementation differs per language. RFC 5545 counts **octets**, JavaScript's `.length`
counts UTF-16 code units, Python's `len()` counts code points, and Go's `len()` counts
bytes — so `slice(0, 75)` cuts in three different places on the same string.

**No case in the corpus enforces this *alignment* rule, and none can.** §7 specifies a builder
that does not fold, so a `build` case whose fold point falls inside a multi-octet sequence
has no fold to assert against — it would pin the unfolded output and pass whether or not a
future implementation aligned its folds correctly.

The alignment fixture is therefore *reserved*, not present: whichever change adds folding adds
it too, and until then this subsection constrains that change rather than the corpus. It is
written now because the constraint is easiest to agree while nothing depends on it, and
because an implementer reaching for `slice(0, 75)` needs to find the rule before writing the
code, not after.

**This is a gap in §7.1 only, not in §7.** §7's own claim — that a long line is emitted whole
— *is* directly assertable, and the corpus asserts it with the two cases §7 names. Do not
read this paragraph as saying line folding is untested; read it as saying the rule for a fold
that never happens cannot be.

## §8 Whitespace

The nine trim operations in this battery — §5.2's seven trimmed properties, §5.2's
whitespace-only line test, and §5.3's address trim — use §R7's normative set.

## §9 Known divergences from RFC 5545

Recorded so that a reader can tell a decision from an omission, and so that a binding author
does not "fix" one and break cross-language agreement. Every item is required behaviour.

| # | Divergence | Section |
|---|---|---|
| 1 | The value begins after the first colon, even one inside a quoted parameter | §3.2 |
| 2 | `buildVEvent` does not fold at 75 octets | §7 |
| 3 | `buildVEvent` emits no `PRODID`, which §3.6 of the RFC requires | §6 |
| 4 | Only VEVENT is read; VTODO, VJOURNAL, VFREEBUSY and VTIMEZONE are discarded | §5.1 |
| 5 | Date-time values are opaque strings — never parsed, validated or converted | §1 |

Item 1 is a candidate for correction under §R2 and would need an RFC of its own. Items 2, 3,
4 and 5 are settled scope decisions: this battery reads and writes the calendar data a Nimbus
connector exchanges, and is not a general iCalendar library. Item 2 was settled by
[RFC-0018](../../../rfcs/0018-icalendar-line-folding.md), which decided against folding for
`v1` and left §7.1 standing as a constraint on any future revision that adds it.

Unfolding is **not** on this list. An earlier draft of §2 recorded it as a divergence, on the
reading that only the CRLF was removed; running the implementation showed the whitespace is
removed too, and that §2 is RFC-conformant. The entry is mentioned here only because the
mistake is an easy one to repeat from the source comment alone.
