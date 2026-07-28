# ESM correctness — four follow-ups

**Status:** approved design, not yet implemented
**Date:** 2026-07-28
**Follows:** [ESM correctness — two shipped defects and the guards that would have caught them](./2026-07-28-esm-correctness-design.md)
**Semver:** items 1–3 are `test:` / `docs:` and cut no release. Item 4 is a `feat:` and cuts a
minor. `release-please-config.json` has no scope filter, so this split is load-bearing: any
`fix:` or `feat:` on the first two branches would cut a release nobody asked for.

---

## Goal

Close the last unguarded route in the "works in-repo, fails from the published package"
class, remove the final silent-under-report path from the CJS scanner, end a three-way
disagreement about what `jmap-fastmail` ships, and give bundled consumers a supported seam
for the sandbox probe.

The v1.7.1 work fixed two defects that had shipped to npm and added two guards
(`scripts/cjs-scan.ts`, and an invocation phase in `scripts/smoke-esm.mjs`). It also
surfaced **three separate checks that could not fail** — a `node -e` verification whose CJS
wrapper leaks a real `require` global into dynamically-imported ESM, the first `probePath`
tests which were green with or without the fix, and a comment stripper that a regex literal
blanked to EOF. None were caught by careful writing; all three were caught by asking *"would
this fail if the code were wrong?"*

**That question governs every check in this spec.** Where a design choice below looks
over-elaborate, it is usually because the simpler version would pass unconditionally.

## The doctrine these guards are held to

Quoted from `scripts/api-surface.ts`'s header:

> the parser either understands a construct or refuses it. It must never silently
> under-report the surface — a guard that quietly misses an export is worse than no guard
> at all.

Refusal is loud. Silence is the failure mode.

---

## Item 1 — Verify what actually ships

**Commit type:** `test:`

### The gap

`scripts/smoke-esm.mjs` and `scripts/cjs-scan.ts` both resolve **inside the checkout** —
the smoke via Node's package self-reference, the scan by walking `dist/` directly. Neither
can observe a packaging regression, because neither ever consults `files`.

`package.json` has `files: ["dist", "src"]` and three `exports` keys. **The `src` entry is
load-bearing**: the `bun` condition points into `src/`, so dropping `"src"` from `files`
would break every Bun consumer while leaving all existing guards green.

### Design

New `scripts/packed-exports.ts` + `scripts/packed-exports.test.ts`, following the
`cjs-scan.ts` / `cjs-scan.test.ts` split — pure logic in a module, guard in the test.

```ts
/** Every exports-map target absent from the packed file list, in map order. */
export function missingPackedPaths(
  exportsMap: unknown,
  packedPaths: readonly string[],
): string[];
```

Every **string leaf** of the exports map is checked, not just its top-level directory. That
is strictly stronger than the minimum this item could have shipped: it covers `types`
targets too, so a `dist/index.d.ts` that failed to emit is caught, and a typo'd
`"./testing"` target is caught even though `dist/` as a directory is packed.

`exportsMap` is typed `unknown` and narrowed with a type guard, per the repo's
cross-boundary rule. A malformed map is a refusal, not a silent zero-leaf pass — see the
anti-vacuity guards.

Normalization: exports values carry a leading `./` (`"./dist/index.js"`), npm's file list
does not (`"dist/index.js"`). Strip the prefix on both sides before comparing.

