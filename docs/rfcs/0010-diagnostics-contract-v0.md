# RFC-0010 — Diagnostics / telemetry contract v0

- **Status:** accepted
- **Opened:** 2026-08-01
- **Landed:** 2026-08-01 — this document, `docs/spec/diagnostics/v1/`, and `docs/spec/README.md`
  land together; the TypeScript module, the Python module, and the conformance corpus follow in
  the same feature's later commits
- **Affects:** `docs/spec/` (new `diagnostics/v1/` area), `@nimbus-dev/sdk` (a new fifth
  `./diagnostics` entry point), `nimbus_sdk.diagnostics` (a new, not-re-exported submodule),
  `sdks/typescript/src/audit-logger.ts` (deprecation markers)
- **Roadmap:** [Phase 2](../ROADMAP.md#phase-2--prove-polyglot-with-python), box 4 — "a
  diagnostics / telemetry contract v0 emitted by both SDKs." The last Phase 2 checkbox inside
  this repository's own control; see *Out of scope* for what it does not close.
- **Pillars:** 1 (the contract), 2 (polyglot SDKs), 8 (no secrets, no row/body data in logs,
  ever)
- **Builds on:** [RFC-0001](./0001-ipc-framing-spec.md), whose `wire/v1/framing.md` §1 defers
  "how a peer's diagnostics travel" the same way it deferred contract-version negotiation, and
  whose normative-document-plus-corpus pattern this reuses; [RFC-0005](./0005-contract-version-negotiation.md),
  whose closed-versus-open envelope contrast this RFC inverts on purpose (§5 of that document
  requires a hello's unknown members be *ignored*; this contract requires a diagnostic event's
  unknown members be *rejected*), and whose `contract-version.md` §5 states the "MUST travel
  somewhere other than the frame stream" requirement this RFC answers; [RFC-0008](./0008-python-sdk-official.md),
  whose `.` vs `./ipc` boundary and not-re-exported convention this RFC's `./diagnostics` /
  `nimbus_sdk.diagnostics` placement follows

## Problem

Connectors run out-of-process in a sandbox. An author who wants to know what their connector is
doing has, today, exactly one tool: `createScopedAuditLogger`, which prefixes a string onto an
action and hands an arbitrary `Record<string, unknown>` to an injected `emit`. Nothing
constrains that payload's shape, so nothing prevents a row of user data, an access token, or an
interpolated error message from reaching whatever the gateway does with it. Pillar 8's
guarantee — "no secrets, no row/body data in logs, ever" — is today enforced by author
discipline, not by the contract.

Separately, [`negotiation/v1/contract-version.md`](../spec/negotiation/v1/contract-version.md)
§5 already states that "a peer's diagnostics MUST travel somewhere other than the frame
stream," but names no alternative — the requirement exists only as a referral, because no
document owned the answer.

## Proposed change

**One structured envelope that both SDKs encode, validated rather than trusted, with no member
that a string may travel through.** Every rule that follows exists because a shape a binding
could accidentally get wrong is exactly the shape this contract closes off before it can be
gotten wrong.

The full member table, the encoding rules, and the closed set of rejection reasons are
specified in [`docs/spec/diagnostics/v1/diagnostics.md`](../spec/diagnostics/v1/diagnostics.md),
with [`diagnostic-event.schema.json`](../spec/diagnostics/v1/diagnostic-event.schema.json) as a
second, independently computed expression of the same rules — the arrangement
[`predicates/v1` §2.3](../spec/predicates/v1/README.md) already uses, including its constraint
that an implementation MUST NOT satisfy the prose by running the schema against it.

### The five decisions

Each was a genuine fork. The rejected branch is recorded so a later reader does not
re-litigate it.

| Decision | Chosen | Rejected, and why |
|---|---|---|
| **Emission** | The envelope and the levels are MUST; writing to standard error as NDJSON is a **SHOULD**; "never the frame stream" is restated as a MUST NOT | A normative transport channel would make this package own an I/O claim it cannot execute — the same untestable-assertion problem [`contract-version.md` §8](../spec/negotiation/v1/contract-version.md) already had to apologize for regarding exit code `20` |
| **Purity** | The caller supplies `ts` and `correlationId`; the SDK validates them and never reads a clock or generates an id | An injected `now` / `newId` seam is strictly additive and can land later as a minor; deferring timing and correlation entirely now would leave an envelope the gateway cannot use yet, and adding a required member later would be a breaking change |
| **Redaction** | **Structural** — bounded identifiers and numeric fields only, no free text anywhere in the envelope | A published deny-list of key names is a scanner, and `fields:{ ctx: "<the whole JWT>" }` defeats any scanner; a manifest-gated free-text slot would only add a second path to audit |
| **Audit logger** | **Staged.** The envelope ships now; `createScopedAuditLogger`'s free-form payload is marked `@deprecated` in this change and removed no earlier than `2.0.0` | Breaking it immediately forces a `2.0.0` on a package with "third-party consumers it cannot enumerate," per [`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md); leaving it untouched leaves open the exact hole this work exists to close |
| **Placement** | A fifth TypeScript entry point, `./diagnostics`; a Python submodule, `nimbus_sdk.diagnostics`, **not** re-exported from `nimbus_sdk` | Adding these exports to the main entry point would keep the `exports` map at four, but would deny that diagnostics is a separate contract with its own `docs/spec/` area — the exact claim the `.` vs `./ipc` split already makes, and that CLAUDE.md documents |

### Where this is written down

- [`docs/spec/diagnostics/v1/diagnostics.md`](../spec/diagnostics/v1/diagnostics.md) — the
  normative document: scope, terminology, the envelope, encoding, rejection reasons, levels,
  transport, and what the specification does not give you.
- [`docs/spec/diagnostics/v1/diagnostic-event.schema.json`](../spec/diagnostics/v1/diagnostic-event.schema.json) —
  draft-07, the envelope's independent schema expression, closed via `additionalProperties:
  false`.
- [`docs/spec/diagnostics/v1/levels.json`](../spec/diagnostics/v1/levels.json) — the four
  levels, ordered, as the one published copy every runtime's own copy is drift-guarded against.
- [`docs/spec/conformance/v1/diagnostics/`](../spec/conformance/v1/diagnostics/) — its own
  corpus, following the precedent the framing, predicate, sandbox, and negotiation corpora all
  set: admitting these cases into the published document index would widen a published `enum`,
  which an older validator rejects outright rather than ignoring. Three case kinds: `encode` (a
  value in, a line or a typed rejection out), `parse` (a line in, an event or a typed rejection
  out — the gateway's direction), and `level` (threshold comparison, pinning the published
  order).
- `sdks/typescript/src/diagnostics/`, exported as `@nimbus-dev/sdk/diagnostics` —
  `DIAGNOSTIC_LEVELS`, `encodeDiagnostic`, `parseDiagnostic`, `isDiagnosticEvent`,
  `meetsLevel`, and `createEmitter`.
- `sdks/python/src/nimbus_sdk/diagnostics/`, imported as `nimbus_sdk.diagnostics` and never
  re-exported from `nimbus_sdk` — the pure contract functions, `format_timestamp`, and frozen
  dataclasses discriminated by `isinstance` in place of TypeScript's tagged union, mirroring
  `HelloOk` / `HelloRefused` / `HelloResult`.
- `sdks/typescript/src/audit-logger.ts` — `createScopedAuditLogger`, `AuditLogger`, and
  `AuditEmit` gain `@deprecated` markers at their declarations, per
  [`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md).

