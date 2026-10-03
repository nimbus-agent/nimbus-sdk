## Summary

<!-- What does this change and why? -->

## Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run test` passes (tests added/updated for behavior changes)
- [ ] `bun run build` succeeds
- [ ] If `sdks/python/` or `docs/spec/` changed: `ruff`, `mypy` and `pytest` pass (see `docs/CONTRIBUTING.md`)
- [ ] If `sdks/go/` or `docs/spec/` changed: the Go commands in `docs/CONTRIBUTING.md` pass, and a spec change regenerated `sdks/go/spec/data/`
- [ ] Generated pages are regenerated if their inputs changed (`docs/api-surface*.md`, `docs/conformance-coverage.md`, `docs/stability-matrix.md`)
- [ ] No new runtime dependency (the published surface stays dependency-free)
- [ ] No `any` (used `unknown` + a type guard for external/cross-boundary data)
- [ ] Exported-type changes are reflected in the Conventional Commit type (semver)
