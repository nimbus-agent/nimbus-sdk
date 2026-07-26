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
bun run lint        # biome check src/ scripts/
bun run test        # bun test
bun run build       # tsc → dist/ (JS + .d.ts + declaration maps)
```

### Changing the public API surface

`docs/api-surface.md` is a generated snapshot of every export of every `exports`
entry point. CI fails when it is stale, so if you add, remove, rename, or change
the type of an export:

```bash
bun run build && bun run api:surface
```

Commit the regenerated file alongside your change. The diff is the review: it is
where the semver conversation happens, so make sure your Conventional Commit type
matches what the diff shows — a removed or narrowed export is breaking.

A new `**Deprecated:**` line for an existing export is a third kind of diff, with its
own rule: it must ship as `feat:`, per the
[deprecation policy](./docs/DEPRECATION-POLICY.md#ship-the-marker-as-feat) — the
policy's window is defined in terms of a released minor, and only a `feat:` commit
makes release-please cut one.

The guard covers each export's own declaration text — not types it merely references.
A change to a type that is used in a public signature but not itself exported from a
barrel (e.g. an options type named in a constructor parameter) is a breaking change
that this file will not show; review those by hand.

## Architecture notes

- **Dependency-free at runtime.** `@nimbus-dev/sdk` ships with **no** runtime
  `dependencies` — it is the stable, MIT-licensed contract that first-party and
  third-party MCP connectors / extensions compile against. Do not add a runtime
  dependency; if you need a helper, inline it.
- **Adding a battery?** It must satisfy the
  [inclusion policy](./docs/INCLUSION-POLICY.md) — dep-free, pure, genuinely reused,
  contract-shaped. The default answer is no.
- **Removing or renaming an export?** It must pass through the
  [deprecation policy](./docs/DEPRECATION-POLICY.md) — marked in a released minor, at
  least one minor shipped carrying the marker, removed only in a major.
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