This RFC records the decisions for the whole feature; the language-neutral artifacts in the
first three bullets above land in this change, and the binding-specific work in the remaining
bullets follows in this same feature's subsequent commits.

## Compatibility impact

**Additive.** One new normative spec area, one new TypeScript entry point, one new Python
submodule, and new manifest-independent exports — no existing behavior changes, and no
existing manifest, schema, or exported type is narrowed.

| Change | Semver | Who is affected |
|---|---|---|
| `docs/spec/diagnostics/v1/` added | none (spec documents) | New paths, new corpus. Nobody validating against the existing spec areas is touched. |
| `@nimbus-dev/sdk/diagnostics` added, the `exports` map grows to five entries | minor (`feat`) | Nobody existing. Purely additive surface. |
| `nimbus_sdk.diagnostics` added, not re-exported from `nimbus_sdk` | minor | Nobody existing. A consumer must opt in to the new import root. |
| `createScopedAuditLogger`, `AuditLogger`, `AuditEmit` marked `@deprecated` | minor (`feat`, per [`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md)'s "ship the marker as `feat:`" rule) | Nobody functionally — the exports keep working exactly as before. `api-surface.md` gains a **Deprecated** line for each, which is what makes the window's opening a reviewable diff. |

`docs/api-surface.md` requires regeneration (`bun run api:surface`) for the new exports and the
three deprecation markers. `docs/modules/diagnostics.md` and a `sdks/typescript/scripts/smoke-calls.mjs`
entry are required by the TypeScript module- and export-surface gates CLAUDE.md documents,
landing with the binding's own commit rather than this one.

## Migration

None required for this change. No existing manifest, connector, or call site needs to change:
`createScopedAuditLogger` keeps working exactly as it does today, and nothing currently
published is removed or narrowed.

This RFC **opens** the deprecation window on `createScopedAuditLogger`'s free-form payload,
per [`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md): the marker must be present in a
released minor, and still present and marked in a later, separate minor release, before a
major may remove it. The window opens with whichever release first carries the `feat:` commit
adding the `@deprecated` marker to `sdks/typescript/src/audit-logger.ts` — the exact version
is release-please's to assign, not this RFC's to guess in advance. A future removal RFC MUST
cite that release by number, as this policy requires, rather than assuming the version this
document was drafted against.

## Alternatives rejected

Beyond the five forks in *The five decisions* above:

**No contract at all — leave `createScopedAuditLogger` as the only tool.** Rejected: it leaves
`framing.md` §5's referral open indefinitely and leaves Pillar 8's guarantee as author
discipline with nothing behind it.

**A published deny-list of forbidden key names**, scanning `fields` for anything resembling a
secret. Rejected in the *Redaction* row above and restated here because it is the alternative
most likely to be re-proposed: a deny-list is a scanner an author can route around by naming a
field anything the list does not enumerate, and it needs updating forever. Restricting `fields`
to booleans and bounded integers removes the *class* of value a secret could be, rather than
trying to recognize secrets by name.

**Breaking `createScopedAuditLogger` immediately**, shipping this change as a `2.0.0` that
removes the free-form payload rather than deprecating it. Rejected in the *Audit logger* row
above: the package has third-party consumers it cannot enumerate, and
[`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md) exists precisely so a breaking removal is
never sprung without a window.

**Folding diagnostics into the main entry point** instead of a fifth `exports` entry. Rejected
in the *Placement* row above: it would keep the map's entry count unchanged at the cost of
denying that diagnostics is its own contract, which is the same reasoning the `.` vs `./ipc`
split already establishes and that CLAUDE.md records.

## Out of scope

- **Teaching the scaffolder templates to emit diagnostics.** It would pull in both connector
  templates, the `docs-excerpts` drift guard, and both `scaffold-*` CI jobs, for no gain to the
  contract itself. A follow-up, not part of this RFC.
- **A Python emitter wrapper.** Tracked by Phase 3's Python `connector-kit` item — a different,
  already-tracked asymmetry, not a new one this RFC introduces.
- **An injected clock / id seam** (`createEmitter` accepting `now` and `newCorrelationId`
  parameters), and the `ts`-defaulting ergonomics it would enable. Deferred, not dismissed: it
  is strictly additive over the design this RFC accepts and can land as a minor whenever it is
  wanted.
- **Sampling, rate limiting, and log-level configuration.** Runtime policy a host applies on
  top of this contract, not part of it — stated in `diagnostics.md` §1 as out of scope for the
  same reason.
- **Proof that any connector emits anything, or that any gateway reads it.** This package
  performs no I/O and owns no process; see `diagnostics.md` §8.
- **Closing Phase 2.** Its exit criteria require "a Python-authored connector runs against the
  gateway and passes the same suite as the TS reference," which this repository has already
  recorded as the one exit clause it cannot demonstrate on its own. This RFC closes the last
  Phase 2 checkbox available inside this repository; the phase itself closes in the gateway
  repository.
