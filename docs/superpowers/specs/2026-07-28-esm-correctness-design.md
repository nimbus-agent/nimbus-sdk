# ESM correctness — two shipped defects and the guards that would have caught them

**Status:** approved design, not yet implemented
**Date:** 2026-07-28
**Follows:** [Phase 1, slice 1 — the schemas and their guard](./2026-07-27-phase1-schemas-design.md)
**Semver:** `fix:` — cuts a patch release. This is the first change in this sequence that
alters published runtime behavior.

---

## Goal

Fix two defects that make published exports fail for real consumers, and close the CI gap
that let both ship.

Both bugs share a shape worth naming, because it is the reason CI is blind to them: **they
work in-repo and fail from the published package.** The `exports` map's `bun` condition
resolves to `src/`, so every in-repo test exercises the TypeScript sources. A consumer
installing from npm gets `dist/`. Anything that is true of one and false of the other is
invisible to the entire existing test suite.

## The two defects

### 1. `require()` inside an ESM package

`src/crypto/verify-signature.ts:120`:

```ts
const nodeCrypto: typeof import("node:crypto") = require("node:crypto");
```

This is emitted verbatim to `dist/crypto/verify-signature.js:81`. `package.json` declares
`"type": "module"`, so **every Node consumer who calls `generateEd25519Keypair()` gets
`ReferenceError: require is not defined in ES module scope`** — on the first call, every
time.

It survives in-repo because Bun resolves the `bun` condition to `src/`, and Bun tolerates
`require` in a `.ts` file.

It is the only real occurrence in the package: a repository-wide search finds exactly one
other `require(` in `src/`, inside a doc comment in `src/testing/sandbox-contract.ts`. That
comment matters later — see the guard design.

### 2. The sandbox probe path names a file that never ships

`src/testing/sandbox-contract.ts:67`:

```ts
return resolve(dirname(fileURLToPath(import.meta.url)), "sandbox-probe.ts");
```

`dist/testing/` ships `sandbox-probe.js`. From the published package the resolved path does
not exist, the spawn fails, and `runSandboxContractTests` reports it as an `fs-denied`
**sandbox** failure — blaming the consumer's configuration for a packaging bug.

## Component 1 — Fixing the `require()`

Replace it with a module-scope import:

```ts
import { generateKeyPairSync } from "node:crypto";
```

**Nothing is lost by making it eager, because it is already eager.**
`src/crypto/jwt.ts:12` does `import crypto from "node:crypto"` at module scope, and both
modules are re-exported from `src/index.ts` — so importing the SDK's main entry point
already loads `node:crypto` unconditionally. There is no laziness here to preserve, and no
browser story to protect: `engines` is `node >= 22` and `package.json` declares no `browser`
field.

### A docstring corrected at the same time

The function's comment says the keypair is generated "via WebCrypto." It is not — it calls
`node:crypto`'s `generateKeyPairSync`. The rest of the module does use WebCrypto
(`crypto.subtle`), which is likely how the sentence came to be written.

The mismatch is not arbitrary. `generateEd25519Keypair` is **synchronous**, and WebCrypto's
`generateKey` is async; `node:crypto` is what offers a synchronous keypair. That constraint
is worth recording, because it is also the reason this design does not "simply" move the
function to WebCrypto: doing so would change the signature from sync to async, which is a
breaking change and cannot ride in a patch.

The sentence is corrected. The behavior is not touched.

## Component 2 — Fixing `probePath`, and why the obvious fix is wrong

The obvious change is `sandbox-probe.ts` → `sandbox-probe.js`. **That would trade a Node bug
for a Bun bug.** Under the `bun` condition the module runs from `src/`, where only
`sandbox-probe.ts` exists — there is no `.js` beside it. A hardcoded extension is wrong from
one side or the other, whichever one is chosen.

The extension must follow whichever copy is actually executing, which the module can read
off itself:

```ts
function probePath(): string {
  const here = fileURLToPath(import.meta.url); // …/sandbox-contract.ts or …/sandbox-contract.js
  const ext = here.endsWith(".ts") ? ".ts" : ".js";
  return resolve(dirname(here), `sandbox-probe${ext}`);
}
```

