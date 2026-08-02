# Nimbus diagnostics / telemetry contract v0

**Status:** normative. **Contract version:** `v1`.

This document specifies the one structured envelope a Nimbus connector uses to report what
it is doing — a diagnostic, or an audit record — to the gateway that spawned it, without
carrying row data, secrets, or free text. Every binding, in every language, MUST encode and
reject events identically for a connector written in one language to be interchangeable with
a connector written in another.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is
[`sdks/typescript/src/diagnostics/`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/sdks/typescript/src/diagnostics),
published from the fifth `exports` entry point, `@nimbus-dev/sdk/diagnostics`; the Python
reference implementation is `nimbus_sdk.diagnostics`. The executable form of this document is
the corpus at [`../../conformance/v1/diagnostics/`](../../conformance/v1/diagnostics/). Where
prose and corpus appear to disagree, the corpus is the tiebreaker — it is what CI runs.

## 1. Scope

This document specifies:

- The **envelope** — the fixed set of members a diagnostic event may carry (§3).
- The **levels** — the ordered severity set every event declares one of (§6).
- The **encoding** rules that make two bindings produce the identical line for the identical
  input (§4).
- The **rejection reasons** a conformant implementation reports, and the order it checks them
  in (§5).

Out of scope:

- **The transport.** A conformant emitter SHOULD write encoded lines as NDJSON on the
  connector's standard error stream. It MUST NOT write them to the frame stream —
  [`negotiation/v1/contract-version.md`](../../negotiation/v1/contract-version.md) §5 already
  requires that "a peer's diagnostics MUST travel somewhere other than the frame stream," and
  this document is the answer that requirement deferred to something else defining. Which
  physical stream carries diagnostic lines beyond that one exclusion is not normative here —
  see §7.
- **Sampling, rate limiting, and log-level configuration.** Runtime policy a host applies on
  top of this contract, not part of it.
- **Retention.** What a gateway does with a line once it has read one is entirely its own
  concern.
- **`createScopedAuditLogger`'s free-form payload.** It remains available, is marked
  `@deprecated` as of this change, and is on its own removal schedule — see
  [RFC-0010](../../../rfcs/0010-diagnostics-contract-v0.md). This document does not specify
  its shape, only that it is being superseded.

## 2. Terminology

- **Event** — one occurrence of the envelope defined in §3, either as the value a caller
  constructs or as the one line it encodes to. This document uses "event" for both; context
  disambiguates.
- **Level** — one of the four ordered severities defined in §6, naming how serious the
  occurrence is.
- **Emitter** — the SDK-side helper a connector calls to build and hand off an event. It
  validates and encodes; it does not itself decide where the line goes.
- **Sink** — the destination a caller supplies to an emitter to receive an encoded line —
  typically a write to standard error, but the contract does not constrain what a sink is,
  only that the emitter never blocks on it indefinitely (§7).

## 3. The envelope

```json
{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page","correlationId":"01J9Z4Q7","fields":{"items":42,"ms":118,"partial":true}}
```

| Member | Required | Rule |
|---|---|---|
| `nimbus` | MUST | The literal `"diag"`. The discriminator, so a diagnostic line is never mistaken for a hello or a gateway envelope. |
| `ts` | MUST | `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`. Caller-supplied. |
| `level` | MUST | One of `debug`, `info`, `warn`, `error`. Published as an **ordered** array. |
| `extensionId` | MUST | A non-empty string. Emptiness, not blankness. |
| `event` | MUST | `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`. |
| `kind` | MAY | `"diagnostic"` (the meaning of absence) or `"audit"`. |
| `correlationId` | MAY | `^[A-Za-z0-9_-]{1,64}$`. Absence means "not attributable to one request". |
| `fields` | MAY | Keys `^[a-z][a-z0-9]*$`, at most 16. Values **only** booleans and integers in ±(2⁵³−1). |
| `error` | MAY | An object. When present, `code` is **required** and matches `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`; `retriable` is an optional boolean. No other member, and in particular no `message` and no `stack` — a stack trace is free text with extra steps, carrying file paths and interpolated values. |

