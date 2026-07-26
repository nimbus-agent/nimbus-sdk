# Phase 0, slice 1 — Lock the contract

**Status:** approved design, not yet implemented
**Date:** 2026-07-26
**Roadmap:** [`docs/ROADMAP.md`](../../ROADMAP.md) — Phase 0, boxes 4, 5, 6

---

## Goal

Make it impossible to change the published surface of `@nimbus-dev/sdk` by accident,
and prove the package behaves the same on every operating system and Node LTS line it
claims to support.

This is the first slice of Phase 0 because it is the guardrail every later slice
lands into. Per-module docs, the example connector, and the written policies all
change the repo; none of them are safe to move fast on until an unintended `exports`
change fails CI.

## Scope

| # | Deliverable | Roadmap box |
|---|-------------|-------------|
| 0 | Declare `engines: { "node": ">=22" }` | prerequisite (unlisted) |
| 1 | Cross-OS CI matrix (Linux / macOS / Windows) | Phase 0, box 5 |
| 2 | Node-LTS ESM smoke matrix | Phase 0, box 6 |
| 3 | Public API-surface golden-file guard | Phase 0, box 4 |

**Out of scope.** Per-module battery docs, the docs surface indexing every export, the
runnable example connector, the inclusion policy, the deprecation policy. Those Phase-0
boxes stay open.

`docs/api-surface.md` is produced here as a *byproduct* of the guard. It is a useful
step toward the "docs surface that indexes every public export" task but does not
complete it — it lists declarations, not prose, and has no per-helper guidance.

## Background: what we verified before designing

Three findings shaped the design. Each was confirmed, not assumed.

**TypeScript 7 has no classic compiler API.** The repo is on `typescript@7.0.2`. Its
`exports` map resolves `"typescript"` to `./lib/version.cjs`; `ts.createProgram`,
`ts.SymbolFlags`, and `ts.ModuleResolutionKind` are all `undefined`. A checker is
available only under `typescript/unstable/sync` (and an AST under
`typescript/unstable/ast`) — paths TypeScript ships with no semver promise. Any
extractor built on the TS 5 API cannot run here.

**The entry barrels use explicit named re-exports.** `src/index.ts` and its emitted
`dist/index.d.ts` write out every public name, with `type` modifiers preserved through
emit. There are no `export *` wildcards today. This makes a text-level extractor
tractable and precise.

**`harden-runner` blocks egress on Linux only.** Its compatibility matrix lists
Windows and macOS as *audit mode only* — `egress-policy: block` is not available there.

**Node LTS status as of 2026-07-26** (nodejs/Release `schedule.json`): v20 reached EOL
on 2026-04-30; v22 is in maintenance until 2027-04-30; v24 is active LTS until
2028-04-30; v26 becomes LTS on 2026-10-28.

---

## Component 0 — Declared Node support

Add to `package.json`:

```json
"engines": { "node": ">=22" }
```

`>=22` covers both lines still receiving security fixes. Narrowing to `>=24` would
exclude connector authors on 22 for no benefit the SDK needs; omitting the field
leaves consumers guessing and leaves the matrix without a stated range to test.

### Semver classification: `feat:`, not `feat!:`

Introducing an engine constraint where none existed is a published, consumer-visible
declaration — npm warns on mismatch and fails under `engine-strict` — so it is a
`feat:` and earns a minor bump, not a `chore:`.

It is deliberately **not** classified as breaking, for three reasons:

1. **Nothing stops working.** The SDK is dependency-free types and pure helpers with
   no Node-22-only code. `engines` here states which lines we *support and test*, not
   which lines the code requires. A consumer on Node 20 keeps working; they lose a
   promise, not a capability.
2. **npm's default is a warning**, not an install failure. Only opt-in
   `engine-strict` turns it fatal.
3. **The lines being excluded are already EOL.** Node 20 ended support 2026-04-30.
   Declaring support for the two lines still receiving security fixes does not warrant
   1.6.0 → 2.0.0.

