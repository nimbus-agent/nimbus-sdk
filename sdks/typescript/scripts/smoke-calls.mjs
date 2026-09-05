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
 * Each `run` receives the six entry points already imported by the smoke, so no entry
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
      const bytes = sdk.canonicalizeManifest(MANIFEST);
      if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        throw new Error(`canonicalizeManifest did not return canonical bytes: ${bytes}`);
      }
    },
  },
  {
    module: "crypto/jwt",
    run: (sdk) => {
      const encoded = sdk.base64UrlJson({ a: 1 });
      if (typeof encoded !== "string" || encoded.length === 0) {
        throw new Error(`base64UrlJson returned an unexpected value: ${encoded}`);
      }
    },
  },
  {
    module: "crypto/service-account-token",
    run: (sdk) => {
      const result = sdk.parseServiceAccountJson("{}");
      if (result !== null) throw new Error(`expected null for an empty object, got ${result}`);
    },
  },
  {
    module: "crypto/app-store-connect-jwt",
    // ES256 = ECDSA over P-256 (see the module's own docstring), and it takes a `.p8`
    // PEM — nothing Apple-issued. An ephemeral EC P-256 key generated on the spot satisfies
    // it, so this can be a real call rather than an existence check.
    run: async (sdk) => {
      const { generateKeyPairSync } = await import("node:crypto");
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
      const jwt = sdk.signAppStoreConnectJwt(
        { issuerId: "smoke-issuer", keyId: "smoke-key", privateKeyPem },
        1_700_000_000_000,
      );
      if (jwt.split(".").length !== 3) throw new Error(`expected a three-part JWT, got ${jwt}`);
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
      const guard = sdk.createBriefGuard("x", () => true);
      if (guard({}) !== false) throw new Error("createBriefGuard accepted an object with no kind");
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
    module: "contract-version",
    run: (sdk) => {
      const result = sdk.negotiateContractVersion(sdk.CONTRACT_VERSIONS, ["1"]);
      if (!result.ok || result.version !== "1") {
        throw new Error(`unexpected negotiation result: ${JSON.stringify(result)}`);
      }
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
    module: "ipc/hello",
    run: (_sdk, _testing, ipc) => {
      const frame = ipc.encodeHello(["1"]);
      const parsed = ipc.parseHello(frame);
      if (!parsed.ok || parsed.contractVersions[0] !== "1") {
        throw new Error(`unexpected parseHello result: ${JSON.stringify(parsed)}`);
      }
    },
  },
  {
    module: "ipc/handshake",
    run: async (_sdk, _testing, ipc) => {
      // The io is two in-memory callbacks — no pipe, no socket — matching the module's own
      // "streams are injected, never opened" contract.
      const io = {
        read: async () => new TextEncoder().encode('{"nimbus":"hello","contractVersions":["1"]}\n'),
        write: async () => {},
      };
      const result = await ipc.performHandshake(io);
      if (!result.ok || result.version !== "1") {
        throw new Error(`unexpected performHandshake result: ${JSON.stringify(result)}`);
      }
    },
  },
  {
    module: "testing/diagnostics-assert",
    run: (_sdk, testing) => {
      // Must not throw: every result is `ok: true`.
      testing.expectNoRejectedDiagnostics([{ ok: true, line: "{}" }]);

      // Must throw: at least one result is `ok: false`, which is the entire point of the
      // helper — a call site that swallows this exception is the require()-in-a-function-
      // body failure mode this file exists to catch, applied to this module.
      let threw = false;
      try {
        testing.expectNoRejectedDiagnostics([
          { ok: false, reason: "invalid-field-value", path: "/fields/user" },
        ]);
      } catch {
        threw = true;
      }
      if (!threw) throw new Error("expectNoRejectedDiagnostics did not throw on a refusal");
    },
  },
  {
    module: "testing/index",
    run: async (_sdk, testing) => {
      const result = await new testing.MockGateway().callTool("x", {});
      if (typeof result !== "object" || result === null || Object.keys(result).length !== 0) {
        throw new Error(`callTool returned an unexpected value: ${JSON.stringify(result)}`);
      }
    },
  },
  {
    module: "testing/sandbox-contract",
    run: async (_sdk, testing) => {
      // Deliberately not spawned. Running the probe would pull process spawning and the
      // documented Windows platform asymmetry into a check that must stay deterministic
      // across the matrix — and its network probes skip on every platform anyway, so a
      // real run would be closer to vacuous than reassuring.
      //
      // Calling probePath() itself — rather than re-deriving its expected filename here —
      // is what proves the fix: a pure-string unit test of probeFileNameFor and a separate
      // file-existence assertion don't prove probePath() actually calls it against its own
      // import.meta.url. Importing the built dist/ module directly (not through the
      // package-name-resolved barrel, since probePath is deliberately not in the `testing`
      // barrel) and calling the real function closes that gap.
      const { existsSync } = await import("node:fs");
      const mod = await import(new URL("../dist/testing/sandbox-contract.js", import.meta.url));
      const resolved = mod.probePath();
      if (!existsSync(resolved)) throw new Error(`probePath() → ${resolved} does not exist`);
      if (typeof testing.runSandboxContractTests !== "function") throw new Error("missing export");
    },
  },
  {
    module: "connector-kit/mcp-tool-kit",
    run: (_sdk, _testing, _ipc, connectorKit) => {
      const result = connectorKit.mcpJsonResult({ a: 1 });
      const expected = JSON.stringify({ a: 1 }, null, 2);
      if (result.content[0]?.text !== expected) {
        throw new Error(`mcpJsonResult produced an unexpected wrapper: ${JSON.stringify(result)}`);
      }
    },
  },
  {
    module: "connector-kit/fetch-bearer-json",
    run: (_sdk, _testing, _ipc, connectorKit) => {
      const resolved = connectorKit.resolveUrlWithBase("https://api.example.com", "/v1/x");
      if (resolved !== "https://api.example.com/v1/x") {
        throw new Error(`resolveUrlWithBase returned an unexpected value: ${resolved}`);
      }
    },
  },
  {
    module: "connector-kit/rest-tool-kit",
    run: (_sdk, _testing, _ipc, connectorKit) => {
      const fetcher = connectorKit.makeRestFetcher({
        apiBase: "https://api.example.com",
        token: "t",
      });
      if (typeof fetcher !== "function") {
        throw new Error("makeRestFetcher did not return a fetcher function");
      }
    },
  },
  {
    module: "connector-kit/search-filter",
    run: (_sdk, _testing, _ipc, connectorKit) => {
      const filter = connectorKit.makeQueryFilter(connectorKit.fieldsFromKeys(["name"]));
      const result = connectorKit.matchesResult(
        [{ name: "Revenue" }, { name: "Latency" }],
        filter,
        {
          query: "rev",
        },
      );
      const parsed = JSON.parse(result.content[0]?.text ?? "null");
      if (!Array.isArray(parsed?.matches) || parsed.matches.length !== 1) {
        throw new Error(`matchesResult produced an unexpected wrapper: ${JSON.stringify(result)}`);
      }
    },
  },
  {
    module: "diagnostics/event",
    run: (_sdk, _testing, _ipc, _connectorKit, diagnostics) => {
      const result = diagnostics.encodeDiagnostic({
        ts: "2026-08-01T12:00:00.000Z",
        level: "info",
        extensionId: "smoke",
        event: "smoke.run",
      });
      if (!result.ok) throw new Error(`encodeDiagnostic refused a valid event: ${result.reason}`);
    },
  },
  {
    module: "diagnostics/emitter",
    run: async (_sdk, _testing, _ipc, _connectorKit, diagnostics) => {
      const lines = [];
      const emitter = diagnostics.createEmitter("smoke", (line) => {
        lines.push(line);
      });
      if (typeof emitter.info !== "function") throw new Error("createEmitter returned no info()");
      const result = await emitter.info("smoke.run", { ts: "2026-08-01T12:00:00.000Z" });
      if (!result.ok || lines.length !== 1) {
        throw new Error(`createEmitter's info() did not emit a line: ${JSON.stringify(result)}`);
      }
    },
  },
  {
    module: "signing/canonical-json",
    run: (_sdk, _testing, _ipc, _connectorKit, _diagnostics, signing) => {
      const text = new TextDecoder().decode(
        signing.canonicalizeManifest({ b: 1, a: 2, signature: "dropped" }),
      );
      if (text !== '{"a":2,"b":1}') {
        throw new Error(`canonicalizeManifest produced ${text}`);
      }
    },
  },
  {
    module: "signing/base64url",
    // "QR" is the whole reason this codec is hand-rolled: Node's Buffer, CPython's base64
    // and Go's base64.RawURLEncoding all decode it to the same 0x41 as "QQ", silently
    // discarding non-zero trailing bits. Rejecting it is the behaviour worth executing.
    run: (_sdk, _testing, _ipc, _connectorKit, _diagnostics, signing) => {
      const encoded = signing.base64urlEncode(new Uint8Array([0x41]));
      if (encoded !== "QQ") throw new Error(`base64urlEncode produced ${encoded}`);
      const bytes = signing.base64urlDecode(encoded);
      if (bytes.length !== 1 || bytes[0] !== 0x41) {
        throw new Error(`base64urlDecode produced ${JSON.stringify([...bytes])}`);
      }
      let rejected = false;
      try {
        signing.base64urlDecode("QR");
      } catch (err) {
        rejected = err?.reason === "base64url-invalid";
      }
      if (!rejected) throw new Error('base64urlDecode accepted "QR" — trailing bits unchecked');
    },
  },
  {
    module: "signing/errors",
    run: (_sdk, _testing, _ipc, _connectorKit, _diagnostics, signing) => {
      if (signing.SIGNATURE_REASONS.length !== 10) {
        throw new Error(`SIGNATURE_REASONS has ${signing.SIGNATURE_REASONS.length} tokens, not 10`);
      }
      const error = new signing.SignatureError("canonicalization-failed", {
        canonicalizationReason: "non-integer-number",
      });
      if (error.reason !== "canonicalization-failed" || !(error instanceof Error)) {
        throw new Error(`SignatureError did not carry its reason: ${error.reason}`);
      }
      if (error.canonicalizationReason !== "non-integer-number") {
        throw new Error("SignatureError dropped the wrapped canonicalization reason");
      }
    },
  },
  {
    module: "signing/jwk",
    // RFC 8037 §A.3's key, and its RFC 7638 thumbprint. Pinned rather than merely
    // length-checked: a thumbprint that is deterministic but wrong still selects no key.
    run: async (_sdk, _testing, _ipc, _connectorKit, _diagnostics, signing) => {
      const thumbprint = await signing.jwkThumbprint({
        kty: "OKP",
        crv: "Ed25519",
        x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
        kid: "ignored — RFC 7638 hashes only crv, kty and x",
      });
      if (thumbprint !== "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k") {
        throw new Error(`jwkThumbprint produced ${thumbprint}`);
      }
    },
  },
  {
    module: "signing/jws",
    run: (_sdk, _testing, _ipc, _connectorKit, _diagnostics, signing) => {
      const kid = "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k";
      const encoded = signing.encodeProtectedHeader({ alg: "EdDSA", kid });
      const header = signing.parseProtectedHeader(encoded);
      if (header.kid !== kid || header.alg !== "EdDSA") {
        throw new Error(`parseProtectedHeader round trip lost members: ${JSON.stringify(header)}`);
      }
      const input = new TextDecoder().decode(signing.signingInput(encoded, new Uint8Array([0x41])));
      if (input !== `${encoded}.QQ`) throw new Error(`signingInput produced ${input}`);
    },
  },
  {
    module: "signing/manifest-signature",
    // Keygen, sign and verify in one round trip — the only way to prove WebCrypto's
    // Ed25519 is reachable from the built dist/ under plain Node.
    run: async (_sdk, _testing, _ipc, _connectorKit, _diagnostics, signing) => {
      const { privateKey, publicKey } = await signing.generateSigningKey();
      const manifest = { id: "smoke-connector", version: "0.1.0", publisher: { id: "nimbus" } };
      const envelope = await signing.signManifest(manifest, privateKey);
      if (typeof envelope.protected !== "string" || typeof envelope.signature !== "string") {
        throw new Error(`signManifest produced ${JSON.stringify(envelope)}`);
      }
      await signing.verifyManifestSignature({ ...manifest, signature: envelope }, [publicKey]);

      let rejected = false;
      try {
        await signing.verifyManifestSignature(
          { ...manifest, version: "0.1.1", signature: envelope },
          [publicKey],
        );
      } catch (err) {
        rejected = err?.reason === "signature-invalid";
      }
      if (!rejected) throw new Error("verifyManifestSignature accepted a mutated manifest");
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
