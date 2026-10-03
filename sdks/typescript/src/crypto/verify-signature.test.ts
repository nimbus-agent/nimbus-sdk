import { describe, expect, test } from "bun:test";

import { NonIntegerNumberInManifest } from "./canonical-json.js";
import {
  decodeBase64,
  encodeBase64,
  errorToHardDisableReason,
  generateEd25519Keypair,
  PublisherKeyMismatch,
  SignatureInvalid,
  SignatureInvalidFormat,
  signManifest,
  verifyManifestSignature,
} from "./verify-signature.js";

type Manifest = {
  publisher?: { id: string; key: string };
  signature?: string;
  [k: string]: unknown;
};

async function signedManifest(): Promise<{
  manifest: Manifest;
  pubkey: Uint8Array;
  privkey: Uint8Array;
}> {
  const { privkey, pubkey } = generateEd25519Keypair();
  const manifest: Manifest = {
    id: "com.example.demo",
    version: "1.0.0",
    publisher: { id: "demo", key: encodeBase64(pubkey) },
  };
  manifest.signature = await signManifest(manifest, privkey);
  return { manifest, pubkey, privkey };
}

describe("base64 round-trip", () => {
  test("encode then decode is identity", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(Array.from(decodeBase64(encodeBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

// Each case below is a contract a legacy caller depends on and that the `@nimbus-dev/sdk/signing`
// replacement does not reproduce: the wire alphabet, the error class that escapes, and the bytes
// a signature covers. They are why this deprecated module keeps calling its own deprecated
// members rather than the replacements those members name, under `NOSONAR S1874` markers.
describe("legacy contract the signing replacement does not share", () => {
  test("encodeBase64 and decodeBase64 use the standard alphabet with padding", () => {
    expect(encodeBase64(new Uint8Array([0xfb, 0xff]))).toBe("+/8=");
    expect(Array.from(decodeBase64("+/8="))).toEqual([0xfb, 0xff]);
  });

  test("a non-integer field rejects with NonIntegerNumberInManifest, not a SignatureError", async () => {
    const { manifest, pubkey, privkey } = await signedManifest();
    manifest["ratio"] = 1.5;
    await expect(verifyManifestSignature(manifest, pubkey)).rejects.toBeInstanceOf(
      NonIntegerNumberInManifest,
    );
    await expect(signManifest(manifest, privkey)).rejects.toBeInstanceOf(
      NonIntegerNumberInManifest,
    );
  });

  test("a signature covers NFC-normalized values, so re-normalizing one still verifies", async () => {
    // Built from code points rather than typed, so no editor can fold the two forms into one.
    const decomposed = `Cafe${String.fromCodePoint(0x301)}`;
    const precomposed = `Caf${String.fromCodePoint(0xe9)}`;
    expect(decomposed).not.toBe(precomposed);
    const { privkey, pubkey } = generateEd25519Keypair();
    const manifest: Manifest = {
      id: "com.example.demo",
      name: decomposed,
      publisher: { id: "demo", key: encodeBase64(pubkey) },
    };
    manifest.signature = await signManifest(manifest, privkey);
    manifest["name"] = precomposed;
    await expect(verifyManifestSignature(manifest, pubkey)).resolves.toBeUndefined();
  });
});

describe("verifyManifestSignature", () => {
  test("accepts a correctly signed manifest", async () => {
    const { manifest, pubkey } = await signedManifest();
    await expect(verifyManifestSignature(manifest, pubkey)).resolves.toBeUndefined();
  });
  test("throws SignatureInvalid when a field is tampered after signing", async () => {
    const { manifest, pubkey } = await signedManifest();
    manifest["version"] = "9.9.9";
    await expect(verifyManifestSignature(manifest, pubkey)).rejects.toBeInstanceOf(
      SignatureInvalid,
    );
  });
  test("throws PublisherKeyMismatch when resolved key differs from declared", async () => {
    const { manifest } = await signedManifest();
    const other = generateEd25519Keypair().pubkey;
    await expect(verifyManifestSignature(manifest, other)).rejects.toBeInstanceOf(
      PublisherKeyMismatch,
    );
  });
  test("throws SignatureInvalidFormat for a wrong-length resolved pubkey", async () => {
    const { manifest } = await signedManifest();
    await expect(verifyManifestSignature(manifest, new Uint8Array(31))).rejects.toBeInstanceOf(
      SignatureInvalidFormat,
    );
  });
  test("throws SignatureInvalidFormat for a wrong-length declared pubkey", async () => {
    const { manifest, pubkey } = await signedManifest();
    manifest.publisher = { id: "demo", key: encodeBase64(new Uint8Array(31)) };
    await expect(verifyManifestSignature(manifest, pubkey)).rejects.toBeInstanceOf(
      SignatureInvalidFormat,
    );
  });
  test("throws SignatureInvalidFormat for a wrong-length signature", async () => {
    const { manifest, pubkey } = await signedManifest();
    manifest.signature = encodeBase64(new Uint8Array(63));
    await expect(verifyManifestSignature(manifest, pubkey)).rejects.toBeInstanceOf(
      SignatureInvalidFormat,
    );
  });
  test("throws when manifest is unsigned (no publisher / no signature)", async () => {
    const { pubkey } = await signedManifest();
    await expect(verifyManifestSignature({ id: "x" }, pubkey)).rejects.toThrow(/unsigned manifest/);
  });
  test("throws when publisher is present but signature is missing", async () => {
    const pubkey = generateEd25519Keypair().pubkey;
    await expect(
      verifyManifestSignature(
        { id: "x", publisher: { id: "p", key: encodeBase64(pubkey) } },
        pubkey,
      ),
    ).rejects.toThrow(/unsigned manifest/);
  });
  test("throws when signature is present but publisher is missing", async () => {
    const pubkey = generateEd25519Keypair().pubkey;
    await expect(verifyManifestSignature({ id: "x", signature: "AA==" }, pubkey)).rejects.toThrow(
      /unsigned manifest/,
    );
  });
});

describe("signManifest", () => {
  test("throws SignatureInvalidFormat for a non-32-byte private key", async () => {
    await expect(signManifest({ id: "x" }, new Uint8Array(16))).rejects.toBeInstanceOf(
      SignatureInvalidFormat,
    );
  });
});

describe("errorToHardDisableReason", () => {
  test("maps each error class to its reason", () => {
    expect(errorToHardDisableReason(new PublisherKeyMismatch())).toBe("publisher_key_mismatch");
    expect(errorToHardDisableReason(new SignatureInvalidFormat())).toBe("signature_malformed");
    expect(errorToHardDisableReason(new SignatureInvalid())).toBe("signature_failed");
    expect(errorToHardDisableReason(new Error("unknown"))).toBe("signature_failed");
  });
});
