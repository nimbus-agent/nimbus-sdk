<!-- covers: diagnostics/event, diagnostics/emitter, testing/diagnostics-assert -->

# `diagnostics`

A structured, redaction-safe diagnostic event envelope. Its own entry point:
`import { createEmitter } from "@nimbus-dev/sdk/diagnostics"`.

## When you reach for it

When a connector needs to say what it did — how many items it synced, which call failed,
how long a page took — on a stream the gateway parses. It replaces free-form log strings,
which are where secrets and row data leak.

The behavior below is specified language-neutrally in
[`spec/diagnostics/v1/diagnostics.md`](../spec/diagnostics/v1/diagnostics.md), and the
corpus at [`spec/conformance/v1/diagnostics/`](../spec/conformance/v1/diagnostics/) holds
both bindings to it on every PR. This page is the TypeScript usage guide; the spec is the
contract.

## Constraints that are load-bearing

- **The envelope is closed.** A member the spec does not name is refused, not ignored.
  This is the inverse of the hello frame, which ignores unknown members for forward
  compatibility. The inversion *is* the redaction guarantee: an open envelope has
  unlimited places to put a secret.
- **Redaction is structural, not a filter.** `fields` admits booleans and integers and
  nothing else. There is no string field, so there is nowhere to put an email address —
  no denylist to keep up to date, and no regex to get wrong.
- **The encoder is pure and total.** It reads no clock, generates no ids, does no I/O, and
  never throws. You supply `ts`; a refusal comes back as a value.
- **`1.0` and `1` are the same JSON value.** A number whose *value* is an integer is
  accepted however the host language types it, and is encoded without a fractional part.
  A binding that rejected integral floats would disagree with one that cannot tell them
  apart — which is exactly the JavaScript/Python split.
- **The emitter never takes down its connector.** A throwing sink comes back as
  `{ ok: false, reason: "sink-failed" }`, and a refused event is never written — a
  half-valid line on a stream parsed as NDJSON is worse than silence.

## The envelope

| Member | Required | Shape |
|---|---|---|
| `ts` | yes | Fixed-width UTC, exactly three fractional digits, `Z` only |
| `level` | yes | `debug` \| `info` \| `warn` \| `error` |
| `extensionId` | yes | Non-empty. Emptiness, not blankness — no trimming is defined |
| `event` | yes | Lowercase dotted segments, e.g. `sync.page` |
| `kind` | no | `diagnostic` \| `audit` |
| `correlationId` | no | Up to 64 URL-safe characters |
| `fields` | no | Up to 16 lowercase keys; boolean or safe-integer values only |
| `error` | no | `{ code }`, optionally `retriable`. No message, no stack |

## Emitting

```ts
import { createEmitter } from "@nimbus-dev/sdk/diagnostics";

const nimbus = createEmitter("acme-gcal", (line) => {
  process.stderr.write(`${line}\n`);
});

await nimbus.info("sync.page", {
  ts: new Date().toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z"),
  fields: { items: 42, partial: false },
});

await nimbus.audit("calendar.event.deleted", {
  ts: "2026-08-01T12:00:00.000Z",
  correlationId: "01J9Z4Q7",
});
```

`audit()` sets `kind: "audit"` at `info` level; the four level methods leave `kind` unset.
Every method returns the `EncodeResult` — on success it carries the exact line written, so
a caller can compare it.

## Encoding and parsing directly

```ts
import { encodeDiagnostic, meetsLevel, parseDiagnostic } from "@nimbus-dev/sdk/diagnostics";

const encoded = encodeDiagnostic({
  ts: "2026-08-01T12:00:00.000Z",
  level: "warn",
  extensionId: "acme-gcal",
  event: "quota.low",
  fields: { remaining: 12 },
});

if (encoded.ok) {
  const parsed = parseDiagnostic(encoded.line);
  // `nimbus` is wire framing, not event data, so the parsed event omits it —
  // which is what makes encode(parse(line)) reproduce the line exactly.
  if (parsed.ok) {
    console.log(parsed.event.event, meetsLevel(parsed.event.level, "info"));
  }
} else {
  // A refusal names the reason and the member, e.g. "invalid-field-value" at
  // "/fields/user". Nothing is thrown.
  console.error(encoded.reason, encoded.path);
}
```

`meetsLevel(level, threshold)` is total: an argument outside the published level set
answers `false` rather than throwing. Left to language defaults this would be `false` by
accident in TypeScript and a `ValueError` in Python — the same call behaving two ways.

## Asserting in your own tests

The emitter drops refused events on purpose. That is right at runtime and wrong in a test
suite, so collect the results and assert on them:

```ts
import { createEmitter } from "@nimbus-dev/sdk/diagnostics";
import { expectNoRejectedDiagnostics } from "@nimbus-dev/sdk/testing";

const results = [];
const nimbus = createEmitter("acme-gcal", () => {});

results.push(await nimbus.info("sync.page", { ts: "2026-08-01T12:00:00.000Z" }));
expectNoRejectedDiagnostics(results);
```

## What this does not give you

Nothing here proves a connector emits anything — the contract constrains the shape of what
is emitted, not whether it is. The `correlationId` bound is a speed bump against putting an
address in it, not a proof of secrecy. Transport is out of scope: diagnostics SHOULD go to
stderr as NDJSON and MUST NOT share the frame stream.
