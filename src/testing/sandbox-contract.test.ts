import { afterAll, describe, expect, it, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __defaultRunProbe,
  type ProbeResult,
  type ProbeRunner,
  probeFileNameFor,
  probePath,
  runSandboxContractTests,
} from "./sandbox-contract.js";

/**
 * Every temp directory this file creates, removed once the suite finishes.
 *
 * Registered centrally rather than per-helper so a new helper cannot quietly reintroduce
 * the leak. Every probe spawn here is `spawnSync`, so the child has always exited by the
 * time this runs and nothing holds the files open. `force: true` makes a directory a test
 * already removed a no-op.
 */
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeProbeRunner(
  responses: ReadonlyArray<{ probe: string; arg?: string; result: ProbeResult }>,
): { runner: ProbeRunner; calls: Array<{ probe: string; arg: string }> } {
  const calls: Array<{ probe: string; arg: string }> = [];
  const runner: ProbeRunner = (probe, arg) => {
    calls.push({ probe, arg });
    const match = responses.find(
      (r) => r.probe === probe && (r.arg === undefined || r.arg === arg),
    );
    if (match === undefined) {
      throw new Error(`unexpected probe call: ${probe} arg=${arg}`);
    }
    return match.result;
  };
  return { runner, calls };
}

function writeManifest(perms: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "sdk-contract-stub-"));
  tempDirs.push(dir);
  const manifestPath = join(dir, "nimbus.extension.json");
  writeFileSync(manifestPath, JSON.stringify({ id: "test", permissions: perms }));
  return manifestPath;
}

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
      expect(outcome).toBe("pass");
    } else {
      expect(outcome).toBe("fail");
    }
  }, 30_000);

  it("runs all three probes when manifest declares hosts (Linux/macOS)", async () => {
    const manifestPath = writeManifest({ network: ["api.github.com"] });
    const { runner, calls } = makeProbeRunner([
      {
        probe: "network-listed",
        arg: "api.github.com",
        result: { status: 0, stderr: "", stdout: "" },
      },
      { probe: "network-unlisted", arg: "", result: { status: 11, stderr: "", stdout: "" } },
      { probe: "fs-denied", arg: "", result: { status: 10, stderr: "", stdout: "" } },
    ]);
    await runSandboxContractTests(manifestPath, { runProbe: runner, platform: "linux" });
    expect(calls).toEqual([
      { probe: "network-listed", arg: "api.github.com" },
      { probe: "network-unlisted", arg: "" },
      { probe: "fs-denied", arg: "" },
    ]);
  });

  it("skips the network-unlisted probe on Windows", async () => {
    const manifestPath = writeManifest({ network: ["api.github.com"] });
    const { runner, calls } = makeProbeRunner([
      { probe: "network-listed", result: { status: 0, stderr: "", stdout: "" } },
      { probe: "fs-denied", result: { status: 10, stderr: "", stdout: "" } },
    ]);
    await runSandboxContractTests(manifestPath, { runProbe: runner, platform: "win32" });
    expect(calls.map((c) => c.probe)).toEqual(["network-listed", "fs-denied"]);
  });

  it("throws when the listed-host probe exits non-zero", async () => {
    const manifestPath = writeManifest({ network: ["api.github.com"] });
    const { runner } = makeProbeRunner([
      { probe: "network-listed", result: { status: 7, stderr: "connect refused", stdout: "" } },
    ]);
    await expect(
      runSandboxContractTests(manifestPath, { runProbe: runner, platform: "linux" }),
    ).rejects.toThrow(/network-listed probe failed for api\.github\.com.*exit 7.*connect refused/);
  });

  it("throws when the unlisted-host probe does NOT return exit 11", async () => {
    const manifestPath = writeManifest({ network: ["api.github.com"] });
    const { runner } = makeProbeRunner([
      { probe: "network-listed", result: { status: 0, stderr: "", stdout: "" } },
      {
        probe: "network-unlisted",
        result: { status: 2, stderr: "unexpected fetch success", stdout: "" },
      },
    ]);
    await expect(
      runSandboxContractTests(manifestPath, { runProbe: runner, platform: "linux" }),
    ).rejects.toThrow(/network-unlisted probe should have failed.*exit 2.*platform-asymmetry/s);
  });

  it("throws when fs-denied probe does NOT return exit 10", async () => {
    const manifestPath = writeManifest({});
    const { runner } = makeProbeRunner([
      { probe: "fs-denied", result: { status: 2, stderr: "unexpected file read", stdout: "" } },
    ]);
    await expect(
      runSandboxContractTests(manifestPath, { runProbe: runner, platform: "linux" }),
    ).rejects.toThrow(/fs-denied probe should have returned EACCES.*exit 2.*unexpected file read/s);
  });

  it("tolerates a manifest with `permissions: string[]` (legacy array form)", async () => {
    const manifestPath = writeManifest(["read-files", "trash"]);
    const { runner, calls } = makeProbeRunner([
      { probe: "fs-denied", result: { status: 10, stderr: "", stdout: "" } },
    ]);
    await runSandboxContractTests(manifestPath, { runProbe: runner, platform: "linux" });
    expect(calls).toEqual([{ probe: "fs-denied", arg: "" }]);
  });

  it("`__defaultRunProbe` returns a well-formed envelope on a probe that exits non-zero", () => {
    const r = __defaultRunProbe("definitely-not-a-probe", "");
    expect(typeof r.status).toBe("number");
    expect(typeof r.stderr).toBe("string");
    expect(typeof r.stdout).toBe("string");
  }, 30_000);
});

describe("probePath", () => {
  test("resolves to a file that exists in whichever tree is running", () => {
    const path = probePath();
    expect(
      existsSync(path),
      `probePath() returned ${path}, which does not exist. Under Bun this module runs ` +
        "from src/ (where only sandbox-probe.ts exists); from the published package it " +
        "runs from dist/ (where only sandbox-probe.js exists). The extension must follow " +
        "whichever copy is executing.",
    ).toBe(true);
  });

  test("names the probe beside the module that resolved it", () => {
    expect(probePath().split(/[\\/]/).pop()).toMatch(/^sandbox-probe\.(ts|js)$/);
  });
});

describe("probeFileNameFor", () => {
  test("names the TypeScript probe beside a TypeScript module", () => {
    expect(probeFileNameFor("/repo/src/testing/sandbox-contract.ts")).toBe("sandbox-probe.ts");
  });

  test("names the JavaScript probe beside an emitted module", () => {
    expect(probeFileNameFor("/repo/dist/testing/sandbox-contract.js")).toBe("sandbox-probe.js");
  });

  test("handles Windows-style paths", () => {
    expect(probeFileNameFor("C:\\repo\\dist\\testing\\sandbox-contract.js")).toBe(
      "sandbox-probe.js",
    );
  });

  test("defaults to .js for anything that is not TypeScript", () => {
    // A bundler emitting .mjs is the plausible future case. Resolving to .js is the right
    // default there: it is what ships in dist/, and a wrong guess fails loudly with a
    // missing file rather than silently resolving to something unintended.
    expect(probeFileNameFor("/repo/dist/testing/sandbox-contract.mjs")).toBe("sandbox-probe.js");
  });
});
