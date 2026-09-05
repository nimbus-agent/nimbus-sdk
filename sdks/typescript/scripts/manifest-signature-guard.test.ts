/**
 * The executable form of `docs/spec/signing/v1/manifest-signature.md`.
 *
 * Validates the published schemas, holds the index and the directory to each other,
 * executes every case against the reference binding, and refuses to pass vacuously.
 *
 * Five kinds, because the document has five separable assertions — §4's codec, §5's
 * thumbprint, §7's primitive, §8's ordered algorithm and §9's signer. The `ed25519` kind
 * is the odd one: it exercises the RUNTIME's Ed25519 rather than anything this package
 * exports, which is why it is also run under plain Node by `ed25519-node.mjs`. Bun ships
 * BoringSSL and Node ships OpenSSL; they agree today, and a Bun-only suite is structurally
 * incapable of noticing if they stop.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  base64urlDecode,
  base64urlEncode,
  canonicalize,
  type Jwk,
  jwkThumbprint,
  type PrivateJwk,
  SIGNATURE_REASONS,
  SignatureError,
  signManifest,
  verifyManifestSignature,
} from "../src/signing/index.ts";
import { createRecorder } from "./conformance-report.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/signing/v1/manifest-signature.md";
const CORPUS_DIR = "docs/spec/conformance/v1/manifest-signature";
const KINDS = ["base64url", "thumbprint", "ed25519", "verify", "sign"] as const;
const PINNED_SECTIONS = ["§3", "§4", "§5", "§6", "§7", "§8", "§9"] as const;

type Kind = (typeof KINDS)[number];
type Expect = {
  ok?: unknown;
  rejected?: string;
  canonicalizationReason?: string;
  canonical?: string;
};
type Case = {
  description: string;
  kind: Kind;
  mode?: "encode" | "decode";
  input?: string;
  jwk?: Jwk;
  publicKey?: string;
  message?: string;
  signature?: string;
  manifest?: unknown;
  trustedKeys?: Jwk[];
  privateKey?: PrivateJwk;
  expect: Expect;
};
type IndexEntry = { file: string; section: string; reason: string };

const index = readJson(`${CORPUS_DIR}/index.json`) as { spec: string; cases: IndexEntry[] };
const cases: { entry: IndexEntry; body: Case }[] = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

const recorder = createRecorder("manifest-signature", "guard");
afterAll(() => recorder.flush());

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string): Uint8Array =>
  new Uint8Array((s.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)));

/**
 * The outcome a case asserts, as a comparable string.
 *
 * Not simply `expect.ok === undefined`: the `ed25519` kind never REFUSES — it returns a
 * verdict — so its two outcomes are `ok: true` and `ok: false`, and a both-outcomes rule
 * written against the presence of `rejected` would declare that kind half-covered forever.
 */
function outcome(body: Case): string {
  if (body.expect.rejected !== undefined) return `rejected:${body.expect.rejected}`;
  return body.kind === "ed25519" ? `ok:${String(body.expect.ok)}` : "ok";
}

