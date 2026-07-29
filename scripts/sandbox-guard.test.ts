/**
 * Sandbox guard — `docs/spec/probe/v1/` cannot drift from the reference implementation, and
 * its corpus cannot pass vacuously.
 *
 * What this proves, and what it deliberately does not:
 *
 * **It proves the harness's decision logic.** Permissions and platform in, an ordered
 * sequence of probe invocations out. That is executable here only because `runProbe` is an
 * injectable option — no sandbox, no network, and no spawn is involved.
 *
 * **It proves the probe's classification logic.** Which errno means "blocked" and which
 * means "something else went wrong" is a pure function, and the one part of the probe a
 * binding must reproduce exactly that CI can actually exercise.
 *
 * **It does not prove that any sandbox enforces anything.** The SDK harness does not
 * sandbox-wrap the probe — `__defaultRunProbe` spawns `process.execPath` directly. Real
 * enforcement is only demonstrated when the gateway's harness forks this inside an
 * already-wrapped process. See RFC-0004 §7, and the spec's own section saying so.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import {
  type ProbeResult,
  type ProbeRunner,
  runSandboxContractTests,
} from "../src/testing/sandbox-contract.ts";
import {
  FS_DENIED_CODES,
  fsDeniedExit,
  NETWORK_BLOCKED_CODES,
  networkBlockedExit,
  SANDBOX_PROBE_EXIT,
  SANDBOX_PROBES,
} from "../src/testing/sandbox-protocol.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));

const PROTOCOL_DIR = "docs/spec/probe/v1";
const PROTOCOL_PATH = `${PROTOCOL_DIR}/probe-protocol.json`;
const PROTOCOL_SCHEMA_PATH = `${PROTOCOL_DIR}/probe-protocol.schema.json`;

const CORPUS_DIR = "docs/spec/conformance/v1/sandbox";
const INDEX_PATH = `${CORPUS_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;

const GITHUB_RAW_PREFIX = "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/";

interface IndexEntry {
  file: string;
  section: string;
  reason: string;
}

interface ExpectedCall {
  probe: string;
  arg: string;
}

interface SandboxCase {
  kind: "harness" | "classify";
  description: string;
  // harness
  platform?: NodeJS.Platform;
  permissions?: unknown;
  probeResults?: Record<string, number>;
  expect?: { calls: ExpectedCall[]; outcome: "pass" | "throw"; failingProbe?: string };
  // classify
  classifier?: "network" | "filesystem";
  code?: string | null;
  expectExit?: number;
}

interface Protocol {
  invocation: { probeFlag: string; argFlag: string; repeated: string };
  exitCodes: { name: string; code: number }[];
  probes: { name: string }[];
  errorCodes: { networkBlocked: string[]; fsDenied: string[] };
}

const PROTOCOL_SCHEMA = readJson(PROTOCOL_SCHEMA_PATH) as Record<string, unknown>;
const PROTOCOL = readJson(PROTOCOL_PATH) as Protocol;
const INDEX_SCHEMA = readJson(INDEX_SCHEMA_PATH) as Record<string, unknown>;
const CASE_SCHEMA = readJson(CASE_SCHEMA_PATH) as Record<string, unknown>;
const INDEX = readJson(INDEX_PATH) as { spec?: string; cases: IndexEntry[] };

const CASES: { entry: IndexEntry; body: SandboxCase }[] = INDEX.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as SandboxCase,
}));

const harnessCases = CASES.filter(({ body }) => body.kind === "harness");
const classifyCases = CASES.filter(({ body }) => body.kind === "classify");

const newAjv = (): Ajv => new Ajv({ allErrors: true, strict: true });

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeManifest(permissions: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "sdk-sandbox-corpus-"));
  tempDirs.push(dir);
  const path = join(dir, "nimbus.extension.json");
  writeFileSync(path, JSON.stringify({ id: "corpus.case", permissions }));
  return path;
}

/** Replay one harness case against the real decision logic with a recording stub. */
async function runHarnessCase(body: SandboxCase): Promise<{
  calls: ExpectedCall[];
  outcome: "pass" | "throw";
  message: string;
}> {
  const calls: ExpectedCall[] = [];
  const results = body.probeResults ?? {};
  const runProbe: ProbeRunner = (probe, arg): ProbeResult => {
    calls.push({ probe, arg });
    const status = results[probe];
    if (status === undefined) {
      throw new Error(`case does not declare a probeResults entry for ${probe}`);
    }
    return { status, stderr: "", stdout: "" };
  };
  const manifestPath = writeManifest(body.permissions);
  try {
    await runSandboxContractTests(manifestPath, {
      runProbe,
      ...(body.platform === undefined ? {} : { platform: body.platform }),
    });
    return { calls, outcome: "pass", message: "" };
  } catch (e) {
    return { calls, outcome: "throw", message: e instanceof Error ? e.message : String(e) };
  }
}