**No path-separator handling.** Verified on a Windows 11 checkout: `npm pack --dry-run
--json` emits POSIX separators throughout — zero backslashes in the entire 165-entry output.
Blanket `\\` → `/` replacement is not merely unnecessary, it is unsafe in the guard's own
direction: `\` is a legal character in a POSIX filename, so the replacement could make a
genuinely wrong path compare equal and turn a caught regression into a silent pass. If a
platform is ever found that does emit backslashes, normalize then, with that platform's
output as the test fixture.

### The file list comes from npm, not from us

`npm pack --dry-run --json` reports the exact set of files npm would publish:

```json
[{ "files": [{ "path": "dist/index.js" }, { "path": "src/index.ts" }, ...] }]
```

Asking npm is the point. Reimplementing `files` semantics — negations, implicit includes,
`.npmignore` interaction — would be a second implementation that can disagree with the real
one, and the disagreement would always resolve in favour of the guard passing.

`--dry-run` writes no tarball and needs no network. It requires `dist/` to have been built,
the same precondition the dist walker and the API-surface guard already carry, and it
reuses their error string: ``dist/ is missing — run `bun run build` before `bun test` ``.

**`--ignore-scripts` is deliberately absent, and the code comment must say so.** A design
review raised it, on the theory that `prepublishOnly` (`bun run build && bun run typecheck`)
would fire and nest a build inside `bun test`. It does not: npm runs `prepublishOnly` only on
`npm publish`. Verified — `dist/index.js`'s mtime is unchanged across a pack, and the whole
invocation takes 2.4s, which a build plus typecheck could not.

Adding the flag defensively would be worse than neutral. `prepack` and `prepare` *do* fire on
`npm pack`, so if either is ever added and generates a file that ships, `--ignore-scripts`
would have the guard compare against a file list no real publish ever produces — a silent
under-report, which is the one direction this repo does not go. The guard's value is fidelity
to what `npm publish` would do; suppressing the hooks publish runs discards exactly that.

### Test structure

Two halves, deliberately:

1. **Synthetic unit cases** over `missingPackedPaths` — a map whose `src` target is absent
   from the file list returns exactly that target (the dropped-`"src"`-from-`files`
   regression); a map with a target in neither `dist/` nor `src/` returns it (the typo'd
   export target); a complete list returns `[]`; a malformed map throws. These are
   falsifiable by construction: the inputs are literals in the test, so they exercise the
   failure path on every run rather than hoping the real repo is broken.

   **These cases pass synthetic values to the pure function; they never mutate the real
   `package.json`.** Writing to it on disk to provoke a failure would leave the checkout
   dirty on any early exit and would race the other guards in the same `bun test` run,
   several of which read `package.json` themselves.
2. **One integration case** running `npm pack --dry-run --json` against the real checkout
   and asserting `missingPackedPaths(pkg.exports, packed) === []`.

### Anti-vacuity guards

Mirroring the dist walker's existing `"found no emitted .js files — the scan would pass
vacuously"` style:

- The packed list must be non-empty.
- The number of leaves checked must be greater than 5 (twelve today — three entries ×
  `bun` + `types` + `import` + `default`).
- **If `npm` is unavailable the test fails; it does not skip.** A conditional skip is
  precisely the shape of the three unfalsifiable checks that motivated this spec. `npm`
  ships with Node, and `build-test` is the only job that runs `bun test` — it has Node and
  its egress policy already allows `registry.npmjs.org`.

### What this does not catch

A file that packs correctly but fails to *execute*. That is `smoke-esm.mjs`'s job, and it
already covers it. Stated here so the boundary is on the record rather than assumed.

**If this class is ever verified by hand again: never use `node -e`.** Its CJS wrapper
leaks a real `require` global into dynamically-imported ESM and masks the exact error being
hunted. Use `node --input-type=module` or a real `.mjs`.

---

## Item 2 — Make an unterminated block comment loud

**Commit type:** `test:`

### The gap

`codePortion` returns `{ code: "", inBlock: true }` at `scripts/cjs-scan.ts:89` and `:100`
when no `*/` is found, so an unterminated `/*` silently swallows to EOF — including any
`require(` below it. `scripts/cjs-scan.test.ts:96` currently asserts that as acceptable.

Unreachable in practice: `dist/` is entirely `tsc` output, and a file with an unterminated
block comment is not valid JavaScript. But it is the module's last silent-under-report
path, and the doctrine above does not have an "unreachable" exemption.

### Design

`findCjsConstructs` records the line number at each `false → true` block transition, and
throws at EOF if a block is still open:

```
unterminated block comment opened at line 42 — the scan cannot see past it
```

