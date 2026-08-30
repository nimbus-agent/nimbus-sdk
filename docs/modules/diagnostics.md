<!-- covers: diagnostics/event, diagnostics/emitter
     py: diagnostics/event, diagnostics/timestamp
     go: diagnostics/emitter, diagnostics/encode, diagnostics/event -->

# `diagnostics`

The structured, redaction-safe diagnostic and audit envelope. Its own entry point:
`import { createEmitter } from "@nimbus-dev/sdk/diagnostics"`.

The normative specification is
[`spec/diagnostics/v1/diagnostics.md`](../spec/diagnostics/v1/diagnostics.md), and the
corpus at [`spec/conformance/v1/diagnostics/`](../spec/conformance/v1/diagnostics/) holds
this implementation to it on every PR. This page is the TypeScript usage guide; the spec
is the contract.

## What the envelope is

One JSON object per line, written as NDJSON to the connector's standard error stream —
never to the frame stream, which is reserved for the hello and whatever gateway envelope
`contract-version.md` builds on top of it. A conformant line looks like:

```json
{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page","correlationId":"01J9Z4Q7","fields":{"items":42,"ms":118,"partial":true}}
```

| Member | Required | Rule |
|---|---|---|
| `nimbus` | MUST | The literal `"diag"`. |
| `ts` | MUST | `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`. Caller-supplied — this module reads no clock. |
| `level` | MUST | One of `debug`, `info`, `warn`, `error`, in ascending severity. |
| `extensionId` | MUST | A non-empty string. |
| `event` | MUST | `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`. |
| `kind` | MAY | `"diagnostic"` (the meaning of absence) or `"audit"`. |
| `correlationId` | MAY | `^[A-Za-z0-9_-]{1,64}$`. |
| `fields` | MAY | Keys `^[a-z][a-z0-9]*$`, at most 16. Values only booleans and integers in ±(2⁵³−1). |
| `error` | MAY | `{ code, retriable? }` only — no `message`, no `stack`. |

Any other member is rejected as `unknown-member`. See the next section for why.

## Why redaction is structural

The envelope is **closed** where the hello frame `contract-version.md` defines is
**open**: a hello's unknown members must be ignored, so the frame can stay readable
across a future contract major, but a diagnostic event's unknown members must be
rejected. That inversion is the entire guarantee.