describe("sandbox guard — the published protocol", () => {
  test("validates against its own schema", () => {
    const ajv = newAjv();
    const validate = ajv.compile(PROTOCOL_SCHEMA);
    expect(validate(PROTOCOL), `${PROTOCOL_PATH}: ${ajv.errorsText(validate.errors)}`).toBe(true);
  });

  test("its $id resolves to its own repository path", () => {
    expect(PROTOCOL_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${PROTOCOL_SCHEMA_PATH}`);
  });

  test("declares exactly the exit codes the TypeScript implements", () => {
    const published = Object.fromEntries(PROTOCOL.exitCodes.map((e) => [e.name, e.code]));
    expect(
      published,
      `${PROTOCOL_PATH} and src/testing/sandbox-protocol.ts disagree on the exit codes`,
    ).toEqual({ ...SANDBOX_PROBE_EXIT });
  });

  test("declares exactly the probes the TypeScript implements, in the same order", () => {
    expect(PROTOCOL.probes.map((p) => p.name)).toEqual([...SANDBOX_PROBES]);
  });

  test("declares exactly the network-blocked error codes the TypeScript implements", () => {
    expect([...PROTOCOL.errorCodes.networkBlocked].sort()).toEqual(
      [...NETWORK_BLOCKED_CODES].sort(),
    );
  });

  test("declares exactly the fs-denied error codes the TypeScript implements", () => {
    expect([...PROTOCOL.errorCodes.fsDenied].sort()).toEqual([...FS_DENIED_CODES].sort());
  });

  test("publishes the invocation syntax, not just the codes", () => {
    // A binding using a "last wins" argument parser is quietly incompatible, so which
    // occurrence wins is part of the contract rather than an implementation detail.
    expect(PROTOCOL.invocation.probeFlag).toBe("--probe=");
    expect(PROTOCOL.invocation.argFlag).toBe("--arg=");
    expect(PROTOCOL.invocation.repeated).toBe("first");
  });
});

describe("sandbox guard — the corpus", () => {
  test("the index validates against its own schema", () => {
    const ajv = newAjv();
    const validate = ajv.compile(INDEX_SCHEMA);
    expect(validate(INDEX), `${INDEX_PATH}: ${ajv.errorsText(validate.errors)}`).toBe(true);
  });

  test("both corpus schemas' $ids resolve to their own repository paths", () => {
    expect(INDEX_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${INDEX_SCHEMA_PATH}`);
    expect(CASE_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${CASE_SCHEMA_PATH}`);
  });

  test("is not empty — an empty corpus would make every assertion below vacuous", () => {
    expect(harnessCases.length).toBeGreaterThan(8);
    expect(classifyCases.length).toBeGreaterThan(8);
  });

  test("every case validates against the case schema", () => {
    const ajv = newAjv();
    const validate = ajv.compile(CASE_SCHEMA);
    const invalid = CASES.map(({ entry, body }) =>
      validate(body) ? null : `${entry.file}: ${ajv.errorsText(validate.errors)}`,
    ).filter((m): m is string => m !== null);
    expect(invalid).toEqual([]);
  });

  test("every case file on disk is listed in the index", () => {
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => `cases/${f}`)
      .sort();
    expect(
      INDEX.cases.map((c) => c.file).sort(),
      "a case on disk that no index lists is a case no runner executes",
    ).toEqual(onDisk);
  });

  test("the index points at the normative document the corpus is the executable form of", () => {
    expect(INDEX.spec).toBe("../../../probe/v1/sandbox-probe.md");
  });
});

describe("sandbox guard — the harness decision table", () => {
  test("the corpus exercises both outcomes", () => {
    expect(harnessCases.some(({ body }) => body.expect?.outcome === "pass")).toBe(true);
    expect(harnessCases.some(({ body }) => body.expect?.outcome === "throw")).toBe(true);
  });

  test("the harness makes exactly the calls each case declares, in order", async () => {
    const disagreed: string[] = [];
    for (const { entry, body } of harnessCases) {
      const actual = await runHarnessCase(body);
      const expectedCalls = JSON.stringify(body.expect?.calls ?? []);
      if (JSON.stringify(actual.calls) !== expectedCalls) {
        disagreed.push(
          `${entry.file}: expected calls ${expectedCalls}, got ${JSON.stringify(actual.calls)}`,
        );
      }
    }
    expect(disagreed).toEqual([]);
  });

  test("the harness reaches the outcome each case declares", async () => {
    const disagreed: string[] = [];
    for (const { entry, body } of harnessCases) {
      const actual = await runHarnessCase(body);
      if (actual.outcome !== body.expect?.outcome) {
        disagreed.push(
          `${entry.file}: expected ${body.expect?.outcome}, got ${actual.outcome} ` +
            `${actual.message}`,
        );
      }
    }
    expect(disagreed).toEqual([]);
  });

  test("a throwing case names the probe it blames", async () => {
    const disagreed: string[] = [];
    for (const { entry, body } of harnessCases) {
      const failing = body.expect?.failingProbe;
      if (failing === undefined) {
        continue;
      }
      const actual = await runHarnessCase(body);
      if (!actual.message.includes(failing)) {
        disagreed.push(`${entry.file}: message does not name ${failing} — ${actual.message}`);
      }
    }
    expect(disagreed).toEqual([]);
  });

  test("every published probe is invoked by at least one case", () => {
    const invoked = new Set(
      harnessCases.flatMap(({ body }) => (body.expect?.calls ?? []).map((c) => c.probe)),
    );
    const uncovered = SANDBOX_PROBES.filter((p) => !invoked.has(p));
    expect(
      uncovered,
      `these probes are published but no case invokes them: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  test("no case invokes a probe the protocol does not publish", () => {
    const published = new Set<string>(SANDBOX_PROBES);
    const unknown = [
      ...new Set(
        harnessCases
          .flatMap(({ body }) => (body.expect?.calls ?? []).map((c) => c.probe))
          .filter((p) => !published.has(p)),
      ),
    ].sort();
    expect(unknown, `cases invoke unpublished probes: ${unknown.join(", ")}`).toEqual([]);
  });
});

describe("sandbox guard — the errno classification", () => {
  test("the reference implementation agrees with every classify case", () => {
    const disagreed = classifyCases
      .map(({ entry, body }) => {
        const code = body.code ?? undefined;
        const actual =
          body.classifier === "network" ? networkBlockedExit(code) : fsDeniedExit(code);
        return actual === body.expectExit
          ? null
          : `${entry.file}: expected exit ${body.expectExit}, got ${actual}`;
      })
      .filter((m): m is string => m !== null);
    expect(disagreed).toEqual([]);
  });

  test("the corpus exercises both classifiers, and both answers for each", () => {
    for (const classifier of ["network", "filesystem"] as const) {
      const forClassifier = classifyCases.filter(({ body }) => body.classifier === classifier);
      expect(forClassifier.length, `no ${classifier} classify cases`).toBeGreaterThan(2);
      expect(
        forClassifier.some(({ body }) => body.expectExit !== SANDBOX_PROBE_EXIT.unexpected),
        `${classifier} has no case that maps`,
      ).toBe(true);
      expect(
        forClassifier.some(({ body }) => body.expectExit === SANDBOX_PROBE_EXIT.unexpected),
        `${classifier} has no case that must NOT map — the check would pass by always mapping`,
      ).toBe(true);
    }
  });

  test("every published error code is exercised by at least one case", () => {
    const exercised = new Set(
      classifyCases.map(({ body }) => `${body.classifier}:${body.code ?? "(none)"}`),
    );
    const uncovered = [
      ...[...NETWORK_BLOCKED_CODES].map((c) => `network:${c}`),
      ...[...FS_DENIED_CODES].map((c) => `filesystem:${c}`),
    ].filter((k) => !exercised.has(k));
    expect(
      uncovered,
      `these published error codes have no case: ${uncovered.join(", ")} — an errno with no ` +
        "fixture is an errno no binding is actually held to",
    ).toEqual([]);
  });

  test("the absent-code case is present, because that is what made the Bun defect silent", () => {
    const absent = classifyCases.filter(({ body }) => body.code === null);
    expect(absent.length).toBeGreaterThan(1);
  });
});