**Open procedural point.** `GOVERNANCE.md` says only that contract-affecting changes
are "potentially a major bump," and the written deprecation policy that would settle
cases like this is Phase 0, box 8 — not yet written and out of this slice. This
classification is therefore a judgment call made on the merits above. It should be
revisited as a worked precedent when that policy is drafted.

**Follow-up, not this slice:** when v26 enters LTS on 2026-10-28, add it to the smoke
matrix.

---

## Component 1 — The surface extractor

**Location:** `scripts/api-surface.ts`. Pure functions, no `typescript` import, no new
dependency of any kind.

`scripts/` rather than `src/` follows the precedent of
`scripts/check-declaration-map.test.ts`: it asserts `dist/` output, it is meta-tooling
rather than shipped SDK code, and keeping it out of `src/` keeps it out of
`bun test --coverage src`. A consequence is that `biome check src/` does not lint it,
so the regeneration path may use `console` — consistent with the existing script, not
a new exception.

### Input is derived, never hardcoded

The extractor reads `package.json` → `exports` → each entry's `types` target
(`./dist/index.d.ts`, `./dist/testing/index.d.ts`, `./dist/ipc/index.d.ts`).

This is deliberate: adding a fourth entry point automatically brings it under the
guard. The public surface cannot be widened without the gate noticing.

### Algorithm

1. For each entry `.d.ts`, parse its `export { … } from "./x.js"` clauses into
   `{ name, typeOnly, sourceModule }`. Both `export type { A }` and inline
   `export { type A }` survive tsc emit, so type-only-ness is readable from the text.
2. Resolve each `sourceModule` to its `dist/**/*.d.ts` file and capture the declaration
   text for that name.
3. **Fail loudly on `export *`.** No barrel uses one today. A future wildcard would
   silently under-capture the surface, so it must be a deliberate decision rather than
   a quiet gap in coverage.
4. Emit markdown: one section per entry point, exports sorted by name, each recording
   kind, type-only-ness, source module, and declaration text.

### Parser requirements

Reading `.d.ts` as text rather than through an AST means the parser must be explicit
about what it tolerates. It must:

- **Strip comments before parsing.** Not hypothetical — the emitted barrels carry
  comment lines today (8 in `dist/index.d.ts`, 11 in `dist/testing/index.d.ts`, 1 in
  `dist/ipc/index.d.ts`), including the JSDoc file header. Both `//` and `/* … */`
  forms must be removed first.
- **Handle multi-line export clauses.** tsc currently emits each clause on a single
  line, but depending on that formatting is exactly the fragility this parser has to
  survive. Normalize whitespace across newlines before matching.
- **Handle aliased re-exports** — `export { Foo as Bar } from "./x.js"`. None exist in
  the barrels today, but the *exported* name is `Bar` and the surface must record it as
  such. Costs nothing to support; the alternative is silent mis-parsing the first time
  one is added.
- **Fail loudly on `export *`**, as described above.

The rule behind all four: the parser either understands a construct or refuses it. It
must never silently under-report the surface, because a guard that quietly misses an
export is worse than no guard.

### Determinism

Output is LF-only, sorted by name, free of absolute paths, and ends with a trailing
newline. The repo's existing `.gitattributes` (`* text=auto eol=lf`) already normalizes
line endings on checkout, so no new attribute rule is needed.

**Normalize `\r\n` → `\n` in memory anyway**, on every file read in both the generator
and the gate, before comparing or writing. `.gitattributes` governs what git puts in
the working tree; it does not stop a Windows editor from saving CRLF into
`docs/api-surface.md` or a source file afterward. Without in-memory normalization that
produces a golden-file failure that reproduces only on one developer's machine and
passes in CI — the worst failure mode this slice could ship. One line of code, so it is
not worth reasoning about whether it can happen.

Cross-platform determinism is not asserted by inspection — it is what the cross-OS
matrix (Component 3) exists to prove.

---

## Component 2 — The gate

**Location:** `scripts/api-surface.test.ts`. Replaces the uncommitted
`src/api-surface.test.ts`, which is written against the TS 5 compiler API and cannot
run under TypeScript 7.

Behavior:

