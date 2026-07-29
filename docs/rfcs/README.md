# RFCs

Contract-affecting changes to `@nimbus-dev/sdk` are proposed here before they land, under
the process in [GOVERNANCE.md](../GOVERNANCE.md#the-rfc-process). An RFC states the problem,
the proposed change, the compatibility impact, and the migration plan — and records the
alternatives that were rejected, so a later reader learns why the contract looks the way it
does rather than only what it says.

The default posture on the narrow waist is *no*: the burden is on the proposal to justify
widening the contract.

| RFC | Title | Status |
|-----|-------|--------|
| [0001](./0001-ipc-framing-spec.md) | A normative wire spec for NDJSON framing | draft |
| [0002](./0002-manifest-rule-registry.md) | A published rule registry for manifest validation | draft |

Not everything needs an RFC. A new battery is governed by the
[inclusion policy](../INCLUSION-POLICY.md); retiring an export is governed by the
[deprecation policy](../DEPRECATION-POLICY.md). RFCs are for changes to the shared law every
binding implements.
