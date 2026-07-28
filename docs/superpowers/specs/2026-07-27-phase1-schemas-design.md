# Phase 1, slice 1 — The schemas and the guard that pins them

**Status:** approved design, not yet implemented
**Date:** 2026-07-27
**Roadmap:** [`docs/ROADMAP.md`](../../ROADMAP.md) — Phase 1, boxes 1 and 4
**Follows:** [Phase 0, slice 3 — the authoring path](./2026-07-26-phase0-authoring-path-design.md)

---

## Goal

Publish versioned JSON Schemas for `ExtensionManifest` and `NimbusItem`, and prove in CI
that they and the TypeScript cannot drift apart.

This is the first real step of the phase's premise: TypeScript becomes one *binding* of the
contract rather than the contract itself.

## Why these two boxes together

Box 4 is what makes box 1 worth anything. A published schema nobody checks is a second
source of truth that silently diverges from the first — strictly *worse* than having only
the TypeScript, because other languages would bind to the lie and discover it in
production.

Shipping the artifact together with the guard that keeps it true is the pattern Phase 0
used three times: the API-surface snapshot, the doc-coverage guard, the snippet guard.

## Scope

| # | Deliverable | Roadmap box |
|---|-------------|-------------|
| 1 | `docs/spec/schemas/v1/extension-manifest.schema.json` | Phase 1, box 1 |
| 2 | `docs/spec/schemas/v1/nimbus-item.schema.json` | Phase 1, box 1 |
| 3 | `docs/spec/conformance/v1/` — fixture corpus, plus `index.json` and its own `index.schema.json` | seeds box 3 |
| 4 | `scripts/schema-guard.test.ts` — structural diff + fixture dual-validation | Phase 1, box 4 |
| 5 | `ajv` as a **devDependency** | enabler for 4 |
| 6 | Rewrite `docs/spec/README.md`; one-line update to `docs/README.md`; tick roadmap boxes 1 and 4 | — |

**Out of scope.**

- **The IPC wire-protocol spec (box 2)** — but not because it is blocked, and the
  distinction matters for whoever picks it up. The roadmap box asks only for *"the IPC
  wire-protocol spec for **the NDJSON framing** in `src/ipc/`"*, and that is entirely
  achievable in-repo: `NdjsonLineReader` defines UTF-8 decoding, LF delimiting, a stripped
  trailing `\r`, skipped blank lines, and a 1 MB byte cap. It is perhaps a page.

  What is blocked is the *larger* promise `docs/spec/README.md` currently makes for
  `wire-protocol.md` — "message envelopes, request / response shapes, error framing, and
  contract-version negotiation." None of those exist in this repository. `src/ipc/`
  contains exactly one thing, a byte-chunk-to-line splitter, and its own comment says it is
  *"Shared by Gateway JSON-RPC and the CLI IPC client"* — the message shapes live in the
  Nimbus monorepo, and specifying them here would mean reverse-engineering another
  repository's protocol.

  So box 2 is a small, self-contained slice; `docs/spec/README.md` overpromises relative to
  the box. Component 2 of this slice resolves that mismatch by scoping the README's claim
  to what this repository can actually specify.
