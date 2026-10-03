/**
 * `@nimbus-dev/sdk/testing` — utilities for extension authors and the
 * gateway's own connector tests.
 *
 * @moduleStability stable
 *
 * Exports:
 *   - `MockGateway` — mock Gateway IPC for unit tests (Phase 4).
 *   - `runSandboxContractTests(manifestPath)` — fork the probe binary and
 *     verify the runtime sandbox enforces the manifest's declared
 *     `permissions.network` + `permissions.filesystem` (Phase 5 T2 PR 1).
 *   - `expectNoRejectedDiagnostics(results)` — fail a connector's own test suite
 *     loudly if any `DiagnosticEmitter` call was refused and silently dropped.
 */

export { expectNoRejectedDiagnostics } from "./diagnostics-assert.js";
export { runSandboxContractTests } from "./sandbox-contract.js";

export class MockGateway {
  // Not `async`: nothing here awaits, and `Promise.resolve` already hands back the promise a
  // real gateway call returns. The body cannot throw, so no caller can tell the difference.
  callTool(_toolName: string, _input: Record<string, unknown>): Promise<unknown> {
    return Promise.resolve({});
  }
}
