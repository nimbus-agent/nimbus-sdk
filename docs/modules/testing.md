<!-- covers: contract-tests, testing/diagnostics-assert, testing/index, testing/sandbox-contract -->

# `testing`

The checks a connector runs against itself: manifest contract tests and the no-row-data
assertion (from the main entry point), plus `MockGateway` and the sandbox probe (from
`@nimbus-dev/sdk/testing`).

## When you reach for it

In your connector's own test suite, before you publish. `runContractTests` catches a
manifest that will be rejected at install time; `runSandboxContractTests` compares a
manifest's declared permissions against what a forked probe actually observes.

## Constraints that are load-bearing

- **`MockGateway` is reachable from both entry points, and that has bitten before.**
  `sdks/typescript/src/index.ts` re-exports it, so [`api-surface.md`](../api-surface.md) lists
  `MockGateway` under `.` as well as under `./testing`, and importing the package root pulls
  `sandbox-contract.js` in with it. The module comment in
  `sdks/typescript/src/testing/sandbox-contract.ts`
  records the consequence: a bundler that inlined the source baked the build machine's
  absolute path into `import.meta.url`, and `require("@nimbus-dev/client")` then threw
  `ERR_INVALID_FILE_URL_PATH` on every machine that was not the CI runner — while passing
  CI, where the baked path happened to exist. The probe path is resolved lazily now, so a
  root import stays inert. But the re-export is still there: test-only code is **not**
  quarantined behind the subpath. Import from `@nimbus-dev/sdk/testing` because it says
  what you mean, not because it isolates anything.
- **The no-row-data check is name-based, and that is on purpose.** Each tool name is split
  on non-alphanumeric boundaries and rejected if any segment is in
  `ROW_DATA_TOOL_SEGMENTS`. Descriptions are deliberately not scanned, so a description
  reading "does not fetch rows" cannot produce a false positive. The service prefix must be
  a single token — `bigquery_list`, not `big_query_list`, which would split into a spurious
  `query`.
- **Case folding is ASCII-only, not `toLowerCase`.** Only `A`–`Z` fold. Published as
  contract, "lowercase" is a trap — Java's is locale-sensitive and Go's uses simple case
  mapping, so both diverge — and exactly two code points in Unicode lower into ASCII
  (U+0130, U+212A), so narrowing costs almost nothing. See
  [`docs/spec/predicates/v1/`](../spec/predicates/v1/README.md).
- **`findRowDataTools` is the non-throwing form.** It returns `{ tool, segment }` pairs in
  **input order**, one at most per tool, naming the *first* segment that matched in name
  order; `assertNoRowDataTools` is a wrapper that throws when the list is non-empty. Prefer
  it when you want to report offenders yourself rather than catch an exception and split its
  message — the same relationship `validateManifest` has to `runContractTests`.
- **The probe is an inter-process protocol, and it is written down.**
  [`docs/spec/probe/v1/`](../spec/probe/v1/sandbox-probe.md) specifies the `--probe=`/`--arg=`
  syntax, the four exit codes, the two errno sets, and the harness decision table; a binding
  in another language ships its own probe against it.
  `sdks/typescript/src/testing/sandbox-protocol.ts` holds
  the same names and numbers for the TypeScript side, and a drift guard keeps the two equal.
  **`runSandboxContractTests` does not sandbox-wrap the probe** — it spawns your runtime
  directly — so a pass proves the harness's decision logic, never that a sandbox enforces
  anything. See the spec's §7.
- **Only the `contract-tests` entry points throw `ExtensionContractError`.**
  `runContractTests` and `assertNoRowDataTools` do. **`runSandboxContractTests` throws a
  plain `Error` on all three of its failure paths.** Catching only `ExtensionContractError`
  around a sandbox run silently swallows every sandbox failure.
- **`runContractTests` validates the manifest's shape, and then runs two v1 self-checks.**
  The shape half covers required strings, the `runtime` value, the `permissions` and
  `hitlRequired` vocabularies, and the `minNimbusVersion` format; every complaint it finds is
  collected and raised as one `ExtensionContractError` whose message joins them with `"; "`.
  If that passes, it asserts two of the SDK's own v1 invariants — that `isHitlRequest` still
  accepts a valid request and rejects an empty one, and that a scoped `AuditLogger.log` still
  returns a Promise. **Those two throw a single, unjoined message**, so a caught message is
  not always a `"; "`-joined list, and splitting one unconditionally turns a single self-check
  failure into a phantom list of manifest defects. What it still does not do is execute your
  tools, so it cannot tell whether the permissions you declared match the ones you use.
- **The sandbox probe reads a different permissions schema than `ExtensionManifest`, and
  the mismatch is silent.** `runSandboxContractTests` reads the manifest **from disk** and
  looks for `permissions.network` — an *object* form. `ExtensionManifest.permissions` in
  this same SDK is an **array** (`["read", "write"]`), the shape the first fence below
  builds. Given an array it finds no hosts, so **both network probes skip on every
  platform** and only the filesystem-denied probe runs. Separately, the network-unlisted
  probe is skipped on Windows, where AppContainer filtering makes the failure
  indistinguishable from the unsandboxed case. A green run proves less than it looks like —
  know which probes actually ran.
- **The SDK harness alone does not sandbox-wrap the probe.** It forks it directly, so for
  the run to assert real enforcement the probe must be invoked under a sandbox wrapper.
- **`runProbe`, `probePath` and `platform` are injectable.** The probe runner, the probe's
  location, and the platform reading are all parameters, so the harness itself is testable —
  see the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
