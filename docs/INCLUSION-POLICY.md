# Batteries — inclusion policy

`@nimbus-dev/sdk` ships **batteries**: pure, dependency-free helper modules so common
connector work isn't reinvented per connector. `crypto`, `jmap-fastmail`, `icalendar`,
`data-profile`, `flux-cd`, `storybook`, `distribution-channel`, the scoped audit logger,
and HITL requests are the ones that exist today.

This policy is the test [maintainers](./GOVERNANCE.md#roles) apply — by consensus, or a
documented maintainer vote if consensus fails, the same authority
[GOVERNANCE.md](./GOVERNANCE.md#the-rfc-process) gives contract-affecting decisions —
when someone proposes another. It exists so
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

### 2. Pure — hidden ambient state is forbidden, substitutable effects are seamed

No module-level side effects, no ambient singletons, no global mutable configuration —
nothing a battery does may depend on state a caller cannot see or replace. Beyond that:
any effect a caller would reasonably want to substitute in a test — the clock, the
network, the filesystem, the environment — must be reachable through a parameter the
caller can replace. A real default for that parameter is permitted — it keeps the live
path ergonomic — but the effect must be substitutable, and the function must be
deterministic *for the effects that are seamed*: given the same seam values, the same
observable behavior. This makes batteries testable and verifiable, and it is a
meaningful bar: a helper that reaches for ambient state with no way to override it still
fails.

**Cryptographic primitives are carved out of the determinism requirement.** Key
generation and signing are nondeterministic on purpose — that unpredictability is the
security property, not an accident that a seam could fix. The worked example is
`generateEd25519Keypair` (`src/crypto/verify-signature.ts`): it takes no parameters and
calls Node's `generateKeyPairSync` directly, and there is no seam that would make two
calls return the same keypair without destroying the reason the function exists. The
same reasoning covers `signJwt`'s reliance on `crypto.sign` under ES256 (ECDSA signing
is randomized per call even with the same injected key) and `signManifest` /
`verifyManifestSignature`'s use of `crypto.subtle` — each is nondeterministic in a way
no parameter could seam away without producing a function that no longer performs the
primitive it is named for.

This carve-out is narrow: it excuses the nondeterminism *inherent to the primitive*, not
ambient configuration a helper reaches for out of convenience. A helper that reads
`process.env.API_ENDPOINT` with no way to override it still fails criterion 2, even
though it never touches a keypair — a parameter is always available for that case, and
the absence of one is exactly what this criterion exists to catch.

Worked examples: `distribution-channel` injects `env`, `execPath`, and `realpath` so a
caller can substitute filesystem or environment queries in tests.
`service-account-token` injects `fetchFn` and `nowMs` so tests control network calls
and deterministic timestamps. Both carry real defaults to their live paths.

### 3. Genuinely reused

Used by at least two connectors — or by one, plus a written case for the second.

This one cannot be checked mechanically. The first-party connectors live in the
[Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo, so this is a claim the
proposing author makes and maintainers accept on the evidence offered. A weaker
criterion that CI *could* check would admit exactly the helpers this policy exists to
keep out.

### 4. Contract-shaped

It serves the job of authoring a Nimbus connector or app. A correct, pure,
dependency-free utility that any project might want is still out of scope — that is
what a general-purpose library is for. This fourth criterion makes explicit what
`ARCHITECTURE.md`, `GOVERNANCE.md`, and `GLOSSARY.md` already describe: the narrow-waist
posture that every addition must justify its width.

## Standing scope constraints

Independent of the four criteria, and non-negotiable because they are
data-minimization guarantees the SDK already makes:

- `jmap-fastmail` stays **headers, attachment metadata, and a server-truncated body
  preview** — `maxBodyValueBytes` (2048) bounds what crosses the wire, `PREVIEW_MAX_CHARS`
  (2000) bounds what is returned, and an attachment's `blobId` is never dereferenced.
  Widening any of these three is contract-affecting.
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

## What rejection means

A proposal that does not satisfy all four criteria is declined. The decision and its
reasoning are recorded in the review — the PR conversation, or the RFC if the proposal
went through the wider RFC process. A rejected helper can live in the proposing
contributor's own package, repository, or ecosystem, in whatever form works for them.
A resubmission is worth making only if the proposal changes materially — for instance,
if a helper initially rejected for not being reused is now used by two connectors, or
if one initially rejected for hidden effects has been restructured to inject every
seam. Resubmitting unchanged work wastes reviewer time and will be declined again.