Throwing matches `scripts/api-surface.ts`, which refuses via `throw` at eleven sites. It is
the same posture applied to the same failure mode.

`codePortion` is **not** modified. The transition is observable from `findCjsConstructs`'s
existing loop, which already reads `result.inBlock` on every line.

### Consumer change

The single consumer is the dist walker at `scripts/cjs-scan.test.ts:179`, which formats
`rel:line — construct` per finding. It wraps the call so a throw still names the file:

```ts
try {
  for (const finding of findCjsConstructs(readFileSync(file, "utf8"))) {
    offenders.push(`${rel}:${finding.line} — ${finding.construct}`);
  }
} catch (err) {
  offenders.push(`${rel} — ${err instanceof Error ? err.message : String(err)}`);
}
```

Without the wrap the throw escapes mid-loop, the test dies before the `offenders` report is
built, and the failure names no file — a strictly worse diagnostic than the one it replaces.

### Do not reintroduce a character-scanning state machine

That was the previous design and its hole was worse: with no regex-literal state,
`const re = /[/*]/;` read as a block opener. The current rule — **a block opens only on a
line whose trimmed form starts with `/*`** — is what closes both that hole and the
`*`-prefixed-code-line hole. These cases must keep passing unchanged:

| input | expected |
|---|---|
| `const re = /[/*]/;` + `require(` | 1 finding |
| `const re = /\/*/g;` + `require(` | 1 finding |
| `const v = 2` / `  * require("x");` | 1 finding |
| `/* note */ const c = require("x");` | 1 finding |
| genuine JSDoc block | 0 findings |

### Two consequences the module header must state

The header already documents one false positive — a construct named in a *trailing* comment
on a code line. The trimmed-prefix rule has two more, both surfaced during design review and
both verified by running the scanner:

1. **A block comment opened mid-line never opens a block.** For
   `const x = 1; /* note` / `require("foo")` / `*/`, the scanner reports one finding on
   line 2 — it reads the comment body as code. Over-refusal, consistent with the doctrine,
   and the fix at a call site is to move the comment onto its own line.
2. **A template literal whose line begins with `/*` *does* open a block** — and with this
   item's change, an unclosed one now makes the scan **throw on valid JavaScript**. This is
   a false *refusal*, which is a sharper edge than a false positive, and it is the direct
   price of item 2. It is the right price under the doctrine: the alternative is the silent
   swallow being replaced.

   Checked before landing: of the 112 emitted `.js` files in `dist/`, **zero** would throw.
   That check is a one-off design-time verification, not a test — the dist walker covers it
   continuously by construction, since it runs the scanner over every emitted file.

### Tests

- The line-96 test inverts: an unterminated block now throws. Its comment is rewritten to
  explain why refusal replaced tolerance, replacing the current rationale for tolerating it.
- A second test asserts the message carries the **opening** line number, not the EOF line —
  a message naming the wrong line is a check that fires correctly and misdirects the fix.
- The five regression cases above stay exactly as they are.

The module header's discussion of this tradeoff updates to match; it currently documents
swallow-to-EOF as a consequence the design accepts.

---

## Item 3 — Reconcile the "headers-only" claim

**Commit type:** `docs:`

### The disagreement

Three places disagree about what `jmap-fastmail` ships:

- `docs/INCLUSION-POLICY.md:91` — *"`jmap-fastmail` stays **headers-only**"*
- `docs/ARCHITECTURE.md:73` — *"(headers only — a hard scope constraint keeps row/body data out)"*
- `src/jmap-fastmail/index.ts` — `MAX_BODY_VALUE_BYTES = 2048`, `PREVIEW_MAX_CHARS = 2000`,
  and a module header that documents the preview accurately and calls it a deliberate
  security scope constraint. `docs/modules/jmap-fastmail.md` documents it correctly too.

### The decision

**The shipped behaviour is right; the two policy documents are wrong and always were.**