Correct from both trees, deterministic, and it touches no filesystem to decide.

**It must stay lazy.** The existing comment above `probePath` records a real incident: the
path was once computed at module scope, which baked the *build machine's* absolute path into
`dist/`, so `require("@nimbus-dev/client")` threw `ERR_INVALID_FILE_URL_PATH` on every
machine that was not the CI runner — while passing CI, where the baked path happened to
exist. Keeping the computation inside the function is what makes importing the root inert.
This change must not undo that.

## Component 3 — The static CJS scan

**File:** a new `bun test` guard over the emitted `dist/`.

It walks every emitted `.js` and fails on `require(`, `__dirname`, `__filename`, or
`module.exports`.

This is the **complete** guard for this bug class, and completeness is exactly what the
existing smoke test lacks: it catches a `require` in a code path no test ever calls. It
needs no curated list and does not rot as the surface grows.

### It must strip comments, and there is already a stripper

A naive text search **fails on this repository today**.
`dist/testing/sandbox-contract.js:59` contains the literal string
`require("@nimbus-dev/client")` inside a doc comment — the very comment describing the
incident above. A guard that flagged it would be crying wolf on a comment that exists to
prevent a bug.

`scripts/api-surface.ts` already exports a string-aware `stripComments()`, written for this
exact problem and already unit tested. The guard reuses it rather than growing a second
parser. That also means a `require(` appearing inside a *string literal* is still caught,
because `stripComments` preserves string contents deliberately.

It is worth being precise about what that stripper is, because the obvious worry — that a
regex-based stripper mangles template literals — does not apply. It is a character-scanning
state machine, not a regex: it tracks `"`, `'` and `` ` `` as string delimiters and honors
backslash escapes, so a template literal containing `//` is preserved intact rather than
truncated. Replacing it with a full JS tokenizer would add a parser this package does not
need and cannot take as a dependency.

#### Postscript: this is what this design proposed, not what shipped

Reusing `stripComments` did not survive implementation review, and what eventually shipped
took two more rounds to get right. Recorded here rather than silently edited out, because
both rejections are genuinely useful to whoever touches this scan next — this document is a
historical record of the design phase, not a description of the current code. For the
committed algorithm, read `scripts/cjs-scan.ts`'s own docstring and `scripts/cjs-scan.test.ts`
— that pairing is the sole source of truth.

- **This design: reuse `stripComments`.** Rejected before implementation. The plan review
  ([`2026-07-28-esm-correctness-review.md`](../plans/2026-07-28-esm-correctness-review.md))
  pointed out that `stripComments` *deletes* block comments outright, newlines included, so a
  construct after a JSDoc header — every emitted `dist/` file opens with one — reports a line
  number short by the header's height.
- **What the implementation plan built instead: `blankComments`,** a bespoke character-
  scanning state machine that blanks comment characters to spaces while preserving every
  newline and all string contents, fixing the line-drift defect above. This *did* ship, in
  the first version of `scripts/cjs-scan.ts`. It did not last: a further review found it had
  no regex-literal awareness, so `const re = /[/*]/;` read the `/*` inside the character
  class as a block-comment opener with no closer and blanked everything after it to EOF —
  including a real `require(` on a later line.
- **What replaced it, and then what replaced that:** a stateless, per-line prefix check
  (`isCommentOnlyLine`) closed the regex hole, at the cost of a narrower one — any line
  trimming to a `*`-prefix was assumed to be JSDoc, so a wrapped multiplication continuation
  carrying a `require(` was skipped. The version now committed tracks block-comment state
  across lines again, same as `blankComments` did, but opens a block *only* on a line whose
  trimmed form starts with `/*` — a rule a regex literal cannot satisfy and a `*`-prefixed
  continuation line does not either, closing both holes at once. Its own tradeoff, stated
  rather than hidden: a construct named in a *trailing* comment on a code line is reported,
  because only a line's start decides whether it is comment-only. That is a loud false
  positive, and over-refusal is the direction this repo's doctrine prefers.

