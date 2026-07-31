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

Changing an exported type is a semver-relevant change — Conventional Commits drive
the release-please bump.

## Python surface (two import roots, deliberately)

- `nimbus_sdk` (`sdks/python/src/nimbus_sdk/__init__.py`) — the contract-version
  constants, the negotiation algorithm, and `load_schema` / `load_corpus` / `spec_root`.
- `nimbus_sdk.ipc` (`sdks/python/src/nimbus_sdk/ipc/`) — `hello.py` (`encode_hello`,
  `parse_hello`, `HELLO_MESSAGE`, `HelloOk`, `HelloRefused`, `HelloResult`), `ndjson.py`
  (`NdjsonLineReader`, `FlushResult`, `FrameTooLongError`, `IPC_MAX_LINE_BYTES`), and
  `handshake.py` (`perform_handshake`, `HandshakeIO`, `HandshakeOk`, `HandshakeRefused`,
  `HandshakeResult`) — the one exchange this package performs end to end. It is
  **synchronous** where TypeScript's `performHandshake` is async, which with the
  `isinstance`-vs-tagged-union split is one of the only two ways the bindings differ on
  purpose.

**The IPC names are NOT re-exported from `nimbus_sdk`, and must not be.** The split
mirrors the `.` vs `./ipc` boundary the TypeScript `exports` map publishes: it states
that the IPC surface is a separate contract. Python has no bundling reason to need a
second entry point, so the boundary is documentation — and hoisting the names to the
top level as a convenience would erase it.

Both bindings execute the published conformance corpora: `negotiation` (all three
kinds) and `framing`. Nothing is deferred, so a new corpus case runs in both languages
the moment it is indexed.

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
  - **A new or changed *export*** trips two. Regenerate `docs/api-surface.md` with
    `bun run api:surface` (`sdks/typescript/scripts/api-surface.test.ts`), **and** claim
    the export's module in some `docs/modules/*.md` page's `<!-- covers: -->` comment
    (`sdks/typescript/scripts/docs-coverage.test.ts`). Note `api-surface.md` also lists
    `private` members, so an internal-only change to a published class still fails the
    first gate until you re-run `api:surface`.
  - **A new *module* reachable from the published surface** trips a third: it needs an
    entry in `sdks/typescript/scripts/smoke-calls.mjs`, enforced by
    `scripts/smoke-calls.test.ts`, which executes every entry against the built `dist/`.
    Adding an export to a module that already has one does not trip it; adding the
    module does.
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
