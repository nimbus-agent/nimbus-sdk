# Contributing

Thanks for helping improve the Nimbus SDK!

## Prerequisites

- [Bun](https://bun.sh) v1.2+

## Setup

```bash
bun install
```

## Develop

```bash
bun run typecheck   # tsc --noEmit (strict)
bun run lint        # biome check src/
bun run test        # bun test
bun run build       # tsc → dist/ (JS + .d.ts + declaration maps)
```

## Architecture notes

- **Dependency-free at runtime.** `@nimbus-dev/sdk` ships with **no** runtime
  `dependencies` — it is the stable, MIT-licensed contract that first-party and
  third-party MCP connectors / extensions compile against. Do not add a runtime
  dependency; if you need a helper, inline it.
- **No `any`; TypeScript strict.** Use `unknown` for data crossing a boundary and
  narrow with a type guard. Biome enforces the rules in `biome.json`, including
  `noExplicitAny` and `noConsole` in `src/`.
- **Public surface is the `exports` map.** The package exposes `.`, `./testing`,
  and `./ipc`. Changing an exported type is a semver-relevant change — bump
  accordingly (Conventional Commits drive release-please).

## Relationship to other repos

- [`Nimbus`](https://github.com/nimbus-agent/Nimbus) — the gateway/CLI monorepo;
  the first-party consumer of this SDK (connectors depend on `@nimbus-dev/sdk`).
- For local co-development against a monorepo checkout, use the monorepo's
  `bun run platform:link`, which `bun link`s a sibling `../nimbus-sdk` checkout.

## Pull requests

- Keep PRs focused; include tests for behavior changes.
- Use [Conventional Commits](https://www.conventionalcommits.org/) — release-please
  derives the version bump and changelog from them.
- `bun run typecheck && bun run lint && bun run build && bun test` must pass
  (CI runs the same on Ubuntu).

## Releases

Releases are automated by [release-please](https://github.com/googleapis/release-please):
merged Conventional Commits open a release PR; merging it tags the release and
publishes `@nimbus-dev/sdk` to npm with provenance via GitHub OIDC (no long-lived
npm token).
