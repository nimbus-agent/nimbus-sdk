# Phase 0, slice 3 — The authoring path

**Status:** approved design, not yet implemented
**Date:** 2026-07-26
**Roadmap:** [`docs/ROADMAP.md`](../../ROADMAP.md) — Phase 0, boxes 1, 2 and 3
**Follows:** [slice 2 — the written policies](./2026-07-26-phase0-policies-design.md)

---

## Goal

Make the path from "I want to build a Nimbus connector" to a working one short and
*provably* correct: every public export reachable from a doc page, every doc snippet
compiled against the artifact that ships, and two connectors that actually run in CI.

This slice closes Phase 0.

## Why this is the next slice

Three boxes remain in Phase 0, and all three serve
[Pillar 4 — authoring experience](../../ROADMAP.md#4-authoring-experience). They are the
last thing standing between the SDK and the phase's stated exit criteria, and they are
the reason the two earlier slices exist: slice 1 locked the contract so it cannot move
without notice, slice 2 wrote the rules that govern how it changes, and neither helps
anyone actually write a connector.

The order matters in one specific way. Slice 1 produced
[`docs/api-surface.md`](../../api-surface.md), and its own design was explicit that the
file "lists declarations, not prose, and has no per-helper guidance" — a step toward the
docs surface, not the docs surface. That file is now the *input* this slice builds on:
it already knows every export and the module each one comes from, which is exactly what a
coverage guard needs.

## Scope

| # | Deliverable | Roadmap box |
|---|-------------|-------------|
| 1 | `docs/modules/*.md` — 15 per-module pages | Phase 0, box 1 |
| 2 | `docs/README.md` — the docs index | Phase 0, box 2 |
| 3 | `scripts/docs-coverage.test.ts` — every export maps to a documented module | enabler for 2 |
| 4 | `scripts/docs-snippets.ts` + test — every `ts` fence compiles | enabler for 1 |
| 5 | `examples/quickstart-connector/` and `examples/calendar-connector/` | Phase 0, box 3 |
| 6 | Tick the three boxes in `ROADMAP.md`; add the coverage rule to `CONTRIBUTING.md` | — |

**Out of scope.** Everything in Phase 1 — the JSON Schemas, the IPC wire-protocol spec,
the conformance-suite extraction, contract-version negotiation. `docs/spec/` stays a
placeholder. No new runtime dependency, and no new devDependency: both guards are built
from what the repo already has.

---

## Component 1 — The per-module docs

**Files:** `docs/modules/*.md`, 15 pages.

### The module map

`buildSurface()` resolves the published surface to **25 distinct source modules**.
Grouping directory-modules onto one page each gives 15 pages:

| Page | Modules it covers |
|------|-------------------|
| `agents.md` | `agents/agent-names`, `agents/brief-composites`, `agents/brief-types`, `agents/brief-guards`, `agents/guard-factory` |
| `audit-logger.md` | `audit-logger` |
| `crypto.md` | `crypto/jwt`, `crypto/canonical-json`, `crypto/verify-signature`, `crypto/service-account-token`, `crypto/app-store-connect-jwt` |
| `data-profile.md` | `data-profile/index` |
| `distribution-channel.md` | `distribution-channel` |
| `flux-cd.md` | `flux-cd/index` |
| `hitl-request.md` | `hitl-request` |
| `icalendar.md` | `icalendar` |
| `ipc.md` | `ipc/ndjson-line-reader` |
| `item-types.md` | `item-types` |
| `jmap-fastmail.md` | `jmap-fastmail/index` |
| `server.md` | `server` |
| `storybook.md` | `storybook/index` |
| `testing.md` | `contract-tests`, `testing/index`, `testing/sandbox-contract` |
| `types.md` | `types` |

The roadmap's box 1 names seven batteries — `crypto`, `jmap-fastmail`, `icalendar`,
`data-profile`, `flux-cd`, `storybook`, `distribution-channel`. The other eight pages are
what the coverage bar drags in, and they are not filler: `server` and `types` are the
contract itself, and `testing` is what every connector's test suite imports.

### How a page claims its modules

Each page opens with a machine-read comment:

```
<!-- covers: crypto/jwt, crypto/canonical-json, crypto/verify-signature,
             crypto/service-account-token, crypto/app-store-connect-jwt -->
```

The guard unions every page's claims and diffs that set against the modules
`buildSurface()` resolves. An unclaimed module fails; a claim matching no module fails.

**Explicit module paths, no directory shorthand.** Letting `crypto.md` claim `crypto/*`
would silently absorb a future `crypto/hmac.ts` into a page that says nothing about it —
the exact drift the guard exists to catch. The verbosity is the feature: adding a module
means deciding, in a diff, which page explains it.

### What a page contains

Prose scaled to the module, not a template filled in mechanically. At minimum: what the
module is for, when an author reaches for it, at least one complete `ts` snippet, and the
constraints that are load-bearing — `jmap-fastmail` is headers-only, `data-profile` is
metadata-only, `icalendar` never throws on malformed input. Signatures are not repeated:
`docs/api-surface.md` already carries every declaration verbatim, and duplicating them
here creates a second thing to keep in sync.

## Component 2 — The docs index

**File:** `docs/README.md`.

One page listing every module page with a one-line description, alongside the existing
top-level documents (`ROADMAP`, `ARCHITECTURE`, `RELEASING`, `SECURITY`, `GOVERNANCE`,
`INCLUSION-POLICY`, `DEPRECATION-POLICY`, `GLOSSARY`, `api-surface`, `spec/`). The root
`README.md` links to it.

This is the "docs surface that indexes every public export" the roadmap asks for. It
indexes exports *through* their modules rather than one entry per export: with 135
exports on `.` alone, a per-export index would mean a sentence about `AgentBriefBase`
that adds nothing to the type signature `api-surface.md` already prints.

## Component 3 — The doc-coverage guard

**File:** `scripts/docs-coverage.test.ts`.

Three assertions, three distinct failure messages:

1. **Every module is claimed.** For each `SurfaceExport`, resolve `source` against its
   entry file — `resolveSpecifier("dist/ipc/index.d.ts", "./ndjson-line-reader.js")` →
   `dist/ipc/ndjson-line-reader.d.ts` — then strip `dist/` and `.d.ts` to get the module
   key. Fail naming both the unclaimed modules and the exports that live in them.
2. **Every claim resolves.** A `covers:` entry naming a module that no longer exports
   anything fails — that is a page documenting something deleted.
3. **The index is complete.** `docs/README.md` links every page in `docs/modules/`, and
   every page it links exists.

`source: "(local)"` — an export the barrel declares itself rather than re-exporting, as
`MockGateway` does in `src/testing/index.ts` — maps to the entry barrel's own module
(`testing/index`). It is handled explicitly rather than skipped: silently skipping a case
is how a guard quietly under-reports, which
[`api-surface.ts`](../../../scripts/api-surface.ts) already names as worse than no guard
at all.

Following `api-surface.test.ts`, the guard first asserts `dist/index.d.ts` exists, reusing
that file's message — *"dist/ is missing — run `bun run build` before `bun test`"* — and
asserts the resolved module set is non-empty, so a broken extractor cannot pass vacuously.

### It does not touch `api-surface.ts`

The guard imports `collectEntryPoints()`, `buildSurface()` and `resolveSpecifier()` as a
library. All three are already exported. `docs/api-surface.md` stays byte-identical, and
keeps meaning exactly one thing: a diff there is a change to the published contract and
must carry the matching semver bump. Folding doc links into that file would have made a
docs-only pull request diff the contract snapshot, muddying the one signal it exists to
give.

## Component 4 — The snippet guard

**Files:** `scripts/docs-snippets.ts` and `scripts/docs-snippets.test.ts`.

Same shape as `api-surface.ts`: pure exported functions, plus a test that drives them
against the real repository.

- **Extract** every TypeScript fence from `docs/modules/*.md` and `README.md`, retaining
  each fence's source file and starting line.
- **Emit** each snippet **verbatim** into a generated temporary project whose
  `tsconfig.json` maps the package name onto the built `dist/` declarations.
- **Typecheck** every snippet in a single `tsc --noEmit` pass under the repo's strict
  settings. A failure reports the originating `docs/modules/crypto.md:42`, not the temp
  path.

One `tsc` invocation, not one per snippet: the compiler's startup cost dominates, and
this runs on three operating systems on every pull request.

### Resolution by `paths`, not by rewriting

The snippet text is **never modified**. The temp project's `tsconfig.json` carries a
`paths` mapping instead:

```jsonc
{
  "@nimbus-dev/sdk":         ["<repo>/dist/index.d.ts"],
  "@nimbus-dev/sdk/testing": ["<repo>/dist/testing/index.d.ts"],
  "@nimbus-dev/sdk/ipc":     ["<repo>/dist/ipc/index.d.ts"]
}
```

What gets typechecked is then byte-identical to what a reader copies, which string
rewriting cannot promise.

**The mapping is derived from `collectEntryPoints()`, and there is no wildcard.** A
`"@nimbus-dev/sdk/*"` pattern would make `@nimbus-dev/sdk/crypto` typecheck green while
failing for every real consumer — the `exports` map has exactly three entries (`.`,
`./testing`, `./ipc`), and `crypto` is reached through the main entry. A guard that
green-lights an import Node will reject is worse than no guard. Building the mapping from
`collectEntryPoints()` also means a fourth entry point added to `package.json` is
resolvable in snippets the moment it exists, with nothing to remember.

### What a snippet may import

Only the `@nimbus-dev/sdk` entry points above and `node:` builtins. A snippet that needs
a third-party package is teaching something false: the SDK is dependency-free, and a
connector author following that snippet would be installing a dependency the contract
says they do not need. The guard rejects any other bare specifier by name rather than
letting `tsc` fail with a resolution error.

### Where the temp project lives

A gitignored directory at the **repository root**, removed in a `finally` block. Root
placement is what lets `tsc` walk up to the repo's `node_modules/@types` for the `node:`
builtin typings; a project written to the system temp directory resolves none of them.

Two locations are specifically ruled out. Not `node_modules/.tmp/` — any `bun install`
may wipe it mid-run. Not under `dist/` — `files: ["dist", "src"]` publishes that
directory and `prepublishOnly` runs `build` without `clean`, so a leftover scratch folder
would ship inside the package.

### Fence tags

` ```ts ` and ` ```typescript `, matched case-insensitively. An info string carrying
anything further — ` ```ts twoslash `, ` ```ts skip ` — **fails the guard by name**
rather than being quietly ignored. `api-surface.ts` states the doctrine this follows:
"the parser either understands a construct or refuses it." Silently discarding an unknown
attribute is how ` ```ts skip ` becomes the escape hatch this design just refused to
provide.

### Two rules that make it work

**Every `ts` fence is a complete, standalone module.** It carries its own imports and
compiles alone. That constraint is also what makes a snippet copy-pasteable, which is the
point of writing it.

**No escape hatch.** An illustration not meant to compile uses ` ```text ` — the
convention [`DEPRECATION-POLICY.md`](../../DEPRECATION-POLICY.md) already uses for its
version timeline. A `ts ignore` flag would become the default for anything inconvenient
and hollow the guard out within a release or two.

### Scope: the teaching surface only

`docs/modules/*.md` and `README.md`. The policy and governance documents deliberately use
fragments — `export const oldThing = …;` in `DEPRECATION-POLICY.md` is not valid
TypeScript and should not be. Those documents argue; the module docs teach. Only what
teaches has to compile.

## Component 5 — The two examples

**Directories:** `examples/quickstart-connector/` and `examples/calendar-connector/`.

### `quickstart-connector`

The ~30-line answer: a manifest, one tool, `server.start()`. It **is** the README
quickstart — a test asserts that the README's quickstart fence and
`examples/quickstart-connector/index.ts` agree, so the first code a newcomer reads cannot
drift from code proven to run.

The comparison normalizes before asserting: line endings through `normalizeEol()`,
trailing whitespace stripped per line, and blank lines trimmed from the start and end.
Without that, a Windows checkout fails the test on `\r\n` alone. It deliberately does
**not** trim leading indentation per line — that is real content, and normalizing it away
would hide exactly the drift the assertion exists to catch.

### `calendar-connector`

The realistic one: a manifest declaring `hitlRequired`, two or three tools of which one is
HITL-gated through `hitl-request`, the scoped audit logger for observability, and
`icalendar` doing real work. It shows the shape of a connector that does something rather
than a tour of all seven batteries — a connector doing seven unrelated jobs teaches
nothing about any of them, and the batteries get their coverage from their own doc pages.

### How they stay green

Each ships an `index.test.ts` that stands the server up and runs `runContractTests`
against it — precisely what Phase 0's exit criteria names.

**The sandbox probe stays out.** Its platform asymmetry is documented and deliberate;
wiring `runSandboxContractTests` into an example would paint the examples red on Windows
for reasons unrelated to the examples. `src/testing/sandbox-contract.test.ts` already
covers that ground on the cross-OS matrix slice 1 built.

Examples import through the package name `@nimbus-dev/sdk`, not relative paths into
`src/`. Under Bun that self-reference resolves through the `exports` map's `bun`
condition, so the examples exercise the same entry-point resolution a real consumer hits.

---

## Wiring

- `tsconfig.json` includes `examples/`, so `bun run typecheck` covers them.
  `tsconfig.build.json` excludes them, so nothing new lands in `dist/`.
- `lint` becomes `biome check src/ scripts/ examples/`. Examples obey the same rules,
  `noConsole` included — a connector that wants to say something uses the audit logger,
  which is the more instructive answer anyway.
- `files: ["dist", "src"]` already excludes `examples/` from the published tarball. No
  change needed.
- `.gitignore` gains the snippet guard's scratch directory, so an interrupted run cannot
  leave an untracked directory that shows up in every later `git status`.
- **No new CI jobs.** Both guards are `bun test` files and both examples are typechecked,
  linted and tested by the existing Typecheck → Lint → Build → Test steps, on all three
  operating systems. `Build` already precedes `Test`, so `dist/` exists when the guards
  need it.
- `CONTRIBUTING.md` gains the rule: a new public export must be claimed by a module page,
  or the coverage guard fails the pull request.
- `ROADMAP.md` ticks boxes 1, 2 and 3.

## Testing

The guards are themselves tested, following `api-surface.test.ts`: pure functions
(`covers:` parsing, fence extraction, `paths`-mapping construction, module-key derivation)
are unit tested against synthetic inputs, then a small number of integration tests run
them against the real repository. Unit tests must not depend on the real docs, or every
future doc edit becomes a test edit.

Cases that must be covered by name:

- **EOL independence.** Fence extraction finds the same snippets under CRLF and LF.
- **Non-TypeScript fences are ignored.** ` ```text `, ` ```jsonc ` and ` ```javascript `
  are skipped; ` ```ts ` and ` ```TypeScript ` are both collected.
- **Unrecognized info strings fail.** ` ```ts skip ` is an error naming the file and line,
  not a silently dropped snippet.
- **Non-existent subpaths fail.** A synthetic snippet importing `@nimbus-dev/sdk/crypto`
  must fail typecheck. This is the regression test for the wildcard `paths` mapping: if
  someone later "simplifies" the mapping to `@nimbus-dev/sdk/*`, this test goes red.
- **Non-SDK bare specifiers fail.** A snippet importing a third-party package is rejected
  by name.
- **The coverage guard has no false negative.** A synthetic surface containing a module no
  page claims must fail. Synthetic, not by adding a throwaway export to `src/` — that
  would also diff `docs/api-surface.md` and drag a contract change into a docs test.

The examples are covered by their own `runContractTests` suites. The README-matches-
quickstart assertion lives with the quickstart example's test.

## Risks, stated plainly

**`tsc` cost on three operating systems.** One batched compilation, not one per snippet.
If it still proves slow, the fallback is to run the snippet guard on Linux only — the
snippets are platform-independent, so cross-OS coverage buys little there. That is a
fallback, not the plan.

**Windows path handling in both guards.** `normalizeEol()` and `resolveSpecifier()` exist
and are already tested for exactly this; the new code uses them rather than reimplementing
path logic.

**`covers:` comments are tedious.** Accepted. It is the cost of not letting a new module
ship undocumented, and the guard names the missing module for you when you forget.

**The coverage bar is module-level, not export-level.** A new export added to an
already-documented module passes the coverage guard without a word written about it. The
`api-surface.md` diff still surfaces it for review, so it cannot ship unnoticed — but this
guard alone will not force prose for it. Tightening to per-export coverage is a later
decision, made cheaply once the pages exist.

## Exit criteria

Phase 0's exit criteria, restated against this slice:

- Every public export is documented and reachable from `docs/README.md` — enforced by the
  coverage guard, not asserted.
- Every `ts` snippet in the teaching surface compiles against `dist/` — enforced by the
  snippet guard.
- Both example connectors build and pass `runContractTests` in CI on the cross-OS matrix.
- `ROADMAP.md` Phase 0 shows eight of eight boxes ticked.
