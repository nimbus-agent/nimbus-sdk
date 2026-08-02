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
  `mcpJsonResult` and its variants, and `makeRestFetcher` / `makeRestToolRegistrar` (the
  Bearer-auth REST fetcher, with `resolveUrlWithBase` as its SSRF chokepoint). Still
  dependency-free — `ZodObjectSchema` is a structural type, not an import of `zod`. The
  generated connector template imports from here.
- `./diagnostics` (`sdks/typescript/src/diagnostics/index.ts`) — the structured,
  redaction-safe diagnostic envelope: `encodeDiagnostic` / `parseDiagnostic`,
  `isDiagnosticEvent`, `meetsLevel`, and `createEmitter`. Its own entry point because
  diagnostics is its own contract, specified at `docs/spec/diagnostics/v1/` and pinned by
  the corpus at `docs/spec/conformance/v1/diagnostics/` (RFC-0010). Redaction is
  structural: `fields` admits booleans and safe integers and nothing else, so there is
  nowhere to put a secret. That makes it a **five**-entry `exports` map.

Changing an exported type is a semver-relevant change — Conventional Commits drive
the release-please bump.

## Python surface (three import roots, deliberately)

- `nimbus_sdk` (`sdks/python/src/nimbus_sdk/__init__.py`) — the contract-version
  constants, the negotiation algorithm, and `load_schema` / `load_corpus` / `spec_root`.
- `nimbus_sdk.ipc` (`sdks/python/src/nimbus_sdk/ipc/`) — `hello.py` (`encode_hello`,
  `parse_hello`, `HELLO_MESSAGE`, `HelloOk`, `HelloRefused`, `HelloResult`), `ndjson.py`
  (`NdjsonLineReader`, `FlushResult`, `FrameTooLongError`, `IPC_MAX_LINE_BYTES`), and
  `handshake.py` (`perform_handshake`, `HandshakeIO`, `HandshakeOk`, `HandshakeRefused`,
  `HandshakeResult`) — the one exchange this package performs end to end. It is
  **synchronous** where TypeScript's `performHandshake` is async, which with the
  `isinstance`-vs-tagged-union split is one of the only two ways the bindings *behave*
  differently on purpose.
- `nimbus_sdk.diagnostics` (`sdks/python/src/nimbus_sdk/diagnostics/`) — `event.py`
  (`encode_diagnostic`, `parse_diagnostic`, `meets_level`, `EncodeOk`, `EncodeRejected`,
  `EncodeResult`, `ParseOk`, `ParseRejected`, `ParseResult`, `DIAGNOSTIC_LEVELS`,
  `DIAGNOSTIC_KINDS`) and `timestamp.py` (`format_timestamp`).

**The IPC and diagnostics names are NOT re-exported from `nimbus_sdk`, and must not be.**
The split mirrors the `.` vs `./ipc` vs `./diagnostics` boundaries the TypeScript
`exports` map publishes: it states that each is a separate contract. Python has no
bundling reason to need extra entry points, so the boundary is documentation — and
hoisting the names to the top level as a convenience would erase it.
`tests/test_diagnostics.py` asserts the diagnostics names stay off the top level.

**Two *surface* asymmetries, distinct from the two behavioral ones above.** Python ships
no emitter — `createEmitter` is a TypeScript-only wrapper, which is why its `sink-failed`
result is not a contract reason and never reaches `case.schema.json`. Python ships
`format_timestamp`, which has no TypeScript counterpart, because
`new Date().toISOString()` is already conformant while `datetime.isoformat()` produces six
fractional digits and a `+00:00` offset — and `timespec="milliseconds"` fixes only the
first of those.

Both bindings execute the published conformance corpora: `negotiation` (all three
kinds) and `framing`. Nothing is deferred, so a new corpus case runs in both languages
the moment it is indexed.

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

  All four read TypeScript only; there is no equivalent gate for the Python surface.
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
  gates there. This is the same failure the `scaffold-*` jobs generate into `$RUNNER_TEMP` to
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
