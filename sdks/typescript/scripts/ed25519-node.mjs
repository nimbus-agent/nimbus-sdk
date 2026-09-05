/**
 * Runs the manifest-signature conformance corpus against the published package under
 * plain Node.
 *
 * The Bun guard (`manifest-signature-guard.test.ts`) proves `src/` conforms. This proves
 * the artifact consumers actually receive conforms, on the runtime they actually run — and
 * the two are not the same claim here in a way they are not for most corpora: signing and
 * verification bottom out in the runtime's Ed25519, and Bun ships BoringSSL where Node
 * ships OpenSSL. The two agree today — every value in this corpus was measured across both
 * before it was written — and a Bun-only suite is structurally incapable of noticing if
 * they stop. RFC 8032 leaves several of the edge cases this corpus pins (a non-canonical S,
 * a small-order public key) to the implementation's own strictness, which is precisely the
 * class of disagreement two libraries drift into.
 *
 * Imports by package name so resolution goes through the `exports` map, exactly as
 * `smoke-esm.mjs` does. Requires `bun run build` (or a downloaded dist/ artifact) first.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  base64urlDecode,
  base64urlEncode,
  jwkThumbprint,
  SignatureError,
  signManifest,
  verifyManifestSignature,
} from "@nimbus-dev/sdk/signing";

// scripts/ -> sdks/typescript/ -> sdks/ -> repo root. Kept as a URL (not paths.ts) because
// this file is loaded by plain Node, which cannot import the TypeScript helper.
const CORPUS_URL = new URL(
  "../../../docs/spec/conformance/v1/manifest-signature/",
  import.meta.url,
);

/** Repo-relative, for error messages a reader can paste into an editor. */
const CORPUS_DIR = "docs/spec/conformance/v1/manifest-signature";

const readCorpusJson = (relative) =>
  JSON.parse(readFileSync(new URL(relative, CORPUS_URL), "utf8"));

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (s) => new Uint8Array((s.match(/../g) ?? []).map((p) => Number.parseInt(p, 16)));

// Inline rather than imported: this file runs under plain `node`, which cannot load the
// TypeScript recorder. Same envelope, same filename convention — the reconciler unions this
// with the guard's report.
function writeConformanceReport(executed) {
  const dir = process.env["NIMBUS_CONFORMANCE_REPORT"];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "typescript.manifest-signature.node.json"),
    JSON.stringify({
      language: "typescript",
      corpus: "manifest-signature",
      producer: "node",
      executed: [...new Set(executed)].sort(),
    }),
    "utf8",
  );
}

async function run(body) {
  switch (body.kind) {
    case "base64url":
      return body.mode === "encode"
        ? base64urlEncode(fromHex(body.input))
        : toHex(base64urlDecode(body.input));
    case "thumbprint":
      return await jwkThumbprint(body.jwk);
    case "ed25519": {
      // The primitive, not the package: §7 delegates to the runtime, and the runtime is
      // exactly what this kind is holding to account under Node rather than Bun.
      let key;
      try {
        key = await crypto.subtle.importKey(
          "raw",
          fromHex(body.publicKey),
          { name: "Ed25519" },
          false,
          ["verify"],
        );
      } catch {
        // An unimportable public key is a failed verification, not an error: RFC 8032's
        // rejected encodings are exactly the ones a runtime may refuse at import instead.
        return false;
      }
      return await crypto.subtle.verify(
        "Ed25519",
        key,
        fromHex(body.signature),
        fromHex(body.message),
      );
    }
    case "verify":
      await verifyManifestSignature(body.manifest, body.trustedKeys);
      return true;
    case "sign": {
      const envelope = await signManifest(body.manifest, body.privateKey);
      return { protected: envelope.protected, signature: envelope.signature };
    }
    default:
      throw new Error(`unknown kind ${body.kind}`);
  }
}

/** Structural equality, enough for the `ok` payloads this corpus carries. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const index = readCorpusJson("index.json");
const failures = [];
const executed = [];

for (const entry of index.cases) {
  const body = readCorpusJson(entry.file);
  const where = `${entry.file} (manifest-signature.md ${entry.section})`;
  if (body.expect.rejected === undefined) {
    let actual;
    try {
      actual = await run(body);
    } catch (error) {
      failures.push(`${where} — expected ok, threw ${error}`);
      continue;
    }
    if (!same(actual, body.expect.ok)) {
      failures.push(
        `${where} — expected ${JSON.stringify(body.expect.ok)}, got ${JSON.stringify(actual)}`,
      );
      continue;
    }
  } else {
    let caught;
    try {
      await run(body);
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof SignatureError)) {
      failures.push(`${where} — expected ${body.expect.rejected}, got ${caught ?? "no rejection"}`);
      continue;
    }
    if (caught.reason !== body.expect.rejected) {
      failures.push(`${where} — expected ${body.expect.rejected}, got ${caught.reason}`);
      continue;
    }
    if (
      body.expect.canonicalizationReason !== undefined &&
      caught.canonicalizationReason !== body.expect.canonicalizationReason
    ) {
      failures.push(
        `${where} — expected canonicalization reason ${body.expect.canonicalizationReason}, got ${caught.canonicalizationReason}`,
      );
      continue;
    }
  }
  process.stdout.write(`ok   ${entry.file}\n`);
  executed.push(entry.file);
}

writeConformanceReport(executed);

if (index.cases.length === 0) {
  failures.push(`${CORPUS_DIR}/index.json listed no cases — an empty corpus proves nothing`);
}

// The kind this file exists for. A corpus edit that removed every ed25519 case would leave
// this runner green while proving nothing about BoringSSL against OpenSSL.
const ed25519Count = index.cases
  .map((entry) => readCorpusJson(entry.file))
  .filter((body) => body.kind === "ed25519").length;
if (ed25519Count === 0) {
  failures.push("the corpus carries no ed25519 case — this runner's whole reason for existing");
}

if (failures.length > 0) {
  process.stderr.write(
    `\n${failures.length} manifest-signature conformance failure(s) under Node ${process.version}:\n`,
  );
  for (const failure of failures) {
    process.stderr.write(`  FAIL ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `\nall ${index.cases.length} manifest-signature cases conformed under Node ${process.version} (${ed25519Count} of them raw Ed25519)\n`,
);