/** Run one case, returning its `ok` payload or throwing a `SignatureError`. */
async function run(body: Case): Promise<unknown> {
  switch (body.kind) {
    case "base64url":
      return body.mode === "encode"
        ? base64urlEncode(fromHex(body.input ?? ""))
        : toHex(base64urlDecode(body.input ?? ""));
    case "thumbprint":
      return await jwkThumbprint(body.jwk as Jwk);
    case "ed25519": {
      // The primitive, not this package's surface: nothing under ./signing exports a raw
      // verify, and nothing should — §7 delegates to the runtime, and what this kind is
      // holding to account IS the runtime.
      let key: CryptoKey;
      try {
        key = await crypto.subtle.importKey(
          "raw",
          new Uint8Array(fromHex(body.publicKey ?? "")),
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
        new Uint8Array(fromHex(body.signature ?? "")),
        new Uint8Array(fromHex(body.message ?? "")),
      );
    }
    case "verify":
      await verifyManifestSignature(body.manifest as object, body.trustedKeys ?? []);
      return true;
    case "sign":
      return await signManifest(body.manifest as object, body.privateKey as PrivateJwk);
  }
}

describe("published artifacts", () => {
  test("the spec document exists and is normative", () => {
    const text = readText(SPEC_PATH);
    expect(text).toContain("**Status:** normative");
    expect(text).toContain("RFC 2119");
  });

  test("the index validates against its own schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(`${CORPUS_DIR}/index.schema.json`) as object);
    expect(validate(index), JSON.stringify(validate.errors)).toBe(true);
  });

  test("every case validates against the case schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(`${CORPUS_DIR}/case.schema.json`) as object);
    for (const { entry, body } of cases) {
      expect(validate(body), `${entry.file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  test("the index and the cases directory hold each other", () => {
    // A case on disk that no index lists is a case no runner executes — the corpus would
    // report it as covered while testing nothing.
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases")).sort();
    const indexed = index.cases.map((c) => c.file.replace("cases/", "")).sort();
    expect(indexed).toEqual(onDisk);
  });
});

describe("the corpus cannot pass vacuously", () => {
  test("it is non-empty", () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
  });

  test("every declared kind has at least one case", () => {
    for (const kind of KINDS) {
      expect(
        cases.filter(({ body }) => body.kind === kind).length,
        `kind ${kind} has no case`,
      ).toBeGreaterThan(0);
    }
  });

  test("every kind exercises both outcomes", () => {
    for (const kind of KINDS) {
      const outcomes = new Set(
        cases.filter(({ body }) => body.kind === kind).map(({ body }) => outcome(body)),
      );
      expect(
        outcomes.size,
        `kind ${kind} only ever expects ${[...outcomes].join(", ")}`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  test("every one of §10's ten tokens is expected by at least one verify case", () => {
    // §10's set is closed at ten and §8 reaches every one of them. A token no verify case
    // asserts is a step whose ORDER is unpinned, which is the one class of divergence this
    // document exists to prevent — every ordering above verifies the same valid signatures
    // and differs only in which token an invalid manifest reports.
    const asserted = new Set(
      cases
        .filter(({ body }) => body.kind === "verify" && body.expect.rejected !== undefined)
        .map(({ body }) => body.expect.rejected as string),
    );
    expect([...asserted].sort()).toEqual([...SIGNATURE_REASONS].sort());
  });

  test("both base64url modes are exercised", () => {
    const modes = new Set(
      cases.filter(({ body }) => body.kind === "base64url").map(({ body }) => body.mode),
    );
    expect([...modes].sort()).toEqual(["decode", "encode"]);
  });

  test("§5's worked example pins the 79 canonical octets, not only the digest", () => {
    // A binding can reach the right digest by the wrong serialization only if the input is
    // never asserted. §5 prints the octets; at least one case must carry them.
    const withCanonical = cases.filter(
      ({ body }) => body.kind === "thumbprint" && body.expect.canonical !== undefined,
    );
    expect(
      withCanonical.length,
      "no thumbprint case pins §5's canonical projection",
    ).toBeGreaterThan(0);
    const example = withCanonical.find(
      ({ body }) => body.expect.ok === "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k",
    );
    expect(example, "no case carries RFC 8037 §2's published thumbprint").toBeDefined();
    expect((example?.body.expect.canonical?.length ?? 0) / 2).toBe(79);
  });

  test("the ed25519 kind pins a non-canonical S, not only bad public keys", () => {
    // Every other ed25519 negative is a rejected public-key encoding, which a runtime
    // refuses at import. S outside [0, L) is the one that reaches the verification
    // routine itself, and RFC 8032 §5.1.7 is what requires refusing it.
    const vector1 = cases.find(
      ({ body }) =>
        body.kind === "ed25519" &&
        body.publicKey === "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a" &&
        body.expect.ok === true,
    );
    expect(vector1, "RFC 8032 §7.1 TEST 1 is absent").toBeDefined();
    const malleable = cases.find(
      ({ body }) =>
        body.kind === "ed25519" &&
        body.expect.ok === false &&
        body.publicKey === vector1?.body.publicKey &&
        body.signature !== vector1?.body.signature &&
        body.signature?.slice(0, 64) === vector1?.body.signature?.slice(0, 64),
    );
    expect(
      malleable,
      "no case shares TEST 1's R with a different S — nothing pins RFC 8032 §5.1.7",
    ).toBeDefined();
  });

  test("§8's kid-beats-alg ordering is pinned in both directions", () => {
    // One case is not enough. A binding that DROPPED step 8 passes the unknown-kid case;
    // one that HOISTED step 8 passes the known-kid case. Only the pair pins the order.
    const byFile = new Map(cases.map(({ entry, body }) => [entry.file, body]));
    const unknown = byFile.get("cases/verify-kid-unknown-beats-alg-unsupported.json");
    const known = byFile.get("cases/verify-known-kid-with-bogus-alg-reaches-alg-unsupported.json");
    expect(unknown?.expect.rejected).toBe("kid-unknown");
    expect(known?.expect.rejected).toBe("alg-unsupported");
  });

  test("every pinnable section is cited by at least one case", () => {
    const cited = new Set(index.cases.map((c) => c.section));
    for (const section of PINNED_SECTIONS) {
      expect(cited.has(section), `no case cites ${section}`).toBe(true);
    }
  });

  test("every case cites a section the document actually has", () => {
    const text = readText(SPEC_PATH);
    for (const entry of index.cases) {
      expect(text.includes(`## ${entry.section} `), `${entry.file} cites a missing section`).toBe(
        true,
      );
    }
  });

  test("the §5 canonicalization reuse is a reuse, not a coincidence", () => {
    // §5 step 2 says to canonicalize the projection rather than hand-roll a second
    // serializer. If canonicalize ever stopped producing RFC 7638's form for a three-member
    // ASCII-keyed object, every thumbprint in this corpus would move at once.
    expect(
      canonicalize({
        crv: "Ed25519",
        kty: "OKP",
        x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
      }),
    ).toBe('{"crv":"Ed25519","kty":"OKP","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}');
  });
});

describe("the reference binding satisfies every case", () => {
  for (const { entry, body } of cases) {
    test(`${entry.file}: ${body.description}`, async () => {
      if (body.expect.rejected === undefined) {
        expect(await run(body)).toEqual(body.expect.ok);
        recorder.record(entry.file);
        return;
      }
      let caught: unknown;
      try {
        await run(body);
      } catch (err) {
        caught = err;
      }
      expect(caught, "expected a rejection, got none").toBeInstanceOf(SignatureError);
      const error = caught as SignatureError;
      expect(error.reason).toBe(body.expect.rejected as SignatureError["reason"]);
      if (body.expect.canonicalizationReason !== undefined) {
        expect(error.canonicalizationReason).toBe(
          body.expect.canonicalizationReason as NonNullable<
            SignatureError["canonicalizationReason"]
          >,
        );
      }
      recorder.record(entry.file);
    });
  }
});
