# Diagnostics / telemetry contract v0 — design

Closes ROADMAP **Phase 2 box 4** ("a diagnostics / telemetry contract v0 emitted by both
SDKs", *Pillar 8*) — the last Phase 2 checkbox inside this repository's control. It does
**not** close Phase 2; see [What this does not close](#what-this-does-not-close).

Lands under **RFC-0010**, following the [RFC process](../../GOVERNANCE.md#the-rfc-process),
because it adds a normative spec area and changes the published surface of both bindings.

## The problem

Connectors run out-of-process in a sandbox. An author who wants to know what their connector
is doing has, today, exactly one tool: `createScopedAuditLogger`, twenty-three lines that
prefix a string onto an action and hand an arbitrary `Record<string, unknown>` to an injected
`emit`. Nothing constrains the payload, so nothing prevents a row of user data, an access
token, or an interpolated error message from reaching whatever the gateway does with it.
Pillar 8's guarantee — *"no secrets, no row/body data in logs, ever"* — is currently a
sentence in a roadmap, enforced by author discipline.

Meanwhile [`wire/v1/framing.md`](../../spec/wire/v1/framing.md) §5 has an open referral. It
requires that "a peer's diagnostics MUST travel somewhere other than the frame stream" and
names no alternative, because no document owned the answer.

## What v0 changes, in one line

There is one structured envelope that both SDKs encode, it is validated rather than trusted,
and a secret cannot be put in it because there is nowhere in it that a string may go.

## The five decisions

Each was a genuine fork; the rejected branches are recorded so the next reader does not
re-litigate them.

| Decision | Chosen | Rejected, and why |
|---|---|---|
| **Emission** | Envelope and levels are MUST; stderr-NDJSON is a **SHOULD**; "never the frame stream" is restated as a MUST NOT | A normative channel would make this package own an I/O claim it cannot execute — the same untestable-assertion problem `contract-version.md` §8 had to apologize for with exit code 20 |
| **Purity** | Caller supplies `ts` and `correlationId`; the SDK validates and never reads a clock or generates an id | An injected `now`/`newId` seam is strictly additive and can come later; deferring timing and correlation entirely would make an envelope the gateway cannot use, and adding required members later is a breaking change |
| **Redaction** | **Structural** — bounded identifiers and numeric fields only, no free text anywhere | A published deny-list of key names is a scanner, and `fields:{ ctx: "<the whole JWT>" }` defeats any scanner; a manifest-gated text slot adds a second path to audit |
| **Audit logger** | **Staged**: envelope ships now, free-form payload marked `@deprecated` now, flipped at 2.0.0 | Breaking immediately forces 2.0.0 on a package at 1.14.0 with "third-party consumers it cannot enumerate"; leaving audit untouched leaves the hole this work exists to close |
| **Placement** | Fifth TypeScript entry point `./diagnostics`; Python submodule `nimbus_sdk.diagnostics`, not re-exported | Putting it in the main entry keeps the map at four but denies that diagnostics is a separate contract with its own `docs/spec/` area — the exact claim the `.` vs `./ipc` split exists to make |

## The envelope

`docs/spec/diagnostics/v1/diagnostics.md`, **normative**, contract version `v1`, with
`docs/spec/diagnostics/v1/diagnostic-event.schema.json` as a second, independently computed
expression of the same rules — the arrangement
[`predicates/v1` §2.3](../../spec/predicates/v1/README.md) already uses, including its
constraint that an implementation MUST NOT satisfy the prose by running the schema.

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

Members this document does not name **MUST be rejected**. The total encoded line MUST NOT
exceed `IPC_MAX_LINE_BYTES` — [`framing.md`](../../spec/wire/v1/framing.md)'s existing limit,
referenced rather than restated, since diagnostics SHOULD travel as NDJSON.

### Why each constraint exists

Every rule below is here because two bindings would otherwise diverge while both looked
correct — the standard this package already holds its other specs to.

**The envelope is closed; the hello is open.**
[`contract-version.md` §5](../../spec/negotiation/v1/contract-version.md) requires that
unknown members be *ignored*. This document requires that they be *rejected*. That inversion
is the entire redaction guarantee: an open envelope has an unbounded number of places to put
a secret, so `{"message":"row 7 failed for SELECT *"}` must fail as `unknown-member` rather
than travel silently. Openness is correct for a negotiation frame that must remain readable
across a future major; closedness is correct for a redaction envelope. The two corpora pin
opposite behaviors, and each case's `reason` names the other so a reader meeting one finds
the other.

**`ts` is one canonical form, not "RFC 3339".** RFC 3339 admits `+05:30`, lowercase `t` and
`z`, and zero through nine fractional digits. Fixed-width UTC with exactly three fractional
digits makes a plain string sort chronological in every language, with no date library and no
parsing. The digit class is spelled `[0-9]` and never `\d`, for the reason
[`contract-version.md` §3](../../spec/negotiation/v1/contract-version.md) already gives: a
binding transcribing `\d` into Python or Rust silently acquires a Unicode-aware class.

**Three alphabets, three purposes — and the differences are deliberate.** The document uses
three distinct character sets, and a reader is owed the reason rather than left to infer an
oversight:

| Field | Alphabet | Why |
|---|---|---|
| `event`, `error.code`, `fields` keys | `[a-z0-9]` with `.` as the only separator | These are **aggregated**. A gateway grouping by event name must see one spelling per concept. |
| `correlationId` | `[A-Za-z0-9_-]{1,64}` | This is **compared for equality**, never grouped. The alphabet is the one UUID, ULID, hex, and base64url already use. |
| `extensionId` | non-empty only | **Not this document's field.** Its format belongs to the [manifest rule registry](../../spec/rules/v1/); re-validating it here would be a second, drifting definition. |

The exclusion of `_` and `-` from event names is the strict choice it looks like, and it is the
same argument as `ts` one paragraph above: permit variants and you get variants. Allowing both
separators makes `auth.token-refresh`, `auth.token_refresh`, and `auth.tokenrefresh` three
distinct events that every human reads as one, and a gateway aggregating by name reports them
as three. Rejecting `sync_page` costs an author one keystroke; accepting it costs every
consumer of the data a normalization step that no two of them will implement identically.

The choice is also cheap to reverse in the right direction: widening the alphabet later is a
minor, narrowing it later is a major. That asymmetry is why v0 starts at the strict end here,
exactly as it does with integers.

Excluding uppercase has a second effect worth stating: the case-folding problem
[`predicates/v1` §3.1](../../spec/predicates/v1/README.md) devotes a table to — Turkish
dotless ı, Go's simple-versus-full mapping — **cannot arise**, because there is no case to
fold. That section exists because a name-based check had to lowercase; this contract sidesteps
the entire class of bug by never admitting an uppercase letter in the first place.

**Integers only.** `json.dumps(1.0)` produces `"1.0"`; `JSON.stringify(1.0)` produces `"1"` —
the same event encodes to two different lines, which would make an exact-line corpus
impossible. Restricting to integers removes the divergence at its source, and every field a
diagnostic actually carries is one: counts, durations in milliseconds, byte sizes. Widening
to floats later is a minor; narrowing later would be a major, so v0 starts strict.

**The ±(2⁵³−1) bound** is
[`contract-version.md` §6](../../spec/negotiation/v1/contract-version.md)'s float-precision
argument reapplied. Python encodes 2⁵³+1 exactly; JavaScript cannot represent it. A bound
both languages hold exactly is the only one that can be pinned.

**Non-finite numbers MUST be rejected.** Python's `json.dumps` emits bare `NaN` and
`Infinity`, which are **not valid JSON**; JavaScript's `JSON.stringify` silently emits `null`.
Left unchecked, one binding produces an unparseable line and the other produces a lie. This is
the single highest-value case in the corpus.

**`correlationId` is bounded, not opaque.** An unbounded opaque string is a free-text slot
under another name. Sixty-four characters of `[A-Za-z0-9_-]` admits UUID, ULID, and hex, and
admits no sentence. This is a speed bump, not a proof, and the spec says so in its own
"what this does not give you" section rather than overclaiming.

**`extensionId` tests emptiness, not blankness**, following
[`predicates/v1` §2.2](../../spec/predicates/v1/README.md). No trimming is defined, so no two
languages' disagreement about what `trim` removes can reach this contract. A binding reaching
for `strip()` fails `extension-id-whitespace-accepted`.

**No cross-member constraints are defined.** An `error` member is permitted at any level. A
rule like "`error` requires `level: error`" would be an invented constraint, and every
invented constraint is one more place two bindings differ.

## The bindings

### TypeScript — `@nimbus-dev/sdk/diagnostics`

```ts
export const DIAGNOSTIC_LEVELS = ["debug", "info", "warn", "error"] as const;

export function encodeDiagnostic(event: unknown): EncodeResult;
export function parseDiagnostic(line: string): ParseResult;
export function isDiagnosticEvent(value: unknown): boolean;
export function meetsLevel(level: DiagnosticLevel, threshold: DiagnosticLevel): boolean;
```

`meetsLevel(level, threshold)` is true when `level` is at or above `threshold` in the
published order — `meetsLevel("warn", "info")` is true, `meetsLevel("debug", "info")` is
false — so a host filtering at a threshold keeps the event. It is defined on the published
array's index, never on a hard-coded number, which is what the drift guard protects.

`unknown` in, tagged union out, and **total — it never throws**. That is the posture
[`predicates/v1` §2](../../spec/predicates/v1/README.md) already requires of a contract
predicate, and CLAUDE.md's rule for cross-boundary data. A rejection is
`{ ok: false, reason, path }`, where `path` is a JSON Pointer naming the offending member —
the same `{ rule, path }` idiom the manifest corpus pins, so a failure reports `/fields/user`
rather than "invalid event".

The `reason` tokens are a **closed set evaluated in a normative order**, exactly like the
hello's seven-row table. Which reason fires first is otherwise a place two bindings disagree
while both reject the same inputs.

### Python — `nimbus_sdk.diagnostics`

Frozen dataclasses discriminated by `isinstance` (`EncodeOk` / `EncodeRejected` /
`EncodeResult`), mirroring `HelloOk` / `HelloRefused` / `HelloResult`. **Not re-exported from
`nimbus_sdk`** — the boundary CLAUDE.md documents for `nimbus_sdk.ipc`, for the same reason:
it states that diagnostics is a separate contract.

Encoding is pure and synchronous in both languages, so **this module introduces no new
*behavioral* divergence**. CLAUDE.md's claim that there are exactly two deliberate differences
— sync-versus-async, and `isinstance`-versus-tagged-union — stays true and needs no amending.

The two surface asymmetries below (no Python emitter; a Python-only `format_timestamp`) are a
different category: neither is the same operation behaving differently in the two languages,
which is what that CLAUDE.md sentence is about. They belong with the existing
`connector-kit`-shaped asymmetry that Phase 3 already tracks, and the CLAUDE.md edit should
place them there rather than inflating "two" to "four".

**Python ships the pure contract functions only** — no emitter wrapper. That is the same
asymmetry Phase 3 already tracks as "a Python `connector-kit`", not a new one. "Emitted by
both SDKs" is satisfied by both bindings *encoding the envelope*, which is the part the
corpus can actually prove.

#### One exception: `format_timestamp`

The `ts` format is not symmetric in how easy it is to produce, and the asymmetry runs against
Python. Verified, not assumed:

```text
JS      new Date().toISOString()                    → 2026-08-01T20:30:00.123Z    ✓ conformant
PY      datetime.now(timezone.utc).isoformat()      → …:00.123456+00:00           ✗ rejected
PY      …isoformat(timespec="milliseconds")         → …:00.123+00:00              ✗ still rejected
```

The obvious call in TypeScript is exactly conformant — the format was chosen so that it would
be. The obvious call in Python fails, **and so does the obvious fix**: `timespec` corrects the
fractional digits but leaves the offset as `+00:00`, which the pattern rejects. An author who
finds the first problem and fixes it lands on a second one that looks identical.

So `nimbus_sdk.diagnostics` ships `format_timestamp(value: datetime) -> str`: a **pure**
function of its argument — no clock, no default of `now()` — that requires a timezone-aware
datetime, converts to UTC, truncates to milliseconds, and renders with `Z`.

This is a deliberate, narrow break from "both bindings expose the same functions", and it is
justified by the asymmetry rather than in spite of it: the helper exists precisely because the
two standard libraries differ, so requiring TypeScript to carry a twin it does not need would
be symmetry for its own sake. It is a scope **addition** over the approved design — small,
pure, and load-bearing for every Python author's first call.

It cannot be corpus-tested, because the corpus is language-neutral and this helper is not part
of the contract — it is a convenience for satisfying one. It gets unit tests, and the contract
rule it serves is pinned by `ts-microseconds-rejected` and `ts-offset-rejected`.

### The emitter, and the audit migration

```ts
type DiagnosticEmit = (line: string) => void | Promise<void>;

const nimbus = createEmitter("acme-gcal", (line) => {
  process.stderr.write(line + "\n");
});

await nimbus.info("sync.page", { ts, fields: { items: 42, ms: 118 } });
await nimbus.audit("calendar.event.deleted", { ts, fields: { count: 1 } });
```

**The methods return a Promise; the callback need not.** `emit` is
`(line: string) => void | Promise<void>`, so a synchronous sink like `process.stderr.write` is
a first-class case and the emitter awaits only when there is something to await. The methods
themselves stay async because `predicates/v1` §5 records it as a **contract obligation** — "a
binding MUST provide an audit-logging operation that does not block its caller" — and
`contract-tests.ts:317` enforces the TypeScript half of it (`AuditLogger.log must return a
Promise`). It is inherited and normative, not a taste call.

Note the callback's **block body**. Written as a concise arrow, `(line) => process.stderr.write(…)`
returns `boolean`, which is assignable to a `void` return but *not* to `void | Promise<void>`;
the braces are what make the published example typecheck under the `docs-snippets` gate.

One factory, five methods. The four level methods and `audit()` produce the same envelope;
`audit()` sets `kind: "audit"` so the gateway can distinguish *a record for the user* from *a
stream for the author* and route what it persists accordingly. `kind` is the one member
derived from no prior artifact — it exists so that routing audit through the envelope does not
quietly erase that distinction.

#### What the emitter does when an event is invalid

The encoder is total, so the emitter inherits a decision the encoder does not have to make:
what happens when `nimbus.info(…)` is handed a float, or a key with a capital letter.

**It never throws, never crashes the connector, and never emits a malformed line.** The
methods return `Promise<EncodeResult>` — the same tagged union `encodeDiagnostic` returns — and
an invalid event is **dropped rather than written**. A rejected event is a bug in the
connector's own diagnostic call; writing a half-valid line onto a stream a gateway is parsing
as NDJSON turns that authoring bug into the gateway's problem, which is strictly worse than
silence.

Errors thrown by `emit` itself — a closed file descriptor, a full pipe — are captured into the
same returned result and **not rethrown**. Diagnostics must not be able to take down the
connector they are describing, and an `await`ed method that can reject is exactly that hazard.

Dropping is not the same as hiding, and the difference lives in the test suite rather than in a
runtime environment check. A `NODE_ENV`-style "throw in dev, drop in prod" split would be an
untestable, platform-dependent normative claim, which is the kind this package has repeatedly
refused to make. Instead the `./testing` entry point — which already exists — gains a helper
that fails a connector's own test suite on any rejected event. Loud where it is free to be
loud, silent where noise is dangerous.

Two things fall out of the envelope for free. Scoping moves from string concatenation into the
`extensionId` member, so `createScopedAuditLogger`'s hand-rolled `"action must not contain a
colon"` guard has nothing left to protect and disappears. And `emit` narrows from
`(action, payload)` to `(line)`.

### Opening the deprecation window

`createScopedAuditLogger`, `AuditLogger`, and `AuditEmit` are marked in
`sdks/typescript/src/audit-logger.ts` — at the declaration, not the barrel re-export, as
[`DEPRECATION-POLICY.md`](../../DEPRECATION-POLICY.md) requires:

```ts
/** @deprecated since 1.15.0 — use `createEmitter` from `@nimbus-dev/sdk/diagnostics` instead. May be removed in 2.0.0. */
```

Three details of that line are load-bearing, and each is a rule the policy states explicitly:

- **`@nimbus-dev/...` is wrapped in backticks.** The surface extractor treats a
  whitespace-preceded `@word` as the start of the next JSDoc tag, so an unwrapped mention
  truncates the message at `use`.
- **The commit is typed `feat:`.** `docs:` and `chore:` cut no release, so the window would
  silently never open and a later removal would cite a marking release that does not exist.
- **`api-surface.md` regenerates**, which is what makes opening the window a reviewable diff
  in the artifact that already gates the contract.

RFC-0010 records the **intent** to remove. The successor RFC that performs the removal cites
the release that actually opened the window, rather than this design guessing at `1.15.0`
before release-please has spoken.

## Conformance

`docs/spec/conformance/v1/diagnostics/`, with `index.json`, `index.schema.json`,
`case.schema.json`, and `cases/`. Three kinds dispatched on `kind`, as negotiation does:
**`encode`** (a value → a line or a rejection), **`parse`** (a line → an event or a rejection,
the gateway's direction), and **`level`** (threshold comparison, which pins the published
ordering). Approximately 45 cases, against negotiation's 38.

The cases that earn their place — each one a binding written the obvious way fails, while
passing every other case:

| Case | What it catches |
|---|---|
| `fields-float-rejected` | `1.0` encodes as `1.0` in Python, `1` in JavaScript |
| `fields-nan-rejected` | `json.dumps` emits bare `NaN`, which is not JSON; `JSON.stringify` emits `null` |
| `fields-two-pow-53-plus-one-rejected` | Python encodes it exactly; JavaScript cannot represent it |
| `correlation-id-null-rejected` | `dict.get()` collapses absent and null — `predicates/v1` §2.1's trap |
| `extension-id-whitespace-accepted` | Emptiness, not blankness; a binding reaching for `strip()` fails |
| `unknown-member-rejected` | The closedness inversion, indexed pointing at `hello-unknown-member` |
| `ts-offset-rejected`, `ts-lowercase-z-rejected` | Both are valid RFC 3339 and both break string-sort ordering |
| `ts-microseconds-rejected` | Python's `datetime.isoformat()` default — six fractional digits. The single most likely first failure for a Python author |
| `ts-non-ascii-digit-rejected` | A Unicode-aware `\d` accepts it; the spelled-out class does not |

### Anti-vacuity gates

Mirroring [`predicates/v1` §6](../../spec/predicates/v1/README.md), plus one addition:

- The corpus is non-empty.
- Every case on disk is indexed; every indexed case exists.
- Every level in the published ordered set is exercised.
- **Every `reason` token is produced by at least one case.**
- **Every envelope member has at least one accept case and at least one reject case** — so no
  member can ship unpinned. This is the addition; the other gates have precedent.

### The drift guard

`DIAGNOSTIC_LEVELS` is published as spec data, and both runtimes hold their own copy because
this package is dependency-free and performs no I/O at runtime. That is exactly the
`row-data-segments.json` situation, so it gets the treatment
[`predicates/v1` §4](../../spec/predicates/v1/README.md) prescribes: a test that fails CI if
the runtime copy and the published data disagree — none missing, none extra.

## CI gates this trips

All four TypeScript gates fire, and CLAUDE.md is explicit that they key on different things:

1. **`api:surface`** — the new exports *and* the three deprecation markers.
2. **`docs/modules/diagnostics.md`** with a `<!-- covers: -->` claim — new modules reachable
   from the published surface.
3. **`smoke-calls.mjs`** entries, executed against the built `dist/` — new modules again.
4. **`docs-snippets`** — every fenced `ts` block typechecks against `dist/`, and must import
   nothing third-party.

The rejection-assertion helper added to `./testing` trips gates 1–3 as well. `./testing` is an
existing entry point, but the gates key on the **module**, not the entry point — so a new file
under `src/testing/` still needs its own `<!-- covers: -->` claim and its own `smoke-calls.mjs`
entry, exactly as a file under `src/diagnostics/` does.

Plus the `exports` map going from four entries to five, the new entry point loading under the
Node-LTS ESM smoke, and on the Python side `tests/test_diagnostics_corpus.py` executing the
same corpus under mypy strict and ruff, alongside unit tests for `format_timestamp`.

**A local-only trap applies.** After adding `docs/spec/diagnostics/`, run
`python -m pip install -e .` from `sdks/python/` before `pytest`, or the suite reads the
previous bundled snapshot and passes while executing none of the new corpus. CI never hits
this; a local run does.

## Documentation that must move

- `docs/rfcs/0010-diagnostics-contract-v0.md` — the RFC itself.
- `docs/spec/README.md` — index the new spec area.
- `docs/modules/diagnostics.md` — the module page the coverage gate requires.
- `CLAUDE.md` — the `exports` map becomes **five** entry points, and Python's "two import
  roots, deliberately" becomes three.
- `docs/ROADMAP.md` — tick Phase 2 box 4 and rewrite the Phase 2 note, which currently reads
  "what still remains is the diagnostics contract (box 4), plus a Python-authored connector".
- `sdks/typescript/CHANGELOG.md` — the user-facing entry.

## What this does not close

**Phase 2 stays open.** Its exit criteria require that "a Python-authored connector runs
against the gateway and passes the same suite as the TS reference", and the roadmap already
records that as "the one exit clause this repository cannot demonstrate on its own." Box 4 is
the last checkbox here; the phase closes in the gateway repo, not this one. The ROADMAP note
will say that rather than tick the phase.

**No proof that any connector emits anything.** This package performs no I/O and owns no
process. It proves that both bindings encode and reject identically. Whether a real connector
writes a line to stderr, and whether a real gateway reads it, is outside what a corpus here
can assert — the same honesty
[`contract-version.md` §8](../../spec/negotiation/v1/contract-version.md) applies to exit
code 20.

**`correlationId` bounding is not a secrecy proof.** A determined author can still encode
something meaningful into 64 URL-safe characters. The constraint removes the *accidental*
path, not the deliberate one.

## Deliberately out of scope for v0

- **Teaching the scaffolder templates to emit diagnostics.** It would pull in both templates,
  the `docs-excerpts` drift guard, and both scaffold CI jobs, for no gain to the contract
  itself. A follow-up.
- **A Python emitter wrapper** — tracked by Phase 3's Python `connector-kit` item.
- **An injected clock / id seam** (`createEmitter` with `now` and `newCorrelationId`), and the
  `ts`-defaulting ergonomics it would buy. Deferred rather than dismissed: it is strictly
  additive over the chosen design and lands as a minor whenever it is wanted.

  The reason not to reach for the shortcut — having `createEmitter` call
  `new Date().toISOString()` internally — is that it puts a clock inside a package whose other
  contract surfaces are pure functions, and it does so unconditionally, so a test cannot pin an
  emitted line without freezing global time. The seam version has neither problem, which is why
  the seam is the deferred design and the shortcut is not.

  The boilerplate this leaves behind is one expression: `new Date().toISOString()` is already
  exactly the contract form, by construction. Python authors get `format_timestamp` for the
  same reason, since theirs is not.
- **Sampling, rate limiting, and log-level configuration.** Runtime policy, not contract.