Members this document does not name **MUST be rejected**, as `unknown-member` (§5). The total
encoded line MUST NOT exceed `IPC_MAX_LINE_BYTES` — the frame size limit
[`wire/v1/framing.md`](../../wire/v1/framing.md) §6 already defines, named here rather than
restated, since a diagnostic line SHOULD travel as NDJSON and is subject to the same size
discipline as any other frame even though it never travels *on* the frame stream itself.

**The envelope is closed; the hello is open.**
[`contract-version.md` §5](../../negotiation/v1/contract-version.md) requires that a hello's
unknown members be *ignored*. This document requires that a diagnostic event's unknown
members be *rejected*. That inversion is the entire redaction guarantee this contract
provides: an open envelope has an unbounded number of places to put a secret, so
`{"message":"row 7 failed for SELECT *"}` fails as `unknown-member` rather than travelling
silently to whatever the gateway persists. Openness is correct for a negotiation frame that
must stay readable across a future contract major; closedness is correct for a redaction
envelope, and the two documents pin opposite behaviors on purpose.

## 4. Encoding

The canonical line form is the exact bytes a conformant encoder MUST produce for a given
valid event, so that two bindings encoding the same input produce byte-identical output. Four
rules together define it:

1. **Fixed member order.** A conformant encoder MUST emit an event's members, when present,
   in this order and no other: `nimbus`, `ts`, `level`, `extensionId`, `event`, `kind`,
   `correlationId`, `fields`, `error`. A member that is absent from the input is omitted
   entirely from the output — never emitted as an explicit `null` placeholder.
2. **`fields` keys sorted ascending by code point.** `fields` is the one member whose key
   order the caller controls rather than the spec; without this rule, two call sites building
   the same event by different routes would produce two different lines. The `[a-z0-9]`
   alphabet sorts identically as code points and as ASCII bytes in every language, so this
   costs a binding one `sort()`.
3. **No insignificant whitespace.** A conformant encoder MUST use compact separators: `,` and
   `:`, with nothing else around them. `{"a":1,"b":2}`, never `{"a": 1, "b": 2}`.
4. **Non-ASCII characters are NOT escaped.** A conformant encoder MUST emit UTF-8 bytes
   directly rather than a `\uXXXX` escape for any code point that does not require one.
   `JSON.stringify` already does this; Python's `json.dumps` does not unless called with
   `ensure_ascii=False`, which a conformant Python encoder MUST pass.

**The integral-value rule.** A binding MUST accept a JSON number whose value is an integer,
however its host language types it, and MUST encode it without a fractional part. `1.0` and
`1` are the same JSON value; a binding that rejects the former is non-conformant. JSON has one
number type — the distinction between an integer *value* and an integer *host type* is
load-bearing, because `JSON.parse('{"a":1.0}')` yields `1` in JavaScript (which cannot see a
float there at all) while Python's `json.loads` yields the float `1.0`. A rule phrased as
"reject floats" is therefore silently satisfied by JavaScript and silently violated by Python
on the identical wire input. The correct predicate is "is the value's magnitude a whole
number" — true for `1.0`, false for `1.5` — evaluated on the value, never on which host type
carried it.

Two further encoding requirements fall directly out of this rule and out of §3's numeric
bound:

- **Non-finite numbers MUST be rejected**, as `invalid-field-value`. Python's `json.dumps`
  emits bare `NaN` and `Infinity` for those values, which are not valid JSON; JavaScript's
  `JSON.stringify` silently emits `null` for the same input. Left unchecked, one binding
  produces an unparseable line and the other produces a lie about what was recorded.
- **A `fields` value MUST NOT exceed ±(2⁵³−1)** — the same bound
  [`contract-version.md` §6](../../negotiation/v1/contract-version.md) already applies to
  avoid float-precision loss: Python encodes 2⁵³+1 exactly, JavaScript cannot represent it, so
  a bound both languages hold exactly is the only one either can be pinned to.

## 5. Rejection reasons