The decisive fact is that the preview is not a view-layer choice that could be toggled off
cheaply. `emailGetArgs` (`src/jmap-fastmail/index.ts:221-230`) sends
`fetchTextBodyValues: true` and `maxBodyValueBytes: 2048`, and `EMAIL_PROPERTIES` requests
`textBody`, `bodyValues`, and `preview`. **Up to 2 KB of body crosses the wire on every
list/get/search, before `viewEmail` is ever called.** An opt-in bolted onto `viewEmail`
would discard body data that had already arrived and was sitting in the raw response object
— which is what `INCLUSION-POLICY.md:97` forbids. Minimization after the bytes arrive is not
minimization.

Making the claim true would therefore mean gating the **request builders** —
`buildListRequest` and its siblings, which take no options today — an RFC and a `feat!:`
across the module's whole public surface, breaking the gateway and mcp fastmail connectors.

The counter-argument is recorded rather than dismissed: for a large share of real email the
first 2000 characters *are* the whole message, and "headers plus a 2 KB preview" is not a
rounding error away from "headers". The judgment here is that the module's minimization
posture is genuine and reviewed — server-side truncation so a full body never exists
client-side, `blobId` never dereferenced, no surface to fetch attachment bytes — and that
the two policy sentences are shorthand that was never accurate, not a guarantee the code
broke.

### The change

`docs/INCLUSION-POLICY.md:91` becomes a statement of the bounds actually enforced, so the
document carries a checkable guarantee rather than a vaguer one:

> `jmap-fastmail` stays **headers, attachment metadata, and a server-truncated body
> preview** — `maxBodyValueBytes` (2048) bounds what crosses the wire, `PREVIEW_MAX_CHARS`
> (2000) bounds what is returned, and `blobId` is never dereferenced. Widening any of these
> three is contract-affecting and takes the RFC path.

`docs/ARCHITECTURE.md:73` gets the one-line version of the same. The RFC gate is preserved:
the next proposal to raise a cap or dereference a blob still hits it.

No code changes. No `api-surface.md` diff. No release. `docs/modules/jmap-fastmail.md` and
the module header already agree and are left alone.

---

## Item 4 — `probePath` override for bundled consumers

**Commit type:** `feat:` — cuts a minor.

### The gap

If a consumer bundles the SDK, `import.meta.url` points at the bundle and
`sandbox-probe.js` does not sit beside it. Not hypothetical: the comment above `probePath`
(`src/testing/sandbox-contract.ts:64-76`) records `@nimbus-dev/client` inlining this module
with `bun build --bundle --conditions=bun`, baking the build machine's absolute path in,
and throwing `ERR_INVALID_FILE_URL_PATH` on every machine that was not the CI runner.

`RunSandboxContractTestsOptions` already has the right shape — it carries
`runProbe?: ProbeRunner` for exactly this kind of seam.

### Design

```ts
export function __defaultRunProbe(
  probe: string,
  arg: string,
  binary: string = probePath(),
): ProbeResult;
```

plus `probePath?: string` on `RunSandboxContractTestsOptions`, threaded at the one call
site:

```ts
const runProbe = opts.runProbe ?? ((p, a) => __defaultRunProbe(p, a, opts.probePath));
```

**The laziness is the whole point.** A default parameter expression is evaluated only when
the argument is absent, so `probePath()` never runs when an override is supplied — and
`probePath()` is exactly what throws for the bundled consumer this feature exists for. The
obvious-looking `opts.probePath ?? probePath()` computed eagerly in the caller would throw
before the override could take effect, shipping a feature that fails for its only audience.

A function with a trailing optional parameter stays assignable to
`ProbeRunner = (probe, arg) => ProbeResult`, so existing callers passing
`__defaultRunProbe` directly are unaffected.

### Not an environment variable

`docs/INCLUSION-POLICY.md`'s purity criterion requires a substitutable effect to be
reachable *through a parameter*. `NIMBUS_SANDBOX_PROBE_PATH` would be precisely the ambient
state it forbids.

### Tests

The falsifiability requirement bites hardest here. A test that merely passes the option and
asserts it typechecks would be green whether or not the parameter is honoured.

