import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSandboxContractTests } from "./sandbox-contract.ts";

describe("runSandboxContractTests", () => {
  it("rejects when the manifest file does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sdk-contract-missing-"));
    const manifestPath = join(dir, "missing.json");
    await expect(runSandboxContractTests(manifestPath)).rejects.toThrow();
  });

  it("rejects when the manifest is not valid JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sdk-contract-bad-"));
    const manifestPath = join(dir, "nimbus.extension.json");
    writeFileSync(manifestPath, "{not-json");
    await expect(runSandboxContractTests(manifestPath)).rejects.toThrow();
  });

  it("handles a manifest with no declared network hosts without crashing", async () => {
    // No declared hosts → probes 1 and 2 are both skipped. Only probe 3
    // (fs-denied) runs. Outside the gateway sandbox harness, probe 3's
    // outcome depends on OS-level ACLs:
    //   - POSIX: /etc/passwd is world-readable → probe exits 2 → harness throws.
    //   - Windows: SAM hive is owner-locked → probe exits 10 → harness passes.
    // We only assert the "harness runs to completion" property here; the
    // pass/fail outcome is platform-dependent and that asymmetry is the
    // documented UX for third-party authors who invoke this outside the
    // gateway test helper. The gateway test helper wraps the probe with
    // `createSandboxRunner` and gets uniform enforcement across platforms.
    const dir = mkdtempSync(join(tmpdir(), "sdk-contract-empty-"));
    const manifestPath = join(dir, "nimbus.extension.json");
    writeFileSync(manifestPath, JSON.stringify({ id: "test.empty", permissions: {} }));
    let outcome: "pass" | "fail" = "pass";
    try {
      await runSandboxContractTests(manifestPath);
    } catch {
      outcome = "fail";
    }
    if (process.platform === "win32") {
      // Windows SAM hive is OS-protected → fs-denied probe gets EACCES → pass.
      expect(outcome).toBe("pass");
    } else {
      // POSIX /etc/passwd is world-readable → fs-denied probe exits 2 → harness throws.
      expect(outcome).toBe("fail");
    }
  }, 30_000);
});