### `require` is banned outright, including via `createRequire`

`import { createRequire } from "node:module"` is the legitimate ESM escape hatch for loading
CJS or JSON, and this guard deliberately does not exempt it. Nothing in a dependency-free
package of types and pure helpers needs to load a CJS module, and the call site a
`createRequire` produces is a `require(` like any other — so the scan catches it without a
special case.

The guard's failure message names `createRequire` explicitly, so that someone with a genuine
need is told to amend the guard deliberately rather than guessing that a rename would slip
past it. That follows the doctrine `api-surface.ts` states for its own parser: refuse the
construct rather than quietly permit it.

## Component 4 — The invocation phase in `smoke-esm.mjs`

`scripts/smoke-esm.mjs` currently imports every published entry point by package name and
asserts each one exports something. That is what makes a `require` inside a function body
invisible: nothing is ever called.

A second phase calls one representative function per module, under plain Node, against
`dist/`.

### The call list is curated on purpose

A mechanical "call every zero-argument export" would be worse than useless here. Most
exports take arguments; many are types with no runtime presence at all; and firing
`server.start()` or a sandbox spawn blindly has side effects a smoke test should not cause.

Each entry is chosen because it **executes real code** rather than merely touching a
binding. `generateEd25519Keypair()` is the one that would have caught today's bug.

The modules the phase must cover, so the implementation has no latitude about what counts as
enough:

| Module | Why this call |
|---|---|
| `crypto` | `generateEd25519Keypair()` — the defect this change exists for |
| `icalendar` | a parse or build call, exercising the RFC 5545 code path |
| `data-profile` | a column extractor, the module's actual work |
| `distribution-channel` | channel resolution with an injected env and path |
| `audit-logger` | build a scoped logger and `await` one `log` call |
| `contract-tests` | `runContractTests` over a valid manifest |
| `server` | construct `NimbusExtensionServer` and call `start()` |
| `ipc` | construct `NdjsonLineReader` and push a chunk |
| `flux-cd`, `storybook`, `jmap-fastmail`, `item-types`, `agents` | one pure call or a non-empty constant each |
| `testing` | `probePath()`'s target exists — see below |

Exact function names are the implementation plan's job; they must be verified against
`docs/api-surface.md` rather than guessed, since this repository has shipped a call to a
function that did not exist before.

### `testing` is checked, not spawned

For the `testing` entry point the smoke asserts that `probePath()`'s target file **exists**,
rather than running the probe.

Spawning it would pull process spawning and the documented Windows platform asymmetry into a
check that must stay deterministic across 3 operating systems × 2 Node versions. It would
also be closer to vacuous than reassuring: the probe's network checks already skip on every
platform, because `sandbox-contract.ts` reads `permissions` in object form while
`ExtensionManifest.permissions` is an array — so only `fs-denied` ever runs.

### Drift is detected, not merely acknowledged

An earlier draft accepted that this list would rot and left it there. It does not have to.

The call list becomes a **machine-readable export** — an array of `{ module, run }` rather
than inline statements — and a `bun test` asserts it covers every module the published
surface reaches, by diffing against `modulesInSurface()` from `scripts/docs-modules.ts`.
That is the same 25-module set the doc-coverage guard already derives from
`buildSurface()`, so adding a battery fails this test until it has a smoke call, exactly as
it already fails until it has a documentation page.

Note the unit that matters here is the **module**, not the entry point. Asserting coverage
of `package.json`'s three `exports` entries would be nearly free and would catch almost
nothing, since the smoke already derives and loads all three. Drift happens per battery.

### The residual cost, stated plainly

Coverage is enforced, but *quality* is not: a `run` that touches a binding without executing
anything would satisfy the diff. Component 3 is the guard that stays complete with no
judgement at all; Component 4 buys execution depth and asks a reviewer to check the calls do
real work. Both are worth having because they fail differently — the scan catches
constructs, the invocation catches resolution and runtime errors.

---

## Semver and release posture

**This is a `fix:` and it should cut a patch release.** Both defects change the runtime
behavior of published code.

