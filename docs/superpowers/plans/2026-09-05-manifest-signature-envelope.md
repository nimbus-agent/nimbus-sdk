# Manifest Signature Envelope (RFC-0020 S2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the detached JWS envelope — a normative spec, a fourteenth conformance corpus, and the `base64url` / `jwk` / `jws` / `manifest-signature` surface in TypeScript and Go, with Python binding the pure layer only.

**Architecture:** A new normative document `docs/spec/signing/v1/manifest-signature.md` defines a ten-step verification algorithm and a closed ten-token rejection set. Each binding implements it against one shared corpus. TypeScript is the reference and uses WebCrypto (async); Go uses `crypto/ed25519` (sync); Python ships only the pure encoding layer in this shipment and defers the three crypto corpus kinds to S3.

**Tech Stack:** TypeScript (Bun, `tsc --noEmit` strict, Biome), Go 1.26 (stdlib only), Python 3 (ruff + mypy strict, stdlib only). Zero runtime dependencies in all three.

**Spec:** [`docs/superpowers/specs/2026-09-05-manifest-signature-envelope-design.md`](../specs/2026-09-05-manifest-signature-envelope-design.md) — read it before Task 1. Its review sibling records the findings this plan already incorporates.

## Global Constraints

- **Zero runtime dependencies.** No `dependencies` in `package.json`; `[project].dependencies` in `pyproject.toml` stays empty; `sdks/go/go.mod` keeps no `require` block. Inline any helper you need.
- **No `any` in TypeScript.** Strict mode. Use `unknown` at boundaries and narrow with a type guard. Biome enforces `noExplicitAny` and `noConsole` in `sdks/typescript/src/`.
- **No `node:` imports in the new modules.** `crypto.subtle` is a global. Only three files in the published TypeScript surface import a `node:` builtin today and none of them may become four.
- **Every export is `experimental`.** TypeScript: `/** @moduleStability experimental */` placed **immediately above the module's first `export`**, never above an `import` — `tsc` elides an unused import together with its leading JSDoc. Python: `__stability__ = "experimental"`. Go: `// Stability: experimental` inside the package doc comment (already present on `signing`; do not add a second).
- **Closed sets are closed.** The ten rejection tokens are exactly: `envelope-malformed`, `base64url-invalid`, `protected-malformed`, `crit-unsupported`, `protected-unknown-member`, `kid-unknown`, `key-unsupported`, `alg-unsupported`, `canonicalization-failed`, `signature-invalid`. Never invent an eleventh.
- **Tests live beside source** as `*.test.ts` in `sdks/typescript/src/`.
- **PR title must be `feat(signing): …`** — `commit-guard` reads the pull request title and diffs all three API-surface goldens.
- **Reinstall Python before pytest.** `cd sdks/python && python -m pip install -e .` after *any* edit under `docs/spec/`, or the suite reads the stale `_data/spec` snapshot and passes while executing none of your cases.
- **Measured constants — do not recompute or "correct" these.** RFC 8037 thumbprint of `{"crv":"Ed25519","kty":"OKP","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}` is `kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k`. All four runtimes (bun 1.3.14, node 24.18.1, go 1.26.7, go 1.27.0) return `false` for the seven Ed25519 edge-case vectors in Task 6 and `true` for RFC 8032 §7.1's three.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `docs/spec/signing/v1/manifest-signature.md` | The normative contract: envelope, strict base64url, thumbprint, header, signing input, the ten-step algorithm, the closed token set |
| `docs/spec/conformance/v1/manifest-signature/{index,index.schema,case.schema}.json` + `cases/*.json` | The executable form of that document |
| `sdks/typescript/src/signing/errors.ts` | `SignatureError`, `SignatureReason`, `SIGNATURE_REASONS` |
| `sdks/typescript/src/signing/base64url.ts` | §4 strict encode/decode |
| `sdks/typescript/src/signing/jwk.ts` | §5 `Jwk`, `PrivateJwk`, `jwkThumbprint` |
| `sdks/typescript/src/signing/jws.ts` | §6–§7 header codec and signing input |
| `sdks/typescript/src/signing/manifest-signature.ts` | §8–§9 sign, verify, keygen |
| `sdks/typescript/scripts/manifest-signature-guard.test.ts` | The corpus runner and its anti-vacuity assertions |
| `sdks/typescript/scripts/ed25519-node.mjs` | The Node companion — Bun alone cannot see a BoringSSL/OpenSSL split |
| `sdks/go/signing/{errors,base64url,jwk,jws,manifestsignature}.go` + tests | The Go binding, one package |
| `sdks/go/conformance/manifestsignature_test.go` | Go's corpus runner |
| `sdks/python/src/nimbus_sdk/signing/{errors,base64url,jwk,jws}.py` | Python's pure layer |
| `sdks/python/tests/test_manifest_signature_corpus.py` | Python's runner plus the deferral-consistency test |
| `docs/modules/manifest-signature.md` | The capability page for the crypto module — claims no Python file, so the matrix renders `—` |

**Modified**

`sdks/typescript/src/signing/index.ts` · `sdks/go/signing/canonicaljson.go` (rename) · `sdks/python/src/nimbus_sdk/signing/__init__.py` · `docs/modules/signing.md` · `docs/conformance-coverage.json` · `docs/spec/README.md` · `docs/GOVERNANCE.md` · `CLAUDE.md` · `sdks/go/README.md` · `.github/workflows/ci.yml` · `sdks/typescript/scripts/smoke-calls.mjs` · `sdks/typescript/scripts/corpus-parity.test.ts` · `docs/rfcs/0020-manifest-signing.md` · `docs/ROADMAP.md` · the three API-surface goldens · `docs/stability-matrix.md` · `docs/conformance-coverage.md` · `sdks/go/spec/data/**`

---

## Task 1: The normative document

**Files:**
- Create: `docs/spec/signing/v1/manifest-signature.md`
- Modify: `sdks/go/spec/data/signing/v1/manifest-signature.md` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: the `§N` anchors every corpus `index.json` entry cites, and the ten token spellings every binding uses verbatim.

- [ ] **Step 1: Read the two documents this one mirrors**

Read `docs/spec/signing/v1/canonical-json.md` end to end — it is the shape to copy (status header, RFC 2119 paragraph, corpus-is-the-tiebreaker note, `## §N Title` headings, a closing "Changes here follow the RFC process" line). Then read §§5–8 of `docs/rfcs/0020-manifest-signing.md`, which this document implements.

- [ ] **Step 2: Write the document**

Ten sections, exactly as the design's table lists them. Content requirements that are easy to get wrong:

**§4 (strict base64url)** must state all four rules: the alphabet is `A–Z a–z 0–9 - _`; padding (`=`) is forbidden; a length congruent to 1 modulo 4 is invalid; and the unused low bits of the final quantum MUST be zero. Add the measured note: no runtime enforces the last rule, so `"QQ"` and `"QR"` both decode to `0x41` everywhere, which is why every binding implements the decoder itself.

**§5 (thumbprint)** must state the projection normatively: *"An implementation MUST project the key to exactly the members `crv`, `kty` and `x` before canonicalizing. A JWK carrying any other member — `kid`, `use`, `key_ops`, `alg`, or a private `d` — MUST produce the same thumbprint as the projection of itself."* Include RFC 8037's worked example and its thumbprint `kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k`.

**§8** is the ten-step table from the design, verbatim, followed by the four resolutions (both members decode before either parses; absent `kid` is `protected-malformed` while absent `alg` is `alg-unsupported`; a non-string `alg` fails at step 3; canonicalization and verification are last).

**§10** is the ten-token table, marked a closed set.

- [ ] **Step 3: Re-sync the Go mirror**

```bash
go -C sdks/go generate ./spec
```

