# RFCs

Contract-affecting changes to `@nimbus-dev/sdk` are proposed here before they land, under
the process in [GOVERNANCE.md](../GOVERNANCE.md#the-rfc-process). An RFC states the problem,
the proposed change, the compatibility impact, and the migration plan — and records the
alternatives that were rejected, so a later reader learns why the contract looks the way it
does rather than only what it says.

The default posture on the narrow waist is *no*: the burden is on the proposal to justify
widening the contract.

| RFC | Title | Status | Landed |
|-----|-------|--------|--------|
| [0001](./0001-ipc-framing-spec.md) | A normative wire spec for NDJSON framing | accepted | [#56](https://github.com/nimbus-agent/nimbus-sdk/pull/56) |
| [0002](./0002-manifest-rule-registry.md) | A published rule registry for manifest validation | accepted | [#57](https://github.com/nimbus-agent/nimbus-sdk/pull/57) |
| [0003](./0003-pure-predicates.md) | Publishing the pure predicates | accepted | [#60](https://github.com/nimbus-agent/nimbus-sdk/pull/60) |
| [0004](./0004-sandbox-probe-protocol.md) | A protocol for the sandbox probe | accepted | [#61](https://github.com/nimbus-agent/nimbus-sdk/pull/61) |
| [0005](./0005-contract-version-negotiation.md) | Contract-version negotiation | accepted | [#67](https://github.com/nimbus-agent/nimbus-sdk/pull/67) |
| [0006](./0006-empty-vs-invalid-negotiation.md) | Empty versus invalid in contract-version negotiation | accepted | [#81](https://github.com/nimbus-agent/nimbus-sdk/pull/81) |
| [0007](./0007-corpus-gaps-from-the-python-binding.md) | Two corpus gaps the Python binding walked into | accepted | [#90](https://github.com/nimbus-agent/nimbus-sdk/pull/90) |
| [0008](./0008-python-sdk-official.md) | Promote the Python SDK to official | accepted | [#91](https://github.com/nimbus-agent/nimbus-sdk/pull/91) |
| [0009](./0009-python-runtime.md) | `manifest.runtime` admits Python | accepted | [#95](https://github.com/nimbus-agent/nimbus-sdk/pull/95) |
| [0010](./0010-diagnostics-contract-v0.md) | Diagnostics / telemetry contract v0 | accepted | [#113](https://github.com/nimbus-agent/nimbus-sdk/pull/113) |
| [0011](./0011-url-resolution.md) | URL resolution for the connector kit | accepted | this document, the normative spec, and `docs/spec/README.md` |
| [0012](./0012-go-sdk-binding.md) | A Go binding, and the release model it needs | accepted | this document and Shipment 1 of `sdks/go/`; released as `sdks/go/v0.1.0` and `v0.2.0` |
| [0013](./0013-go-sdk-official.md) | Promote the Go SDK to official, and pin what "the full conformance suite" means | accepted | [#153](https://github.com/nimbus-agent/nimbus-sdk/pull/153) |
| [0014](./0014-utf8-replacement-count.md) | One U+FFFD per maximal subpart | accepted | [#155](https://github.com/nimbus-agent/nimbus-sdk/pull/155) |
| [0015](./0015-tiered-stability.md) | Tiered stability markers | accepted | this document (Shipment 1 of 5) |
| [0016](./0016-typescript-sdk-official.md) | Record the TypeScript SDK as official | accepted | this document |
| [0017](./0017-battery-specifications.md) | Battery specifications, the normative whitespace set, and one amendment to RFC-0015's rule table — **supersedes** RFC-0015's `Export added` / `frozen` cell | accepted | this document (Shipment 0 of the battery port) |
| [0018](./0018-icalendar-line-folding.md) | `buildVEvent` does not fold — settles `icalendar.md` §7, which RFC-0017 left provisional | accepted | this document (Shipment 3 of the battery port) |
| [0019](./0019-additive-signature-changes.md) | Extending a declaration is adding, not breaking — **supersedes** RFC-0015's `Signature changed` / `stable` cell for optional-member additions | accepted | this document |

## Statuses

Four, matching the [process](../GOVERNANCE.md#the-rfc-process) rather than adding to it:

- **draft** — open for discussion. Nothing has been decided, and the proposal may still be
  withdrawn or rewritten.
- **accepted** — maintainers reached consensus, and the change has landed. Where it landed
  is recorded in the RFC's header, so the decision and the code that implements it stay
  connected.
- **rejected** — decided against. The document stays: an RFC that was turned down records
  why the contract does *not* work some way, which is as useful as recording why it does.
- **superseded** — overtaken by a later RFC, which it links to. A superseded RFC is not
  wrong, it is history.

An accepted RFC is not frozen prose. If the contract it describes changes later, that is a
new RFC — this one keeps describing the decision as it was made.

Not everything needs an RFC. A new battery is governed by the
[inclusion policy](../INCLUSION-POLICY.md); retiring an export is governed by the
[deprecation policy](../DEPRECATION-POLICY.md). RFCs are for changes to the shared law every
binding implements.