An open envelope has an unbounded number of places to put a secret — a `message` field,
a `context` blob, an extra key nobody reviewed — and every one of them is a channel a row
value, a credential, or a stack trace can travel through unexamined. This envelope has
none of those *extra* places: `nimbus`, `ts`, `level`, `extensionId`, `event`, `kind`,
`correlationId`, `fields`, and `error` are the whole set, and every other shape at every
position is a rejection, not a pass-through. Within that set, `fields` is closed to free
text entirely — it admits only bounded identifiers as keys and only booleans or integers
as values, so there is no room in a `fields` value for a sentence — and `error` admits
only a dotted `code` and an optional `retriable` boolean, never a `message` or a `stack`.
That is not the whole envelope, though: `extensionId`, `event`, and `error.code` are still
caller-controlled strings, and this document does not bound their length (`extensionId`
has no pattern at all — see spec
[§8](../spec/diagnostics/v1/diagnostics.md#8-what-this-specification-does-not-give-you)).
Redaction here is a filter on *shape* — it removes every place an unreviewed, free-form
field could go — not a proof that no caller-controlled string on the envelope could be
misused.

## Levels

```
debug < info < warn < error
```

`meetsLevel(level, threshold)` answers whether `level` is at or above `threshold` in that
order — `meetsLevel("warn", "info")` is `true`, `meetsLevel("debug", "info")` is `false`.
It is total: a value outside the four levels, in either position, answers `false` rather
than throwing.

## Encoding and parsing directly

`encodeDiagnostic` validates and serializes a caller-built value; `parseDiagnostic` does
the reverse, on a line already read off the wire. Both are pure, total, and never throw —
even a hostile input (a getter that throws, or that answers differently on a second read)
comes back as an `{ ok: false, reason, path }` result, never an exception.

```ts
import { encodeDiagnostic, parseDiagnostic } from "@nimbus-dev/sdk/diagnostics";

const encoded = encodeDiagnostic({
  ts: "2026-08-01T12:00:00.000Z",
  level: "info",
  extensionId: "acme-gcal",
  event: "sync.page",
  fields: { items: 42 },
});

if (encoded.ok) {
  const parsed = parseDiagnostic(encoded.line);
  // parsed.ok is true, and parsed.event round-trips encoded's input.
}
```

`reason` is one of the tokens the spec's §5 table pins — `unknown-member`,
`invalid-field-value`, `too-many-fields`, and so on — and `path` is a JSON Pointer to
where the problem was found. Both are corpus-pinned, not diagnostic color: a connector
in one language and a gateway in another agree on the exact token and the exact pointer
for the same bad input.

## `createEmitter`

The authoring ergonomics over the envelope. It never throws from a log call — not on an
invalid event, and not on a sink that rejects — because a diagnostic must not be able to
take down the connector it is describing.

```ts
import { createEmitter } from "@nimbus-dev/sdk/diagnostics";

const nimbus = createEmitter("acme-gcal", (line) => {
  process.stderr.write(line + "\n");
});

export async function syncPage(itemCount: number): Promise<void> {
  const result = await nimbus.info("sync.page", {
    ts: new Date().toISOString(),
    fields: { items: itemCount },
  });
  if (!result.ok) {
    // Dropped, not thrown — result.reason names why (or "sink-failed" if the write
    // itself rejected; see below). Handle it, or ignore it — either way the call above
    // already returned safely.
  }
}
```

`nimbus.audit(...)` always encodes at `level: "info"`, with `kind: "audit"` implied — both
are fixed, not just `kind`. There is currently no way to record an audited *failure*
through this emitter: an audit record at `level: "warn"` or `"error"` needs a caller to
build one with `encodeDiagnostic` directly (`{ ..., level: "warn", kind: "audit" }`),
bypassing `createEmitter` entirely. Every method resolves
to an `EmitResult`: the encoder's own result on success or on a validation refusal, or
`{ ok: false, reason: "sink-failed", path: "" }` if `emit` itself threw or rejected.
`"sink-failed"` is deliberately not one of the spec's rejection reasons — whether a write
to a caller-supplied sink succeeds is an I/O outcome of *this* wrapper's host, not a
contract violation, so it is a member of this module's own `EmitResult` union rather than
of `DiagnosticEncodeReason`.

A dropped event is silent by design in production. In your own test suite, that silence
is exactly what you don't want — see
[`expectNoRejectedDiagnostics`](./testing.md#making-dropped-diagnostics-loud-in-your-own-tests),
published from `@nimbus-dev/sdk/testing`, for making a dropped diagnostic fail the build
instead.

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.

- **`diagnostics/event`** — `encodeDiagnostic`, `parseDiagnostic`, `isDiagnosticEvent`,
  `meetsLevel`; the `DiagnosticEvent`, `DiagnosticError`, `EncodeResult`, `ParseResult`,
  `DiagnosticEncodeReason`, `DiagnosticParseReason`, `DiagnosticLevel`, and
  `DiagnosticKind` types; and the published patterns and constants —
  `DIAGNOSTIC_LEVELS`, `DIAGNOSTIC_KINDS`, `DIAGNOSTIC_TS_PATTERN`,
  `DIAGNOSTIC_NAME_PATTERN`, `DIAGNOSTIC_FIELD_KEY_PATTERN`,
  `DIAGNOSTIC_CORRELATION_ID_PATTERN`, `DIAGNOSTIC_MAX_FIELDS`.
- **`diagnostics/emitter`** — `createEmitter`, and the `DiagnosticEmitter`, `DiagnosticEmit`,
  `EmitDetail`, `EmitResult` types.
