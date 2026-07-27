<!-- covers: contract-tests, testing/index, testing/sandbox-contract -->

# `testing`

The checks a connector runs against itself: manifest contract tests and the no-row-data
assertion (from the main entry point), plus `MockGateway` and the sandbox probe (from
`@nimbus-dev/sdk/testing`).

## When you reach for it

In your connector's own test suite, before you publish. `runContractTests` catches a
manifest that will be rejected at install time; `runSandboxContractTests` catches a
manifest whose declared permissions do not match what the sandbox actually enforces.

## Constraints that are load-bearing

- **Two entry points, deliberately.** `runContractTests` and `assertNoRowDataTools` are
  part of the main contract (`@nimbus-dev/sdk`) because a connector may want them in
  production code paths. `MockGateway` and `runSandboxContractTests` live behind
  `@nimbus-dev/sdk/testing` so test-only machinery never enters a production bundle.
- **The no-row-data check is name-based, and that is on purpose.** Each tool name is split
  on non-alphanumeric boundaries and rejected if any segment is in
  `ROW_DATA_TOOL_SEGMENTS`. Descriptions are deliberately not scanned, so a description
  reading "does not fetch rows" cannot produce a false positive. The service prefix must be
  a single token — `bigquery_list`, not `big_query_list`, which would split into a spurious
  `query`.
- **Failures throw `ExtensionContractError`, not a plain `Error`.** Match on the class.
- **The sandbox probe asserts enforcement, and the SDK harness alone does not wrap it.**
  `runSandboxContractTests` forks probes for the first declared network host, an unroutable
  address, and a protected filesystem path. The network-unlisted probe is skipped on
  Windows, where AppContainer filtering makes the failure indistinguishable from the
  unsandboxed case. A green run on Windows therefore proves less than a green run on POSIX.
- **`runProbe` and `platform` are injectable.** The probe runner and the platform reading
  are parameters, so the harness itself is testable — see the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).

## Example

Validating the manifest and the tool surface:

```ts
import { assertNoRowDataTools, type ExtensionManifest, runContractTests } from "@nimbus-dev/sdk";

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
};

export async function checkContract(): Promise<void> {
  // Throws ExtensionContractError listing every problem it found.
  await runContractTests(manifest);

  // `acme_rows` would be rejected here; `acme_schema` is fine.
  assertNoRowDataTools([{ name: "acme_schema", description: "List note fields." }], manifest.id);
}
```

The sandbox probe and the gateway mock:

```ts
import { MockGateway, runSandboxContractTests } from "@nimbus-dev/sdk/testing";

export async function checkSandbox(manifestPath: string): Promise<void> {
  await runSandboxContractTests(manifestPath);
}

export async function callThroughMock(): Promise<unknown> {
  const gateway = new MockGateway();
  return await gateway.callTool("acme_schema", { itemId: "note-1" });
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct. `RunSandboxContractTestsOptions`, referenced by `runSandboxContractTests`, is
structural and not itself exported: pass an object literal.