- Regenerate the surface and compare against the committed `docs/api-surface.md`.
- On mismatch, fail with the offending diff **and** the literal re-baseline command.
- If `dist/` is absent, fail with a message telling the reader to run `bun run build`
  first — not a raw `ENOENT`.
- Assert that every key in the `exports` map has a corresponding section in the golden
  file, so a newly added entry point fails rather than passing vacuously.

**Re-baselining** is a new `package.json` script, `api:surface`, which writes the file.
An intentional surface change is therefore a two-part PR: the source change plus a
visible `docs/api-surface.md` diff, which is where the semver conversation happens.

**Unit tests.** The extractor is tested against a fixture `.d.ts` tree in a temp
directory. The fixture carries over the shapes from the superseded red test — a class,
a const, a function, an interface with one required and one optional member, a
string-union type alias — and the barrel re-exporting them must exercise every parser
requirement above:

| Fixture case | Guards against |
|---|---|
| `export { … }` spanning multiple lines | reliance on tsc's current one-line emit |
| `export type { InterfaceA } from "./x.js"` | clause-level type-only detection |
| `export { type InterfaceB } from "./x.js"` | inline `type` modifier detection |
| `export { originalName as exportedName }` | recording the *exported* name, not the source name |
| a `//` comment and a `/* … */` block among the clauses | comment bleed into parsed names |
| a file written with CRLF endings | platform-dependent baselines |
| `export * from "./x.js"` | must throw, not silently under-report |

---

## Component 3 — The CI matrix

Replaces the single `build-test` job in `.github/workflows/ci.yml` with two jobs.

```text
build-test    os: [ubuntu-24.04, macos-15, windows-2025]        → 3 jobs
              fail-fast: false
              typecheck → lint → build → test
              the ubuntu job uploads dist/ as an artifact

node-smoke    needs: build-test
              os: [ubuntu, macos, windows] × node: [22, 24]     → 6 jobs
              downloads the ubuntu-built dist/
              runs `node scripts/smoke-esm.mjs`
```

Nine jobs total. Three choices are load-bearing:

**The smoke moves out of the workflow YAML into `scripts/smoke-esm.mjs`.** Today it is
an inline `run: |` block wrapping a multi-line `node --input-type=module -e "…"` — bash
syntax. The default shell on GitHub's Windows runners is PowerShell, so that step
breaks the moment `windows-2025` joins the matrix. A committed `.mjs` file invoked as
`node scripts/smoke-esm.mjs` is shell-agnostic, and it is also runnable locally, which
the heredoc never was. **Every other multi-line `run:` block in `ci.yml` must be
audited for the same problem as part of this change.**

The script imports **by package name**, not by relative `dist/` path:

```js
import * as sdk     from "@nimbus-dev/sdk";
import * as testing from "@nimbus-dev/sdk/testing";
import * as ipc     from "@nimbus-dev/sdk/ipc";
```

Node's self-reference resolution makes this work from inside the package without an
install step (verified: resolves to `dist/` and yields 77 / 2 / 2 exports). This is
strictly better than importing `./dist/index.js` directly, because it exercises the
`exports` map itself — the same map the API-surface guard is built around, and the
thing that produced the original `ERR_MODULE_NOT_FOUND` class of bug. Under plain Node
the `bun` condition does not match, so resolution correctly lands on `import` →
`./dist/index.js`. The script exits non-zero listing every entry point that failed.

**The smoke jobs consume the ubuntu-built `dist/`, not a per-OS rebuild.** This matches
what actually ships: npm publishes one tarball, built on one machine, and consumers on
every OS load that exact artifact. Rebuilding per job would test something the
ecosystem never receives. It is also faster. Per-OS *build* correctness is still
covered — `build-test` builds on all three.

**`harden-runner` stays at `egress-policy: block` on ubuntu and drops to `audit` on
macOS and Windows,** because blocking is unavailable on those runners. The alternative
— weakening every job to the common denominator — would trade real protection on the
job that does the publishing-relevant work for uniformity. Accepted trade-off: the
non-Linux jobs run with unhardened egress, in audit mode so exfiltration attempts are
at least recorded.