- **Bundling the SDK breaks the default probe path; `probePath` is the fix.** By default the
  probe is resolved beside this module via `import.meta.url`, which holds for
  `sdks/typescript/src/` under the `bun` condition and for `dist/` from the published
  package. A bundler that inlines the
  module replaces `import.meta.url` with the build machine's path, and the resolution throws
  `ERR_INVALID_FILE_URL_PATH`. Pass `probePath` with the probe's real location. It is a
  parameter, not an environment variable, on purpose. Point it at
  `dist/testing/sandbox-probe.js` — it does ship (`files` includes `dist`) — and reference it
  unbundled: if your build relocates or inlines the rest of the package, copy this file out of
  `node_modules` first rather than letting a bundle step touch it. It is spawned with
  `process.execPath`, so a `.ts` path fails under a Node runtime; point at the compiled `.js`.

## Example

Validating the manifest and the tool surface:

```ts
import {
  assertNoRowDataTools,
  ExtensionContractError,
  type ExtensionManifest,
  runContractTests,
} from "@nimbus-dev/sdk";

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

/** What the contract checks reported, or `[]` when the manifest and both v1 self-checks pass. */
export async function checkContract(): Promise<string[]> {
  try {
    await runContractTests(manifest);

    // `acme_rows` would be rejected here; `acme_schema` is fine.
    assertNoRowDataTools([{ name: "acme_schema", description: "List note fields." }], manifest.id);
    return [];
  } catch (err) {
    // The message is returned whole, not split on "; ". Manifest-shape complaints are joined
    // that way, but the v1 HITL/audit self-checks and `assertNoRowDataTools` each throw one
    // sentence — splitting would render a single failure as several defects.
    if (err instanceof ExtensionContractError) return [err.message];
    throw err;
  }
}
```

Making a dropped diagnostic loud in your own suite — see the section below for why the
emitter drops silently at runtime and this helper does the opposite in a test:

```ts
import { expectNoRejectedDiagnostics } from "@nimbus-dev/sdk/testing";

// Shaped like the `EmitResult` values a `DiagnosticEmitter` method resolves to — the
// type itself is not published, so this matches it structurally, the same way a real
// caller collecting results from `nimbus.info(...)` and friends would, without an
// import for a type this entry point does not export.
const results = [
  { ok: true, line: '{"nimbus":"diag","event":"sync.page"}' },
  { ok: true, line: '{"nimbus":"diag","event":"sync.done"}' },
] as const;

export function testEmitsOnlyValidDiagnostics(): void {
  expectNoRejectedDiagnostics(results);
}
```

## Making dropped diagnostics loud in your own tests

[`createEmitter`](./diagnostics.md) (`@nimbus-dev/sdk/diagnostics`) never throws and never writes a line the wire contract's encoder refused — an invalid
event is dropped, and the caller gets back an `{ ok: false, reason, path }` result instead
of a written line. That is the correct behavior in production: a typo in an event name or
an out-of-range field value must not be able to crash, or even destabilize, the connector
it is trying to describe.

It is the *wrong* behavior for a connector's own test suite, where a silently dropped
diagnostic is a bug that should fail the build, not vanish. `expectNoRejectedDiagnostics`
closes that gap without asking the emitter to behave differently depending on who is
watching: collect the `EmitResult` values your test run produced, and hand the whole list
to `expectNoRejectedDiagnostics`. It throws one `Error` naming every refused event's
reason and JSON-Pointer path if any result has `ok: false`, and does nothing if every
event encoded cleanly.

The alternative — branching inside the emitter on `NODE_ENV` or an equivalent flag — was
deliberately rejected. It would make "does this event validate" a claim about which
process launched the connector rather than about the event itself, and that claim has no
single answer across hosts: a normative behavior that depends on an ambient environment
variable is untestable and unportable in exactly the way the rest of this contract works
to avoid.

The sandbox probe and the gateway mock:

```ts
import { MockGateway, runSandboxContractTests } from "@nimbus-dev/sdk/testing";

/** A plain `Error`, not an ExtensionContractError — do not narrow it away. */
export async function checkSandbox(manifestPath: string): Promise<string | null> {
  try {
    await runSandboxContractTests(manifestPath);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Resolves to `{}` for every call — a null object, not a programmable mock. */
export async function callThroughMock(): Promise<unknown> {
  const gateway = new MockGateway();
  return await gateway.callTool("acme_schema", { itemId: "note-1" });
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.

- **`contract-tests`** — `runContractTests` and `assertNoRowDataTools`, plus
  `findRowDataTools` and `RowDataViolation` (the non-throwing form and the `{ tool, segment }`
  pair it returns), `ROW_DATA_TOOL_SEGMENTS` (the segment blocklist the check consults,
  exported so you can see what it will reject before it rejects it — and published as
  language-neutral data at
  [`docs/spec/predicates/v1/`](../spec/predicates/v1/row-data-segments.json), with a drift
  guard holding the two together), `RowDataToolCandidate` (the `{ name, description? }` shape
  it takes), and `ExtensionContractError`.
- **`testing/diagnostics-assert`** — `expectNoRejectedDiagnostics`. Throws if any
  `EmitResult` in the list it is given has `ok: false`; otherwise a no-op. See "Making
  dropped diagnostics loud in your own tests" above.
- **`testing/index`** — `MockGateway`. `callTool` ignores both arguments and resolves to
  `{}`. It is a null object that lets a call site compile and run, not a mock you can
  script; substitute your own when a test needs a real answer.
- **`testing/sandbox-contract`** — `runSandboxContractTests`.
  `RunSandboxContractTestsOptions`, which carries `runProbe`, `probePath` and `platform`, *is* an
  `export interface` in that module, but the `./testing` barrel does not re-export it — so it
  is absent from the package's public surface and appears in
  [`api-surface.md`](../api-surface.md) only inside the function's signature. You cannot
  import the name; pass an object literal.
