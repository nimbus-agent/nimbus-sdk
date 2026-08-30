<!-- covers: contract-version, ipc/hello
     py: contract, ipc/hello, __init__
     go: contract/manifest, contract/negotiate, contract/sdkversion, contract/version, ipc/hello -->

# `contract-version`

How a connector and a gateway agree on which version of the contract they speak. The normative
specification is [`spec/negotiation/v1/contract-version.md`](../spec/negotiation/v1/contract-version.md);
this page is the TypeScript view of it.

## What a contract version is

A decimal major, as a string, matching `^[1-9][0-9]*$`. It names a published spec path segment:
`"1"` is everything under `docs/spec/*/v1/`.

It is **not** the package version, **not** `manifest.version`, and **not**
`manifest.minNimbusVersion` — that last one is a floor on the gateway *product*, and the two are
unrelated.

## Declaring what you speak

`contractVersions` on the manifest is optional. Omitting it means `["1"]`:

```ts
import type { ExtensionManifest } from "@nimbus-dev/sdk";

const manifest: ExtensionManifest = {
  id: "acme-notes",
  displayName: "Acme Notes",
  version: "1.0.0",
  description: "Indexes notes from Acme.",
  author: "Acme",
  entrypoint: "./dist/index.js",
  runtime: "bun",
  permissions: ["read"],
  hitlRequired: [],
  minNimbusVersion: "1.0.0",
  contractVersions: ["1"],
};
```

It becomes required at the next contract major — see the
[deprecation policy](../DEPRECATION-POLICY.md).

## Negotiating

```ts
import {
  CONTRACT_HANDSHAKE_EXIT,
  CONTRACT_VERSIONS,
  manifestContractVersions,
  negotiateContractVersion,
} from "@nimbus-dev/sdk";

const manifest = { contractVersions: ["1"] };

const result = negotiateContractVersion(CONTRACT_VERSIONS, manifestContractVersions(manifest));
if (!result.ok) {
  // result.reason is "no-common-version" or "invalid-version"
  process.exit(CONTRACT_HANDSHAKE_EXIT); // 20
}
result.version; // "1"
```

`negotiateContractVersion` validates every member of both sets rather than trusting the caller,
and never throws on caller data: a refusal is a value.

The agreed version is the largest common member, compared as **longer-string-wins, then
character comparison** — which is exact numeric order given the no-leading-zeros rule, and needs
no number type. Parsing to a number would lose precision on a long major.

## Confirming a declaration

`declaredVersionsMatch(manifestVersions, helloVersions)` is the gateway-side check that a running
connector announced exactly what its manifest promised. Equal as sets; a superset is a runtime
claiming a version it never declared.

## What this module does not do

It performs no I/O and starts no handshake. Reading and writing the frame is
[`ipc`](./ipc.md)'s `encodeHello` / `parseHello`; performing the exchange belongs to whatever owns
the transport.
