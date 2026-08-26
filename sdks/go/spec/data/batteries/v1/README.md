# Nimbus batteries contract v1 — preamble

**Status:** normative. **Contract version:** `v1`.

This document is the preamble every battery specification in this directory defers to. It
does not specify a battery itself; it settles the six questions each of them would
otherwise answer separately, and answer differently.

The batteries specified here are:

| Document | Modules |
|---|---|
| [`data-profile.md`](./data-profile.md) | `data-profile` (TS), `nimbus_sdk.data_profile`, `dataprofile` (Go) |
| [`distribution-channel.md`](./distribution-channel.md) | `distribution-channel` (TS), `nimbus_sdk.distribution_channel`, `distributionchannel` (Go) |
| [`icalendar.md`](./icalendar.md) | `icalendar` (TS), `nimbus_sdk.icalendar`, `icalendar` (Go) |
| [`jmap.md`](./jmap.md) | `jmap-fastmail` (TS), `nimbus_sdk.jmap_fastmail`, `jmapfastmail` (Go) |

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

Each battery document names its own TypeScript reference implementation and its own
conformance corpus. Where prose and corpus appear to disagree, **the corpus is the
tiebreaker** — it is what CI runs.

The reasoning behind this area, and the decisions it depends on, are in
[RFC-0017](../../../rfcs/0017-battery-specifications.md).

## Why batteries have normative documents

A battery is not the contract. `NimbusItem` and the handshake are; `icalendar` is a helper
a connector author reaches for. The reason a helper still gets a specification is narrower
than "everything should be specified": **a helper that exists in three languages needs one
statement of behaviour rather than three readings of one implementation.**

The precedent is [`../../connector-kit/v1/url-resolution.md`](../../connector-kit/v1/url-resolution.md).
The counter-example is the rest of `connector-kit`: roughly forty names bound in three
languages from the TypeScript source alone, which produced four cross-language divergences,
every one found by hand and none by CI. RFC-0017's Problem section catalogues them.

## §R1 Scope, and injected I/O

These documents pin **input to output** for the pure surface of each battery. They do not
specify how a caller obtains the input, and they do not specify anything the module does not
compute from its arguments.

A battery that needs I/O is specified against **injected** inputs — an environment map, an
executable path, a realpath function — never against a real filesystem, network or clock.
`distribution-channel` is the case this rule exists for: it reads `process.env`,
`process.execPath` and `realpathSync` in TypeScript, and all three are injectable through
`ResolveChannelOptions`. A conformant binding MUST expose equivalent injection points, so
that the whole of its specified behaviour is reachable from a conformance case.

`icalendar`'s `buildVEvent` already follows this rule for time: it takes `now` as an
argument and never calls the clock.

## §R2 The tiebreak: where this document and the implementation disagree

Where a battery document and the shipped TypeScript reference disagree, **the document
states the correct behaviour and the implementation moves.** The change is authorised by an
RFC, and the correction is registered in
[RFC-0017 §6.1](../../../rfcs/0017-battery-specifications.md) so that a one-line fix cites an
existing RFC rather than opening one of its own.

Where the behaviour is a genuinely free choice — no external standard requires one answer,
and no binding is observably wrong — the document pins what the TypeScript reference already
does **and records that this is why**. A reader MUST be able to tell a decision from an
accident by reading the document alone.

## §R3 Undefined behaviour

A document MAY declare a specific input **undefined** for `v1`, following the precedent of
[`../../diagnostics/v1/diagnostics.md`](../../diagnostics/v1/diagnostics.md) §8.

Where an input is so declared:

- a binding MUST NOT be held to any particular result for it;
- no conformance case MAY pin a verdict for it;
- a binding MUST NOT invent one and document it as conformant behaviour.

Declaring an input undefined is a statement that the bindings are permitted to differ, not a
statement that they do.

## §R4 Closed vocabularies

