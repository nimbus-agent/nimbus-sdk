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

- `.` (`src/index.ts`) — the main contract: connector/extension types, the Plugin
  API v1 surface, `server`, `hitl-request`, `item-types`, `contract-tests`,
  `distribution-channel`, `audit-logger`, `icalendar`, and the `agents` / `crypto` /
  `data-profile` / `jmap-fastmail` / `flux-cd` / `storybook` helper modules.
- `./testing` (`src/testing/index.ts`) — contract-test + sandbox-probe utilities
  connectors use in their own test suites.
- `./ipc` (`src/ipc/index.ts`) — the NDJSON line-reader + IPC framing helpers.

Changing an exported type is a semver-relevant change — Conventional Commits drive
the release-please bump.

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

## Conventions / non-negotiables

- **Dependency-free at runtime.** No `dependencies` in `package.json`. If you need
  a helper, inline it — never add a runtime dep to the published surface.
- **No `any`; TypeScript strict.** Use `unknown` for external/cross-boundary data
  and narrow with a type guard. Biome enforces `noExplicitAny` + `noConsole` in
  `src/` (tests may log) — see `biome.json`.
- **MIT license.** Do not change the license field.
- Tests live alongside source as `*.test.ts` in `src/`.
- A new/changed export requires regenerating `docs/api-surface.md` **and** a
  `docs/modules/*.md` page claiming its module in `<!-- covers: -->` — both are CI
  gates (`sdks/typescript/scripts/api-surface.test.ts`,
  `sdks/typescript/scripts/docs-coverage.test.ts`).
- **Two roots.** `sdks/typescript/scripts/paths.ts` distinguishes `packageRoot`
  (`package.json`, `src/`, `dist/`) from `repoRoot` (`docs/`, and the language-neutral
  `docs/spec/`). Scripts import from it rather than computing a root themselves.
- The spec in `docs/spec/` and the docs surface in `docs/` are **language-neutral** and stay
  at the repository root. They are not TypeScript's to move.

## Relationship to other repos

- [`Nimbus`](https://github.com/nimbus-agent/Nimbus) — gateway/CLI monorepo, the
  first-party consumer; its connectors depend on `@nimbus-dev/sdk`. For local
  co-development, the monorepo's `bun run platform:link` `bun link`s a sibling
  `../nimbus-sdk` checkout.

## Releasing

Record user-facing changes in `CHANGELOG.md`. Releases are automated by
release-please: merged Conventional Commits open a release PR; merging it tags the
release and publishes to npm with `--provenance` via GitHub OIDC (no npm token).