Encoding a caller-supplied value, or reading a diagnostic line already known to be JSON, can
fail for one of the following reasons. A reader MUST use these exact tokens — they are not
diagnostic color, they are data the corpus pins per case. A conformant implementation checks
them in the order below: each row is reachable only once every row above it has passed.

| Reason | Triggers when |
|---|---|
| `not-object` | The value is not a JSON object — `null`, an array, a string, a number, or a boolean. |
| `unknown-member` | The value carries a member §3 does not name. |
| `invalid-ts` | `ts` is absent, is not a string, or does not match the §3 pattern. |
| `invalid-level` | `level` is absent, is not a string, or is not one of the four values in §6. |
| `invalid-extension-id` | `extensionId` is absent, is not a string, or is the empty string. |
| `invalid-event` | `event` is absent, is not a string, or does not match the §3 pattern. |
| `invalid-kind` | `kind` is present and is neither `"diagnostic"` nor `"audit"`. |
| `invalid-correlation-id` | `correlationId` is present and does not match the §3 pattern. |
| `invalid-fields` | `fields` is present and is not a JSON object. |
| `invalid-field-key` | Some key of `fields` does not match `^[a-z][a-z0-9]*$`. |
| `invalid-field-value` | Some value of `fields` is neither a boolean nor an integer within ±(2⁵³−1) — including a non-integral number, a non-finite number, a string, an object, an array, or `null`. |
| `too-many-fields` | `fields` has more than sixteen members. |
| `invalid-error` | `error` is present and is not an object, is missing `code`, has a `code` that fails the §3 pattern, has a `retriable` that is not a boolean, or carries any member other than `code` and `retriable`. |
| `line-too-long` | The encoded line, in UTF-8 octets, exceeds `IPC_MAX_LINE_BYTES`. |

A `path` value is a JSON Pointer ([RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)), and
every caller-controlled token it carries MUST be escaped per RFC 6901 §3: `~` becomes `~0`
and `/` becomes `~1`, `~` escaped first so the `~0` it introduces is never re-escaped by the
second substitution. This is reachable, not theoretical: a caller supplying a member literally
named `a/b` — rejected as `unknown-member` — MUST render as `/a~1b`, never `/a/b`, because the
unescaped form is indistinguishable from a two-level pointer into a nested member that was
never sent. A binding that interpolates a caller-controlled key into `path` without this step
produces a syntactically valid but semantically wrong pointer, and does so silently — nothing
about the line itself signals the mistake.

`invalid-field-key` and `invalid-field-value` (the two rows above for `fields`) are evaluated
as two SEPARATE passes over the whole object: every key is checked against the pattern first,
across every member, before any value is checked at all. `{"a":"bad","B":1}` MUST report
`invalid-field-key` at `/fields/B`, never `invalid-field-value` at `/fields/a`, even though
`a`'s value would be reached first under insertion order. A single pass that checks a key and
then its value before moving to the next key is the shape one binding reaches for naturally and
another does not, and the two would then disagree on exactly this combined-fault input; fixing
the pass structure, not just the reason order, is what keeps them identical.

### 5.1 Two reasons that belong to parsing only

The table above governs both directions: it is what a caller-supplied value is checked
against on encode, and — once a line is already known to be syntactically valid JSON — what
the parsed value is checked against on parse. Two further reasons exist, and apply to parsing
only, because each concerns a channel that has no counterpart on the encode side: encoding
starts from an in-memory value that is already JSON-shaped and whose `nimbus` member the
encoder itself supplies as the literal `"diag"`, never something a caller can get wrong.

A conformant parser MUST check reasons in exactly this order — the fourteen-row table above,
with these two reasons inserted rather than prepended wholesale:

1. `not-json` — the only reason checked before the table's own first row. There is no parsed
   value to classify as an object or not until the line has parsed as JSON at all.
2. `not-object` — the table's own row 1, reached in its normal position.
3. `wrong-message` — inserted immediately after `not-object` and before every remaining row of
   the table, `unknown-member` included.
4. The table's rows 2 through 14, `unknown-member` through `line-too-long`, in the order
   already listed above.