- **Contract-version negotiation (box 5).** Nothing carries a contract version today;
  `minNimbusVersion` is a floor, not a negotiation. Designing one adds exported surface,
  making it semver-relevant and RFC-worthy under [GOVERNANCE.md](../../GOVERNANCE.md#the-rfc-process).
- **The language-neutral conformance runner (box 3).** This slice produces the fixtures
  that seed it. The runner itself is a later slice.
- **Agent brief schemas.** `docs/spec/README.md` promises them eventually. Two shapes are
  enough to prove the mechanism; adding seven more before the mechanism is validated is
  work at risk.

**No `src/` changes**, and no `feat:`/`fix:` commits — so this slice cuts no release, the
same posture as Phase 0 slice 3.

---

## Background: what we verified before designing

**TypeScript 7 has no classic compiler API — confirmed, not assumed.** On
`typescript@7.0.2`, the `exports` map resolves `"typescript"` to `./lib/version.cjs`;
`ts.createProgram` and `ts.SymbolFlags` are both `undefined`. A real API exists only under
the explicitly-unstable `typescript/unstable/*` paths.

This is decisive for the whole slice: **every TypeScript-to-JSON-Schema generator
(`typescript-json-schema`, `ts-json-schema-generator`, `ts-to-zod`) depends on that API and
cannot run here.** Generating the schemas from the types is not available.

**The reverse direction is available but wrong.** `json-schema-to-typescript` operates on
JSON and never touches the TypeScript AST, so it would run fine. But it cannot express what
is already published: `ItemType = KnownItemType | (string & {})` has no JSON Schema
equivalent, and generating it away would close an open vocabulary that
[`src/item-types.ts`](../../../src/item-types.ts) forbids closing. The API-surface guard
would flag the result as a breaking change, correctly.

**So the schemas are hand-written, and a guard proves agreement.** That conclusion is
forced by the tooling, not chosen for taste.

---

## Component 1 — The schemas

**Files:** `docs/spec/schemas/v1/extension-manifest.schema.json`,
`docs/spec/schemas/v1/nimbus-item.schema.json`.

JSON Schema **draft-07**.

Not 2020-12, and the reason is that our schemas gain nothing from it. Between them they
use `$id`, `$schema`, `type`, `properties`, `required`, `enum`, `pattern`, `items`,
`examples`, and `description` — every one of which behaves identically in draft-07. None of
2019-09 or 2020-12's additions appear: no `prefixItems`, no `unevaluatedProperties`, no
`$dynamicRef`, no `$vocabulary`.

Given identical expressiveness, the deciding factor is reach. draft-07 has the broadest
support across editor JSON language services and across validators in the languages Phase 2
and 3 target — Python, Go, Rust — where several widely-used libraries are draft-07-only.
That matters most for the case `$schema` exists to serve: a connector author getting
completion and validation in their editor while writing a manifest. A schema draft the
author's editor half-supports defeats the field's purpose.

This is reversible at low cost — the schema bodies do not change, only the `$schema` line —
so if you would rather ship the modern draft and accept narrower tool support, say so and
it flips.

### The `v1` path segment — and an ambiguity resolved

The contract is frozen at Plugin API v1. Putting the version into the path from the first
commit avoids moving published URLs later — and a schema URL is the one thing in this slice
that other people's files will reference by hand.

The roadmap box says the schemas are *"versioned alongside the package"*, which admits two
readings: the schema path carries the **package** version (`1.7.0`), or the schemas are
versioned under the same discipline as the package. **This design takes the second
reading**, and `v1` is the *contract* version, not the package version.

The first reading does not survive contact with practice: a directory per package release
would mint `docs/spec/schemas/1.7.1/` for a patch that changed nothing about the contract,
and leave consumers guessing which of dozens of identical directories to reference. The
contract is what a binding depends on, so the contract version is what belongs in the path.
`docs/spec/README.md` already supports this reading — it says the spec "is versioned
alongside the package and evolves under the versioning & compatibility rules", i.e. it
follows the same semver discipline, not the same numbers.

### `$id`

```text
https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/schemas/v1/extension-manifest.schema.json
```

Chosen because **it resolves today.** A connector author can paste it into the manifest's
`$schema` field and their editor fetches it immediately, with no infrastructure to stand
up. A `nimbus-agent.github.io` URL reads better but returns 404 until someone configures
GitHub Pages, and a `$schema` pointing at a 404 is worse than an unlovely URL that works.

The tradeoff, stated plainly: this pins to `main`, so the schema a manifest references
tracks the branch rather than a release tag. The `v1` path segment carries the contract
version, which is the guarantee that actually matters to a consumer. If Pages is set up
later, the `github.io` URL becomes an alias and this one keeps working.

### Why not pin `$id` to a release tag

Two reasons, one practical and one that makes the risk smaller than it looks.

**The practical one is decisive: the tag does not exist when the file is committed.** A
schema's `$id` lives inside the schema file. To reference `.../sdk-v1.8.0/docs/spec/...`
the commit would have to name a tag that release-please only creates *after* that commit
merges. Every schema would therefore ship with a `$id` that 404s until the release is cut,
and keeping it correct would need a release-time step that rewrites published files — with
the guard taught to tolerate the rewrite. That is a lot of machinery to buy very little.

**And the drift a tag would protect against is drift these schemas already tolerate.**
Within `v1`, the [deprecation policy](../../DEPRECATION-POLICY.md) permits only additive
change; removing or narrowing a field requires a major, which by construction means a new
path segment rather than an edit to this one. So a consumer fetching the `main` copy of a
`v1` schema can only ever observe *additions* — and because both schemas are open, an older
consumer validating against an older copy is unaffected by them.

The genuine residual risk is not validation but capability: a manifest may use a field a
particular gateway does not yet act on. No schema URL can express that. It is exactly what
contract-version negotiation — Phase 1, box 5 — exists to solve, and it is recorded here so
that box inherits the problem rather than this slice pretending to have solved it.

### Both schemas are open

No `additionalProperties: false`, on either shape.

For `NimbusItem` this is required by the ecosystem rule
[`src/item-types.ts`](../../../src/item-types.ts) states: a gateway that ships something
new must not break clients that have not upgraded.

For `ExtensionManifest` it is a deliberate trade. An unknown key is accepted silently,
which means a misspelled *optional* field (`homepge`, `syncIntervall`) validates clean and
does nothing. The hole is smaller than it first appears: because `required` is populated, a
typo in a **required** key still fails — `permisions` is rejected, not because the unknown
key is refused, but because `permissions` is then missing.

### `itemType` is not an enum

```json
{ "type": "string", "pattern": "\\S", "examples": ["file", "message", "issue"] }
```

`KNOWN_ITEM_TYPES` appears in `examples` for editor hints and nowhere else. Encoding it as
an `enum` would close a vocabulary that `item-types.ts` is emphatic must stay open:
*"Treat `KNOWN_ITEM_TYPES` as a best-effort convenience, never as a validation whitelist —
rejecting an item because its type is absent here would break on the next connector."*

### Two constraints that are easy to get wrong

Writing the manifest schema to agree with `runContractTests` surfaces two subtleties. Both
are recorded here because a later editor "tidying" either one would break the guard, and
the reason would not be obvious from the schema alone.

**Non-empty strings use `"pattern": "\\S"`, not `"minLength": 1`.**
`isNonEmptyString` in [`src/contract-tests.ts`](../../../src/contract-tests.ts) is
`typeof v === "string" && v.trim() !== ""`, so `"   "` is invalid. `minLength: 1` accepts
it. The two validators would then disagree on whitespace-only ids.

**`minNimbusVersion`'s pattern stays unanchored at the end.** The runtime check is
`/^\d+\.\d+\.\d+/` with no `$`, so `"1.2.3-beta"` passes today. The schema pattern is
`^\\d+\\.\\d+\\.\\d+`, matching that laxness on purpose. "Tidying" it to `...$` would
reject manifests the SDK accepts.

---

## Component 2 — The doc surface for the spec

**Files:** `docs/spec/README.md` (rewritten), `docs/README.md` (one line).

`docs/spec/README.md` currently opens with *"Status: planned … intentionally a stub
today"*. Leaving that above a directory containing shipped schemas would be the same
self-contradiction Phase 0 slice 3 spent three review rounds correcting elsewhere.

It becomes the spec's usage documentation: which `$id` to reference from a manifest's
`$schema`, what the `v1` path guarantees, what is and is not yet specified (the wire
protocol is explicitly still absent), and how to run the fixtures.

Four places link to the `docs/spec/` directory — `README.md`, `docs/README.md`, and
`docs/ROADMAP.md` twice — and GitHub renders a directory's README when you click through.
This page is what those links land on, and it serves a different reader from the docs
index: someone implementing a Python or Go binding who cares about that directory and
nothing else. `docs/README.md` keeps its single pointer line, updated to say the spec
exists rather than that it is planned.

---

## Component 3 — The structural diff

**File:** `scripts/schema-guard.test.ts` (with pure helpers extracted so they are unit
testable).

It reuses the extractor already in [`scripts/api-surface.ts`](../../../scripts/api-surface.ts)
rather than re-deriving anything: `collectEntryPoints()` and `buildSurface()` yield each
export's declaration text, so the guard takes `ExtensionManifest`'s interface body from the
emitted `dist/types.d.ts`, parses property names and `?` optionality, and diffs that against
the schema's `properties` keys and `required` array.

Three distinct failures:

1. A property in the TypeScript that the schema does not declare.
2. A property in the schema that the TypeScript does not declare.
3. An optionality mismatch — required in one, optional in the other.

This is the half that catches a field added to `types.ts` for which nobody wrote a fixture.

`$schema?: string` must therefore appear in the manifest schema's `properties`. If the
first run fails on it, that is the guard working.

### It recurses one level into inline object types

An earlier draft of this design stopped at the top level and declared `oauth` a blind spot.
That was the wrong call for two reasons.

First, the cost is smaller than it looked. Splitting interface members *already* requires
brace-depth tracking — otherwise a member split would tear the inline `oauth` object in
half. Once the parser tracks depth, descending one level to parse that object's own members
is incremental, not a new capability.

Second, `oauth` is the wrong place to accept a blind spot. It carries `authUrl`,
`tokenUrl`, `scopes`, and `pkce` — the security-relevant half of a manifest. A schema that
silently disagreed with the TypeScript about whether `pkce` is required is precisely the
divergence this guard exists to catch.

So the diff descends into inline object types and compares their members too, in both
directions and including optionality.

**What it still does not do**, stated in the file header the way `api-surface.ts` states
its own limitations: it does not follow a property whose type is a *named* type declared
elsewhere. `ExtensionManifest` has no such property today — `oauth` is inline and every
other field is a primitive, array, or union — so the limitation is currently theoretical.
It becomes real the moment someone extracts `oauth` into a named `OAuthConfig` interface.

That extraction is itself worth doing later: a named type is what a Python or Go binding
needs in order to name the same structure. But it adds an exported type, which is
semver-relevant and would cut a release — so it belongs in its own `feat:` change, not in a
documentation slice. Whoever does it must extend this guard in the same commit.

---

## Component 4 — The fixture corpus

**Files:** `docs/spec/conformance/v1/manifest/*.json`,
`docs/spec/conformance/v1/item/*.json`, and `docs/spec/conformance/v1/index.json`.

`index.json` gives every fixture a shape, an expectation, a class, and a reason. It is
machine-readable so a later Python or Go runner consumes it without parsing prose — that is
what makes this corpus the seed of box 3 rather than a pile of test data.

**The index gets its own schema**, `docs/spec/conformance/v1/index.schema.json`, and the
guard validates the index against it before using it. A slice whose entire thesis is that
published artifacts need machine-checked contracts should not exempt the one file a
cross-language runner has to parse first. It also fails helpfully: a malformed entry is
reported as a schema violation naming the offending index element, rather than surfacing
later as a confusing fixture-loading error.

### Every schema is registered with ajv locally, and nothing is fetched

The guard loads each schema from disk and registers it with `ajv.addSchema(schema)` so its
`$id` resolves from the in-memory registry. No `$ref` is ever resolved over the network.

ajv does not fetch remote references on its own — synchronous compilation raises
`MissingRefError` instead — so this is not a matter of blocking egress. It is a matter of
making an `http`-scheme `$id` behave as the *identifier* it is rather than a location, and
of ensuring that the first cross-schema `$ref` anyone adds resolves against the local copy
instead of failing.

It also matters for CI specifically: the workflows run under `harden-runner`, which
restricts egress. A guard that depended on fetching `raw.githubusercontent.com` would fail
there in a way whose cause is not obvious from the error.

### Manifest fixtures are checked in both directions

**ajv-valid ⟺ `runContractTests` resolves.** Both directions asserted, which is what
"validate the TypeScript SDK against its own spec" has to mean if it is to mean anything.

### The asymmetry, named rather than hidden

That equivalence holds only over fields *both* validators cover, and they do not cover the
same ground. `runContractTests` never inspects `oauth`, `syncInterval`, or `tags`. The
schema does. So the schema is **stricter than the runtime check**, and a fixture with
`syncInterval: "60"` fails ajv while `runContractTests` accepts it.

Each fixture is therefore classified in `index.json`:

- **`equivalence`** — touches only fields both validate. Both directions asserted; a
  disagreement fails CI.
- **`schema-only`** — touches fields the runtime ignores. Only ajv is asserted.

The split makes visible exactly where the TypeScript runtime is weaker than the published
contract. That is useful to anyone writing the next binding, and pretending the two agree
everywhere would be the same category of overclaim Phase 0 kept catching in prose.

### `NimbusItem` fixtures are weaker, and the design says so

There is no runtime validator for items anywhere in the SDK. Valid item fixtures must
typecheck as `NimbusItem` *and* pass ajv. Invalid ones must fail ajv, and this design
claims nothing about TypeScript catching them — many, such as a negative `sizeBytes`, are
perfectly well-typed.

---

## Testing

Following `api-surface.test.ts` and the Phase 0 guards: pure functions are unit tested
against synthetic input, then a small number of integration tests run against the real
artifacts.

- **Unit, on synthetic input:** interface-body parsing, property-and-optionality
  extraction, `index.json` parsing, and — named individually, because each is a distinct
  way the guard could silently stop working:
  - a property in the TypeScript but absent from the schema **fails**;
  - a property in the schema but absent from the TypeScript **fails**;
  - an optionality mismatch (`?` in TypeScript vs presence in `required`) **fails**, tested
    in both directions;
  - the same three, one level down inside an inline object member, so `oauth`'s coverage is
    proven rather than assumed.
- **Integration, on the real artifacts:** the structural diff over the real
  `ExtensionManifest` and its nested `oauth`; `index.json` validated against
  `index.schema.json`; every fixture validated per its class.
- **Class handling is itself asserted:** an `equivalence` fixture is run through both ajv
  and `runContractTests` and their verdicts compared; a `schema-only` fixture is run
  through ajv alone. A bug that quietly treated every fixture as `schema-only` would
  otherwise disable half the guard while staying green.
- **Offline resolution:** every schema resolves from the local ajv registry, with no
  network access.
- **Anti-vacuity floors:** a non-empty fixture count and a non-empty extracted property
  set, so a broken parser cannot pass by comparing two empty sets. Plus the
  `dist/` existence assertion the other guards use, with the same message.

Unit tests must not read the real schemas, or every future schema edit becomes a test edit.

## Risks, stated plainly

**The `$id` pins to `main`.** A consumer referencing it tracks the branch, not a release.
Mitigated by the `v1` path segment carrying the contract version, which is the guarantee
that matters. Revisit if GitHub Pages is ever configured.

**`ajv` is a new devDependency** in a repo that has been deliberate about adding none. It
never ships — `dependencies` stays empty and `files` is `["dist", "src"]` — and the
alternative is worse: these schemas are published for other languages to bind against, so
they must be validated by a spec-compliant implementation rather than by our reading of the
specification.

**Hand-written schemas can drift from the types.** That is precisely what Component 3
exists to prevent, and its declared top-level limitation says where it does not reach.

**The schemas may be stricter than the gateway actually is.** They are written against
`runContractTests` and the TypeScript types, which are this repository's understanding of
the contract. If the real gateway accepts manifests these schemas reject, that is a
discrepancy this slice will surface rather than resolve — and surfacing it is a good
outcome, not a defect.

## Exit criteria

- Both schemas are published under `docs/spec/schemas/v1/`, are valid draft-07, and carry a
  resolvable `$id`.
- The structural diff passes for `ExtensionManifest` and its nested `oauth` object, and
  fails if a property is added to either side alone at either level.
- `index.json` validates against `index.schema.json`.
- Every `equivalence` fixture produces the same verdict from ajv and from
  `runContractTests`, in both directions.
- `docs/spec/README.md` documents the shipped schemas and no longer describes itself as a
  stub.
- Roadmap boxes 1 and 4 are ticked; boxes 2, 3 and 5 remain open, with box 2's cross-repo
  blocker recorded.