Several of these batteries return strings drawn from JavaScript's own semantics. A value so
derived MUST be defined in the document as a **closed set of strings**, enumerated. It MUST
NOT be defined by reference to a host-language operation — "whatever `typeof` returns" names
nothing outside JavaScript.

A non-JavaScript binding implements a **mapping into** the enumerated set. Where its own type
system has no member corresponding to one of the strings, the document says so, and that
input falls under §R3.

Two vocabularies are governed by this rule: `data-profile`'s kind names, and §R6's whitespace
set.

## §R5 Builders are in scope, and pinned exactly

Where a battery builds a string — `icalendar`'s `buildVEvent`, `jmap`'s request builders —
the document pins the **exact output**, byte for byte, and a conformance case asserts it as a
literal.

This follows `url-resolution.md`, where the refusal *message* is contract text and not merely
the verdict: a binding that produces the right meaning in different words does not conform.
The reason is the same here. A caller that string-matches on a built value, or diffs two
bindings' output, is relying on the bytes; leaving them unspecified would make every such
caller's behaviour depend on which language its connector happened to be written in.

## §R6 Absence is a value, not an error

For input these functions cannot interpret — a line that is not JSON, a session document
missing a required member, an unrecognised channel marker — the result is an **absence**, not
a raised error:

| Binding | Absence |
|---|---|
| TypeScript | `null`, or `[]` for a list-returning function |
| Python | `None`, or `[]` |
| Go | the zero value, or an empty slice |

A binding MUST NOT raise, throw or return an error for input a document specifies as
producing an absence. Errors remain reserved for the transport-shaped failures the connector
kit already uses them for — a socket that closed, a status code that was not 2xx.

This is what the TypeScript reference already does; it is pinned here rather than left
implicit because it is the kind of decision a Go implementer would otherwise reverse on
idiom, `(T, error)` being the more natural Go shape.

## §R7 The normative whitespace set

Every `trim` these batteries perform MUST use exactly the following set of code points, and a
binding MUST NOT delegate to its host language's trim:

```
U+0009 U+000A U+000B U+000C U+000D U+0020 U+00A0 U+1680
U+2000 U+2001 U+2002 U+2003 U+2004 U+2005 U+2006 U+2007 U+2008 U+2009 U+200A
U+2028 U+2029 U+202F U+205F U+3000 U+FEFF
```

Trimming removes a maximal run of these code points from the start and the end of the value,
and nothing from its interior.

### §R7.1 Why the set is named at all

The three host runtimes disagree. Measured against CPython's `str.strip()`, Node's
`String.prototype.trim()` and Go's `strings.TrimSpace`:

| Code point | Python | JavaScript | Go | Outlier |
|---|---|---|---|---|
| U+001C–U+001F (file/group/record/unit separator) | strips | — | — | **Python** |
| U+0085 (NEL) | strips | — | strips | **JavaScript** |
| U+FEFF (BOM / ZWNBSP) | — | strips | — | **JavaScript** |

Every other code point tested agrees across all three: U+0009–U+000D, U+0020, U+00A0, U+1680,
U+2000, U+2028, U+2029, U+202F, U+205F, U+3000.

The consequence is not academic. A UTF-8 BOM is what Excel writes at the front of every CSV
it exports, so `parseCsvHeader` on a BOM-prefixed header line yields a first column named
`id` in TypeScript and U+FEFF followed by `id` in Python and Go.

### §R7.2 Why it is enumerated rather than referenced

The set above is ECMA-262's `WhiteSpace` plus `LineTerminator`. It is written out rather than
cited because ECMA-262 defines `WhiteSpace` partly by **Unicode general category Zs**, which
is version-dependent: a future Unicode assigning a new Zs code point would change what
`String.prototype.trim()` does, silently, with no change to this document or to any binding.

This is §R4 applied to a second JavaScript-derived vocabulary. A closed set means closed.
**All three bindings implement the set**, TypeScript included — its helper is
behaviour-identical to `.trim()` on every one of the 0x110000 code points today, and a test
re-runs that sweep so the day they diverge is a failing build rather than a silent
divergence.
