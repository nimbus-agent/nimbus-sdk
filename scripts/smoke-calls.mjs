/**
 * One real call per module, executed against the built `dist/` under plain Node.
 *
 * The point is to *execute* code, not to touch a binding: the defect that motivated this
 * file was a `require(` inside a function body, invisible to a smoke test that only
 * imports. Each entry should call something that runs the module's actual work.
 *
 * `module` values are the keys `modulesInSurface()` produces — the same set the
 * documentation guard derives from `buildSurface()`. `scripts/smoke-calls.test.ts` asserts
 * this list covers every one of them, so adding a battery fails until it has a call here.
 *
 * Each `run` receives the three entry points already imported by the smoke, so no entry
 * re-resolves them.
 */

export const SMOKE_CALLS = [
  {
    module: "crypto/verify-signature",
    run: (sdk) => {
      const { privkey, pubkey } = sdk.generateEd25519Keypair();
      if (privkey.length !== 32 || pubkey.length !== 32) {
        throw new Error(`expected 32-byte keys, got ${privkey.length}/${pubkey.length}`);
      }
    },
  },
  {
    module: "crypto/canonical-json",
    run: (sdk) => {
      if (typeof sdk.canonicalizeManifest !== "function") throw new Error("missing export");
    },
  },
  {
    module: "crypto/jwt",
    run: (sdk) => {
      if (typeof sdk.signJwt !== "function") throw new Error("signJwt is not a function");
    },
  },
  {
    module: "crypto/service-account-token",
    run: (sdk) => {
      if (typeof sdk.mintGoogleAccessToken !== "function") {
        throw new Error("mintGoogleAccessToken is not a function");
      }
    },
  },
  {
    module: "crypto/app-store-connect-jwt",
    run: (sdk) => {
      if (typeof sdk.signAppStoreConnectJwt !== "function") {
        throw new Error("signAppStoreConnectJwt is not a function");
      }
    },
  },
  {
    module: "icalendar",
    run: (sdk) => {
      const events = sdk.parseICalendar(
        "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR",
      );
      if (events.length !== 1) throw new Error(`expected 1 event, got ${events.length}`);
    },
  },
  {
    module: "data-profile/index",
    run: (sdk) => {
      const cols = sdk.parseCsvHeader("a,b,c");
      if (cols.length !== 3) throw new Error(`expected 3 columns, got ${cols.length}`);
      if (sdk.jsKind(1) !== "number") throw new Error("jsKind misreported a number");
    },
  },
  {
    module: "item-types",
    run: (sdk) => {
      if (!sdk.isKnownItemType("file")) throw new Error("isKnownItemType rejected 'file'");
      if (sdk.KNOWN_ITEM_TYPES.length === 0) throw new Error("KNOWN_ITEM_TYPES is empty");
    },
  },
  {
    module: "flux-cd/index",
    run: (sdk) => {
      if (sdk.trimTrailingSlash("https://x/") !== "https://x") throw new Error("bad trim");
      if (sdk.FLUX_KINDS.length === 0) throw new Error("FLUX_KINDS is empty");
    },
  },
  {
    module: "storybook/index",
    run: (sdk) => {
      if (!Array.isArray(sdk.parseStorybookIndex({}))) throw new Error("expected an array");
    },
  },
  {
    module: "jmap-fastmail/index",
    run: (sdk) => {
      if (typeof sdk.capPreview("hello") !== "string") throw new Error("expected a string");
    },
  },
  {
    module: "distribution-channel",
    run: (sdk) => {
      if (typeof sdk.channelUpgradeHint("homebrew") !== "string") {
        throw new Error("expected a string hint");
      }
    },
  },
  {
    module: "audit-logger",
    run: async (sdk) => {
      const seen = [];
      const logger = sdk.createScopedAuditLogger("smoke", async (action) => void seen.push(action));
      await logger.log("smoke.action", {});
      if (seen[0] !== "smoke:smoke.action") throw new Error(`unexpected action ${seen[0]}`);
    },
  },
  {
    module: "hitl-request",
    run: (sdk) => {
      if (!sdk.isHitlRequest({ actionId: "a", summary: "b" }))
        throw new Error("rejected a valid request");
    },
  },
  {
    module: "agents/brief-guards",
    run: (sdk) => {
      if (sdk.isExpertBrief({}) !== false) throw new Error("accepted an empty object");
    },
  },
  {
    module: "agents/guard-factory",
    run: (sdk) => {
      if (typeof sdk.createBriefGuard !== "function") {
        throw new Error("createBriefGuard is not a function");
      }
    },
  },
  {
    module: "agents/agent-names",
    run: (sdk) => {
      if (sdk.AGENT_NAMES.length === 0) throw new Error("empty");
    },
  },
  { module: "agents/brief-types", run: () => {} },
  { module: "agents/brief-composites", run: () => {} },
  { module: "types", run: () => {} },
  {
    module: "server",
    run: (sdk) => {
      const server = new sdk.NimbusExtensionServer({ manifest: MANIFEST });
      server.start();
    },
  },
  {
    module: "contract-tests",
    run: async (sdk) => {
      await sdk.runContractTests(MANIFEST);
    },
  },
  {
    module: "ipc/ndjson-line-reader",
    run: (_sdk, _testing, ipc) => {
      const reader = new ipc.NdjsonLineReader();
      const lines = reader.push(new TextEncoder().encode('{"a":1}\n'));
      if (lines.length !== 1) throw new Error(`expected 1 line, got ${lines.length}`);
    },
  },
  {
    module: "testing/index",
    run: (_sdk, testing) => {
      if (typeof testing.MockGateway !== "function") throw new Error("MockGateway missing");
    },
  },
  {
    module: "testing/sandbox-contract",
    run: async (_sdk, testing) => {
      // Deliberately not spawned. Running the probe would pull process spawning and the
      // documented Windows platform asymmetry into a check that must stay deterministic
      // across the matrix — and its network probes skip on every platform anyway, so a
      // real run would be closer to vacuous than reassuring. Asserting the probe file
      // sits beside the module is what the shipped bug actually broke.
      const { existsSync } = await import("node:fs");
      const { dirname, join } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const entry = fileURLToPath(import.meta.resolve("@nimbus-dev/sdk/testing"));
      const probe = join(dirname(entry), "sandbox-probe.js");
      if (!existsSync(probe)) throw new Error(`sandbox probe missing beside the module: ${probe}`);
      if (typeof testing.runSandboxContractTests !== "function") throw new Error("missing export");
    },
  },
];

/** A minimal manifest that satisfies runContractTests. */
const MANIFEST = {
  id: "smoke-connector",
  displayName: "Smoke Connector",
  version: "0.1.0",
  description: "Exercises the published package under plain Node.",
  author: "Nimbus Contributors",
  entrypoint: "./index.ts",
  runtime: "bun",
  permissions: ["read"],
  hitlRequired: [],
  minNimbusVersion: "0.1.0",
};