- [ ] **Step 4: Verify the mirror is clean**

Run: `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./spec/...`
Expected: PASS. A failure here means step 3 was skipped or ran from the wrong directory.

- [ ] **Step 5: Commit**

```bash
git add docs/spec/signing/v1/manifest-signature.md sdks/go/spec/data/
git commit -m "docs(signing): specify the detached JWS manifest signature envelope"
```

---

## Task 2: TypeScript — errors and strict base64url

**Files:**
- Create: `sdks/typescript/src/signing/errors.ts`, `sdks/typescript/src/signing/base64url.ts`
- Test: `sdks/typescript/src/signing/base64url.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SignatureReason` (union of the ten tokens), `SIGNATURE_REASONS`, `class SignatureError extends Error { readonly reason: SignatureReason; readonly canonicalizationReason?: CanonicalizationReason }`, `base64urlEncode(bytes: Uint8Array): string`, `base64urlDecode(s: string): Uint8Array`.

- [ ] **Step 1: Write the failing test**

`sdks/typescript/src/signing/base64url.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { base64urlDecode, base64urlEncode } from "./base64url.js";
import { SignatureError } from "./errors.js";

const rejects = (s: string) => {
  expect(() => base64urlDecode(s)).toThrow(SignatureError);
  try {
    base64urlDecode(s);
  } catch (e) {
    expect((e as SignatureError).reason).toBe("base64url-invalid");
  }
};

describe("base64urlEncode", () => {
  test("empty input encodes to the empty string", () => {
    expect(base64urlEncode(new Uint8Array())).toBe("");
  });
  test("emits the url alphabet, never + / or =", () => {
    expect(base64urlEncode(new Uint8Array([251, 255]))).toBe("-_8");
  });
  test("round-trips every byte value", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(base64urlDecode(base64urlEncode(all))).toEqual(all);
  });
});

describe("base64urlDecode", () => {
  test("empty string decodes to zero bytes", () => {
    expect(base64urlDecode("")).toEqual(new Uint8Array());
  });
  test("accepts a canonical two-character quantum", () => {
    expect(base64urlDecode("QQ")).toEqual(new Uint8Array([0x41]));
  });
  // The rule no runtime enforces: "QR" decodes to 0x41 everywhere else.
  test("rejects nonzero trailing bits in a two-character quantum", () => rejects("QR"));
  test("rejects nonzero trailing bits in a three-character quantum", () => rejects("QUJ"));
  test("rejects a length congruent to 1 mod 4", () => rejects("A"));
  test("rejects padding", () => rejects("QQ=="));
  test("rejects the standard-base64 alphabet", () => {
    rejects("+w");
    rejects("/w");
  });
  test("rejects whitespace, leading, trailing and embedded", () => {
    rejects(" QQ");
    rejects("QQ ");
    rejects("Q\nQ");
    rejects("Q\tQ");
  });
  test("rejects non-ASCII", () => rejects("Qé"));
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `cd sdks/typescript && bun test src/signing/base64url.test.ts`
Expected: FAIL — cannot resolve `./base64url.js`.

- [ ] **Step 3: Write `errors.ts`**

```ts
import type { CanonicalizationReason } from "./canonical-json.js";

/**
 * Rejection reasons for the detached JWS envelope.
 *
 * @moduleStability experimental
 *
 * The binding of `docs/spec/signing/v1/manifest-signature.md` §10. The set is closed:
 * a binding may never invent an eleventh. It is deliberately independent of
 * `CanonicalizationReason` — §9's `canonicalization-failed` wraps that set rather than
 * absorbing it, so a consumer switching on one never has to know about the other.
 */
export type SignatureReason =
  | "envelope-malformed"
  | "base64url-invalid"
  | "protected-malformed"
  | "crit-unsupported"
  | "protected-unknown-member"
  | "kid-unknown"
  | "key-unsupported"
  | "alg-unsupported"
  | "canonicalization-failed"
  | "signature-invalid";

export const SIGNATURE_REASONS: readonly SignatureReason[] = [
  "envelope-malformed",
  "base64url-invalid",
  "protected-malformed",
  "crit-unsupported",
  "protected-unknown-member",
  "kid-unknown",
  "key-unsupported",
  "alg-unsupported",
  "canonicalization-failed",
  "signature-invalid",
];

export class SignatureError extends Error {
  readonly reason: SignatureReason;
  /** Set only when `reason` is `canonicalization-failed`. */
  readonly canonicalizationReason?: CanonicalizationReason;

  constructor(
    reason: SignatureReason,
    options?: { canonicalizationReason?: CanonicalizationReason; cause?: unknown },
  ) {
    super(`manifest signature rejected: ${reason}`, { cause: options?.cause });
    this.name = "SignatureError";
    this.reason = reason;
    this.canonicalizationReason = options?.canonicalizationReason;
  }
}
```

- [ ] **Step 4: Write `base64url.ts`**

```ts
import { SignatureError } from "./errors.js";

/**
 * Strict base64url, per `docs/spec/signing/v1/manifest-signature.md` §4.
 *
 * @moduleStability experimental
 *
 * Hand-rolled rather than delegated because no runtime checks that the final quantum's
 * unused trailing bits are zero — `"QQ"` and `"QR"` both decode to `0x41` in Node,
 * CPython and Go. For a signature envelope that is malleability: two distinct `protected`
 * values decoding to the same header bytes.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const VALUES: readonly number[] = (() => {
  const table = new Array<number>(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(acc >> bits) & 63];
    }
  }
  if (bits > 0) out += ALPHABET[(acc << (6 - bits)) & 63];
  return out;
}

export function base64urlDecode(s: string): Uint8Array {
  if (s.length % 4 === 1) throw new SignatureError("base64url-invalid");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const value = code < 128 ? VALUES[code] : -1;
    if (value === undefined || value < 0) throw new SignatureError("base64url-invalid");
    acc = ((acc << 6) | value) & 0x3ffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (acc >> bits) & 0xff;
    }
  }
  // The rule no runtime enforces: leftover bits must be zero.
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) {
    throw new SignatureError("base64url-invalid");
  }
  return out;
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd sdks/typescript && bun test src/signing/base64url.test.ts && bun run typecheck && bun run lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/src/signing/errors.ts sdks/typescript/src/signing/base64url.ts sdks/typescript/src/signing/base64url.test.ts
git commit -m "feat(signing): strict base64url and the envelope's closed reason set"
```

---

## Task 3: TypeScript — JWK thumbprint with projection

**Files:**
- Create: `sdks/typescript/src/signing/jwk.ts`
- Test: `sdks/typescript/src/signing/jwk.test.ts`

**Interfaces:**
- Consumes: `base64urlEncode` (Task 2), `SignatureError` (Task 2), `canonicalize` from `./canonical-json.js`.
- Produces: `interface Jwk { readonly kty: string; readonly crv: string; readonly x: string; readonly [k: string]: unknown }`, `interface PrivateJwk extends Jwk { readonly d: string }`, `jwkThumbprint(jwk: Jwk): Promise<string>`.

- [ ] **Step 1: Write the failing test**

`sdks/typescript/src/signing/jwk.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { SignatureError } from "./errors.js";
import { type Jwk, jwkThumbprint } from "./jwk.js";

const RFC8037_KEY: Jwk = {
  kty: "OKP",
  crv: "Ed25519",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
};
const RFC8037_THUMBPRINT = "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k";

describe("jwkThumbprint", () => {
  test("matches RFC 8037's published example", async () => {
    expect(await jwkThumbprint(RFC8037_KEY)).toBe(RFC8037_THUMBPRINT);
  });

  // The B2 case: without projection these extras land in the hash input and the
  // thumbprint stops matching every standard JOSE tool.
  test("ignores kid, use, alg and key_ops", async () => {
    const decorated: Jwk = {
      ...RFC8037_KEY,
      kid: "ignored",
      use: "sig",
      alg: "EdDSA",
      key_ops: ["verify"],
    };
    expect(await jwkThumbprint(decorated)).toBe(RFC8037_THUMBPRINT);
  });

  test("a private key thumbprints as its public half", async () => {
    const priv: Jwk = { ...RFC8037_KEY, d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A" };
    expect(await jwkThumbprint(priv)).toBe(RFC8037_THUMBPRINT);
  });

  test("rejects a key whose required members are not strings", async () => {
    await expect(jwkThumbprint({ kty: "OKP", crv: "Ed25519" } as unknown as Jwk)).rejects.toThrow(
      SignatureError,
    );
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `cd sdks/typescript && bun test src/signing/jwk.test.ts`
Expected: FAIL — cannot resolve `./jwk.js`.

- [ ] **Step 3: Write `jwk.ts`**

```ts
import { base64urlEncode } from "./base64url.js";
import { canonicalize } from "./canonical-json.js";
import { SignatureError } from "./errors.js";

/**
 * JWK shapes and the RFC 7638 thumbprint, per `manifest-signature.md` §5.
 *
 * @moduleStability experimental
 */
