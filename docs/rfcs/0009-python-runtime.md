# RFC-0009 — `manifest.runtime` admits Python

- **Status:** accepted
- **Opened:** 2026-07-31
- **Landed:** (pending — not yet merged; this RFC ships on `feat/create-connector`)
- **Affects:** `docs/spec/schemas/v1/extension-manifest.schema.json`, `docs/spec/rules/v1/manifest-rules.json`, the manifest conformance corpus, `sdks/typescript/src/types.ts`, `sdks/typescript/src/contract-tests.ts`
- **Roadmap:** [Phase 2](../ROADMAP.md#phase-2--prove-polyglot-with-python) — box 2, `create-nimbus-connector` scaffolding for TypeScript **and** Python. This RFC is the prerequisite: scaffolding a Python connector is pointless if the manifest it authors cannot pass validation
- **Pillars:** 1 (the contract), 2 (polyglot SDKs), 4 (authoring experience)
- **Builds on:** [RFC-0008](./0008-python-sdk-official.md), which promoted the Python SDK to official and recorded that it executes both published conformance corpora, `negotiation` and `framing`, with nothing deferred. Manifest validation is not among them — it is TypeScript-only, `runContractTests` and the schema, and this RFC changes only that surface

## Problem

`manifest.runtime.enum` is `["bun", "node"]`, and omitting the field does not escape it:
the rule in `sdks/typescript/src/contract-tests.ts` tests `manifest["runtime"] === "bun" ||
manifest["runtime"] === "node"`, so an absent value fails the same as a wrong one, and the
published JSON schema lists `runtime` in `required`. There is no honest value a Python
connector's manifest can declare.

Declaring `"node"` would tell a gateway to run a Python connector's entrypoint with Node,
which is false on its face. The field exists to answer one question — what process the
gateway should spawn — and today it cannot answer that question for a connector written in
the language this project promoted to official standing in RFC-0008.

## The decision

**Widen `manifest.runtime.enum` to `["bun", "node", "python"]`.** Every manifest valid before
this change stays valid; the change only admits manifests that were previously refused. That
is a backward-compatible widening — the same shape RFC-0006 and RFC-0007 used to widen the
corpus without touching what was already pinned — which is a statement about compatibility,
not about which `GOVERNANCE.md` change class this is. See *Compatibility impact* for the
class this RFC is filed under and why.

The value is pinned in four places that must agree, and this RFC changes all four:

1. `docs/spec/schemas/v1/extension-manifest.schema.json` — the published `enum`.
2. `docs/spec/rules/v1/manifest-rules.json` — the `enum` array **and** the human-readable
   `requires` string, which read `exactly "bun" or "node"`. A stale prose field is a spec
   that lies in the place a reader trusts most, so it changes in the same commit as the enum
   it describes.
3. `sdks/typescript/src/types.ts` — `ExtensionManifest.runtime` widens to
   `"bun" | "node" | "python"`.
4. `sdks/typescript/src/contract-tests.ts` — `RUNTIME_ENUM`'s check and the violation message
   it produces both admit `"python"`.

## Why this is backward compatible under `v1`

No existing connector manifest is affected. A manifest that declared `"bun"` or `"node"`
before this RFC still validates identically after it — the schema still requires the field,
still rejects every value outside the (now three-member) enum, and every other rule is
untouched. The only manifests whose verdict changes are ones that declared `"python"`, which
were refused before and are accepted now. `invalid-runtime.json`, which declares `"deno"`,
is deliberately left untouched: it stays invalid, and is the case proving the enum did not
simply become permissive to any string.

## The cases

One new case, added to `docs/spec/conformance/v1/manifest/`:

| Case | `runtime` | Expected |
|---|---|---|
| `valid-runtime-python.json` | `"python"` | valid, no violations |

It is a copy of `valid-minimal.json` with `runtime` changed from `"bun"` to `"python"` —
every other required field present and well-formed, so the only thing under test is the
enum member itself. Indexed in `docs/spec/conformance/v1/index.json` in the `equivalence`
class, so `schema-guard.test.ts` asserts the JSON schema and `runContractTests` agree on it,
the same discipline every other manifest fixture is held to.

`invalid-runtime.json` (`"deno"`) is not touched. It was invalid before this RFC and remains
invalid after it, which is what distinguishes "the enum gained one member" from "the enum
stopped constraining anything."

## The cross-repo dependency, stated plainly

This RFC lets the **contract** express a Python connector's runtime honestly. It does not
make a gateway able to spawn one. Whether the [Nimbus](https://github.com/nimbus-agent/Nimbus)
gateway understands `runtime: "python"` — resolving an interpreter, wiring up the sandbox,
running the IPC handshake against a Python process rather than a Node one — lives entirely
in that monorepo, not here. The [roadmap](../ROADMAP.md#phase-2--prove-polyglot-with-python)
already names "a Python-authored connector running against the gateway" as the one Phase 2
exit clause this repository cannot demonstrate on its own, and this RFC does not change that.
An author who declares `"python"` today needs a gateway release that understands the value;
this RFC does not imply one exists yet.

## Compatibility impact

Change class under [GOVERNANCE.md](../GOVERNANCE.md#change-classes): this changes a
published schema, an exported TypeScript type, and a conformance invariant (the manifest
corpus), which is squarely **contract-affecting** — an RFC required, which is why this
document exists. It is not `GOVERNANCE.md`'s **Additive** class (new optional field, new
export, new battery); it widens an existing enum on an existing required field, and the
RFC process is the one contract-affecting changes go through regardless of how backward
compatible the resulting widening is.

**Backward compatible within `v1`.** No existing case changes verdict, no new refusal
reason, no new case kind, and the corpus's `index.schema.json` is untouched — but backward
compatible is not the same claim as "no semver bump," which the table below states per
artifact.

| Change | Semver | Who is affected |
|---|---|---|
| `manifest.runtime.enum` gains `"python"` in the schema and the rules | none (spec documents) | A validator pinned to the old enum starts refusing a manifest the new contract accepts — but no such manifest was constructible before this RFC, so no existing connector regresses. |
| `ExtensionManifest.runtime` widens in TypeScript | **minor** | Per `CLAUDE.md`, changing an exported type is semver-relevant; release-please's `typescript` component keys on `sdks/typescript` and will open a minor bump for this commit. Consumers pattern-matching on `runtime` exhaustively (e.g. a `switch` with no `default`) gain a new case to handle at compile time — `tsc --noEmit` catches it, which is exactly the kind of downstream break a minor bump (not `none`) exists to signal, even though no *runtime* behavior for existing values changes. |
| One case added to the manifest conformance corpus | none | A third-party binding that reimplements manifest validation and hardcodes the two-member enum, which was already narrower than a contract this RFC widens. |

`docs/api-surface.md` requires regeneration (`bun run api:surface`) because
`ExtensionManifest.runtime` is an exported type and the api-surface gate has export
granularity. No `docs/modules/*.md` page or `smoke-calls.mjs` entry changes: `types.ts`'s
module was already claimed and already smoke-called before this RFC, and adding a member to
an existing exported type's union does not add a new module.

## Migration

None. No manifest declaring `"bun"` or `"node"` needs to change. A connector author who wants
to write a Python connector may now declare `runtime: "python"` and pass manifest validation;
whether the gateway they target can run it is a question this repository cannot answer.

## Alternatives rejected

**A generic `"executable"` or `"system"` value**, pushing the choice of interpreter into
`entrypoint` (e.g. `"python3 ./main.py"`). Rejected: `runtime` exists to answer exactly one
question — what process the gateway spawns — and a generic value makes it unable to answer
that question without parsing `entrypoint` as a shell command, which the contract has never
required a gateway to do. It would also mean every future runtime addition invents its own
convention inside a string field the schema cannot constrain.

**A Node wrapper script that spawns Python**, so a Python connector still declares
`runtime: "node"` with an `entrypoint` that shells out. Rejected: it teaches every Python
author a workaround as though it were the design, defeats the reason `runtime` exists at
all, and hides the connector's real language from every tool that reads the manifest —
including a future registry or trust model that might reasonably treat runtimes differently.

**Wait until the gateway can actually run a Python connector**, and land this RFC alongside
that gateway work instead of ahead of it. Rejected: the contract and the gateway are
different repositories with different release cadences, and this repository's job is to let
the contract describe what is true before any one product implements it. RFC-0005 through
RFC-0008 already established that pattern — the spec and corpus are written and pinned in
this repository, and a consuming gateway conforms to them rather than the reverse. Blocking
on the gateway would also block Task 4's Python connector template in this project's own
scaffolding work, which needs a contract-valid manifest to generate.

## How it is enforced

**The one case, indexed.** `manifest/valid-runtime-python.json` is listed in `index.json`
with its `file`, `shape`, `expect`, `class`, `violations`, and `reason` — the index is
normative, not the directory, and `schema-guard.test.ts`'s "every fixture on disk is listed
in the index" assertion already checks set equality in both directions, so an unindexed file
fails as loudly as a missing one.

**Equivalence, not just schema-only.** The case is classed `equivalence`, so
`schema-guard.test.ts` asserts both that the JSON schema accepts it *and* that
`runContractTests` accepts it, and separately that `validateManifest` produces the exact
empty violation list the index declares. A change to only the schema, or only the rule,
would leave this case red.

**`invalid-runtime.json` unchanged, and still in the corpus.** It continues to assert that
`"deno"` violates `manifest.runtime.enum`, which is what proves the enum was widened by
exactly one member rather than opened up entirely.

## Out of scope

- **Whether the gateway can spawn a Python connector.** Entirely a
  [Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo concern, per *The cross-repo
  dependency* above.
- **The Python connector template itself**, and any other scaffolding. That is Task 4 of
  this project's own plan, which depends on this RFC having landed first and does not touch
  the contract.
- **Any other manifest field.** `entrypoint`, `permissions`, `hitlRequired`, and every other
  rule in `manifest-rules.json` are untouched.
- **A fourth runtime value beyond `bun`, `node`, and `python`.** If a future language SDK
  needs one, it goes through this same RFC process on its own merits.
