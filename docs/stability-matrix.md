# Stability and support matrix

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with `bun run build && bun run stability:matrix`.
     Tiers are read from the three API-surface goldens on every render and are never
     stored here — see docs/superpowers/specs/2026-08-30-stability-matrix-design.md. -->

What each capability promises you, in each language that binds it. A `—` means that
binding does not publish the capability at all.

| Capability | TypeScript | Python | Go |
|---|---|---|---|
| [`agents`](./modules/agents.md) | `stable` | — | — |
| [`audit-logger`](./modules/audit-logger.md) | `stable` | — | — |
| [`connector-kit`](./modules/connector-kit.md) | `experimental` | `experimental` | `experimental` |
| [`contract-version`](./modules/contract-version.md) | `frozen` | `stable` | `experimental` |
| [`crypto`](./modules/crypto.md) | `stable` | — | — |
| [`data-profile`](./modules/data-profile.md) | `frozen` | `frozen` | `frozen` |
| [`diagnostics`](./modules/diagnostics.md) | `experimental` | `stable` | `frozen` |
| [`distribution-channel`](./modules/distribution-channel.md) | `frozen` | `frozen` | `frozen` |
| [`flux-cd`](./modules/flux-cd.md) | `experimental` | — | — |
| [`hitl-request`](./modules/hitl-request.md) | `frozen` | — | — |
| [`icalendar`](./modules/icalendar.md) | `frozen` | `frozen` | `frozen` |
| [`ipc`](./modules/ipc.md) | `frozen` | `frozen` | `frozen` |
| [`item-types`](./modules/item-types.md) | `frozen` | — | — |
| [`jmap-fastmail`](./modules/jmap-fastmail.md) | `frozen` | `frozen` | `frozen` |
| [`server`](./modules/server.md) | `stable` | — | — |
| [`signing`](./modules/signing.md) | `experimental` | `experimental` | — |
| [`storybook`](./modules/storybook.md) | `experimental` | — | — |
| [`testing`](./modules/testing.md) | `stable` | `stable` | `stable` |
| [`types`](./modules/types.md) | `frozen` | — | — |

## What each tier promises

| Tier | Spec- and corpus-backed | Deprecation window before removal | RFC required to break |
|---|---|---|---|
| `frozen` | Yes — a normative spec and a conformance corpus | Full window | Yes |
| `stable` | No | Full window | No |
| `experimental` | No | None — may change or be removed at any time | No |

The window itself is [`DEPRECATION-POLICY.md`](./DEPRECATION-POLICY.md)'s: marked in a
minor, surviving a later minor, removed at a major. Tier and deprecation are orthogonal —
an export can be `stable` and `@deprecated` at once (RFC-0015 §1).

## Binding status

| Binding | Officiality | Package | Published through | Corpora executed |
|---|---|---|---|---|
| TypeScript | Official — [RFC-0016](./rfcs/0016-typescript-sdk-official.md) | `@nimbus-dev/sdk` | npm | 13 of 13 |
| Python | Official — [RFC-0008](./rfcs/0008-python-sdk-official.md) | `nimbus-dev-sdk` | PyPI | 9 of 13 |
| Go | Official — [RFC-0013](./rfcs/0013-go-sdk-official.md) | `github.com/nimbus-agent/nimbus-sdk/sdks/go` | module proxy (a `sdks/go/vX.Y.Z` tag) | 8 of 13 |

Officiality is a governance act, not a test result — it is
[GOVERNANCE.md's four criteria](./GOVERNANCE.md#how-a-language-becomes-official), the
fourth of which is an accepted RFC. Which corpora each binding executes, and why it
does not claim the rest, is [`conformance-coverage.md`](./conformance-coverage.md)'s.

## Runtime support

| Binding | Declared floor | Where it is declared |
|---|---|---|
| TypeScript | `>=22` | `engines.node` |
| Python | `>=3.11` | `requires-python` |
| Go | `1.26` | the `go` directive |

These are read from the packages themselves on every render, so this table cannot
drift from what the packages declare. CI proves each floor on Linux and Windows on
every pull request; macOS runs only the newest supported Node and Go, not the floor
itself, so this table's Go and TypeScript rows are unproven there (Python's floor
runs on all three). See [docs/README.md](./README.md#supported-versions) for every
version CI actually tests, per OS. Go's floor names the *older* of the two supported
minors on purpose. Dropping a runtime version is a breaking change under
[`DEPRECATION-POLICY.md`](./DEPRECATION-POLICY.md).
