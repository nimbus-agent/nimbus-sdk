# Nimbus SDK — Claude Code Context

## What this is

`@nimbus-dev/sdk` is the **MIT-licensed, dependency-free** TypeScript authoring
contract that first-party and third-party Nimbus **MCP connectors / extensions**
compile against. It ships types, small pure helpers, and test utilities — no
runtime dependencies, no I/O, no credentials. The gateway, Vault, HITL gate, and
connector sandbox all live in the [Nimbus](https://github.com/nimbus-agent/Nimbus)
monorepo, **not** here.

This repo mirrors the `nimbus-vscode` / `nimbus-web-clipper` satellite template
(own CI, Biome, Sonar, release-please, MIT) and releases on its own clock. It was
extracted from `Nimbus/packages/sdk` and is now the source of truth for the
published package.

## Public surface (the `exports` map)

- `.` (`sdks/typescript/src/index.ts`) — the main contract: connector/extension types,
  the Plugin API v1 surface, `server`, `hitl-request`, `item-types`, `contract-tests`,
  `distribution-channel`, `audit-logger`, `icalendar`, and the `agents` / `crypto` /
  `data-profile` / `jmap-fastmail` / `flux-cd` / `storybook` helper modules.
- `./testing` (`sdks/typescript/src/testing/index.ts`) — contract-test + sandbox-probe
  utilities connectors use in their own test suites.
- `./ipc` (`sdks/typescript/src/ipc/index.ts`) — the NDJSON line-reader + IPC framing
  helpers.
- `./connector-kit` (`sdks/typescript/src/connector-kit/index.ts`) — helpers for
  hand-rolled MCP connectors: `createRegisterSimpleTool` / `registerZodTool`,
  `mcpJsonResult` and its variants, `makeRestFetcher` / `makeRestToolRegistrar` (the
  Bearer-auth REST fetcher, with `resolveUrlWithBase` as its SSRF chokepoint), and the
  search kit from `connector-kit/search-filter` (`filterByQuery`, `makeQueryFilter`,
  `matchesResult`, `stringField`, `tagText` and five more), shipped from this entry
  point since `1.15.0`. Still dependency-free — `ZodObjectSchema` is a structural type,
  not an import of `zod`. The generated connector template imports from here.
- `./diagnostics` (`sdks/typescript/src/diagnostics/index.ts`) — the diagnostics /
  telemetry contract v0: `encodeDiagnostic` / `parseDiagnostic` / `isDiagnosticEvent` /
  `meetsLevel` and the `DiagnosticEvent` envelope types, plus `createEmitter` and the
  `DiagnosticEmit` / `DiagnosticEmitter` sink types. A separate entry point because
  diagnostics is a separate contract, normatively specified at
  `docs/spec/diagnostics/v1/diagnostics.md` with its own conformance corpus. It is the
  structural replacement for `createScopedAuditLogger`'s free-form payload, which
  `audit-logger` now marks `@deprecated` (since `1.16.0`, removal no earlier than
  `2.0.0`). This makes it a **five**-entry `exports` map.

Changing an exported type is a semver-relevant change — Conventional Commits drive
the release-please bump.

## Python surface (four import roots, deliberately)

- `nimbus_sdk` (`sdks/python/src/nimbus_sdk/__init__.py`) — the contract-version
  constants, the negotiation algorithm, and `load_schema` / `load_corpus` / `spec_root`.
- `nimbus_sdk.ipc` (`sdks/python/src/nimbus_sdk/ipc/`) — `hello.py` (`encode_hello`,
  `parse_hello`, `HELLO_MESSAGE`, `HelloOk`, `HelloRefused`, `HelloResult`), `ndjson.py`
  (`NdjsonLineReader`, `FlushResult`, `FrameTooLongError`, `IPC_MAX_LINE_BYTES`), and
  `handshake.py` (`perform_handshake`, `HandshakeIO`, `HandshakeOk`, `HandshakeRefused`,
  `HandshakeResult`) — the one exchange this package performs end to end. It is
  **synchronous** where TypeScript's `performHandshake` is async, which with the
  `isinstance`-vs-tagged-union split is one of the three ways the bindings differ
  *behaviorally* — and one of the two that are deliberate. See the inventory below.
- `nimbus_sdk.diagnostics` (`sdks/python/src/nimbus_sdk/diagnostics/`) — the Python
  binding of `docs/spec/diagnostics/v1/diagnostics.md`: `encode_diagnostic`,
  `parse_diagnostic`, `meets_level`, `DIAGNOSTIC_KINDS`, `DIAGNOSTIC_LEVELS`, and the
  `EncodeOk` / `EncodeRejected` / `ParseOk` / `ParseRejected` result types, plus a
  Python-only `format_timestamp` helper. It runs the same `diagnostics` conformance
  corpus as TypeScript, byte-identically.
- `nimbus_sdk.connector_kit` (`sdks/python/src/nimbus_sdk/connector_kit/`) — the Python
  binding of `@nimbus-dev/sdk/connector-kit`'s batteries for hand-rolled MCP connectors.
  Shipment 1 ships the pure core, six modules: `errors.py` (the `ConnectorKitError`
  taxonomy — `UrlResolutionError`, `MissingEnvError`, `HttpStatusError`), `urls.py`
  (`resolve_url_with_base`, the SSRF chokepoint, binding
  `docs/spec/connector-kit/v1/url-resolution.md`), `env.py` (`require_env`), `types.py`
  (the `McpTextContent` / `McpToolResult` wire shapes), `results.py` (`json_result` and
  its `*_if_ok` variants, plus `error_result`), and `search_filter.py`
  (`filter_by_query`, `make_query_filter`, `matches_result` and the field-extractor
  helpers). The transport, the tool router, and `rest.py`'s REST factories are
  Shipment 2 — see the Phase 3 box in `docs/ROADMAP.md`. `docs/modules/connector-kit.md`
  carries the Python-binding section: the exports with no Python counterpart, the
  asymmetries, and the kit's own divergence.

**The IPC, diagnostics, and connector-kit names are NOT re-exported from `nimbus_sdk`,
and must not be.** The split mirrors the `.` vs `./ipc` vs `./diagnostics` vs
`./connector-kit` boundary the TypeScript `exports` map publishes. The justification is
not uniformly "each is a separate contract" — `nimbus_sdk.connector_kit` is batteries,
with no spec or conformance corpus of its own beyond `url-resolution` — so the actual
claim, and the one that covers all four roots, is that **each is a separate surface**.
The TypeScript `exports` map has implied exactly this since `1.15.0`, by giving
`connector-kit` its own entry point alongside the contract-bearing `./ipc` and
`./diagnostics`. Python has no bundling reason to need a second, third, or fourth entry
point, so the boundary is documentation — and hoisting the names to the top level as a
convenience would erase it.

Both bindings execute the published conformance corpora: `negotiation` (all three
kinds), `framing`, `diagnostics`, and — since `connector_kit`'s `urls.py` — the 25-case
`url-resolution` corpus. Nothing is deferred, so a new corpus case runs in both
languages the moment it is indexed.

**The `ipc` and `diagnostics` contract surfaces differ in three *behavioral* ways.**
Two predate this branch — sync-vs-async
`performHandshake`/`perform_handshake`, and `isinstance`-vs-tagged-union narrowing.
Diagnostics adds a third, verified by execution: given
`extensionId: "\ud800"` (a lone UTF-16 surrogate), `encodeDiagnostic` returns
`{ ok: true, line: ... }` — `JSON.stringify` and `TextEncoder` both pass an ill-formed
code point through rather than rejecting it — while `encode_diagnostic` raises
`UnicodeEncodeError`, because `line.encode("utf-8")` cannot represent an unpaired
surrogate at all. This is permitted, not a bug: `docs/spec/diagnostics/v1/diagnostics.md`
§8 declares a lone surrogate in `extensionId` undefined behaviour in v0 — `extensionId`
is checked only for emptiness, no case in the conformance corpus pins a verdict for this
input, and neither binding may invent one until the manifest rule registry constrains
the identifier's format enough to rule the question out structurally. `event.py`'s own
docstring discloses the exact mechanism.

This inventory is scoped to `ipc` and `diagnostics` — the contract surfaces with a spec
and a corpus — and is not exhaustive across the package. `nimbus_sdk.connector_kit` is
batteries, not a contract, and carries its own divergence (`json_result` refusing a
non-finite number where `JSON.stringify` emits `null`); see the Python-binding section of
[`docs/modules/connector-kit.md`](./docs/modules/connector-kit.md) rather than this list.

Diagnostics separately adds two *surface* asymmetries, not further behavioral ones, and
they belong with the `connector-kit`-shaped gap Phase 3 of
[`docs/ROADMAP.md`](./docs/ROADMAP.md) already tracks: Python ships no emitter
(`createEmitter` / `DiagnosticEmitter` has no Python counterpart — nothing in this
dependency-free package writes to a sink), and Python alone ships `format_timestamp`,
since Python has no built-in equivalent of `Date#toISOString()`. Neither changes what
the same operation returns in both languages on a defined input; they are surface, not
behavior.

## The scaffolder (`tools/create-connector`)

The repository's third package, alongside `sdks/typescript` and `sdks/python` — and the
second Bun workspace member, since `sdks/python` is not one. It publishes to npm as
`@nimbus-dev/create-connector`, and the two documented invocations are:

```bash
npm create @nimbus-dev/connector@latest my-connector                     # TypeScript
npx @nimbus-dev/create-connector@latest my-connector --lang python       # Python
```

The Python line is `npx`, not `npm create`, on purpose: `npm create` is `npm init`, which
runs `npm exec` underneath and parses npm's own options first, so a `--lang` passed to
`npm create` without a `--` separator is silently swallowed and hands a Python author a
TypeScript project with no error. `npx` forwards everything after the first positional
argument unconditionally.

- **A template dotfile does not automatically ship.** npm strips `.gitignore` from every
  published tarball regardless of `files`, so `templates/*/_gitignore` is renamed by
  `TEMPLATE_FILE_RENAMES` in `tools/create-connector/src/generate.ts`. It is not the only such
  name. `src/pack-and-generate.test.ts` packs the package and asserts the tarball generates the
  same tree the checkout does — that guard, not a list, is what protects a new template file.
- `templates/typescript/` (10 files) and `templates/python/` (9 files) are **deliberately
  outside `tsconfig.json`'s `include`**, which is `["src/**/*"]`. They are not this
  package's sources — they depend on `@modelcontextprotocol/sdk`, `zod` and `mcp`, which
  this dependency-free repository does not install, so `bun run typecheck` here cannot and
  must not compile them. The `scaffold-typescript` / `scaffold-python` CI jobs are where
  they are typechecked, built, tested and driven as a process, against a generated project
  with its own real dependencies.
- `src/docs-excerpts.test.ts` pins `sdks/typescript/README.md` and
  `docs/quickstart-*.md` to the template files and the CLI's `USAGE` string they quote,
  via `<!-- excerpt-of: -->` / `<!-- quoted-from: -->` markers. It replaces the drift test
  the deleted `examples/quickstart-connector/` carried. It runs under
  `bun run scaffold:test`, **not** under `sdks/typescript`'s suite — editing that README
  and running only `bun run test` will not catch drift.
- No fenced `ts` block in `sdks/typescript/README.md` may import
  `@modelcontextprotocol/sdk` or `zod`; `docs-snippets` refuses third-party specifiers by
  name, and there is deliberately no skip marker. The template's `main.ts` is therefore
  quoted there as a ```` ```text ```` illustration, which is what
  `scripts/docs-snippets.ts` prescribes for a snippet that must not compile.

## Commands

All TypeScript commands run from `sdks/typescript/` (or via the root proxy scripts,
e.g. `bun run test` at the repository root).

```bash
bun install         # from the repo root — Bun workspaces
cd sdks/typescript
bun run typecheck   # tsc --noEmit (strict)
bun run lint        # biome check src/ scripts/ examples/
bun run test        # bun test
bun run build       # tsc → dist/ (JS + .d.ts + declaration maps)
bun run api:surface # regenerate docs/api-surface.md after any exports change
```

The scaffolder has its own three, from the repository root:

```bash
bun run scaffold:typecheck   # tsc --noEmit over src/ only — never over templates/
bun run scaffold:lint        # biome check src/ templates/
bun run scaffold:test        # bun test src/ — includes the README/quickstart drift guard
```

Python commands run from `sdks/python/`:

```bash
cd sdks/python
python -m pip install -e .      # editable install
python -m ruff check . && python -m ruff format --check .
python -m mypy                  # strict
python -m pytest -q
python -m build                 # sdist + wheel into dist/
```

## Conventions / non-negotiables

- **Dependency-free at runtime.** No `dependencies` in `package.json`. If you need
  a helper, inline it — never add a runtime dep to the published surface.
- **No `any`; TypeScript strict.** Use `unknown` for external/cross-boundary data
  and narrow with a type guard. Biome enforces `noExplicitAny` + `noConsole` in
  `sdks/typescript/src/` (tests may log) — see `biome.json`.
- **MIT license.** Do not change the license field.
- Tests live alongside source as `*.test.ts` in `sdks/typescript/src/`.
- **Four CI gates guard the TypeScript surface, and they fire on different things.** Do
  not think of them as one checklist — a change can trip any subset:
  - **A new or changed *export*** trips one: regenerate `docs/api-surface.md` with
    `bun run api:surface` (`sdks/typescript/scripts/api-surface.test.ts`). This is the
    only gate with export granularity. Note `api-surface.md` also lists `private`
    members, so an internal-only change to a published class still fails it until you
    re-run `api:surface`.
  - **A new *module* reachable from the published surface** trips two, and both key on
    the module rather than the export — adding an export to a module that already has
    one trips neither. It needs a `docs/modules/*.md` page claiming it in a
    `<!-- covers: -->` comment (`scripts/docs-coverage.test.ts`, which resolves the
    surface's modules and requires each to be claimed by exactly one page), **and** an
    entry in `sdks/typescript/scripts/smoke-calls.mjs`, enforced by
    `scripts/smoke-calls.test.ts`, which executes every entry against the built `dist/`.
  - **A fenced `ts` block** trips a fourth: `scripts/docs-snippets.test.ts` typechecks
    every one against `dist/`. Its reach is narrower than "anything under `docs/`" —
    `SNIPPET_SOURCES` is `docs/modules/*.md`, `docs/README.md`, and the package's own
    `README.md`. Snippets in `docs/rfcs/`, `docs/spec/`, or `docs/superpowers/` are not
    compiled, so a plan or design doc can go stale without CI noticing.

  All four read TypeScript only; there is no equivalent gate for the Python surface —
  and that gap is more load-bearing now that `nimbus_sdk.connector_kit` has roughly
  doubled the Python surface with nothing guarding it the way `api-surface.md` guards
  TypeScript's. Tracked as Follow-up 2 in
  [`docs/superpowers/specs/2026-08-17-python-connector-kit-design.md`](./docs/superpowers/specs/2026-08-17-python-connector-kit-design.md#follow-ups).
- **Python reads the spec from `src/nimbus_sdk/_data/spec`, not from `docs/spec`.**
  `spec_root()` prefers that bundled copy; it is gitignored and regenerated by the
  hatch build hook. So after editing anything under `docs/spec/`, run
  `python -m pip install -e .` from `sdks/python/` **before** `pytest` — otherwise the
  suite reads the previous snapshot and passes while executing none of your changes.
  CI never hits this (it installs into a clean checkout); it is a local-only trap.
- **A worktree under `.claude/worktrees/` silently borrows the parent checkout's
  `node_modules`.** Node and TypeScript resolution walk *up* out of the worktree and into
  `<repo>/node_modules`, so a package can resolve a dependency it never declares and every
  local run goes green while CI — which checks out flat — fails. This is not hypothetical:
  `tools/create-connector` named `"node"` in its `tsconfig` `types` without any package
  declaring `@types/node`, six reviewers ran it clean, and it took down `build-test` on all
  three OSes plus both scaffold jobs the moment it reached CI (fixed in #95's follow-up).
  **To reproduce CI honestly, clone the branch somewhere outside the repository** —
  `git clone --branch <branch> . <tmpdir>` then `bun install --frozen-lockfile` — and run the
  gates there. Build before testing, the same order `.github/workflows/ci.yml` uses: `bun run
  build` from the repository root, then `bun run --cwd tools/create-connector build`. Skipping
  this step fails `api-surface`, `smoke-calls`, and `pack-and-generate` on a missing `dist/`
  for the wrong reason — those three gates execute the built package, not the source tree —
  which teaches the reader to distrust the recipe rather than trust it. Only then run the
  gates. This is the same failure the `scaffold-*` jobs generate into `$RUNNER_TEMP` to
  avoid, one level up: resolution reaching past a boundary and satisfying a dependency the
  real environment does not have.
- **Two roots.** `sdks/typescript/scripts/paths.ts` distinguishes `packageRoot`
  (`package.json`, `src/`, `dist/`) from `repoRoot` (`docs/`, and the language-neutral
  `docs/spec/`). Scripts import from it rather than computing a root themselves.
- The spec in `docs/spec/` and the docs surface in `docs/` are **language-neutral** and stay
  at the repository root. They are not TypeScript's to move.
- **The Python distribution is `nimbus-dev-sdk`; the import is `nimbus_sdk`.** PyPI's
  namespace is flat and `nimbus-sdk` belongs to an unrelated project — `pip install
  nimbus-sdk` installs the wrong package rather than failing.
- **Zero runtime dependencies in Python too.** `[project].dependencies` stays empty;
  `hatchling` is a build backend, not a dependency.

## Relationship to other repos

- [`Nimbus`](https://github.com/nimbus-agent/Nimbus) — gateway/CLI monorepo, the
  first-party consumer; its connectors depend on `@nimbus-dev/sdk`. For local
  co-development, the monorepo's `bun run platform:link` `bun link`s a sibling
  `../nimbus-sdk` checkout.

## Releasing

Record user-facing changes in `sdks/typescript/CHANGELOG.md`. Releases are automated by
release-please: merged Conventional Commits open a release PR; merging it tags the
release and publishes to npm with `--provenance` via GitHub OIDC (no npm token).