`fail-fast: false` so one platform's failure still reports the others — the whole point
is seeing *which* platforms differ.

---

## Sequencing

Ordering is chosen so every commit lands green:

1. `feat: declare the supported Node range (engines >=22)`
2. `ci: run the ESM smoke from a script instead of an inline shell block`
   — a behavior-preserving extraction that lands green on the existing ubuntu-only
     job, so the shell-portability fix is isolated from the matrix change that needs it
3. `ci: run the suite cross-OS and smoke the ESM entries on Node 22/24`
   — proves the *existing* suite is platform-clean before anything new depends on it
4. `test: guard the public API surface with a golden file`
   — lands into an already-proven matrix, so a Windows-nondeterministic baseline
     surfaces immediately rather than after it is committed as truth
5. `docs: document the api:surface re-baseline command in CONTRIBUTING.md`
6. `docs: tick the three Phase-0 boxes in ROADMAP.md`

One PR, six commits. The matrix must validate the golden file within the same PR;
splitting them would commit a baseline no one has run on Windows.

---

## Rejected and deferred

**Rejected: a pre-commit / pre-push hook that regenerates the surface.** Proposed so a
developer who forgets `bun run api:surface` learns before CI. Declined: the repo has no
hook framework — no husky, no lefthook, nothing in `package.json` — so this means new
infrastructure and a devDependency in a package that deliberately carries three. And it
treats the designed behavior as a gap: the gate fails with the re-baseline command in
its message, which is the intended feedback path. **The documentation half is
accepted** — `bun run api:surface` and when to run it get documented in
`CONTRIBUTING.md` as part of this slice.

**Deferred: revisiting the `engines` semver classification** against a written
breaking-change policy, once Phase 0 box 8 lands. See Component 0.

**Deferred: Node 26 in the smoke matrix** until it enters LTS on 2026-10-28.

## Risks accepted

**tsc reformatting produces golden-file diff noise.** A change to how tsc emits
declarations will show up as a surface diff even when the contract is unchanged. This
is accepted — a reviewer seeing every change to the published `.d.ts` is the feature,
and false positives are cheap to re-baseline.

**Text extraction is less precise than a checker.** It reads declarations as written
rather than as fully resolved. Since `.d.ts` files already spell their types out
textually, the gap is small, and it buys complete independence from the `unstable/*`
TypeScript APIs — which matters for a guard whose whole job is to be more stable than
what it guards.

**Non-Linux CI jobs run without egress blocking.** Bounded by harden-runner's platform
support, mitigated by audit mode.

---

## Exit criteria

- `package.json` declares `engines: { "node": ">=22" }`.
- `docs/api-surface.md` is committed and lists every export of all three entry points.
- `scripts/api-surface.test.ts` fails CI when the committed surface is stale, and names
  the re-baseline command when it does.
- Adding a new `exports` entry point without re-baselining fails CI.
- The extractor throws on `export *` and records the exported name for aliased
  re-exports; both are covered by unit tests.
- Golden-file comparison is unaffected by CRLF in any input, proven by a CRLF fixture.
- No multi-line inline shell block remains in `ci.yml`; the ESM smoke runs as
  `node scripts/smoke-esm.mjs` and is runnable locally.
- The full suite is green on Linux, macOS, and Windows.
- All three entry points import **by package name** under plain Node 22 and 24, on all
  three operating systems, from a single ubuntu-built `dist/`.
- `CONTRIBUTING.md` documents `bun run api:surface` and when to run it.
- Phase 0 boxes 4, 5, and 6 are ticked in `docs/ROADMAP.md`.

---

## Review history

Revised 2026-07-26 against
[`2026-07-26-phase0-lock-the-contract-design-review.md`](./2026-07-26-phase0-lock-the-contract-design-review.md).
Accepted: parser hardening, in-memory CRLF normalization, extraction of the ESM smoke
into a script, package-name imports, expanded fixture coverage. Rejected: the
pre-commit hook (see Rejected and deferred). Retained after re-examination: the `feat:`
classification for `engines`.