export interface Jwk {
  readonly kty: string;
  readonly crv: string;
  readonly x: string;
  readonly [member: string]: unknown;
}

export interface PrivateJwk extends Jwk {
  readonly d: string;
}

/**
 * RFC 7638 §3.2 hashes ONLY the required members — `crv`, `kty`, `x` for OKP. A JWK
 * carrying `kid`, `use`, `alg` or `d` must therefore be projected first; serializing it
 * whole would produce a digest no JOSE tool agrees with, and because `kid` selection is
 * thumbprint equality, that turns a genuinely trusted key into `kid-unknown`.
 *
 * Given the projection, `canonicalize` already emits exactly RFC 7638's form: required
 * members only, ascending code-point key order, no whitespace.
 */
export async function jwkThumbprint(jwk: Jwk): Promise<string> {
  if (typeof jwk?.kty !== "string" || typeof jwk.crv !== "string" || typeof jwk.x !== "string") {
    throw new SignatureError("key-unsupported");
  }
  const json = canonicalize({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return base64urlEncode(new Uint8Array(digest));
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd sdks/typescript && bun test src/signing/jwk.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/src/signing/jwk.ts sdks/typescript/src/signing/jwk.test.ts
git commit -m "feat(signing): RFC 7638 JWK thumbprints, projected to the required members"
```

---

## Task 4: TypeScript — the protected header and signing input

**Files:**
- Create: `sdks/typescript/src/signing/jws.ts`
- Test: `sdks/typescript/src/signing/jws.test.ts`

**Interfaces:**
- Consumes: `base64urlEncode` / `base64urlDecode` (Task 2), `canonicalize`, `SignatureError`.
- Produces: `interface ProtectedHeader { readonly alg?: string; readonly kid: string }`, `encodeProtectedHeader(h: ProtectedHeader): string`, `parseProtectedHeader(b64url: string): ProtectedHeader`, `parseProtectedHeaderBytes(bytes: Uint8Array): ProtectedHeader`, `signingInput(protectedB64url: string, canonicalBytes: Uint8Array): Uint8Array`.

`alg` is **optional and typed `string`**, never the literal `"EdDSA"`. The parser must be able to return a header carrying `alg: "ES256"` so that §8 step 6 (`kid-unknown`) can beat step 8 (`alg-unsupported`); a literal return type would force the parser to reject at step 3 and destroy the ordering.

- [ ] **Step 1: Write the failing test**

`sdks/typescript/src/signing/jws.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { base64urlEncode } from "./base64url.js";
import { SignatureError } from "./errors.js";
import { encodeProtectedHeader, parseProtectedHeader, signingInput } from "./jws.js";

const b64 = (o: unknown) => base64urlEncode(new TextEncoder().encode(JSON.stringify(o)));

const rejectsWith = (input: string, reason: string) => {
  try {
    parseProtectedHeader(input);
    throw new Error(`expected a rejection with ${reason}`);
  } catch (e) {
    expect(e).toBeInstanceOf(SignatureError);
    expect((e as SignatureError).reason).toBe(reason);
  }
};

describe("encodeProtectedHeader", () => {
  test("emits canonical key order — alg before kid", () => {
    const encoded = encodeProtectedHeader({ alg: "EdDSA", kid: "abc" });
    expect(new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))).toBe(
      '{"alg":"EdDSA","kid":"abc"}',
    );
  });
  test("round-trips through the parser", () => {
    expect(parseProtectedHeader(encodeProtectedHeader({ alg: "EdDSA", kid: "abc" }))).toEqual({
      alg: "EdDSA",
      kid: "abc",
    });
  });
});

describe("parseProtectedHeader", () => {
  test("returns a non-EdDSA alg rather than rejecting it — step 8 does that", () => {
    expect(parseProtectedHeader(b64({ alg: "ES256", kid: "abc" }))).toEqual({
      alg: "ES256",
      kid: "abc",
    });
  });
  test("returns a header with no alg — step 8 rejects it", () => {
    expect(parseProtectedHeader(b64({ kid: "abc" }))).toEqual({ kid: "abc" });
  });
  test("rejects invalid base64url before parsing anything", () => rejectsWith("!!!", "base64url-invalid"));
  test("rejects non-JSON", () => rejectsWith(base64urlEncode(new TextEncoder().encode("{")), "protected-malformed"));
  test("rejects a JSON array", () => rejectsWith(b64([1]), "protected-malformed"));
  test("rejects ill-formed UTF-8", () =>
    rejectsWith(base64urlEncode(new Uint8Array([0xff, 0xfe])), "protected-malformed"));
  test("rejects an absent kid", () => rejectsWith(b64({ alg: "EdDSA" }), "protected-malformed"));
  test("rejects a non-string kid", () => rejectsWith(b64({ alg: "EdDSA", kid: 1 }), "protected-malformed"));
  test("rejects a non-string alg", () => rejectsWith(b64({ alg: 1, kid: "abc" }), "protected-malformed"));
  test("rejects crit", () => rejectsWith(b64({ alg: "EdDSA", kid: "abc", crit: ["x"] }), "crit-unsupported"));
  test("rejects an unknown member", () =>
    rejectsWith(b64({ alg: "EdDSA", kid: "abc", typ: "JWT" }), "protected-unknown-member"));
  // §8: step 3 precedes step 4, so a crit header with no kid is protected-malformed.
  test("an absent kid beats crit", () => rejectsWith(b64({ crit: ["x"] }), "protected-malformed"));
});

describe("signingInput", () => {
  test("is ASCII(protected + '.' + b64url(payload))", () => {
    const input = signingInput("aGVhZGVy", new Uint8Array([0x7b, 0x7d]));
    expect(new TextDecoder().decode(input)).toBe("aGVhZGVy.e30");
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `cd sdks/typescript && bun test src/signing/jws.test.ts`
Expected: FAIL — cannot resolve `./jws.js`.

- [ ] **Step 3: Write `jws.ts`**

```ts
import { base64urlDecode, base64urlEncode } from "./base64url.js";
import { canonicalize } from "./canonical-json.js";
import { SignatureError } from "./errors.js";

/**
 * The protected header and the signing input, per `manifest-signature.md` §6 and §7.
 *
 * @moduleStability experimental
 */
export interface ProtectedHeader {
  /**
   * Optional and typed `string`, never the literal `"EdDSA"`. §8 checks the value at
   * step 8, AFTER key resolution, so that an unknown `kid` beats a bogus `alg` — which is
   * the whole point of resolving the algorithm from the key rather than the header. A
   * literal type here would force this parser to reject at step 3 and collapse that order.
   */
  readonly alg?: string;
  readonly kid: string;
}

export function encodeProtectedHeader(header: ProtectedHeader): string {
  const json =
    header.alg === undefined
      ? canonicalize({ kid: header.kid })
      : canonicalize({ alg: header.alg, kid: header.kid });
  return base64urlEncode(new TextEncoder().encode(json));
}

export function parseProtectedHeader(b64url: string): ProtectedHeader {
  return parseProtectedHeaderBytes(base64urlDecode(b64url));
}

/**
 * §8 requires BOTH envelope members to decode before either is parsed, so the verifier
 * decodes them itself and hands the bytes here.
 */
export function parseProtectedHeaderBytes(bytes: Uint8Array): ProtectedHeader {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SignatureError("protected-malformed");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SignatureError("protected-malformed");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignatureError("protected-malformed");
  }

  const header = value as Record<string, unknown>;
  // Step 3 before step 4: an absent kid beats crit.
  if (typeof header.kid !== "string") throw new SignatureError("protected-malformed");
  if ("alg" in header && typeof header.alg !== "string") {
    throw new SignatureError("protected-malformed");
  }
  if ("crit" in header) throw new SignatureError("crit-unsupported");
  for (const member of Object.keys(header)) {
    if (member !== "alg" && member !== "kid") {
      throw new SignatureError("protected-unknown-member");
    }
  }

  return typeof header.alg === "string" ? { alg: header.alg, kid: header.kid } : { kid: header.kid };
}

export function signingInput(protectedB64url: string, canonicalBytes: Uint8Array): Uint8Array {
  return new TextEncoder().encode(`${protectedB64url}.${base64urlEncode(canonicalBytes)}`);
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd sdks/typescript && bun test src/signing/jws.test.ts && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/src/signing/jws.ts sdks/typescript/src/signing/jws.test.ts
git commit -m "feat(signing): the JWS protected header codec and signing input"
```

---

## Task 5: TypeScript — sign, verify, keygen

**Files:**
- Create: `sdks/typescript/src/signing/manifest-signature.ts`
- Test: `sdks/typescript/src/signing/manifest-signature.test.ts`
- Modify: `sdks/typescript/src/signing/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4, plus `canonicalizeManifest` and `CanonicalizationError` from `./canonical-json.js`.
- Produces: `interface ManifestSignatureEnvelope { readonly protected: string; readonly signature: string }`, `generateSigningKey(): Promise<{ privateKey: PrivateJwk; publicKey: Jwk }>`, `signManifest(manifest: object, privateKey: PrivateJwk): Promise<ManifestSignatureEnvelope>`, `verifyManifestSignature(manifest: object, trustedKeys: readonly Jwk[]): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`sdks/typescript/src/signing/manifest-signature.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "bun:test";
import { SignatureError } from "./errors.js";
import { type Jwk, jwkThumbprint, type PrivateJwk } from "./jwk.js";
import { encodeProtectedHeader } from "./jws.js";
import {
  generateSigningKey,
  signManifest,
  verifyManifestSignature,
} from "./manifest-signature.js";

let priv: PrivateJwk;
let pub: Jwk;
let kid: string;
let signed: Record<string, unknown>;

const MANIFEST = { id: "com.example.demo", version: "1.0.0", publisher: { id: "example" } };

beforeAll(async () => {
  ({ privateKey: priv, publicKey: pub } = await generateSigningKey());
  kid = await jwkThumbprint(pub);
  signed = { ...MANIFEST, signature: await signManifest(MANIFEST, priv) };
});

const rejectsWith = async (m: object, keys: readonly Jwk[], reason: string) => {
  try {
    await verifyManifestSignature(m, keys);
    throw new Error(`expected a rejection with ${reason}`);
  } catch (e) {
    expect(e).toBeInstanceOf(SignatureError);
    expect((e as SignatureError).reason).toBe(reason);
  }
};

describe("round trip", () => {
  test("a freshly signed manifest verifies", async () => {
    await expect(verifyManifestSignature(signed, [pub])).resolves.toBeUndefined();
  });
  test("signing is deterministic", async () => {
    expect(await signManifest(MANIFEST, priv)).toEqual(await signManifest(MANIFEST, priv));
  });
  test("an existing signature member does not affect the bytes signed", async () => {
    expect(await signManifest(signed, priv)).toEqual(await signManifest(MANIFEST, priv));
  });
  test("a mutated manifest fails", async () => {
    await rejectsWith({ ...signed, version: "1.0.1" }, [pub], "signature-invalid");
  });
});

describe("§8 ordering", () => {
  test("an unknown kid beats a bogus alg", async () => {
    const m = {
      ...MANIFEST,
      signature: {
        protected: encodeProtectedHeader({ alg: "ES256", kid: "not-a-real-thumbprint" }),
        signature: "A".repeat(86),
      },
    };
    await rejectsWith(m, [pub], "kid-unknown");
  });
  test("a known kid with a bogus alg reaches alg-unsupported", async () => {
    const m = {
      ...MANIFEST,
      signature: { protected: encodeProtectedHeader({ alg: "ES256", kid }), signature: "A".repeat(86) },
    };
    await rejectsWith(m, [pub], "alg-unsupported");
  });
  test("an absent alg is alg-unsupported, not protected-malformed", async () => {
    const m = {
      ...MANIFEST,
      signature: { protected: encodeProtectedHeader({ kid }), signature: "A".repeat(86) },
    };
    await rejectsWith(m, [pub], "alg-unsupported");
  });
});

describe("§8 steps 1 and 2", () => {
  test("no signature member", () => rejectsWith(MANIFEST, [pub], "envelope-malformed"));
  test("no publisher id", () =>
    rejectsWith({ ...signed, publisher: {} }, [pub], "envelope-malformed"));
  test("an extra member in the signature object", () =>
    rejectsWith({ ...signed, signature: { ...signed.signature as object, x: "y" } }, [pub], "envelope-malformed"));
  test("a bad signature member is caught before the header parses", async () => {
    const m = { ...MANIFEST, signature: { protected: "!!!", signature: "===" } };
    await rejectsWith(m, [pub], "base64url-invalid");
  });
});

describe("key selection", () => {
  test("an empty trusted set is kid-unknown", () => rejectsWith(signed, [], "kid-unknown"));
  test("a malformed key is skipped rather than fatal", async () => {
    const junk = { kty: "OKP", crv: "Ed25519" } as unknown as Jwk;
    await expect(verifyManifestSignature(signed, [junk, pub])).resolves.toBeUndefined();
  });
  test("an X25519 key that matches the kid is key-unsupported", async () => {
    const x25519: Jwk = { kty: "OKP", crv: "X25519", x: pub.x };
    const m = {
      ...MANIFEST,
      signature: {
        protected: encodeProtectedHeader({ alg: "EdDSA", kid: await jwkThumbprint(x25519) }),
        signature: "A".repeat(86),
      },
    };
    await rejectsWith(m, [x25519], "key-unsupported");
  });
});

describe("canonicalization failures are wrapped", () => {
  test("carries the underlying reason", async () => {
    const m = { ...signed, bad: Number.POSITIVE_INFINITY };
    try {
      await verifyManifestSignature(m, [pub]);
      throw new Error("expected a rejection");
    } catch (e) {
      expect((e as SignatureError).reason).toBe("canonicalization-failed");
      expect((e as SignatureError).canonicalizationReason).toBe("number-out-of-range");
    }
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `cd sdks/typescript && bun test src/signing/manifest-signature.test.ts`
Expected: FAIL — cannot resolve `./manifest-signature.js`.

- [ ] **Step 3: Write `manifest-signature.ts`**

```ts
import { base64urlDecode, base64urlEncode } from "./base64url.js";
import { CanonicalizationError, canonicalizeManifest } from "./canonical-json.js";
import { SignatureError } from "./errors.js";
import { type Jwk, jwkThumbprint, type PrivateJwk } from "./jwk.js";
import { encodeProtectedHeader, parseProtectedHeaderBytes, signingInput } from "./jws.js";

/**
 * The detached JWS envelope, per `manifest-signature.md` §8 and §9.
 *
 * @moduleStability experimental
 *
 * Asynchronous because `crypto.subtle` is, which keeps this entry point runnable in a
 * browser, Deno or an edge worker. Go's binding is synchronous, so this is the minority
 * shape — the same two-against-one split `performHandshake` already carries.
 */
export interface ManifestSignatureEnvelope {
  readonly protected: string;
  readonly signature: string;
}

function canonicalizeOrWrap(manifest: object): Uint8Array {
  try {
    return canonicalizeManifest(manifest);
  } catch (error) {
    if (error instanceof CanonicalizationError) {
      throw new SignatureError("canonicalization-failed", {
        canonicalizationReason: error.reason,
        cause: error,
      });
    }
    throw error;
  }
}

export async function generateSigningKey(): Promise<{
  privateKey: PrivateJwk;
  publicKey: Jwk;
}> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const priv = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as { x?: string; d?: string };
  if (typeof priv.x !== "string" || typeof priv.d !== "string") {
    throw new SignatureError("key-unsupported");
  }
  return {
    privateKey: { kty: "OKP", crv: "Ed25519", x: priv.x, d: priv.d },
    publicKey: { kty: "OKP", crv: "Ed25519", x: priv.x },
  };
}

export async function signManifest(
  manifest: object,
  privateKey: PrivateJwk,
): Promise<ManifestSignatureEnvelope> {
  if (
    privateKey?.kty !== "OKP" ||
    privateKey.crv !== "Ed25519" ||
    typeof privateKey.x !== "string" ||
    typeof privateKey.d !== "string"
  ) {
    throw new SignatureError("key-unsupported");
  }
  // §5's projection means a private key thumbprints as its own public half.
  const kid = await jwkThumbprint(privateKey);
  const protectedB64 = encodeProtectedHeader({ alg: "EdDSA", kid });
  const canonical = canonicalizeOrWrap(manifest);

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: privateKey.x, d: privateKey.d },
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    key,
    signingInput(protectedB64, canonical),
  );
  return { protected: protectedB64, signature: base64urlEncode(new Uint8Array(signature)) };
}

export async function verifyManifestSignature(
  manifest: object,
  trustedKeys: readonly Jwk[],
): Promise<void> {
  const document = manifest as Record<string, unknown>;

  // Step 1 — envelope shape.
  const publisher = document.publisher;
  if (
    typeof publisher !== "object" ||
    publisher === null ||
    Array.isArray(publisher) ||
    typeof (publisher as Record<string, unknown>).id !== "string" ||
    (publisher as Record<string, unknown>).id === ""
  ) {
    throw new SignatureError("envelope-malformed");
  }
  const envelope = document.signature;
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    throw new SignatureError("envelope-malformed");
  }
  const members = envelope as Record<string, unknown>;
  if (
    Object.keys(members).length !== 2 ||
    typeof members.protected !== "string" ||
    typeof members.signature !== "string"
  ) {
    throw new SignatureError("envelope-malformed");
  }

  // Step 2 — BOTH members decode before either is parsed.
  const protectedBytes = base64urlDecode(members.protected);
  const signatureBytes = base64urlDecode(members.signature);

  // Steps 3-5.
  const header = parseProtectedHeaderBytes(protectedBytes);

  // Step 6 — thumbprintable keys only; a malformed entry in a rotation set must not make
  // every signature unverifiable.
  let selected: Jwk | undefined;
  for (const candidate of trustedKeys) {
    if (
      typeof candidate?.kty !== "string" ||
      typeof candidate.crv !== "string" ||
      typeof candidate.x !== "string"
    ) {
      continue;
    }
    if ((await jwkThumbprint(candidate)) === header.kid) {
      selected = candidate;
      break;
    }
  }
  if (selected === undefined) throw new SignatureError("kid-unknown");

  // Step 7 — X25519 is thumbprintable and is NOT a signing curve.
  if (selected.kty !== "OKP" || selected.crv !== "Ed25519") {
    throw new SignatureError("key-unsupported");
  }
  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = base64urlDecode(selected.x);
  } catch {
    throw new SignatureError("key-unsupported");
  }
  if (publicKeyBytes.length !== 32) throw new SignatureError("key-unsupported");

  // Step 8 — the algorithm comes from the resolved key, so this is checked only now.
  if (header.alg !== "EdDSA") throw new SignatureError("alg-unsupported");

  // Step 9.
  const canonical = canonicalizeOrWrap(document);

  // Step 10.
  if (signatureBytes.length !== 64) throw new SignatureError("signature-invalid");
  const key = await crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "Ed25519",
    key,
    signatureBytes,
    signingInput(members.protected, canonical),
  );
  if (!ok) throw new SignatureError("signature-invalid");
}
```

- [ ] **Step 4: Re-export from the entry point**

Add to `sdks/typescript/src/signing/index.ts`, keeping the existing canonicalization exports and the alphabetical order Biome enforces:

```ts
export { base64urlDecode, base64urlEncode } from "./base64url.js";
export { SIGNATURE_REASONS, SignatureError, type SignatureReason } from "./errors.js";
export { type Jwk, jwkThumbprint, type PrivateJwk } from "./jwk.js";
export {
  encodeProtectedHeader,
  parseProtectedHeader,
  type ProtectedHeader,
  signingInput,
} from "./jws.js";
export {
  generateSigningKey,
  type ManifestSignatureEnvelope,
  signManifest,
  verifyManifestSignature,
} from "./manifest-signature.js";
```

Also update the module's own doc comment: it currently says "and, from a later shipment, the detached JWS envelope." That shipment is this one.

- [ ] **Step 5: Run the whole TypeScript suite**

Run: `cd sdks/typescript && bun test src/signing/ && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/src/signing/
git commit -m "feat(signing): sign and verify a detached JWS manifest envelope"
```

---

## Task 6: The conformance corpus, its guard, and the Node companion

**Files:**
- Create: `docs/spec/conformance/v1/manifest-signature/index.json`, `index.schema.json`, `case.schema.json`, `cases/*.json`
- Create: `sdks/typescript/scripts/manifest-signature-guard.test.ts`, `sdks/typescript/scripts/ed25519-node.mjs`
- Modify: `sdks/go/spec/data/**` (generated)

**Interfaces:**
- Consumes: the whole TypeScript surface from Tasks 2–5.
- Produces: the case files and `index.json` every other binding's runner reads.

- [ ] **Step 1: Read the corpus conventions**

Invoke the `nimbus-sdk-conformance-corpus` skill and read `docs/spec/conformance/v1/canonical-json/` — its `index.schema.json`, `case.schema.json`, and three case files. Copy that shape.

- [ ] **Step 2: Write the schemas**

`case.schema.json` requires `description`, `kind`, and `expect`, with `additionalProperties: false`. `kind` is an enum of `base64url`, `thumbprint`, `ed25519`, `verify`, `sign`. `expect` is either `{ "ok": … }` or `{ "rejected": "<token>" }`, the token constrained to the ten in §10 for `verify`/`sign` kinds and to `base64url-invalid` / `key-unsupported` for the pure kinds.

`index.schema.json` mirrors `canonical-json`'s, with `section` patterned `^§[0-9]+(\.[0-9]+)*$` — the wider form, so a later subsection is nameable.

- [ ] **Step 3: Write the case files**

Roughly 48 files across the five kinds. Every index entry carries `file`, `section` and `reason`, and nothing else — `additionalProperties` is `false`.

**`ed25519` (10 cases) — use these measured values verbatim.** All four runtimes agree; do not recompute:

| case | public key / signature | expect |
|---|---|---|
| `ed25519-rfc8032-vector-1` | pk `d75a…511a`, empty message, sig `e556…100b` | `true` |
| `ed25519-rfc8032-vector-2` | pk `3d40…660c`, message `72` | `true` |
| `ed25519-rfc8032-vector-3` | pk `fc51…8025`, message `af82` | `true` |
| `ed25519-non-canonical-s` | vector 1 with `S + L` | `false` |
| `ed25519-public-key-all-zero` | pk `00…00` | `false` |
| `ed25519-public-key-y-equals-p` | pk `edff…ff7f` | `false` |
| `ed25519-public-key-y-equals-p-plus-1` | pk `eeff…ff7f` | `false` |
| `ed25519-small-order-1` | pk `0100…0000` | `false` |
| `ed25519-small-order-2` | pk `ecff…ffff` | `false` |
| `ed25519-small-order-8` | pk `c717…037a` | `false` |

`ed25519-non-canonical-s` is the load-bearing one: `S + L` is the same signature mathematically with different bytes, and RFC 8032 §5.1.7 requires rejecting it. Its `reason` records the measurement — *"BoringSSL (bun 1.3.14), OpenSSL (node 24.18.1) and Go's crypto/ed25519 (1.26.7, 1.27.0) all reject it; measured 2026-09-05 before this case was written."*

**`base64url` (13 cases)** — the enumeration from the design: canonical `"QQ"`; nonzero trailing bits in a 2-char quantum (`"QR"`) and a 3-char quantum (`"QUJ"`); length ≡ 1 mod 4 (`"A"`); padding (`"QQ=="`); `+` and `/`; leading, trailing and embedded whitespace; non-ASCII; the empty string; and two encode vectors.

**`thumbprint` (6 cases)** — RFC 8037's example; the decorated-JWK case proving projection; a private key thumbprinting as its public half; a non-OKP key; a key with a non-string required member; a key with a missing required member.

**`verify` (15 cases)** — one `ok`, then one per token, plus the three ordering cases (unknown `kid` beats bogus `alg`; known `kid` with bogus `alg` reaches `alg-unsupported`; absent `kid` beats `crit`).

**`sign` (4 cases)** — RFC 8032 §7.1 seeds against manifests of our own, each expected `protected` and `signature` computed by the TypeScript binding and then **independently reproduced by the Go binding in Task 7 before this task's commit is considered final.**

- [ ] **Step 4: Measure the anti-vacuity claim for each ordering case**

For each of the three ordering cases: implement the wrong order (move step 8 above step 6), run the corpus as it stands, and count how many *other* cases catch it. Record the number in that case's `reason` as *"caught by 0 of the N other cases."* Do not assert a number you did not measure.

- [ ] **Step 5: Write the guard**

`sdks/typescript/scripts/manifest-signature-guard.test.ts`, modelled on `canonical-json-guard.test.ts`. It must assert:

1. Every case on disk is indexed, and every indexed case exists on disk.
2. The corpus is non-empty and every declared `kind` has at least one case.
3. Every kind exercises **both** outcomes.
4. Every one of `SIGNATURE_REASONS`' ten tokens is expected by at least one `verify` case.
5. Every case executes against the built surface and matches its `expect`.

- [ ] **Step 6: Write the Node companion**

`sdks/typescript/scripts/ed25519-node.mjs`, modelled on `framing-node.mjs`: it runs the `ed25519` kind against `dist/` under Node rather than Bun. Bun ships BoringSSL and Node ships OpenSSL; they agree today, and a Bun-only suite is structurally incapable of noticing if they stop.

- [ ] **Step 7: Register the corpus in `conformance-corpora.test.ts`**

`corpusNames()` reads the directory, so there is no list to register the corpus *in* — but its test pins two things by hand, and both fail until you edit them:

- The expected corpus-name set (the array containing `"canonical-json"` near the top of `sdks/typescript/scripts/conformance-corpora.test.ts`) gains `"manifest-signature"`, in whatever order the surrounding entries use.
- The per-corpus size floors below it gain `expect(corpora.get("manifest-signature")?.length).toBeGreaterThanOrEqual(40);`.

A **floor**, not an exact count — this repository pins exact totals for only `negotiation` and `framing`, and only in `sdks/python/tests/test_spec.py`. A duplicated exact count would detect nothing and make every future case a four-file edit.

- [ ] **Step 8: Run everything**

```bash
cd sdks/typescript && bun run build && bun test scripts/manifest-signature-guard.test.ts scripts/conformance-corpora.test.ts && node scripts/ed25519-node.mjs
go -C sdks/go generate ./spec
```
Expected: PASS, and a clean `git status` for `sdks/go/spec/data/` after the generate.

- [ ] **Step 9: Commit**

```bash
git add docs/spec/conformance/v1/manifest-signature/ sdks/typescript/scripts/ sdks/go/spec/data/
git commit -m "test(signing): the manifest-signature conformance corpus and its guard"
```

---

## Task 7: The Go binding

**Files:**
- Create: `sdks/go/signing/{errors,base64url,jwk,jws,manifestsignature}.go` and a `_test.go` beside each
- Create: `sdks/go/conformance/manifestsignature_test.go`
- Modify: `sdks/go/signing/canonicaljson.go` (rename `Error` → `CanonicalizationError`, `Reasons` → `CanonicalizationReasons`)

**Interfaces:**
- Consumes: the corpus from Task 6, and `Canonicalize` / `CanonicalizeManifest` from the same package.
- Produces: `SignatureError`, `SignatureReasons`, `Base64URLEncode`, `Base64URLDecode`, `JWK`, `PrivateJWK`, `JWKThumbprint`, `ProtectedHeader`, `EncodeProtectedHeader`, `ParseProtectedHeader`, `SigningInput`, `SignatureEnvelope`, `GenerateSigningKey`, `SignManifest`, `VerifyManifestSignature`.

- [ ] **Step 1: Do the rename first, on its own**

`signing.Error` and `signing.Reasons` become `signing.CanonicalizationError` and `signing.CanonicalizationReasons`, so the envelope's pair can be `SignatureError` / `SignatureReasons` without collision. Update every reference in `sdks/go/` and re-run the package tests.

This is legal without a deprecation window: `stability-rules.ts` computes `isBreaking = BREAKING_KINDS.has(kind) && tier !== "experimental"`, and `signing` is `experimental`.

Run: `go -C sdks/go build ./... && go -C sdks/go test ./signing/...`
Expected: PASS. Commit this rename by itself — a reviewer should be able to reject it independently of the new code.

```bash
git add sdks/go/signing/
git commit -m "feat(signing)!: rename Go's canonicalization error for the envelope's own"
```

- [ ] **Step 2: Write the Go tests**

Mirror `sdks/typescript/src/signing/*.test.ts` case for case, in stdlib `testing` with table-driven subtests. The same inputs must produce the same tokens; that equivalence is the point of the exercise.

- [ ] **Step 3: Write the Go implementation**

Mirror the TypeScript, with these Go-specific requirements:

**`JWK` carries `Kid` and `Extra`.** Without representable extra members, §5's projection rule is vacuous in Go and the decorated-JWK corpus case passes by construction rather than by conformance:

```go
type JWK struct {
	Kty   string
	Crv   string
	X     string
	Kid   string
	Extra map[string]any
}
```

`JWKThumbprint` projects to `map[string]any{"crv": k.Crv, "kty": k.Kty, "x": k.X}` and canonicalizes that — never the struct.

**Do not use `encoding/base64`.** `base64.RawURLEncoding` does not check trailing bits. Hand-roll the decoder exactly as TypeScript does.

**`SignatureError` implements `Unwrap`:**

```go
type SignatureError struct {
	Reason                  string
	CanonicalizationReason  string
	Err                     error
}

func (e *SignatureError) Error() string { return "manifest signature rejected: " + e.Reason }
func (e *SignatureError) Unwrap() error { return e.Err }
```

**Verification is synchronous and returns `error`**: `func VerifyManifestSignature(manifest map[string]any, trusted []JWK) error`, `nil` on success. The ten steps run in the same order as TypeScript's.

- [ ] **Step 4: Write the Go corpus runner**

`sdks/go/conformance/manifestsignature_test.go`, modelled on `canonicaljson_test.go`. Three things this runner must carry:

- **`spec.LoadCorpus` decodes with `UseNumber`**, so every corpus number is a `json.Number` and a `.(float64)` assertion on corpus data is always wrong.
- **A size floor**, matching Go's convention — `negotiation` fails under 30, `framing` under 20, `diagnostics` under 60, `url-resolution` under 20. Use 40 here, the same floor Task 6 step 7 gave the TypeScript side.
- **An anti-vacuity guard**: a `kind` filter that matches zero cases must fail the test, the way `runKind` already does elsewhere. A runner that silently executes nothing is the failure mode these guards exist for.

- [ ] **Step 5: Cross-check the `sign` cases**

Verify that Go reproduces every expected `protected` and `signature` byte string that Task 6 computed in TypeScript. **If any differs, stop** — that is a cross-language canonicalization or signing-input disagreement, and it is RFC territory, not a value to adjust.

- [ ] **Step 6: Run the Go suite**

```bash
go -C sdks/go build ./... && go -C sdks/go vet ./...
test -z "$(gofmt -l sdks/go)"
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add sdks/go/
git commit -m "feat(signing): bind the manifest signature envelope in Go"
```

---

## Task 8: The Python pure layer and its deferrals

**Files:**
- Create: `sdks/python/src/nimbus_sdk/signing/{errors,base64url,jwk,jws}.py`
- Create: `sdks/python/tests/test_manifest_signature_corpus.py`, `sdks/python/tests/test_manifest_signature.py`
- Modify: `sdks/python/src/nimbus_sdk/signing/__init__.py`

**Interfaces:**
- Consumes: the corpus from Task 6; `canonicalize` from `nimbus_sdk.signing.canonical_json`.
- Produces: `SignatureError`, `SIGNATURE_REASONS`, `base64url_encode`, `base64url_decode`, `Jwk`, `jwk_thumbprint`, `ProtectedHeader`, `encode_protected_header`, `parse_protected_header`, `signing_input`. **No** `sign_manifest`, `verify_manifest_signature` or `generate_signing_key` — those are S3.

- [ ] **Step 1: Write the failing tests**

Mirror the TypeScript `base64url`, `jwk` and `jws` tests case for case, in pytest. Do **not** write tests for signing or verification; there is nothing to test yet.

- [ ] **Step 2: Write the implementation**

Mirror the TypeScript. Two Python-specific requirements:

**Do not use `base64.urlsafe_b64decode`** — it neither rejects padding nor checks trailing bits. Hand-roll it.

**Every module declares `__stability__ = "experimental"`**, and `__init__.py` re-exports the new names into `__all__` alongside the existing canonicalization ones. The import root count stays at **nine**; do not add a tenth.

- [ ] **Step 3: Write the corpus runner and the deferral-consistency test**

`sdks/python/tests/test_manifest_signature_corpus.py` runs the `base64url` and `thumbprint` kinds. It must also contain the test that stops the runner and the declaration drifting apart:

```python
def test_skipped_cases_are_exactly_the_declared_deferrals() -> None:
    """The runner and conformance-coverage.json must not disagree.

    Without this, adding a case is silent in both directions: the runner would not run
    it and the reconciler would not expect it, and the corpus would report coverage it
    does not have.
    """
    manifest = json.loads((repo_root() / "docs" / "conformance-coverage.json").read_text())
    declared = set(manifest["languages"]["python"]["deferred"]["manifest-signature"])
    all_cases = {case["file"] for case in load_corpus("manifest-signature")}
    assert all_cases - executed_case_files() == declared
```

When `NIMBUS_CONFORMANCE_REPORT` is set, the runner writes execution records for the cases it runs, exactly as the other Python runners do.

- [ ] **Step 4: Reinstall, then run**

```bash
cd sdks/python && python -m pip install -e . && python -m pytest -q
python -m ruff check . && python -m ruff format --check . && python -m mypy
python scripts/api_surface.py
```
Expected: PASS. **The reinstall is not optional** — without it `spec_root()` reads the stale bundled snapshot and the suite passes while executing none of the new corpus.

- [ ] **Step 5: Commit**

```bash
git add sdks/python/ docs/api-surface-python.md
git commit -m "feat(signing): bind the pure envelope layer in Python"
```

---

## Task 9: The coverage declaration and every pinned sentence

**Files:**
- Modify: `docs/conformance-coverage.json`, `docs/conformance-coverage.md`, `CLAUDE.md`, `docs/GOVERNANCE.md`, `sdks/go/README.md`, `.github/workflows/ci.yml`, `docs/spec/README.md`, `sdks/typescript/scripts/corpus-parity.test.ts`

**Interfaces:**
- Consumes: the corpus from Task 6 and the three runners from Tasks 6–8.
- Produces: nothing code-facing. This task is what makes `corpus-parity.test.ts` and the `conformance` job pass.

- [ ] **Step 1: Declare the corpus**

In `docs/conformance-coverage.json`: add `manifest-signature` to all three `claims` arrays, and add Python's deferral list — the file names of every `ed25519`, `verify` and `sign` case.

- [ ] **Step 2: Add the two `ci.yml` entries**

The `conformance` job carries a hand-maintained guard list and a hand-maintained Python runner list. Add `sdks/typescript/scripts/manifest-signature-guard.test.ts` and `sdks/python/tests/test_manifest_signature_corpus.py`.

**This is the entry whose omission fails late.** A recording guard absent from that list is never run by the job, so the corpus is claimed and silently never executed — the test's own comment records a Python runner having done exactly that.

- [ ] **Step 3: Update every sentence `COUNT_CLAIMS` pins**

| File | Change |
|---|---|
| `CLAUDE.md` | "Thirteen corpora are published" → **Fourteen**; "Eleven carry their own `index.json`" → **Twelve** |
| `CLAUDE.md` | "Nine is nevertheless what GOVERNANCE criterion 1 asks of this binding" → **Ten** |
| `CLAUDE.md` | "The four Go does not claim" — unchanged; Go claims the new corpus |
| `docs/GOVERNANCE.md` | "all thirteen published corpora where Python executes nine and Go executes nine" → **fourteen / ten / ten** |
| `docs/GOVERNANCE.md` | "thirteen are published, and no binding but the reference implementation runs all thirteen" → **fourteen … fourteen** |

- [ ] **Step 4: Update every list `NAME_CLAIMS` pins**

Add `manifest-signature` to `CLAUDE.md`'s "Go executes `negotiation` …" paragraph and to `sdks/go/README.md`'s Status section's executed list. The not-executed list is unchanged.

- [ ] **Step 5: Disclose the deferral next to the claim count**

Immediately after `docs/GOVERNANCE.md`'s pinned criterion-1 sentence, add a sentence recording that Python's ten includes `manifest-signature` with its crypto cases deferred, and that RFC-0013's criterion — *every published corpus whose surface the binding publishes* — is satisfied at case granularity because the deferred cases are exactly the ones whose surface Python does not publish.

Leave the pinned sentence itself byte-identical; `COUNT_CLAIMS` matches with `includes`, so a following sentence is safe.

- [ ] **Step 6: Fix `docs/spec/README.md`, including S1's drift**

- "Thirteen guards run on every pull request" → **Fourteen**, and the newest is now `manifest-signature-guard.test.ts`.
- "Eleven kinds of assertion, across **twelve** corpus directories" → **twelve kinds, fourteen directories**. Both numbers were already wrong by one before this shipment: S1 added `canonical-json` and bumped neither.
- Add the guard's own subsection, and name `manifest-signature` in the language-neutrality paragraph.

- [ ] **Step 7: Pin the sentence S1 let drift**

Add an entry to `COUNT_CLAIMS` in `sdks/typescript/scripts/corpus-parity.test.ts` for the `docs/spec/README.md` corpus-directory sentence, so the next corpus cannot repeat the drift.

- [ ] **Step 8: Regenerate and verify**

```bash
cd sdks/typescript && bun run conformance:coverage && bun test scripts/corpus-parity.test.ts scripts/conformance-coverage.test.ts
```
Expected: PASS. `docs/conformance-coverage.md` should now show `19 of 48` for Python.

- [ ] **Step 9: Commit**

```bash
git add docs/ CLAUDE.md sdks/go/README.md .github/workflows/ci.yml sdks/typescript/scripts/corpus-parity.test.ts
git commit -m "docs(signing): declare the manifest-signature corpus across all three bindings"
```

---

## Task 10: Capability pages, goldens, and the matrix

**Files:**
- Create: `docs/modules/manifest-signature.md`
- Modify: `docs/modules/signing.md`, `sdks/typescript/scripts/smoke-calls.mjs`, `docs/api-surface.md`, `docs/api-surface-go.md`, `docs/stability-matrix.md`

**Interfaces:**
- Consumes: everything.
- Produces: nothing code-facing.

- [ ] **Step 1: Split the capability pages**

`docs/modules/signing.md`'s `covers:` comment gains the pure modules in all three bindings:

```
<!-- covers: signing/canonical-json, signing/errors, signing/base64url, signing/jwk, signing/jws
     py: signing/canonical_json, signing/errors, signing/base64url, signing/jwk, signing/jws
     go: signing/canonicaljson, signing/errors, signing/base64url, signing/jwk, signing/jws -->
```

`docs/modules/manifest-signature.md` is new and claims the crypto module **with no `py:` clause**:

```
<!-- covers: signing/manifest-signature
     go: signing/manifestsignature -->
```

That omission is the point: `stability-matrix.ts` renders `—` for a binding claiming zero files, so Python's S2 gap shows in a generated document instead of hiding behind a shared row.

- [ ] **Step 2: Write both pages**

Usage guides, not contracts — say so, and link `docs/spec/signing/v1/manifest-signature.md` as the normative source. Every fenced `ts` block is typechecked against `dist/` by `docs-snippets.test.ts` and must not import a third-party specifier.

- [ ] **Step 3: Add the smoke-call entries**

One entry in `sdks/typescript/scripts/smoke-calls.mjs` per new module — five — each executing a real call against the built `dist/`.

- [ ] **Step 4: Regenerate the three goldens and the matrix**

```bash
cd sdks/typescript && bun run build && bun run api:surface
go -C sdks/go run ./internal/apisurface/cmd
cd ../.. && bun run stability:matrix
```

- [ ] **Step 5: Verify the matrix says what it should**

`docs/stability-matrix.md` must now carry:

```
| manifest-signature | experimental | — | experimental |
```

If Python's cell is not `—`, the `covers:` comment in step 1 has a stray `py:` clause.

- [ ] **Step 6: Run the full TypeScript suite**

Run: `cd sdks/typescript && bun run test`
Expected: PASS, including `docs-coverage`, `smoke-calls`, `docs-snippets`, `stability-matrix` and `api-surface`.

- [ ] **Step 7: Commit**

```bash
git add docs/ sdks/typescript/scripts/smoke-calls.mjs
git commit -m "docs(signing): capability pages, API-surface goldens and the stability matrix"
```

---

## Task 11: Governance prose, and verification in a clean clone

**Files:**
- Modify: `docs/rfcs/0020-manifest-signing.md`, `docs/ROADMAP.md`, `CLAUDE.md`, `sdks/typescript/src/crypto/verify-signature.ts`, `sdks/typescript/src/crypto/canonical-json.ts`

- [ ] **Step 1: Amend RFC-0020 §9**

S2's row said Python *"records a non-claim."* It records per-case deferrals instead. Add a short amendment note giving the reason — the `unclaimed` map holds permanent structural gaps, and a deferral names precisely which cases Python does not run — and correct S3's row, which says it *"deletes S2's non-claim."*

- [ ] **Step 2: Correct S1's deprecation notices**

`crypto/verify-signature.ts` and `crypto/canonical-json.ts` carry `@deprecated` notices saying the replacement *"has not shipped yet, in a later shipment."* It has. Point them at the real names. **Do not remove or otherwise change these modules** — that is S5, and `commit-guard` blocks it.

- [ ] **Step 3: Update `CLAUDE.md`'s divergence inventory**

Do **not** add a fourth behavioral divergence. Widen the first: sync-versus-async goes from one function to six, still two-against-one, TypeScript still the outlier. Also update the `./signing` bullet in the Public surface section, which currently describes the envelope as coming "from a later shipment."

- [ ] **Step 4: Update `docs/ROADMAP.md`**

Phase 4's *"A manifest signature path proven end-to-end (sign → publish → gateway verify)"* box stays `[ ]` — S2 ships sign and verify, but the gateway half lives in the Nimbus monorepo. Record what landed and what the box still waits on.

- [ ] **Step 5: Verify in a clone outside the repository**

A worktree under `.claude/worktrees/` resolves `node_modules` from the parent checkout, so a green run there does not prove CI green.

```bash
git clone --branch <branch> . /tmp/s2-verify
cd /tmp/s2-verify && bun install --frozen-lockfile
bun run build && bun run --cwd tools/create-connector build
bun run test && bun run scaffold:test
cd sdks/python && python -m pip install -e . && python -m pytest -q
cd ../.. && NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
```

Build before testing — `api-surface`, `smoke-calls` and `pack-and-generate` execute the built package, not the source tree.

- [ ] **Step 6: Commit and open the pull request**

```bash
git add -A && git commit -m "docs(signing): record S2 in the RFC, roadmap and divergence inventory"
```

The PR title **must** be `feat(signing): the detached JWS manifest signature envelope` — `commit-guard` reads the title, diffs all three goldens, and this shipment adds exported surface in two bindings and renames one in a third.

Expect release-please to cut TypeScript, Python **and** Go releases under that one subject line; this touches all four component paths, which is the #155 behaviour and is accepted here as it was for S1.

---

## Notes for the executor

**Do not "fix" the measured constants.** The ten Ed25519 vectors and the RFC 8037 thumbprint were measured against all four runtimes on 2026-09-05 and are recorded in the design. If your implementation disagrees with one, your implementation is wrong.

**If Go and TypeScript produce different signature bytes for the same manifest in Task 7 step 5, stop and escalate.** That is a cross-language disagreement on a security primitive, which `docs/GOVERNANCE.md` classes as contract-affecting and therefore RFC-gated. It is not a number to adjust.

**The ordering in §8 is the contract, not an implementation detail.** Every step must run in the documented order even where a cheaper order would give the same answer for valid input. The three ordering corpus cases exist to catch exactly that shortcut.