**`docs/api-surface.md` must stay byte-identical.** No exported signature changes — only two
function bodies and a docstring. That file staying still is the evidence this is a patch and
not something larger, and the existing API-surface guard enforces it.

## Testing

- **Unit, on synthetic input:** the CJS scanner's pure half, including the cases that
  separate a correct implementation from a plausible one:
  - a `require(` inside a line comment and inside a block comment — **ignored**;
  - a `require(` inside a string literal and inside a template literal — **caught**;
  - `require(` nested in a function body, behind a conditional, and with a computed
    specifier — **caught** in every position, since a scan that only matched top-level
    calls would have missed the defect this change exists for;
  - `__dirname`, `__filename`, and `module.exports` — **caught**;
  - a `createRequire` import followed by a call — **caught**, and the message names
    `createRequire`.
- **Integration:** the scanner over the real `dist/`. This must pass today, which is a real
  assertion rather than a formality: `dist/testing/sandbox-contract.js` contains
  `require("@nimbus-dev/client")` inside a doc comment, so a naive implementation fails here.
- **Coverage:** the smoke's call list covers every module `modulesInSurface()` reports, so a
  new battery cannot ship without one.
- **`probePath` resolves to a file that exists.** In-repo tests run under the `bun`
  condition, so this covers the `src/` side; the smoke covers the `dist/` side. Both trees
  are proven, which is the entire point of the fix. Both halves run on the full CI matrix
  already — `bun test` on three operating systems, the smoke on three × two Node versions —
  so no new workflow wiring is needed to get cross-platform coverage of this check.
- **The smoke's invocation phase** runs on the existing 3 OS × 2 Node matrix — the
  environment that would have caught the original bug.
- The existing crypto suite continues to cover `generateEd25519Keypair`'s behavior; this
  change must not alter a single assertion there.

## Risks

**The curated call list will drift.** Accepted, and named in Component 4. The static scan is
the guard that does not depend on anyone remembering.

**`probePath`'s extension check is a heuristic.** It assumes the running module is either
`.ts` or `.js`, which is true of both trees this package ships. A future bundler emitting
`.mjs` would need it revisited — cheap to fix, and it fails loudly (file not found) rather
than silently.

**A bundled consumer can still break `probePath`, and this change does not fix that.**
If a consumer bundles the SDK with webpack, rollup, esbuild or tsup, `import.meta.url`
points at the bundle, and `sandbox-probe.js` — a separate file the bundler has no reason to
emit — will not sit beside it. This is not hypothetical for this repo: the comment above
`probePath` records a bundler inlining this very module and breaking `@nimbus-dev/client`.

It is deliberately out of scope, for two reasons. It is a `feat:` — any remedy adds public
configuration surface, and this change must stay a patch. And the obvious remedy is the
wrong one: an environment variable such as `NIMBUS_SANDBOX_PROBE_PATH` is precisely the
ambient state [`INCLUSION-POLICY.md`](../../INCLUSION-POLICY.md) forbids, which says an
effect a caller would want to substitute must be reachable **through a parameter**. The
right shape is an optional `probePath` on the existing `RunSandboxContractTestsOptions`,
defaulting to today's resolution — recorded here so whoever picks it up does not reach for
the env var.

The practical exposure is also narrow: this is a test utility that spawns a subprocess, so
it already assumes a real filesystem, and bundling a spawning test harness is unusual.
Failing loudly with a missing-file path is an acceptable interim behavior — which is exactly
what this change restores, since today it names a file that never existed in `dist/` at all.

**This is the first PR to exercise the CLA fix from #39.** If the required `cla` check still
does not report, that is the fix being wrong, not this change.

## Exit criteria

- `generateEd25519Keypair()` runs under plain Node from `dist/` without throwing.
- `probePath()` resolves to an existing file from both `src/` and `dist/`.
- The CJS scan passes over `dist/`, and fails if a `require(` is reintroduced in code — but
  not when one appears in a comment.
- The smoke's invocation phase is green across the full CI matrix.
- `docs/api-surface.md` is unchanged.
- The merged commit is typed `fix:`, and release-please opens a patch release PR.
