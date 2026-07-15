## Summary

<!-- What does this change and why? -->

## Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun run test` passes (tests added/updated for behavior changes)
- [ ] `bun run build` succeeds
- [ ] No new runtime dependency (the published surface stays dependency-free)
- [ ] No `any` (used `unknown` + a type guard for external/cross-boundary data)
- [ ] Exported-type changes are reflected in the Conventional Commit type (semver)
