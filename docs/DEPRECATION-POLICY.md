# Deprecation policy

How an export of `@nimbus-dev/sdk` is marked deprecated, how long it survives, and when
it may be removed.

The contract is a shared law that connectors and, eventually, other language bindings
depend on. Changing it is fine. Changing it *without warning* is not.

## The window

An export must be marked deprecated in a **released minor**, and it must still be
present and marked in **a later, separate minor release**, before a major may remove
it. The minor that introduces the marker does not itself satisfy this — a second
release is required. Removal is always a major bump.

```text
1.8.0   mark @deprecated              window opens
1.9.0   still present, still marked   window satisfied
2.0.0   may remove
```

The window is tied to **releases, not the calendar**. This package releases on its own
clock, driven by release-please and Conventional Commits, so a date-based promise is one
the maintainers cannot keep: during a quiet quarter the window would elapse with no
release ever carrying the warning.

Nothing may be removed without passing through this window. "It was obviously unused" is
not an exception — the SDK has third-party consumers it cannot enumerate.

## Marking

A `@deprecated` JSDoc tag on the export, stating three things: the version it was
deprecated in, the replacement, and the earliest version that may remove it.

```ts
/** @deprecated since 1.8.0 — use `newThing` instead. May be removed in 2.0.0. */
export const oldThing = …;
```

Mark the declaration in its own module, not the barrel re-export line (e.g. in
`src/index.ts`) — that is where it lives for every consumer, whichever barrel
re-exports it.

Keep the message on the `@deprecated` tag. Any following tag (`@param`, `@see`) ends it.

Wrap any `@`-shaped token in the message — a scoped package name, a handle — in
backticks. The surface extractor treats a whitespace-preceded `@word` as the start of
the next JSDoc tag, exactly as JSDoc and TypeDoc do, so an unwrapped mention truncates
the message there. `use @nimbus-dev/sdk-v2 instead` records as `use`; ``use
`@nimbus-dev/sdk-v2` instead`` records in full. This matters here more than most
places, because the package's own name begins with `@`.

### Ship the marker as `feat:`

The window above is defined in terms of a **released minor**, but release-please cuts
a release only for commit types it treats as version-bumping — `docs:`, `chore:`, and
`test:` cut nothing. The commit that adds a new `@deprecated` marker must therefore be
typed `feat:`, even though the diff is "just" a JSDoc comment: `feat:` is what makes
release-please open the minor release PR that opens this policy's window. A marker
committed as `docs:` or `chore:` passes CI and updates `api-surface.md`, but ships in no
release — the window silently never opens, and a later removal would cite a marking
release that does not exist.

## Visibility

The marker is recorded in [`api-surface.md`](./api-surface.md), the generated snapshot
of every public export:

```markdown
### `oldThing`

**Deprecated:** since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.
```

So **opening and closing a deprecation are both reviewable diffs** in the artifact that
already gates the contract — the same property adds, removals, and signature changes
have. A deprecation that does not show up there has not really been made.

## Worked precedents

Real classification calls and the reasoning behind them, so the next similar decision is
cheap.

### `engines: ">=22"` merged as `feat:` — a minor, not a major

Introducing an engine constraint where none existed narrows what the package claims to
support, which is superficially breaking. It merged as a `feat:` commit and shipped in
**1.7.0** (2026-07-26), the minor its classification called for. It is classified
as a minor because:

1. **Nothing stops working.** The SDK is dependency-free types and pure helpers with no
   Node-22-only code. A consumer on Node 20 keeps working — they lose a promise, not a
   capability.
2. **npm's default response to an engine mismatch is a warning**, not a failure.
3. **The excluded line was already end-of-life.** Node 20 ended support 2026-04-30.

The reasoning generalizes: **a narrowing of a support claim is not by itself a breaking
change if no behavior changes.**

**With a caveat.** "npm warns" is not universal — under `engine-strict`, and by default
in some package managers, an engine mismatch is a hard install failure. A consumer on an
excluded line who could install the previous version cannot install the new one. The
classification still holds, because the excluded line was EOL and the alternative was
promising support the project does not test. But it is why a support narrowing warrants
a release note even as a minor, and why the bar is "the excluded line is already EOL"
rather than "we would rather not test it."

## `manifest.contractVersions` — optional now, required at the next contract major

`manifest.contractVersions` is **optional** in contract `v1`: a manifest that omits it declares
the default set `["1"]`, per
[`spec/negotiation/v1/contract-version.md` §4](./spec/negotiation/v1/contract-version.md#4-declaration).
It becomes **required** at the next contract major, so that no manifest reaches a later gateway
still relying on a default that was written for `v1`.

This is not a deprecation — nothing is marked, and nothing is removed — but it is the same kind
of forward commitment this policy exists to record: the requirement takes effect only at a major
version boundary, never silently within `v1`, and it is written down once, here, rather than
left implicit in the spec section it is linked from.

## Relationship to the RFC process

Removing an export is contract-affecting and takes the RFC path in
[GOVERNANCE.md](./GOVERNANCE.md#the-rfc-process). This policy governs the *timing*; the
RFC governs the *decision*. An RFC that proposes a removal must state which release
opened the window.
