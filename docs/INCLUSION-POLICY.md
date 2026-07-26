# Batteries — inclusion policy

`@nimbus-dev/sdk` ships **batteries**: pure, dependency-free helper modules so common
connector work isn't reinvented per connector. `crypto`, `jmap-fastmail`, `icalendar`,
`data-profile`, `flux-cd`, `storybook`, and `distribution-channel` are the ones that
exist today.

This policy is the test a reviewer applies when someone proposes another. It exists so
the surface grows on purpose rather than by accretion — every export here is one more
thing every language binding must eventually implement and every consumer may depend on.

## The default answer is no

The burden is on the proposal. This mirrors the posture
[GOVERNANCE.md](./GOVERNANCE.md#the-rfc-process) already takes on the narrow waist: the
question is never "is this useful?" but "does the contract get worse if this is *not*
here?"

## Admission criteria

A proposed battery must satisfy **all four**.

### 1. No runtime dependency

It compiles and runs with nothing in `dependencies`. If it needs a helper, that helper
is inlined. This is not a preference — it is the guarantee that makes the SDK safe to
depend on across an ecosystem, and `package.json` has no `dependencies` key at all.

### 2. Pure

No I/O, no credentials, no network, no filesystem, no global mutable state, and no
clock or randomness reachable from its result. Given the same input it returns the same
output on every supported platform. Anything that must touch the outside world belongs
in the gateway, not here.

### 3. Genuinely reused

Used by at least two connectors — or by one, plus a written case for the second.

This one cannot be checked mechanically. The first-party connectors live in the
[Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo, so this is a claim the
proposing author makes and a reviewer accepts on the evidence offered. A weaker
criterion that CI *could* check would admit exactly the helpers this policy exists to
keep out.

### 4. Contract-shaped

It serves the job of authoring a Nimbus connector or app. A correct, pure,
dependency-free utility that any project might want is still out of scope — that is
what a general-purpose library is for.

## Standing scope constraints

Independent of the four criteria, and non-negotiable because they are
data-minimization guarantees the SDK already makes:

- `jmap-fastmail` stays **headers-only**.
- `data-profile` stays **metadata-only** — never cell values.
- No battery may place row or body data anywhere it could reach a log.

A proposal needing any of these relaxed is contract-affecting and takes the RFC path in
[GOVERNANCE.md](./GOVERNANCE.md#the-rfc-process).

## What acceptance means

A new battery is an **additive** change under
[GOVERNANCE.md's change classes](./GOVERNANCE.md#change-classes): PR plus review, minor
bump, and it will show up as new entries in [`api-surface.md`](./api-surface.md). Adding
it is easy; removing it later requires the
[deprecation policy](./DEPRECATION-POLICY.md) and a major version. Decide accordingly.
