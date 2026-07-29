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
bun run lint        # biome check src/ scripts/ examples/
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

## Adding a public export

A new export must be documented before it can ship. `scripts/docs-coverage.test.ts`
resolves every export to its source module and fails the pull request unless some page in
[`docs/modules/`](./docs/modules/) claims that module in its `<!-- covers: ... -->`
comment. If your export lives in a module that already has a page, the guard is already
satisfied — but write the prose anyway, since that is the point of the page.

Code examples in `docs/modules/` and `README.md` are typechecked against the built
`dist/` by `scripts/docs-snippets.test.ts`. Every ` ```ts ` fence must be a complete,
standalone module that compiles on its own, importing only `@nimbus-dev/sdk`, its
`./testing` and `./ipc` entry points, or `node:` builtins. Use ` ```text ` for anything
that is not meant to compile.

Whether the export is additive or breaking is governed by the
[deprecation policy](./docs/DEPRECATION-POLICY.md); whether a new *battery* belongs here
at all is governed by the [inclusion policy](./docs/INCLUSION-POLICY.md).

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
  (CI runs the same on Linux, macOS and Windows, plus a Node 22/24 ESM smoke of the
  built `dist/` on each — see `.github/workflows/ci.yml`).

### Stacking a multi-part change

A change too large for one PR may be stacked: open each part against a shared dev branch,
then one aggregate PR from that branch to `main`. This repo merges by **squash only**, so
the aggregate PR's *title* is the only commit subject that ever lands on `main` — every
constituent subject is squashed one level below what release-please reads.

That means the aggregate title carries the whole stack's semver signal, and it must not
declare less than the stack contains:

- It must be a Conventional Commit.
- If any commit in the stack is a `feat`, the title must be a `feat`.
- If any commit is breaking (`!` or a `BREAKING CHANGE:` footer), the title must carry `!`.

Declaring *more* than the stack contains is fine — it only over-bumps. Declaring less
publishes a feature in a patch release, or a breaking change in a minor.

The `commit-guard` CI job enforces this on every PR targeting `main`. To check a PR before
pushing:

```bash
GITHUB_REPOSITORY=nimbus-agent/nimbus-sdk GH_TOKEN=$(gh auth token) \
  bun run scripts/conventional-commit-guard.ts --pr <number>
```

One residual gap the guard cannot close: a stack commit whose own subject is not a
Conventional Commit is unreadable to it (and to release-please), so a feature hidden behind
a `wip` subject is invisible. The job lists such commits as a note. Keep stack commits
conventional, or land the part directly on `main`.

## Releases

Releases are automated by [release-please](https://github.com/googleapis/release-please):
merged Conventional Commits open a release PR; merging it tags the release and
publishes `@nimbus-dev/sdk` to npm with provenance via GitHub OIDC (no long-lived
npm token).

Only the commits that reach `main` are parsed — see [Stacking a multi-part
change](#stacking-a-multi-part-change) for why that distinction decides the version
number, and `sdk 1.9.0` for what it costs when it is missed.