| Reason | Triggers when |
|---|---|
| `not-json` | The line does not parse as JSON at all. |
| `wrong-message` | `nimbus` is absent, or present but not exactly the string `"diag"`. |

This mirrors the first three rows of
[`contract-version.md`](../../negotiation/v1/contract-version.md)'s seven-row hello table,
which names the same three tokens for the same reason: a message that does not even claim to
be the kind of frame this document describes should be told apart before any member-level
check runs — `unknown-member`, the closedness check, included.

`sink-failed` is deliberately **not** a reason this document defines. Whether writing an
already-encoded line to whatever sink a caller supplied succeeds is an I/O outcome, not a
contract violation — the line was valid the moment it was encoded, and this document has
nothing more to say about what happens to it afterward.

## 6. Levels

The four levels, in ascending order of severity:

```
debug < info < warn < error
```

[`levels.json`](./levels.json) is this order's published form:

```json
{ "levels": ["debug", "info", "warn", "error"] }
```

A level `L` is **at or above** a threshold `T` if and only if `L`'s index in the published
array is greater than or equal to `T`'s index. `warn` is at or above `info`; `debug` is not at
or above `info`. This definition is over the published array's index, never over a
hard-coded number in any binding's own source — which is exactly what the drift guard between
this file and each runtime's own copy of the order protects.

## 7. Transport

A conformant emitter SHOULD write each encoded line to the connector's standard error stream,
as NDJSON — one complete line per event, terminated the way
[`wire/v1/framing.md`](../../wire/v1/framing.md) §3 already defines a frame.

A conformant emitter MUST NOT write a diagnostic line to the frame stream. That stream is
reserved, in full, for the hello and for whatever gateway envelope a future document defines
on top of it; a diagnostic line arriving there is indistinguishable, to a reader expecting
only those frames, from protocol corruption. This is the MUST NOT half of the referral
[`contract-version.md` §5](../../negotiation/v1/contract-version.md) already states in the
other direction, and this document is its answer.

Which physical stream carries diagnostic lines beyond that one exclusion — standard error, a
dedicated file descriptor, a log file the gateway tails — is deliberately not fixed as a MUST
here, for the same reason no transport claim in this package's other specs is: this package
performs no I/O and owns no process, so it cannot execute a transport claim, only describe
one a host is free to choose among.

## 8. What this specification does not give you

**No proof that any connector emits anything.** This document specifies the envelope and its
encoding. It does not, and cannot, prove that a real connector ever calls an emitter, or that
a real gateway ever reads what it writes — the same honesty
[`contract-version.md` §8](../../negotiation/v1/contract-version.md) applies to its own exit
code.

**`correlationId` bounding is a speed bump, not a secrecy proof.** Sixty-four characters of
`[A-Za-z0-9_-]` admits UUID, ULID, and hex, and admits no sentence — but a determined author
can still encode something meaningful into 64 URL-safe characters. This constraint removes
the *accidental* path a free-text field would otherwise leave open; it does not, and does not
claim to, remove the deliberate one.

**Lone surrogates in `extensionId` are undefined behaviour in v0.** `extensionId` is checked
only for emptiness (§3); nothing here excludes an ill-formed UTF-16 sequence such as a lone
`\uD800`. JavaScript can construct and emit one; Python's `json.dumps(..., ensure_ascii=False)`
cannot encode it as UTF-8 at all. No case in the conformance corpus pins a verdict for this
input, and none should until the manifest rule registry — which owns `extensionId`'s actual
format — constrains the identifier enough to rule the question out structurally, rather than
this document inventing an encoding-layer answer to a format question it does not own.

**No cross-member constraints.** An `error` member is permitted at any `level`, including
`debug`. A rule such as "`error` requires `level: error`" would be an invented constraint —
and every invented constraint here is one more place two bindings could disagree about
whether it was checked, when nothing about the redaction guarantee needs it.

---

Changes here follow the [RFC process](../../../GOVERNANCE.md#the-rfc-process) — see
[RFC-0010](../../../rfcs/0010-diagnostics-contract-v0.md).
