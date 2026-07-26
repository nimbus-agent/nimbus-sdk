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

**This is a `feat:`, not a `chore:`.** Introducing an engine constraint where none
existed is a published, consumer-visible declaration — npm warns on mismatch, and
fails under `engine-strict`. It earns a minor bump.

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

### Determinism

Output is LF-only, sorted by name, free of absolute paths, and ends with a trailing
newline. The repo's existing `.gitattributes` (`* text=auto eol=lf`) already normalizes
line endings, so no new rule is needed.

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
directory, carrying over the shapes from the superseded red test: a class, a const, a
function, an interface with one required and one optional member, a string-union type
alias, and a barrel that re-exports all of them with mixed `type` modifiers.

---

## Component 3 — The CI matrix

Replaces the single `build-test` job in `.github/workflows/ci.yml` with two jobs.

```
build-test    os: [ubuntu-24.04, macos-15, windows-2025]        → 3 jobs
              fail-fast: false
              typecheck → lint → build → test
              the ubuntu job uploads dist/ as an artifact

node-smoke    needs: build-test
              os: [ubuntu, macos, windows] × node: [22, 24]     → 6 jobs
              downloads the ubuntu-built dist/
              imports all three exports entry points under plain Node
```

Nine jobs total. Two choices are load-bearing:

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
2. `ci: run the suite cross-OS and smoke the ESM entries on Node 22/24`
   — proves the *existing* suite is platform-clean before anything new depends on it
3. `test: guard the public API surface with a golden file`
   — lands into an already-proven matrix, so a Windows-nondeterministic baseline
     surfaces immediately rather than after it is committed as truth
4. `docs: tick the three Phase-0 boxes in ROADMAP.md`

One PR, four commits. The matrix must validate the golden file within the same PR;
splitting them would commit a baseline no one has run on Windows.

---

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
- The full suite is green on Linux, macOS, and Windows.
- All three entry points import cleanly under plain Node 22 and 24, on all three
  operating systems, from a single ubuntu-built `dist/`.
- Phase 0 boxes 4, 5, and 6 are ticked in `docs/ROADMAP.md`.