Instead: write a throwaway script to a temp dir that exits with a distinctive code, call
`__defaultRunProbe("fs-denied", "", thatPath)`, and assert that code. If the third parameter
were ignored, the real probe would spawn and return something else — so the test fails when
the feature is absent.

A second test drives the option end-to-end through `runSandboxContractTests` with a stub
manifest, confirming the option reaches the runner rather than only the signature.

**The laziness itself is not test-covered, and no test should pretend otherwise.** Design
review suggested asserting that supplying `probePath` "does not throw
`ERR_INVALID_FILE_URL_PATH`". That check cannot fail: in-repo `import.meta.url` is always a
valid file URL, so `probePath()` never throws here and an eagerly-evaluated implementation
would pass it just as happily. It is the same shape as the three unfalsifiable checks this
spec exists to prevent.

The property is guaranteed structurally instead — a default parameter expression is
evaluated only when its argument is absent — and that is why the seam is built as a default
parameter rather than a `??` in the caller. Reproducing the bundled failure in-repo would
require building a bundle in the test, which is out of proportion to the risk. The limit is
recorded here so a later reader does not mistake its absence for an oversight.

### Contract change

This adds exported surface, so **`docs/api-surface.md` will change** — regenerate with
`bun run api:surface` and let the diff be reviewed as the contract change it is. This is the
only item in this spec that legitimately touches that file; on the other branches a diff
there means something went wrong.

`docs/modules/testing.md` gains the option. Doc coverage is per exported symbol and
`RunSandboxContractTestsOptions` is already covered, so the guard does not force this — it
is the right thing to do anyway.

---

## Sequencing

Three branches. Item 4 lands separately because it is the only one that changes the
published contract; mixing a `feat:` into a `test:`/`docs:` branch would cut a release for
the guards.

| # | Branch | Items | Commit types | Touches `api-surface.md` |
|---|---|---|---|---|
| 1 | guards | 1, 2 | `test:` | no |
| 2 | docs | 3 | `docs:` | no |
| 3 | probe-path | 4 | `feat:` | **yes** |

Items 1 and 2 are independent of each other and share a branch only because they are both
small guard work in `scripts/`.

## Verification

```bash
bun run typecheck && bun run lint && bun run build && bun test
node scripts/smoke-esm.mjs
```

The suite is 610 tests at v1.7.1 and must grow, not merely stay green — a guard branch that
leaves the count unchanged has added no check.

For each new check, the acceptance question is not "does it pass" but **"did I watch it
fail when the code was wrong?"** Every check in this spec has a stated way to make it fail;
running that is part of the work, not an optional extra.

## Design review disposition

Reviewed in
[`2026-07-28-esm-correctness-followups-design-review.md`](./2026-07-28-esm-correctness-followups-design-review.md).

| Item | Disposition | Basis |
|---|---|---|
| Q1 `--ignore-scripts` | **deferred** | Premise incorrect — `prepublishOnly` does not run on `npm pack` (mtime unchanged, 2.4s run). The flag would suppress `prepack`/`prepare`, which publish *does* run, costing fidelity. |
| Q2 mid-line comment opener | **accepted** | Reproduced; undocumented. Header gains it, plus the template-literal false-refusal the review did not reach. |
| 3.1 path normalization | **deferred** | Zero backslashes in npm's output on Windows 11. `\` is legal in a POSIX filename, so blanket replacement risks a silent pass. |
| 3.2 track opening line | **already specified** | Item 2 already describes exactly this. |
| 4.1–4.2 test coverage | **accepted** | Already specified; wording sharpened to forbid mutating the real `package.json`. |
| 4.3 laziness assertion | **rejected, limit recorded** | The suggested check cannot fail in-repo; the property is structural. |

## Review dispatch note

When dispatching a review subagent, open with: *"This is a LOCAL FILE REVIEW — there is no
pull request, do not run `gh`."* Without it the reviewer reaches for this repo's PR-review
workflow and goes hunting for a PR number.
