# Sync contract v1

Normative. How an extension hands indexable items to the gateway. The key words MUST,
MUST NOT, SHOULD and MAY are used as in RFC 2119. The TypeScript reference is
`@nimbus-dev/sdk/sync` (`sdks/typescript/src/sync/index.ts`); the gateway implements these
rules independently and does not import it, so this document, not the code, is the contract.

The conformance corpus is [`corpus/`](./corpus/): every `valid-*.json` MUST be accepted by
`validateSyncResponse` and every `invalid-*.json` MUST be rejected. It is executed by the
TypeScript binding only.

## 1. Versioning

The contract major is `"1"` (`SYNC_CONTRACT_VERSION`). An extension opts in by declaring a
`sync` block with `contract: "1"` in its manifest (§ 7). The contract carries its own
version rather than extending the manifest's `contractVersions`: a gateway that does not know
the sync contract ignores the `sync` block, installs the extension as a tool-only extension,
and never syncs it. A gateway MUST refuse a `sync.contract` value it does not implement.

## 2. The sync tool

An extension that syncs exposes exactly one MCP tool named `__nimbus_sync`
(`SYNC_TOOL_NAME`). Every tool name beginning `__nimbus_` (`RESERVED_TOOL_PREFIX`) is
reserved to the gateway: it MUST be omitted from every tool listing shown to a user or a
model, and a user-initiated call to it MUST be refused. Only the scheduler calls it.

## 3. Request

The tool's argument object is a `SyncRequest`:

| Member | Type | Meaning |
|---|---|---|
| `cursor` | string or `null` | The cursor returned by the previous page; `null` on a first sync. |
| `depth` | `"metadata_only"` \| `"summary"` \| `"full"` | How much body the owner allows indexed. |
| `historyFloorMs` | integer, optional | Items last modified before this epoch-millisecond instant need not be returned. |

An extension SHOULD honour `depth`: at `metadata_only` it SHOULD send no `body` or
`bodyPreview`; at `summary` it SHOULD send `bodyPreview` only. The gateway enforces the depth
again on receipt and drops what exceeds it.

## 4. Response

The tool result is a JSON object (MCP structured content, or a single text content block
holding the JSON) whose `status` member selects the shape:

- `"ok"` — `items`: array of items (§ 5); `cursor`: string or `null`; `hasMore`: boolean.
- `"rate_limited"` — `retryAfterMs`: non-negative integer, optional.
- `"unauthenticated"` — no other members.

Any other `status`, a non-object response, or a missing or ill-typed member is invalid.
Unknown extra members MUST be ignored, not rejected.

### 4.1 Cursor opacity

The cursor is an opaque string chosen by the extension. The gateway stores it and returns it
verbatim; it MUST NOT parse, order or compare cursors. `hasMore: true` means call again with
the returned cursor; `hasMore: false` ends the run, and the returned cursor (or `null`) is
what the gateway sends on the next run.

## 5. Item

| Member | Type | Rule |
|---|---|---|
| `type` | string | Non-empty. MUST be one of the manifest's `sync.itemTypes`. |
| `externalId` | string | Non-empty. Stable per item across runs. |
| `title` | string | Required; MAY be empty. |
| `url`, `canonicalUrl` | string or `null`, optional | |
| `modifiedAt` | integer | Epoch milliseconds; a non-negative safe integer (not a float, not above 2^53 - 1). |
| `metadata` | object | A plain JSON object (not an array, not `null`). |
| `body` | string, optional | The full body. Exclusive with `bodyPreview`. |
| `bodyPreview` | string, optional | A short excerpt. Exclusive with `body`. |
| `bodyTruncated` | boolean, optional | Only valid alongside `body`: the extension cut it. |

`body` and `bodyPreview` are a union: an item carrying both is invalid, and `bodyTruncated`
without `body` is invalid.

## 6. What validation does not cover

`validateSyncResponse` is structural. These belong to the gateway and are not conformance
cases here: per-item and per-page size limits, dropping items whose `type` is not declared
in the manifest, rejecting an `externalId` that collides across declared types, the body
depth cap, and the call timeout. A response the gateway cannot accept is treated like a
transport failure: the run fails and the stored cursor does not advance.

## 7. Manifest blocks

Two optional manifest members support sync. Both are validated by the extension manifest
schema (`docs/spec/schemas/v1/extension-manifest.schema.json`); no semantic rule in
`docs/spec/rules/v1/` inspects them.

```json
{
  "permissions": { "network": ["readwise.io"] },
  "sync": { "contract": "1", "intervalSeconds": 3600, "itemTypes": ["highlight", "book"] },
  "credentials": { "token": { "env": "READWISE_TOKEN" } }
}
```

- `sync.contract` MUST be exactly `"1"`.
- `sync.intervalSeconds` MUST be an integer of at least 60.
- `sync.itemTypes` MUST be non-empty; each entry MUST match `^[a-z][a-z0-9_]{0,31}$`.
- A `credentials` key (the credential name) MUST match `^[a-z][a-z0-9_]{0,31}$`.
- A credential's `env` MUST match `^[A-Z][A-Z0-9_]{0,63}$`, MUST NOT begin with `NIMBUS_`,
  `BUN_` or `NODE_`, and MUST NOT be one of `PATH`, `HOME`, `USERPROFILE`, `TEMP`, `TMP`,
  `TMPDIR`, `SYSTEMROOT`. The gateway injects the credential's value into the extension's
  environment under that name; the value never appears in the manifest.

The TypeScript types for these two blocks are `SyncManifestBlock`, `CredentialsManifestBlock`
and `SyncCapableManifestFields` in `@nimbus-dev/sdk/sync`; intersect the last with
`ExtensionManifest`. `ExtensionManifest` itself is unchanged.

The `permissions` member of an extension manifest is outside this contract. Real manifests
declare an object (`{ "network": [...] }`) where the published schema and rule registry pin
an array; reconciling them is a separate, RFC-governed change to a frozen module.
