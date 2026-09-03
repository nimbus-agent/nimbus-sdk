# Manifest Signing S0–S1: RFC and Canonicalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish RFC-0020, then specify manifest canonicalization as a normative document with a conformance corpus executed byte-identically by all three bindings — fixing the four measured cross-language divergences and opening the deprecation window on the old `crypto` signing surface.

**Architecture:** A new `signing` surface in each binding (TypeScript's sixth entry point, Python's ninth import root, Go's tenth package) holding canonicalization only. The old `crypto/canonical-json.ts` and `crypto/verify-signature.ts` stay **byte-for-byte unchanged** and are merely marked `@deprecated`, opening the two-release window that a later shipment needs before it may remove them. No cryptography ships in this plan.

**Tech Stack:** TypeScript (Bun + `tsc` strict, Biome), Python 3.11+ (`pyproject.toml` sets `target-version = "py311"`; `ruff`, `mypy` strict, `pytest`), Go 1.26 (stdlib `testing` only). Zero runtime dependencies in all three.

**Spec:** [`docs/superpowers/specs/2026-09-02-manifest-signing-design.md`](../specs/2026-09-02-manifest-signing-design.md), revised after [its review](../specs/2026-09-02-manifest-signing-design-review.md).

## Global Constraints

- **Zero runtime dependencies** in all three bindings. TypeScript: no `dependencies` in `package.json`. Python: `[project].dependencies` stays empty. Go: no `require` block.
- **No `any`; TypeScript strict.** Use `unknown` at boundaries and narrow with a type guard. Biome enforces `noExplicitAny` and `noConsole` in `sdks/typescript/src/`.
- **Every module declares a stability tier.** TypeScript `/** @moduleStability experimental */` above the module's **first export** (never above an import — `tsc` elides the comment with an unused import). Python `__stability__ = "experimental"`. Go `// Stability: experimental` inside the package doc comment. There is no default; the generators throw.
- **New corpus cases and their `index.json` entry land in the same commit.** A case on disk that no index lists is executed by nothing.
- **After editing anything under `docs/spec/`:** run `go -C sdks/go generate ./spec` (the committed Go mirror) and `python -m pip install -e .` from `sdks/python/` before `pytest` (the gitignored `_data/spec` snapshot, a local-only false-green trap).
- **Canonicalization rejection tokens** (closed set): `non-integer-number`, `number-out-of-range`, `unsupported-type`, `nesting-too-deep`, `lone-surrogate`.
- **Integer bound:** ±(2⁵³−1) = ±9007199254740991 inclusive.
- **Depth cap:** 32, counting the top-level value as depth 0. Depth 33 is rejected.
- **Commit types:** every task in this plan is additive — `feat:` or `docs:`. Nothing here is a breaking change; the `feat!:` belongs to the removal shipment, not this plan.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `docs/rfcs/0020-manifest-signing.md` | The governance decision record |
| `docs/spec/signing/v1/canonical-json.md` | The normative canonicalization document |
| `docs/spec/conformance/v1/canonical-json/{index,case,index.schema,case.schema}.json` + `cases/*.json` | The corpus |
| `sdks/typescript/src/signing/{canonical-json,index}.ts` + `canonical-json.test.ts` | TS binding + sixth entry point |
| `sdks/typescript/scripts/canonical-json-guard.test.ts` | TS corpus runner |
| `sdks/python/src/nimbus_sdk/signing/{__init__,canonical_json}.py` | Python binding, ninth import root |
| `sdks/python/tests/{test_canonical_json,test_canonical_json_corpus}.py` | Python unit + corpus runner |
| `sdks/go/signing/canonicaljson.go` + `canonicaljson_test.go` | Go binding, tenth package |
| `sdks/go/conformance/canonicaljson_test.go` | Go corpus runner |
| `docs/modules/signing.md` | The capability page the docs gate requires |

**Modified:** `sdks/typescript/package.json` (exports map), `sdks/typescript/scripts/smoke-calls.mjs`, `docs/api-surface{,-python,-go}.md`, `docs/stability-matrix.md`, `docs/conformance-coverage.{json,md}`, `docs/spec/README.md`, `sdks/python/scripts/api_surface.py` (`IMPORT_ROOTS`), `sdks/go/internal/apisurface/cmd/main.go` (`packages`), `sdks/go/spec/data/**`, `CLAUDE.md`, `docs/rfcs/README.md`, and in Task 9 the old `crypto/*` modules (deprecation markers only).

---

### Task 1: RFC-0020

**Files:**
- Create: `docs/rfcs/0020-manifest-signing.md`
- Modify: `docs/rfcs/README.md` (index table)

**Interfaces:**
- Consumes: nothing.
- Produces: the citation `RFC-0020`, referenced by every later task's commit body and by `docs/spec/signing/v1/canonical-json.md`.

This is a governance prerequisite — `docs/GOVERNANCE.md` classes a new conformance invariant as contract-affecting. It merges as its own pull request before any code lands.

- [ ] **Step 1: Read two neighbouring RFCs for house structure**

Run: `sed -n '1,60p' docs/rfcs/0011-url-resolution.md` and `sed -n '1,40p' docs/rfcs/0015-tiered-stability.md`

Match their front matter (title, status, date, authors) and section numbering exactly.

- [ ] **Step 2: Write the RFC**

Create `docs/rfcs/0020-manifest-signing.md` carrying, at minimum, these sections — the content is the design doc's, condensed, not new material:

1. **Summary** — manifest signing becomes a specified contract in three languages; canonicalization first, JWS envelope second.
2. **The four measured divergences** — copy §1.1–§1.4 of the design verbatim, including the measured values (`z`/`😀`/`Ｚ` orderings, `1e21`, `<&>`, `"QQ"`/`"QR"` → `0x41`). State the runtimes: Node 22, CPython 3.14, Go 1.27.
3. **NFC is dropped** — Go publishes no importable normalization in `std`; state the consequence (a publisher whose editor emits NFD signs NFD).
4. **The sort fix is a fix, not a disclosure** — cite RFC-0014 and the U+0130 fold as the precedent: two of three bindings already agree.
5. **The envelope** — detached JWS, `alg: EdDSA`, `kid` = RFC 7638 thumbprint, no key material in the manifest, algorithm selected from the resolved key.
6. **Replace, not coexist** — and the consequence: removal requires the DEPRECATION-POLICY window and takes `@nimbus-dev/sdk` to **2.0.0**.
7. **Python's Ed25519 side-channel** — verification is safe on public data; signing leaks; disclosed, not mitigated.

- [ ] **Step 3: Add the index row**

Append a row to the table in `docs/rfcs/README.md` matching the existing column order. Verify: `grep -n "0019\|0020" docs/rfcs/README.md` shows both, adjacent.

- [ ] **Step 4: Verify every internal link resolves**

```bash
grep -oE '\]\(\.\./[^)]+\)|\]\(\./[^)]+\)' docs/rfcs/0020-manifest-signing.md \
  | sed -E 's/^\]\(//; s/\)$//' \
  | while read -r p; do [ -e "docs/rfcs/$p" ] || echo "BROKEN: $p"; done
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add docs/rfcs/0020-manifest-signing.md docs/rfcs/README.md
git commit -m "docs: RFC-0020, manifest signing as a specified three-language contract"
```

---

### Task 2: The normative canonicalization document

**Files:**
- Create: `docs/spec/signing/v1/canonical-json.md`
- Modify: `docs/spec/README.md` (guard roster + count)

**Interfaces:**
- Consumes: RFC-0020's decisions.
- Produces: the section anchors `## §4` … `## §8` and the five rejection tokens, both of which Task 5's guard asserts against this file by text match.

- [ ] **Step 1: Write the document**

Create `docs/spec/signing/v1/canonical-json.md`. It **must** contain the literal strings `**Status:** normative` and `RFC 2119` — Task 5's guard asserts both. Headings must be `## §N …` form, because the guard checks `text.includes("## " + section)`.

Sections, with the normative content from the design's §5:

- `## §1 Scope` — what canonicalization is for; the JWS payload. Prose, unpinnable.
- `## §2 Terminology` — RFC 2119 boilerplate. Prose.
- `## §3 Input domain` — the value space of a parsed manifest: object, array, string, integer, boolean, null. Prose plus the `unsupported-type` token.
- `## §4 Key ordering` — keys MUST be sorted ascending by **Unicode code point**. State explicitly that UTF-16 code-unit order is non-conformant, and name the failing example: with keys `z`, `Ｚ` (U+FF3A) and `😀` (U+1F600), the conformant order is `z`, `Ｚ`, `😀`.
- `## §5 Numbers` — a number is an **integer if its value is integral**. The literal form
  is **not observable and MUST NOT be consulted**: `1`, `1.0` and `1e2` are numbers whose
  values are 1, 1 and 100, and they canonicalize to `1`, `1` and `100`. State this
  explicitly and state why — `JSON.parse("1.0")` returns `1`, so the literal is destroyed
  before any TypeScript binding runs and a literal-based rule would be unimplementable in
  the reference binding. A non-integral value MUST be rejected with `non-integer-number`;
  a non-finite one, and any integral value whose magnitude exceeds 9007199254740991, with
  `number-out-of-range`. Serialized as the shortest decimal integer, no exponent, no
  leading `+`.
- `## §6 Strings` — byte-preserving, no normalization. Escape exactly `"`, `\`, and U+0000–U+001F; use `\b \f \n \r \t` where they apply and `\u00XX` (lowercase hex) for the remaining controls. All other code points MUST be emitted literally — in particular `<`, `>` and `&` MUST NOT be escaped. A lone surrogate MUST be rejected with `lone-surrogate`.

  **§6 must also record that `lone-surrogate` is pinned by unit tests rather than by the
  corpus, and why.** A corpus case would have to carry the input as the JSON escape
  `"\ud800"`, and every runner decodes its cases before reaching the binding: Node and
  CPython both preserve U+D800, while Go's `encoding/json` substitutes U+FFFD and returns
  no error — measured, 3 bytes `ef bf bd`. The case would therefore test a different
  input in Go than in the other two, which is the one thing a language-neutral corpus may
  not do. Each binding pins it natively instead.
- `## §7 Depth` — the top-level value is depth 0; a value at depth greater than 32 MUST be rejected with `nesting-too-deep`.
- `## §8 Manifest stripping` — `canonicalizeManifest` removes the top-level `signature` member and canonicalizes the remainder. Shallow only: a member named `signature` at any other depth is ordinary data.
- `## §9 Rejection tokens` — the closed set, one row each. Prose, unpinnable (every token is pinned through §3–§7).

- [ ] **Step 2: Update the spec README's guard count only — NOT the neutrality paragraph**

`docs/spec/README.md`'s *How this stays true* section opens with *"Twelve guards run on
every pull request"*. Increment that count and name the new `canonical-json` guard
alongside the others. No test reads this sentence; it is free prose.

**Do not touch the language-neutrality paragraph** — the one beginning *"What holds the
contract to being **language-neutral**"*. `corpus-parity.test.ts` asserts against it in
both directions: it must name every corpus **more than one** binding claims, and it must
**not** name a corpus only one binding claims. Through Tasks 2–5 `canonical-json` is
claimed by TypeScript alone, so naming it here fails the suite. Task 6 adds it, at the
moment Python's claim makes it dual-run.

Run: `grep -n -i "how this stays true" -A 30 docs/spec/README.md` first, to see the exact shape before editing.

- [ ] **Step 3: Verify the guard's text preconditions hold**

```bash
grep -c "^\*\*Status:\*\* normative" docs/spec/signing/v1/canonical-json.md
grep -c "RFC 2119" docs/spec/signing/v1/canonical-json.md
for s in 4 5 6 7 8; do grep -q "^## §$s" docs/spec/signing/v1/canonical-json.md \
  || echo "MISSING ## §$s"; done
```
Expected: `1`, then a non-zero count, then no `MISSING` lines.

- [ ] **Step 4: Re-sync the Go mirror**

Run: `go -C sdks/go generate ./spec`
Then: `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./spec/...`
Expected: PASS. (`docs/spec/` changed, so `sdks/go/spec/data/` must change with it in this commit.)

- [ ] **Step 5: Commit**

```bash
git add docs/spec/signing docs/spec/README.md sdks/go/spec/data
git commit -m "docs(spec): publish canonical-json v1, the manifest canonicalization contract"
```

---

### Task 3: TypeScript canonicalization — the four fixes, under test

**Files:**
- Create: `sdks/typescript/src/signing/canonical-json.ts`
- Test: `sdks/typescript/src/signing/canonical-json.test.ts`

**Interfaces:**
- Consumes: §4–§8 of the document from Task 2.
- Produces, for Tasks 4, 5 and 9:
  - `canonicalize(value: unknown): string`
  - `canonicalizeManifest(manifest: object): Uint8Array`
  - `class CanonicalizationError extends Error { readonly reason: CanonicalizationReason }`
  - `type CanonicalizationReason = "non-integer-number" | "number-out-of-range" | "unsupported-type" | "nesting-too-deep" | "lone-surrogate"`
  - `const CANONICALIZATION_REASONS: readonly CanonicalizationReason[]`

Note the deliberate departure from the old module: **one error class carrying a `reason`**, not three classes. The corpus asserts a token, and a token is what a Python and a Go binding can both produce.

- [ ] **Step 1: Write the failing test**

Create `sdks/typescript/src/signing/canonical-json.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  CANONICALIZATION_REASONS,
  CanonicalizationError,
  canonicalize,
  canonicalizeManifest,
} from "./canonical-json.js";

const reasonOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    if (err instanceof CanonicalizationError) return err.reason;
    throw err;
  }
  throw new Error("expected a CanonicalizationError, got none");
};

describe("§4 key ordering", () => {
  test("sorts by code point, not UTF-16 code unit", () => {
    // The live cross-language bug: JS `<` puts the astral key before U+FF3A,
    // because a surrogate pair starts at 0xD800. Python and Go both disagree.
    const value = { "\u{1F600}": 1, "Ｚ": 2, z: 3 };
    expect(canonicalize(value)).toBe('{"z":3,"Ｚ":2,"\u{1F600}":1}');
  });

  test("orders plain ASCII keys lexicographically", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("§5 numbers", () => {
  test("accepts the largest safe integer", () => {
    expect(canonicalize(9007199254740991)).toBe("9007199254740991");
  });

  test("rejects one past it, which JS would otherwise serialize exponentially", () => {
    expect(reasonOf(() => canonicalize(1e21))).toBe("number-out-of-range");
  });

  test("rejects a non-integer", () => {
    expect(reasonOf(() => canonicalize(1.5))).toBe("non-integer-number");
  });

  test("an integral value is an integer whatever literal produced it", () => {
    // §5 is a rule about the VALUE. `JSON.parse("1.0")` is already 1 here, so this
    // binding cannot see the literal at all — which is why the rule has to be
    // value-based, and why Python and Go must not consult their own literals either.
    expect(canonicalize(JSON.parse("1.0") as number)).toBe("1");
    expect(canonicalize(JSON.parse("1e2") as number)).toBe("100");
  });

  test("emits negative zero as 0", () => {
    expect(canonicalize(-0)).toBe("0");
  });
});

describe("§6 strings", () => {
  test("does not HTML-escape, unlike Go's encoding/json default", () => {
    expect(canonicalize("<&>")).toBe('"<&>"');
  });

  test("does not normalize — NFD survives as NFD", () => {
    expect(canonicalize("e\u0301")).toBe('"e\u0301"');
  });

  test("escapes the five named controls and hex-escapes the rest", () => {
    expect(canonicalize("\b\f\n\r\t\u0001")).toBe('"\\b\\f\\n\\r\\t\\u0001"');
  });

  test("escapes the quote and the backslash only", () => {
    expect(canonicalize('a"b\\c/d')).toBe('"a\\"b\\\\c/d"');
  });

  test("rejects a lone surrogate", () => {
    expect(reasonOf(() => canonicalize("\ud800"))).toBe("lone-surrogate");
  });
});

describe("§7 depth", () => {
  const nest = (depth: number): unknown => {
    let v: unknown = 1;
    for (let i = 0; i < depth; i++) v = [v];
    return v;
  };

  test("accepts depth 32", () => {
    expect(() => canonicalize(nest(32))).not.toThrow();
  });

  test("rejects depth 33", () => {
    expect(reasonOf(() => canonicalize(nest(33)))).toBe("nesting-too-deep");
  });
});

describe("§8 manifest stripping", () => {
  test("strips the top-level signature and nothing else", () => {
    const bytes = canonicalizeManifest({ id: "x", signature: "sig", a: { signature: "keep" } });
    expect(new TextDecoder().decode(bytes)).toBe('{"a":{"signature":"keep"},"id":"x"}');
  });
});

describe("§9 tokens", () => {
  test("every published reason is reachable", () => {
    expect([...CANONICALIZATION_REASONS].sort()).toEqual(
      [
        "lone-surrogate",
        "nesting-too-deep",
        "non-integer-number",
        "number-out-of-range",
        "unsupported-type",
      ].sort(),
    );
  });

  test("rejects a value outside the input domain", () => {
    expect(reasonOf(() => canonicalize(undefined))).toBe("unsupported-type");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd sdks/typescript && bun test src/signing/canonical-json.test.ts`
Expected: FAIL — cannot resolve `./canonical-json.js`.

- [ ] **Step 3: Write the implementation**

Create `sdks/typescript/src/signing/canonical-json.ts`:

```ts
/**
 * Deterministic JSON canonicalization for extension manifests.
 *
 * @moduleStability experimental
 *
 * The binding of `docs/spec/signing/v1/canonical-json.md`. Produces the bytes a
 * detached JWS signs, so two bindings that disagree here produce signatures that
 * do not verify across languages — which is exactly what the module this one
 * replaces did (RFC-0020 §2).
 *
 * Nothing here normalizes: Go publishes no importable Unicode normalization, so an
 * NFC rule could not be bound in all three languages without a dependency.
 */

export type CanonicalizationReason =
  | "non-integer-number"
  | "number-out-of-range"
  | "unsupported-type"
  | "nesting-too-deep"
  | "lone-surrogate";

/** §9. The closed set. A binding may never invent a sixth. */
export const CANONICALIZATION_REASONS: readonly CanonicalizationReason[] = [
  "lone-surrogate",
  "nesting-too-deep",
  "non-integer-number",
  "number-out-of-range",
  "unsupported-type",
];

export class CanonicalizationError extends Error {
  override readonly name = "CanonicalizationError";
  readonly reason: CanonicalizationReason;
  constructor(reason: CanonicalizationReason) {
    super(`canonicalize: ${reason}`);
    this.reason = reason;
  }
}

/** §5. 2**53 - 1, the largest integer JSON numbers carry losslessly in every binding. */
const MAX_MAGNITUDE = 9007199254740991;

/** §7. The top-level value is depth 0. */
const MAX_DEPTH = 32;

/**
 * §4. Ascending code point order.
 *
 * `Array.from` iterates code points, so an astral character compares as its single
 * scalar value rather than as the surrogate pair JavaScript's `<` would compare.
 * The `?? 0` branches are unreachable — `i` is bounded by the shorter array — and
 * exist only because `noUncheckedIndexedAccess` cannot see that.
 */
const codePoints = (s: string): number[] => Array.from(s, (c) => c.codePointAt(0) ?? 0);

function compareCodePoints(a: string, b: string): number {
  const x = codePoints(a);
  const y = codePoints(b);
  const shared = Math.min(x.length, y.length);
  for (let i = 0; i < shared; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** §6. Byte-preserving, with exactly the escapes JSON requires and no others. */
function encodeString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) throw new CanonicalizationError("lone-surrogate");
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (cp === 0x08) out += "\\b";
    else if (cp === 0x0c) out += "\\f";
    else if (cp === 0x0a) out += "\\n";
    else if (cp === 0x0d) out += "\\r";
    else if (cp === 0x09) out += "\\t";
    else if (cp < 0x20) out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

function canonicalizeAt(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) throw new CanonicalizationError("nesting-too-deep");
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") return encodeString(value);
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new CanonicalizationError("non-integer-number");
    if (value > MAX_MAGNITUDE || value < -MAX_MAGNITUDE) {
      throw new CanonicalizationError("number-out-of-range");
    }
    // `Object.is(-0, -0)` is true, and `String(-0)` is already "0"; stated so a reader
    // does not add a branch that would diverge from the other two bindings.
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeAt(v, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareCodePoints);
    const members = keys.map((k) => `${encodeString(k)}:${canonicalizeAt(obj[k], depth + 1)}`);
    return `{${members.join(",")}}`;
  }
  throw new CanonicalizationError("unsupported-type");
}

/** Canonicalize any value in §3's input domain. */
export function canonicalize(value: unknown): string {
  return canonicalizeAt(value, 0);
}

/**
 * §8. Canonicalize a manifest with its top-level `signature` member removed.
 * Shallow: a nested member named `signature` is ordinary data.
 */
export function canonicalizeManifest(manifest: object): Uint8Array {
  const clone: Record<string, unknown> = { ...(manifest as Record<string, unknown>) };
  delete clone["signature"];
  return new TextEncoder().encode(canonicalize(clone));
}
```

- [ ] **Step 4: Run the tests and the type checker**

Run: `cd sdks/typescript && bun test src/signing/canonical-json.test.ts && bun run typecheck && bun run lint`
Expected: all tests PASS, no type errors, no lint findings.

If the `§4 key ordering` test fails, the sort comparator is the bug — that test is the regression guard for the live divergence and must never be weakened to match the implementation.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/src/signing/canonical-json.ts sdks/typescript/src/signing/canonical-json.test.ts
git commit -m "feat(signing): bind canonical-json v1 in TypeScript, fixing the UTF-16 key sort"
```

---

### Task 4: Publish `@nimbus-dev/sdk/signing` — the sixth entry point

**Files:**
- Create: `sdks/typescript/src/signing/index.ts`, `docs/modules/signing.md`
- Modify: `sdks/typescript/package.json` (exports map), `sdks/typescript/scripts/smoke-calls.mjs`, `docs/api-surface.md`, `docs/stability-matrix.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything Task 3 produced.
- Produces: the import specifier `@nimbus-dev/sdk/signing`, which Task 5's guard and every later shipment import from.

Four CI gates fire here and none of them is optional. This task exists as its own unit because a reviewer can reject the wiring while accepting Task 3's algorithm.

- [ ] **Step 1: Write the entry point**

Create `sdks/typescript/src/signing/index.ts`:

```ts
/**
 * `@nimbus-dev/sdk/signing` — manifest canonicalization and, from a later shipment,
 * the detached JWS envelope.
 *
 * A separate entry point because signing is a separate contract with its own spec area
 * (`docs/spec/signing/v1/`) — the same claim the `.` vs `./ipc` vs `./diagnostics`
 * split already makes.
 */
export {
  CANONICALIZATION_REASONS,
  type CanonicalizationReason,
  CanonicalizationError,
  canonicalize,
  canonicalizeManifest,
} from "./canonical-json.js";
```

- [ ] **Step 2: Add the exports-map entry**

In `sdks/typescript/package.json`, after the `"./diagnostics"` block, add:

```json
    "./signing": {
      "bun": "./src/signing/index.ts",
      "types": "./dist/signing/index.d.ts",
      "import": "./dist/signing/index.js",
      "default": "./dist/signing/index.js"
    }
```

- [ ] **Step 3: Add the smoke-call entry**

`sdks/typescript/scripts/smoke-calls.mjs` — each `run` receives the entry points already imported by the smoke harness. Read the harness first to learn the current parameter order:

Run: `grep -n "SMOKE_CALLS\|import(" sdks/typescript/scripts/smoke-calls.test.ts | head -20`

Then append an entry whose `module` key is `signing/canonical-json`, calling `canonicalizeManifest` on a real manifest and asserting the exact bytes — an entry that only checks `length > 0` would pass against a broken sort:

```js
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
```

If the harness does not yet pass a sixth argument, add `./signing` to its import list in `smoke-calls.test.ts` in the same edit.

- [ ] **Step 4: Write the capability page**

Create `docs/modules/signing.md`, opening with the coverage claim comment the docs gate parses:

```markdown
<!-- covers: signing/canonical-json -->
```

Follow the shape of `docs/modules/diagnostics.md`. Any fenced ` ```ts ` block is compiled against `dist/` by `docs-snippets.test.ts`, so every snippet must import from `@nimbus-dev/sdk/signing` and must typecheck. Do not import `zod` or `@modelcontextprotocol/sdk` — the snippet gate refuses third-party specifiers by name.

- [ ] **Step 5: Update CLAUDE.md's entry-point count**

CLAUDE.md's *Public surface* section says the map has **five** entries and ends with *"This makes it a **five**-entry `exports` map."* Both become six, and a `./signing` bullet joins the list describing what it holds. Verify no stale count survives:

Run: `grep -n -i "five-entry\|five entry" CLAUDE.md`
Expected: no output.

- [ ] **Step 6: Regenerate the goldens and run every gate**

```bash
cd sdks/typescript
bun run build
bun run api:surface
cd ../.. && bun run stability:matrix
bun run test
```
Expected: PASS. `api-surface.md` gains the `signing` exports each carrying `**Stability:** experimental`; `stability-matrix.md` gains a row.

If `docs-coverage.test.ts` fails with a module claimed by no page, the `covers:` comment in Step 4 does not match the module key — read the failure, which names the key it wanted.

- [ ] **Step 7: Commit**

```bash
git add sdks/typescript/src/signing/index.ts sdks/typescript/package.json \
        sdks/typescript/scripts/smoke-calls.mjs sdks/typescript/scripts/smoke-calls.test.ts \
        docs/modules/signing.md docs/api-surface.md docs/stability-matrix.md CLAUDE.md
git commit -m "feat(signing): publish @nimbus-dev/sdk/signing as the sixth entry point"
```

---

### Task 5: The conformance corpus and the TypeScript guard

**Files:**
- Create: `docs/spec/conformance/v1/canonical-json/{index.json,index.schema.json,case.schema.json}` and `cases/*.json`
- Create: `sdks/typescript/scripts/canonical-json-guard.test.ts`
- Modify: `docs/conformance-coverage.json`, `docs/conformance-coverage.md`, `sdks/go/spec/data/**`

**Interfaces:**
- Consumes: `canonicalize` / `canonicalizeManifest` / `CanonicalizationError` from Task 3.
- Produces: the corpus name `canonical-json`, loaded by Task 6's `load_corpus("canonical-json")` and Task 7's `corpusCases(t, "canonical-json")`.

The case shape is `mode` + `input` + `expect`, with the expected bytes **hex-encoded** — the corpus asserts byte equality, and a JSON string would route those bytes through the corpus file's own escaping.

- [ ] **Step 1: Write the two schemas**

`docs/spec/conformance/v1/canonical-json/case.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/conformance/v1/canonical-json/case.schema.json",
  "title": "Canonical-JSON conformance case",
  "description": "One canonicalization. An input value and either the exact bytes produced, hex-encoded, or the exact rejection token.",
  "type": "object",
  "required": ["description", "mode", "input", "expect"],
  "additionalProperties": false,
  "properties": {
    "description": { "type": "string", "pattern": "\\S" },
    "mode": {
      "enum": ["value", "manifest"],
      "description": "\"value\" drives canonicalize; \"manifest\" drives canonicalizeManifest, which strips the top-level signature member first."
    },
    "input": {
      "description": "The value being canonicalized. Deliberately unconstrained — several cases supply values outside the input domain, which is what unsupported-type pins."
    },
    "expect": {
      "type": "object",
      "required": ["ok"],
      "additionalProperties": false,
      "properties": {
        "ok": { "type": "boolean" },
        "canonical": {
          "type": "string",
          "pattern": "^([0-9a-f]{2})*$",
          "description": "On success: the exact UTF-8 bytes produced, lowercase hex, no separators. Hex rather than a string so the corpus file's own JSON escaping cannot alter what is asserted."
        },
        "reason": {
          "enum": [
            "non-integer-number",
            "number-out-of-range",
            "unsupported-type",
            "nesting-too-deep",
            "lone-surrogate"
          ],
          "description": "On refusal: the §9 token."
        }
      },
      "allOf": [
        { "if": { "properties": { "ok": { "const": true } } }, "then": { "required": ["canonical"] } },
        { "if": { "properties": { "ok": { "const": false } } }, "then": { "required": ["reason"] } }
      ]
    }
  }
}
```

`docs/spec/conformance/v1/canonical-json/index.schema.json` — copy `url-resolution/index.schema.json` verbatim, changing only `$id`, `title`, `description`, and the `spec` const to `"../../../signing/v1/canonical-json.md"`. **Keep the `section` pattern as `^§[0-9]+(\\.[0-9]+)*$`** — the section pattern is not the same across corpora and copying the wrong one is the classic failure here.

- [ ] **Step 2: Write the guard, which will fail against an empty corpus**

Create `sdks/typescript/scripts/canonical-json-guard.test.ts`, structured like `url-resolution-guard.test.ts`:

```ts
/**
 * The executable form of `docs/spec/signing/v1/canonical-json.md`.
 *
 * Validates the published schemas, holds the index and the directory to each other,
 * executes every case against the reference binding, and refuses to pass vacuously.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  CANONICALIZATION_REASONS,
  CanonicalizationError,
  canonicalize,
  canonicalizeManifest,
} from "../src/signing/canonical-json.ts";
import { createRecorder } from "./conformance-report.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/signing/v1/canonical-json.md";
const CORPUS_DIR = "docs/spec/conformance/v1/canonical-json";
const PINNED_SECTIONS = ["§4", "§5", "§6", "§7", "§8"] as const;

type Expect = { ok: true; canonical: string } | { ok: false; reason: string };
type Case = { description: string; mode: "value" | "manifest"; input: unknown; expect: Expect };
type IndexEntry = { file: string; section: string; reason: string };

const index = readJson(`${CORPUS_DIR}/index.json`) as { spec: string; cases: IndexEntry[] };
const cases: { entry: IndexEntry; body: Case }[] = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

const recorder = createRecorder("canonical-json", "guard");
afterAll(() => recorder.flush());

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

const run = (body: Case): Uint8Array =>
  body.mode === "manifest"
    ? canonicalizeManifest(body.input as object)
    : new TextEncoder().encode(canonicalize(body.input));

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
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases")).sort();
    const indexed = index.cases.map((c) => c.file.replace("cases/", "")).sort();
    expect(indexed).toEqual(onDisk);
  });
});

describe("the corpus cannot pass vacuously", () => {
  test("it is non-empty", () => {
    expect(cases.length).toBeGreaterThanOrEqual(21);
  });

  test("both outcomes are exercised", () => {
    expect(cases.some(({ body }) => body.expect.ok)).toBe(true);
    expect(cases.some(({ body }) => !body.expect.ok)).toBe(true);
  });

  test("both modes are exercised", () => {
    expect(cases.some(({ body }) => body.mode === "manifest")).toBe(true);
    expect(cases.some(({ body }) => body.mode === "value")).toBe(true);
  });

  test("every published rejection token except lone-surrogate is asserted by a case", () => {
    // `lone-surrogate` is deliberately absent, and its absence is not an oversight.
    // A case would have to carry the input as the JSON escape "\ud800", and every
    // runner decodes its cases before the binding sees them: Node and CPython preserve
    // U+D800, but Go's encoding/json substitutes U+FFFD and returns no error (measured:
    // 3 bytes, ef bf bd). The case would test a different input in Go than in the other
    // two, which is the one thing a language-neutral corpus may not do. Each binding
    // pins the token in its own unit tests instead — see canonical-json.md §6.
    const CORPUS_EXPRESSIBLE = CANONICALIZATION_REASONS.filter((r) => r !== "lone-surrogate");
    const asserted = new Set(
      cases.filter(({ body }) => !body.expect.ok).map(({ body }) => (body.expect as { reason: string }).reason),
    );
    expect([...asserted].sort()).toEqual([...CORPUS_EXPRESSIBLE].sort());
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
      expect(text.includes(`## ${entry.section}`), `${entry.file} cites a missing section`).toBe(true);
    }
  });

  test("§4 is pinned against UTF-16 code-unit order", () => {
    // Without an astral key beside a key in U+E000-U+FFFF, a binding sorting by UTF-16
    // code unit passes every other ordering case. This is the corpus's whole reason for
    // existing, so its absence must fail rather than silently reduce coverage.
    const astral = cases.filter(
      ({ body }) =>
        body.expect.ok &&
        typeof body.input === "object" &&
        body.input !== null &&
        Object.keys(body.input).some((k) => [...k].some((c) => (c.codePointAt(0) ?? 0) > 0xffff)) &&
        Object.keys(body.input).some((k) =>
          [...k].some((c) => {
            const cp = c.codePointAt(0) ?? 0;
            return cp >= 0xe000 && cp <= 0xffff;
          }),
        ),
    );
    expect(astral.length, "no case distinguishes code-point from code-unit order").toBeGreaterThan(0);
  });
});

describe("the reference binding satisfies every case", () => {
  for (const { entry, body } of cases) {
    test(`${entry.file}: ${body.description}`, () => {
      if (body.expect.ok) {
        expect(toHex(run(body))).toBe(body.expect.canonical);
        recorder.record(entry.file);
        return;
      }
      let caught: unknown;
      try {
        run(body);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CanonicalizationError);
      expect((caught as CanonicalizationError).reason).toBe(body.expect.reason);
      recorder.record(entry.file);
    });
  }
});
```

- [ ] **Step 3: Run the guard to watch it fail**

Run: `cd sdks/typescript && bun test scripts/canonical-json-guard.test.ts`
Expected: FAIL — the corpus directory does not exist.

- [ ] **Step 4: Write the cases**

Create `docs/spec/conformance/v1/canonical-json/cases/`, at least 22 files — one per row of the table below. `lone-surrogate` gets no case — it is not corpus-expressible (see the guard's comment and §6); it is pinned by a unit test in each binding instead. Compute each `canonical` hex with the reference binding rather than by hand:

```bash
cd sdks/typescript && bun -e '
import { canonicalize } from "./src/signing/canonical-json.ts";
const hex = (s) => [...new TextEncoder().encode(s)].map(b=>b.toString(16).padStart(2,"0")).join("");
console.log(hex(canonicalize({ "\u{1F600}": 1, "Ｚ": 2, z: 3 })));
'
```

Cases must include, at minimum, one per row:

| Case | `section` | Pins |
|---|---|---|
| `key-order-astral-vs-bmp` | `§4` | The live divergence. Keys `z`, `Ｚ`, `😀`. |
| `key-order-ascii` | `§4` | Ordinary lexicographic ordering |
| `key-order-empty-key` | `§4` | `""` sorts first |
| `number-max-safe-integer` | `§5` | 9007199254740991 accepted |
| `number-above-safe-range-rejected` | `§5` | `1e21` → `number-out-of-range` |
| `number-negative-max-safe` | `§5` | −9007199254740991 accepted |
| `number-non-integer-rejected` | `§5` | `1.5` → `non-integer-number` |
| `number-integral-float-accepted` | `§5` | `1.0` → `1`. Pins §5 as a rule about the VALUE: TypeScript cannot see the literal, Python sees a `float`, Go sees `json.Number("1.0")`, and all three must agree. |
| `number-negative-zero` | `§5` | `-0` serializes as `0` |
| `string-html-characters-literal` | `§6` | `<&>` unescaped — Go's default would fail |
| `string-nfd-preserved` | `§6` | `e` + U+0301 survives undecomposed |
| `string-nfc-preserved` | `§6` | `é` survives uncomposed |
| `string-named-control-escapes` | `§6` | `\b \f \n \r \t` |
| `string-hex-control-escape` | `§6` | U+0001 → the six characters `\u0001` |
| `string-quote-and-backslash` | `§6` | only those two |
| `string-solidus-not-escaped` | `§6` | `/` literal |
| `string-astral-literal` | `§6` | 😀 emitted as UTF-8, not escaped |
| `depth-32-accepted` | `§7` | boundary, accepted |
| `depth-33-rejected` | `§7` | boundary, `nesting-too-deep` |
| `manifest-strips-top-level-signature` | `§8` | mode `manifest` |
| `manifest-keeps-nested-signature` | `§8` | shallow only |
| `value-unsupported-type-rejected` | `§3` | `unsupported-type` |

Each index entry's `reason` states what the case pins. For the two that would otherwise be presumed covered, use the house measurement convention — write the wrong binding, run it against the corpus as it stands, and record the count. For `key-order-astral-vs-bmp`, revert `compareCodePoints` to `(a, b) => (a < b ? -1 : a > b ? 1 : 0)`, re-run, and record *"caught by N of the other M cases"* in the `reason`.

- [ ] **Step 5: Write the index and run the guard green**

Create `index.json` with `"spec": "../../../signing/v1/canonical-json.md"` and one entry per case file.

Run: `cd sdks/typescript && bun test scripts/canonical-json-guard.test.ts`
Expected: PASS, with every case listed as its own subtest.

- [ ] **Step 6: Declare coverage for all three bindings**

In `docs/conformance-coverage.json`, add `"canonical-json"` to `typescript.claims`, and to **both** `python.unclaimed` and `go.unclaimed` add:

```json
    "canonical-json": "binding lands in the next task of this shipment; the surface does not exist yet"
```

Tasks 6 and 7 move each into `claims` and delete its `unclaimed` line.

Then: `cd sdks/typescript && bun run conformance:coverage`

- [ ] **Step 7: Re-sync Go's mirror and run every suite**

```bash
go -C sdks/go generate ./spec
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
cd sdks/typescript && bun run test
```
Expected: PASS. `corpus-parity.test.ts` is the one to watch — it fails if any binding has neither a claim nor a recorded reason.

- [ ] **Step 8: Commit**

```bash
git add docs/spec/conformance/v1/canonical-json docs/conformance-coverage.json \
        docs/conformance-coverage.md sdks/typescript/scripts/canonical-json-guard.test.ts \
        sdks/go/spec/data
git commit -m "feat(signing): publish the canonical-json conformance corpus"
```

---

### Task 6: The Python binding

**Files:**
- Create: `sdks/python/src/nimbus_sdk/signing/{__init__.py,canonical_json.py}`
- Test: `sdks/python/tests/test_canonical_json.py`, `sdks/python/tests/test_canonical_json_corpus.py`
- Modify: `sdks/python/scripts/api_surface.py` (`IMPORT_ROOTS`), `docs/api-surface-python.md`, `docs/conformance-coverage.json`, `docs/conformance-coverage.md`, `docs/modules/signing.md`, `docs/stability-matrix.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the corpus from Task 5.
- Produces: `nimbus_sdk.signing` exporting `canonicalize(value: object | None) -> str`, `canonicalize_manifest(manifest: dict[str, object]) -> bytes`, `CanonicalizationError` (with `.reason: str`), and `CANONICALIZATION_REASONS: tuple[str, ...]`.

Python's `sorted` is already code point order and `str` is already a sequence of code points, so §4 needs no special handling here — the divergence was TypeScript's alone.

- [ ] **Step 1: Write the failing unit test**

Create `sdks/python/tests/test_canonical_json.py`:

```python
"""Unit tests for the Python canonicalization binding.

Mirrors sdks/typescript/src/signing/canonical-json.test.ts case for case, so a
divergence shows up here rather than only in the shared corpus.
"""

from __future__ import annotations

import pytest

from nimbus_sdk.signing import (
    CANONICALIZATION_REASONS,
    CanonicalizationError,
    canonicalize,
    canonicalize_manifest,
)


def _reason(fn) -> str:  # type: ignore[no-untyped-def]
    with pytest.raises(CanonicalizationError) as excinfo:
        fn()
    return excinfo.value.reason


def test_keys_sort_by_code_point() -> None:
    assert canonicalize({"\U0001F600": 1, "Ｚ": 2, "z": 3}) == '{"z":3,"Ｚ":2,"\U0001F600":1}'


def test_max_safe_integer_accepted() -> None:
    assert canonicalize(9007199254740991) == "9007199254740991"


def test_above_safe_range_rejected() -> None:
    assert _reason(lambda: canonicalize(10**21)) == "number-out-of-range"


def test_non_integer_rejected() -> None:
    assert _reason(lambda: canonicalize(1.5)) == "non-integer-number"


def test_integral_float_is_an_integer() -> None:
    # json.loads("1.0") is a float here and 1 in TypeScript. §5 is a rule about the
    # value, so both must emit "1" -- this is the assertion that keeps the two bindings
    # from disagreeing on an input any manifest may legitimately contain.
    assert canonicalize(1.0) == "1"
    assert canonicalize(1e2) == "100"


def test_non_finite_rejected() -> None:
    # json.loads("1e400") yields inf, which the diagnostics corpus already contains.
    assert _reason(lambda: canonicalize(float("inf"))) == "number-out-of-range"


def test_bool_is_not_an_integer() -> None:
    # bool subclasses int in Python and nothing else does. Without an explicit branch
    # True would serialize as 1 here and as `true` in the other two bindings.
    assert canonicalize(True) == "true"


def test_html_characters_are_literal() -> None:
    assert canonicalize("<&>") == '"<&>"'


def test_no_normalization() -> None:
    assert canonicalize("e\u0301") == '"e\u0301"'


def test_named_control_escapes() -> None:
    assert canonicalize("\b\f\n\r\t\u0001") == '"\\b\\f\\n\\r\\t\\u0001"'


def test_lone_surrogate_rejected() -> None:
    assert _reason(lambda: canonicalize("\ud800")) == "lone-surrogate"


def test_depth_boundary() -> None:
    def nest(depth: int) -> object:
        value: object = 1
        for _ in range(depth):
            value = [value]
        return value

    canonicalize(nest(32))
    assert _reason(lambda: canonicalize(nest(33))) == "nesting-too-deep"


def test_manifest_strips_only_the_top_level_signature() -> None:
    out = canonicalize_manifest({"id": "x", "signature": "sig", "a": {"signature": "keep"}})
    assert out == b'{"a":{"signature":"keep"},"id":"x"}'


def test_unsupported_type_rejected() -> None:
    assert _reason(lambda: canonicalize(object())) == "unsupported-type"


def test_every_reason_is_published() -> None:
    assert sorted(CANONICALIZATION_REASONS) == [
        "lone-surrogate",
        "nesting-too-deep",
        "non-integer-number",
        "number-out-of-range",
        "unsupported-type",
    ]
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd sdks/python && python -m pytest tests/test_canonical_json.py -q`
Expected: FAIL — `ModuleNotFoundError: nimbus_sdk.signing`.

- [ ] **Step 3: Write the implementation**

Create `sdks/python/src/nimbus_sdk/signing/canonical_json.py`:

```python
"""Deterministic JSON canonicalization for extension manifests.

The binding of ``docs/spec/signing/v1/canonical-json.md``. Produces the bytes a detached
JWS signs, so a binding that disagrees here produces signatures that do not verify across
languages.

Nothing here normalizes: Go publishes no importable Unicode normalization, so an NFC rule
could not be bound in all three languages without a dependency (RFC-0020).
"""

from __future__ import annotations

import math

__stability__ = "experimental"

#: §9. The closed set. A binding may never invent a sixth.
CANONICALIZATION_REASONS: tuple[str, ...] = (
    "lone-surrogate",
    "nesting-too-deep",
    "non-integer-number",
    "number-out-of-range",
    "unsupported-type",
)

#: §5. 2**53 - 1.
_MAX_MAGNITUDE = 9007199254740991

#: §7. The top-level value is depth 0.
_MAX_DEPTH = 32

_NAMED_ESCAPES = {0x08: "\\b", 0x0C: "\\f", 0x0A: "\\n", 0x0D: "\\r", 0x09: "\\t"}


class CanonicalizationError(Exception):
    """A value that cannot be canonicalized, carrying its §9 token."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"canonicalize: {reason}")
        self.reason = reason


def _encode_string(value: str) -> str:
    """§6. Byte-preserving, with exactly the escapes JSON requires and no others."""
    out = ['"']
    for ch in value:
        cp = ord(ch)
        if 0xD800 <= cp <= 0xDFFF:
            raise CanonicalizationError("lone-surrogate")
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif cp in _NAMED_ESCAPES:
            out.append(_NAMED_ESCAPES[cp])
        elif cp < 0x20:
            out.append(f"\\u{cp:04x}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _canonicalize_at(value: object, depth: int) -> str:
    if depth > _MAX_DEPTH:
        raise CanonicalizationError("nesting-too-deep")
    if value is None:
        return "null"
    # Checked before int: bool subclasses int, and only bool does.
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _encode_string(value)
    if isinstance(value, int):
        if value > _MAX_MAGNITUDE or value < -_MAX_MAGNITUDE:
            raise CanonicalizationError("number-out-of-range")
        return str(value)
    if isinstance(value, float):
        # §5 is a rule about the VALUE, not the literal. `json.loads("1.0")` yields a
        # float here where `JSON.parse("1.0")` yields 1 in TypeScript, which cannot see
        # the literal at all -- so rejecting every float would make this binding disagree
        # with the reference on an input any manifest may contain.
        if not math.isfinite(value):
            # json.loads("1e400") yields inf, a shape the diagnostics corpus already
            # contains. One call covers both inf and nan.
            raise CanonicalizationError("number-out-of-range")
        if not value.is_integer():
            raise CanonicalizationError("non-integer-number")
        if value > _MAX_MAGNITUDE or value < -_MAX_MAGNITUDE:
            raise CanonicalizationError("number-out-of-range")
        return str(int(value))
    if isinstance(value, list):
        return "[" + ",".join(_canonicalize_at(v, depth + 1) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value)  # §4. Python compares by code point already.
        members = (f"{_encode_string(k)}:{_canonicalize_at(value[k], depth + 1)}" for k in keys)
        return "{" + ",".join(members) + "}"
    raise CanonicalizationError("unsupported-type")


def canonicalize(value: object) -> str:
    """Canonicalize any value in §3's input domain."""
    return _canonicalize_at(value, 0)


def canonicalize_manifest(manifest: dict[str, object]) -> bytes:
    """§8. Canonicalize a manifest with its top-level ``signature`` member removed."""
    clone = {k: v for k, v in manifest.items() if k != "signature"}
    return canonicalize(clone).encode("utf-8")
```

**Note on `_MAX_DEPTH`:** Python's default recursion limit is ~1000 frames, well above 33, so no guard beyond the depth check is needed.

Create `sdks/python/src/nimbus_sdk/signing/__init__.py`:

```python
"""``nimbus_sdk.signing`` — manifest canonicalization.

A separate import root because signing is a separate surface with its own spec area
(``docs/spec/signing/v1/``). These names are deliberately NOT re-exported from
``nimbus_sdk``; the split mirrors the TypeScript ``exports`` map.
"""

from __future__ import annotations

__stability__ = "experimental"

from nimbus_sdk.signing.canonical_json import (
    CANONICALIZATION_REASONS,
    CanonicalizationError,
    canonicalize,
    canonicalize_manifest,
)

__all__ = [
    "CANONICALIZATION_REASONS",
    "CanonicalizationError",
    "canonicalize",
    "canonicalize_manifest",
]
```

- [ ] **Step 4: Run the unit tests, the type checker and the linter**

```bash
cd sdks/python
python -m pip install -e .
python -m pytest tests/test_canonical_json.py -q
python -m mypy
python -m ruff check . && python -m ruff format --check .
```
Expected: all PASS.

- [ ] **Step 5: Write the corpus runner**

Create `sdks/python/tests/test_canonical_json_corpus.py`:

```python
"""Drive canonicalization from the published conformance corpus.

Reads the spec data bundled at build time into ``src/nimbus_sdk/_data/spec``, which
``spec_root()`` prefers over the repository's ``docs/spec``. That copy is gitignored and
regenerated by the hatch build hook, so **adding a case to docs/spec is not enough
locally**: without ``python -m pip install -e .`` first, this suite runs the previous
snapshot and passes while executing none of the new cases.
"""

from __future__ import annotations

import pytest
from _conformance_report import corpus_files, recorder

from nimbus_sdk import load_corpus
from nimbus_sdk.signing import CanonicalizationError, canonicalize, canonicalize_manifest

CASES = load_corpus("canonical-json")
FILES = corpus_files("canonical-json")
assert len(FILES) == len(CASES), "the index and load_corpus disagree on the case count"
_RECORDER = recorder("canonical-json")


def _ids() -> list[str]:
    return [str(case["description"]) for case in CASES]


def test_the_corpus_is_not_empty() -> None:
    # A load_corpus that silently returned [] would make every parametrised test below
    # vanish rather than fail. A floor, not an exact pin: the TypeScript guard holds
    # the exact list, and duplicating it here would make every new case a four-file edit.
    assert len(CASES) >= 21


def test_both_outcomes_are_exercised() -> None:
    outcomes = set()
    for case in CASES:
        expect = case["expect"]
        assert isinstance(expect, dict)
        outcomes.add(bool(expect["ok"]))
    assert outcomes == {True, False}


@pytest.mark.parametrize(("file", "case"), list(zip(FILES, CASES, strict=True)), ids=_ids())
def test_case(file: str, case: dict[str, object]) -> None:
    mode = case["mode"]
    value = case["input"]
    expect = case["expect"]
    assert isinstance(expect, dict)

    def run() -> bytes:
        if mode == "manifest":
            assert isinstance(value, dict)
            return canonicalize_manifest(value)
        return canonicalize(value).encode("utf-8")

    if expect["ok"]:
        assert run().hex() == expect["canonical"]
    else:
        with pytest.raises(CanonicalizationError) as excinfo:
            run()
        assert excinfo.value.reason == expect["reason"]
    _RECORDER(file)
```

Read `sdks/python/tests/_conformance_report.py` first to confirm `recorder`'s call shape — `test_url_resolution_corpus.py` is the reference.

- [ ] **Step 6: Run the corpus suite**

```bash
cd sdks/python && python -m pip install -e . && python -m pytest -q
```
Expected: PASS, every case as its own parametrised test.

If cases appear to be missing, the `_data/spec` snapshot is stale — the reinstall in this same command is what prevents it.

- [ ] **Step 7: Register the root and regenerate the golden**

Add `"nimbus_sdk.signing"` to `IMPORT_ROOTS` in `sdks/python/scripts/api_surface.py` (after `"nimbus_sdk.jmap_fastmail"`), then:

```bash
cd sdks/python && python scripts/api_surface.py && python -m pytest tests/test_api_surface.py -q
```
Expected: PASS. `test_api_surface.py` asserts the roots on disk are exactly `IMPORT_ROOTS`, so this fails until the tuple is updated.

- [ ] **Step 8: Claim the corpus and update the docs**

- `docs/conformance-coverage.json`: move `canonical-json` from `python.unclaimed` into `python.claims` (alphabetical), deleting the placeholder reason.
- **`docs/spec/README.md`: add `` `canonical-json` `` to the language-neutrality
  paragraph** — the one beginning *"What holds the contract to being
  **language-neutral**"*. This is the task where the claim becomes true and where it
  becomes required: `corpus-parity.test.ts` asserts the paragraph names every corpus more
  than one binding claims, and Python's claim is the second. It was deliberately withheld
  until now, because the same test fails in the other direction if the paragraph names a
  corpus only one binding runs. Task 7 needs no further edit here — it is already named.
- `docs/modules/signing.md`: extend the `covers:` comment with a `py:` line — `py: signing/canonical_json`.
- `CLAUDE.md`: the *Python surface* heading says **eight** import roots; make it nine, add the `nimbus_sdk.signing` bullet, and update the sentence naming the `IMPORT_ROOTS` count.

```bash
cd sdks/typescript && bun run conformance:coverage
cd ../.. && bun run stability:matrix
bun run test
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add sdks/python/src/nimbus_sdk/signing sdks/python/tests/test_canonical_json.py \
        sdks/python/tests/test_canonical_json_corpus.py sdks/python/scripts/api_surface.py \
        docs/api-surface-python.md docs/conformance-coverage.json docs/conformance-coverage.md \
        docs/modules/signing.md docs/stability-matrix.md CLAUDE.md
git commit -m "feat(signing): bind canonical-json v1 in Python as the ninth import root"
```

---

### Task 7: The Go binding

**Files:**
- Create: `sdks/go/signing/canonicaljson.go`, `sdks/go/signing/canonicaljson_test.go`, `sdks/go/conformance/canonicaljson_test.go`
- Modify: `sdks/go/internal/apisurface/cmd/main.go` (`packages`), `docs/api-surface-go.md`, `docs/conformance-coverage.json`, `docs/conformance-coverage.md`, `docs/modules/signing.md`, `docs/stability-matrix.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the corpus from Task 5.
- Produces: package `signing` exporting `Canonicalize(value any) (string, error)`, `CanonicalizeManifest(manifest map[string]any) ([]byte, error)`, `Error` (with field `Reason string`), and `Reasons []string`.

Go returns `(value, error)` rather than panicking, matching `ipc.PerformHandshake`'s shape. **`encoding/json` must not be used to serialize strings** — its `SetEscapeHTML` default is divergence §1.3 — and corpus numbers arrive as `json.Number` because `spec.LoadCorpus` decodes with `UseNumber`.

- [ ] **Step 1: Write the failing unit test**

Create `sdks/go/signing/canonicaljson_test.go`:

```go
package signing

import (
	"encoding/json"
	"testing"
)

func TestKeysSortByCodePoint(t *testing.T) {
	got, err := Canonicalize(map[string]any{"\U0001F600": 1, "Ｚ": 2, "z": 3})
	if err != nil {
		t.Fatalf("Canonicalize: %v", err)
	}
	want := "{\"z\":3,\"Ｚ\":2,\"\U0001F600\":1}"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestHTMLCharactersAreLiteral(t *testing.T) {
	// encoding/json would emit <&> here. That is divergence 1.3 and the
	// reason this package hand-rolls its string encoder.
	got, err := Canonicalize("<&>")
	if err != nil {
		t.Fatalf("Canonicalize: %v", err)
	}
	if got != `"<&>"` {
		t.Errorf("got %q, want %q", got, `"<&>"`)
	}
}

func TestRejections(t *testing.T) {
	deep := func(depth int) any {
		var v any = 1
		for i := 0; i < depth; i++ {
			v = []any{v}
		}
		return v
	}
	cases := []struct {
		name  string
		value any
		want  string
	}{
		{"non-integer", 1.5, "non-integer-number"},
		// 1e21 exceeds math.MaxInt64, so this case is also the regression guard for
		// the undefined int64(v) conversion the range check must not perform.
		{"out-of-range", float64(1e21), "number-out-of-range"},
		{"lone-surrogate", string([]byte{0xED, 0xA0, 0x80}), "lone-surrogate"},
		{"too-deep", deep(33), "nesting-too-deep"},
		{"unsupported", struct{}{}, "unsupported-type"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := Canonicalize(c.value)
			var e *Error
			if !errorsAs(err, &e) {
				t.Fatalf("got %v, want *Error", err)
			}
			if e.Reason != c.want {
				t.Errorf("reason %q, want %q", e.Reason, c.want)
			}
		})
	}
}

func TestIntegralFloatIsAnInteger(t *testing.T) {
	// §5 is a rule about the value. TypeScript cannot see the literal at all, so Go
	// must not consult its own: json.Number("1.0") canonicalizes to "1", not to a
	// refusal. Without this the three bindings disagree on an ordinary manifest number.
	got, err := Canonicalize(json.Number("1.0"))
	if err != nil {
		t.Fatalf("Canonicalize(1.0): %v", err)
	}
	if got != "1" {
		t.Errorf("got %q, want %q", got, "1")
	}
}

func TestDepth32Accepted(t *testing.T) {
	var v any = 1
	for i := 0; i < 32; i++ {
		v = []any{v}
	}
	if _, err := Canonicalize(v); err != nil {
		t.Errorf("depth 32 must be accepted: %v", err)
	}
}

func TestManifestStripsOnlyTopLevelSignature(t *testing.T) {
	got, err := CanonicalizeManifest(map[string]any{
		"id": "x", "signature": "sig", "a": map[string]any{"signature": "keep"},
	})
	if err != nil {
		t.Fatalf("CanonicalizeManifest: %v", err)
	}
	want := `{"a":{"signature":"keep"},"id":"x"}`
	if string(got) != want {
		t.Errorf("got %q, want %q", got, want)
	}
}
```

Add at the bottom of the test file, so the test does not depend on an import the implementation may not need:

```go
func errorsAs(err error, target **Error) bool {
	e, ok := err.(*Error)
	if ok {
		*target = e
	}
	return ok
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `go -C sdks/go test ./signing/...`
Expected: FAIL — no such package.

- [ ] **Step 3: Write the implementation**

Create `sdks/go/signing/canonicaljson.go`:

```go
// Package signing implements deterministic JSON canonicalization for extension
// manifests — the binding of docs/spec/signing/v1/canonical-json.md.
//
// The bytes produced here are what a detached JWS signs, so a binding that disagrees
// produces signatures that do not verify across languages.
//
// encoding/json is deliberately unused for serialization: it HTML-escapes '<', '>' and
// '&' by default, which no other binding does. Nothing here normalizes either — Go
// publishes no importable Unicode normalization (RFC-0020).
//
// Stability: experimental
package signing

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Reasons is the closed set from §9. A binding may never invent a sixth.
var Reasons = []string{
	"lone-surrogate",
	"nesting-too-deep",
	"non-integer-number",
	"number-out-of-range",
	"unsupported-type",
}

// Error is a value that cannot be canonicalized, carrying its §9 token.
type Error struct {
	Reason string
}

func (e *Error) Error() string { return "canonicalize: " + e.Reason }

const (
	// maxMagnitude is 2**53 - 1 (§5).
	maxMagnitude = 9007199254740991
	// maxDepth counts the top-level value as depth 0 (§7).
	maxDepth = 32
)

// encodeString implements §6: byte-preserving, with exactly the escapes JSON requires.
func encodeString(s string, b *strings.Builder) error {
	b.WriteByte('"')
	for i, r := range s {
		// A lone surrogate cannot be valid UTF-8, so range decoding reports it as
		// RuneError over one byte. A genuine U+FFFD decodes over three. The slice
		// from i is load-bearing: DecodeRuneInString(s) would re-decode the FIRST
		// rune every time, so every position after the first would be judged on the
		// wrong bytes.
		if r == utf8.RuneError {
			if _, size := utf8.DecodeRuneInString(s[i:]); size == 1 {
				return &Error{Reason: "lone-surrogate"}
			}
		}
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\b':
			b.WriteString(`\b`)
		case r == '\f':
			b.WriteString(`\f`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r < 0x20:
			fmt.Fprintf(b, `\u%04x`, r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return nil
}

// writeNumber implements §5, which is a rule about the VALUE and not the literal:
// "1", "1.0" and "1e0" are the same number and all canonicalize to "1". TypeScript
// cannot see the literal at all (JSON.parse("1.0") is 1), so a literal-based rule
// would be unimplementable in the reference binding.
func writeNumber(n json.Number, b *strings.Builder) error {
	if i, err := strconv.ParseInt(string(n), 10, 64); err == nil {
		if i > maxMagnitude || i < -maxMagnitude {
			return &Error{Reason: "number-out-of-range"}
		}
		b.WriteString(strconv.FormatInt(i, 10))
		return nil
	}
	f, err := n.Float64()
	if err != nil {
		// Overflows float64 entirely — the corpus's 1e400 shape.
		return &Error{Reason: "number-out-of-range"}
	}
	return writeFloat(f, b)
}

// writeFloat orders its checks deliberately: non-finite first, then integrality, then
// magnitude. Nothing converts to int64 before the magnitude check, because int64(1e21)
// is undefined in Go — 1e21 exceeds math.MaxInt64, and math.Trunc lets the integrality
// test avoid the conversion entirely.
func writeFloat(f float64, b *strings.Builder) error {
	if math.IsInf(f, 0) || math.IsNaN(f) {
		return &Error{Reason: "number-out-of-range"}
	}
	if f != math.Trunc(f) {
		return &Error{Reason: "non-integer-number"}
	}
	if f > maxMagnitude || f < -maxMagnitude {
		return &Error{Reason: "number-out-of-range"}
	}
	b.WriteString(strconv.FormatInt(int64(f), 10))
	return nil
}

func canonicalizeAt(value any, depth int, b *strings.Builder) error {
	if depth > maxDepth {
		return &Error{Reason: "nesting-too-deep"}
	}
	switch v := value.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if v {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		return encodeString(v, b)
	case json.Number:
		return writeNumber(v, b)
	case int:
		if v > maxMagnitude || v < -maxMagnitude {
			return &Error{Reason: "number-out-of-range"}
		}
		b.WriteString(strconv.Itoa(v))
	case float64:
		return writeFloat(v, b)
	case []any:
		b.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := canonicalizeAt(item, depth+1, b); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		// §4. Go compares strings by UTF-8 byte, which is code point order.
		sort.Strings(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := encodeString(k, b); err != nil {
				return err
			}
			b.WriteByte(':')
			if err := canonicalizeAt(v[k], depth+1, b); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		return &Error{Reason: "unsupported-type"}
	}
	return nil
}

// Canonicalize canonicalizes any value in §3's input domain.
func Canonicalize(value any) (string, error) {
	var b strings.Builder
	if err := canonicalizeAt(value, 0, &b); err != nil {
		return "", err
	}
	return b.String(), nil
}

// CanonicalizeManifest implements §8: the top-level "signature" member is removed and
// the remainder canonicalized. Shallow — a nested member named "signature" is data.
func CanonicalizeManifest(manifest map[string]any) ([]byte, error) {
	clone := make(map[string]any, len(manifest))
	for k, v := range manifest {
		if k == "signature" {
			continue
		}
		clone[k] = v
	}
	s, err := Canonicalize(clone)
	if err != nil {
		return nil, err
	}
	return []byte(s), nil
}
```

- [ ] **Step 4: Run the unit tests, vet and gofmt**

```bash
go -C sdks/go test ./signing/...
go -C sdks/go vet ./signing/...
test -z "$(gofmt -l sdks/go)"
```
Expected: PASS, no vet findings, no gofmt output. (`gofmt -l` alone always exits 0 — the `test -z` is what makes it fail.)

- [ ] **Step 5: Write the corpus runner**

Create `sdks/go/conformance/canonicaljson_test.go`, modelled on `urlresolution_test.go`. Read that file first for `corpusCases`, `describe` and `recordCase`.

```go
package conformance

import (
	"encoding/hex"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/signing"
)

// TestCanonicalJSONCorpus executes docs/spec/conformance/v1/canonical-json in full.
func TestCanonicalJSONCorpus(t *testing.T) {
	cases := corpusCases(t, "canonical-json")
	// A floor, not an exact count — both languages read the same index.json, so a
	// duplicated exact pin would detect nothing and make every new case a four-file edit.
	if len(cases) < 21 {
		t.Fatalf("corpus holds %d cases; every assertion here would be near-vacuous", len(cases))
	}

	executed := 0
	for _, c := range cases {
		c := c
		t.Run(describe(c.Body), func(t *testing.T) {
			t.Cleanup(func() {
				if !t.Failed() && !t.Skipped() {
					recordCase("canonical-json", c.File)
				}
			})
			executed++

			// Named rather than comma-ok'd away: a mistyped key would otherwise run
			// vacuously and report PASS. "input" may legitimately be any value,
			// including null, so it is read without a type assertion.
			mode, ok := c.Body["mode"].(string)
			if !ok {
				t.Fatalf("case is malformed: no \"mode\" string (got %#v)", c.Body["mode"])
			}
			expect, ok := c.Body["expect"].(map[string]any)
			if !ok {
				t.Fatalf("case is malformed: no \"expect\" object (got %#v)", c.Body["expect"])
			}
			okWanted, ok := expect["ok"].(bool)
			if !ok {
				t.Fatalf("case is malformed: no \"ok\" boolean (got %#v)", expect["ok"])
			}

			var got []byte
			var err error
			if mode == "manifest" {
				m, isMap := c.Body["input"].(map[string]any)
				if !isMap {
					t.Fatalf("manifest-mode case input is not an object: %#v", c.Body["input"])
				}
				got, err = signing.CanonicalizeManifest(m)
			} else {
				var s string
				s, err = signing.Canonicalize(c.Body["input"])
				got = []byte(s)
			}

			if okWanted {
				if err != nil {
					t.Fatalf("expected success, got %v", err)
				}
				want, _ := expect["canonical"].(string)
				if hex.EncodeToString(got) != want {
					t.Errorf("got %s, want %s", hex.EncodeToString(got), want)
				}
				return
			}
			var e *signing.Error
			if err == nil {
				t.Fatalf("expected refusal, got %q", got)
			}
			if !asSigningError(err, &e) {
				t.Fatalf("expected *signing.Error, got %T: %v", err, err)
			}
			want, _ := expect["reason"].(string)
			if e.Reason != want {
				t.Errorf("reason %q, want %q", e.Reason, want)
			}
		})
	}
	if executed != len(cases) {
		t.Fatalf("executed %d subtests for %d cases", executed, len(cases))
	}
}

func asSigningError(err error, target **signing.Error) bool {
	e, ok := err.(*signing.Error)
	if ok {
		*target = e
	}
	return ok
}
```

- [ ] **Step 6: Run the Go suite**

Run: `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...`
Expected: PASS.

Numbers in the corpus arrive as `json.Number` (`spec.LoadCorpus` uses `UseNumber`), which is why `canonicalizeAt` has a `json.Number` arm — a `.(float64)` assertion on corpus data is always wrong here.

- [ ] **Step 7: Register the package and regenerate the golden**

Add `"signing"` to the `packages` slice in `sdks/go/internal/apisurface/cmd/main.go`, keeping alphabetical order (after `"jmapfastmail"`), then:

```bash
go -C sdks/go run ./internal/apisurface/cmd
go -C sdks/go test ./internal/apisurface/...
```
Expected: PASS. The second test asserts `packages` covers every non-internal package, so it fails until the slice is updated.

- [ ] **Step 8: Claim the corpus and update the docs**

- `docs/conformance-coverage.json`: move `canonical-json` from `go.unclaimed` into `go.claims`, deleting the placeholder.
- `docs/modules/signing.md`: extend the `covers:` comment with `go: signing/canonicaljson`.
- `CLAUDE.md`: the *Go surface* heading says **nine packages**; make it ten, and add the `signing` bullet.

```bash
cd sdks/typescript && bun run conformance:coverage
cd ../.. && bun run stability:matrix
bun run test
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
```
Expected: PASS everywhere. `corpus-parity.test.ts` should now show `canonical-json` claimed by all three bindings and `unclaimed` empty for it.

- [ ] **Step 9: Commit**

```bash
git add sdks/go/signing sdks/go/conformance/canonicaljson_test.go \
        sdks/go/internal/apisurface/cmd/main.go docs/api-surface-go.md \
        docs/conformance-coverage.json docs/conformance-coverage.md \
        docs/modules/signing.md docs/stability-matrix.md CLAUDE.md
git commit -m "feat(signing): bind canonical-json v1 in Go as the tenth package"
```

---

### Task 8: Open the deprecation window

**Files:**
- Modify: `sdks/typescript/src/crypto/canonical-json.ts`, `sdks/typescript/src/crypto/verify-signature.ts`, `docs/modules/crypto.md`, `docs/api-surface.md`

**Interfaces:**
- Consumes: the published `@nimbus-dev/sdk/signing` from Task 4.
- Produces: `**Deprecated:**` lines in `docs/api-surface.md`, which the removal shipment's `commit-guard` check reads from the **base** golden to prove the window opened.

**The behavior of these modules must not change.** They keep the UTF-16 sort and the NFC normalization. Only documentation comments are added. A behavioral edit here would silently change signatures for every current consumer, which is the failure the window exists to prevent.

- [ ] **Step 1: Mark every export in `crypto/canonical-json.ts`**

Add a `@deprecated` tag to the JSDoc of `canonicalize`, `canonicalizeManifest`, `NonIntegerNumberInManifest`, `UnsupportedManifestValueType` and `ManifestNestedTooDeep`. Example, on `canonicalizeManifest`:

```ts
/**
 * @deprecated since 1.32.0 — use `canonicalizeManifest` from `@nimbus-dev/sdk/signing`,
 * which implements `docs/spec/signing/v1/canonical-json.md`. This function sorts keys in
 * UTF-16 code-unit order, which disagrees with the Python and Go bindings for any key
 * containing an astral character (RFC-0020 §2). Removal is scheduled for 2.0.0, no
 * earlier than the release after next — see docs/DEPRECATION-POLICY.md.
 */
```

Replace `1.32.0` with the version this change will actually ship in — read the current version first:

Run: `grep -n '"version"' sdks/typescript/package.json`

- [ ] **Step 2: Mark every export in `crypto/verify-signature.ts`**

Same treatment for `verifyManifestSignature`, `signManifest`, `generateEd25519Keypair`, `encodeBase64`, `decodeBase64`, `errorToHardDisableReason`, `PublisherKeyMismatch`, `SignatureInvalidFormat`, `SignatureInvalid` and the `SignatureDisableReason` type. Point at `@nimbus-dev/sdk/signing` and note that the JWS replacement lands in a later shipment.

While here, fix the dangling citation in `generateEd25519Keypair`'s docstring: the phrase *"no committed crypto material — see spec §6.3"* refers to a section that does not exist in this repository, inherited from the monorepo extraction. Delete the `— see spec §6.3` clause.

- [ ] **Step 3: Record the deprecation on the capability page**

Add a short section to `docs/modules/crypto.md` stating that the two signing modules are deprecated in favour of `@nimbus-dev/sdk/signing`, that they retain their existing behavior deliberately for the window's duration, and that the two canonicalizers therefore differ — pointing at RFC-0020 §2 for the four divergences.

- [ ] **Step 4: Regenerate the surface golden and confirm the markers landed**

```bash
cd sdks/typescript && bun run build && bun run api:surface
grep -c "Deprecated:" ../../docs/api-surface.md
```
Expected: a count of at least 15 — one per marked export. If it is 0, the tags are formatted in a way the generator does not read; compare against how `createScopedAuditLogger` renders, which is already deprecated.

- [ ] **Step 5: Confirm nothing changed behaviorally**

```bash
cd sdks/typescript && bun test src/crypto/ && bun run typecheck && bun run lint
```
Expected: PASS with no test edits. If any `crypto/` test needed changing, behavior changed and the edit must be reverted.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/src/crypto docs/modules/crypto.md docs/api-surface.md
git commit -m "feat(crypto): deprecate the flat manifest-signing surface in favour of @nimbus-dev/sdk/signing"
```

---

### Task 9: Full-gate verification outside the worktree

**Files:** none modified — this task only runs gates.

**Interfaces:**
- Consumes: everything.
- Produces: the evidence that CI will be green.

A worktree under `.claude/worktrees/` resolves `node_modules` from the parent checkout, so a green run there does not prove a green run in CI, which checks out flat. This is not hypothetical — it took down `build-test` on three operating systems once already.

- [ ] **Step 1: Clone the branch outside the repository**

```bash
git clone --branch worktree-manifest-signing-spec . "$TEMP/nimbus-verify"
cd "$TEMP/nimbus-verify" && bun install --frozen-lockfile
```

- [ ] **Step 2: Build before testing, in CI's order**

```bash
bun run build
bun run --cwd tools/create-connector build
```
Expected: both succeed. Skipping this fails `api-surface`, `smoke-calls` and `pack-and-generate` on a missing `dist/` for the wrong reason — those three gates execute the built package, not the source tree.

- [ ] **Step 3: Run every gate**

```bash
bun run test
bun run scaffold:test
cd sdks/python && python -m pip install -e . && python -m pytest -q \
  && python -m mypy && python -m ruff check . && python -m ruff format --check .
cd ../.. && NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./... \
  && go -C sdks/go vet ./... && test -z "$(gofmt -l sdks/go)"
```
Expected: all PASS.

- [ ] **Step 4: Confirm the six goldens are clean**

```bash
git -C "$TEMP/nimbus-verify" status --short
```
Expected: empty. Any modified golden means a generator was not re-run in the task that changed its input — go back and re-run it there rather than committing the regeneration separately.

- [ ] **Step 5: Clean up**

```bash
rm -rf "$TEMP/nimbus-verify"
```

---

## Self-Review

**Spec coverage.** Every section of the design that belongs to S0–S1 maps to a task: §1 divergences → Tasks 1, 3, 5, 7 (the fixes and their regression cases); §2 NFC → Tasks 2, 3, 6, 7; §5 rules → Task 2 (document), 3/6/7 (bindings), 5 (corpus); §7.1 corpus → Task 5; §8 shipment boundary → Task 8's window. Design §6 (the JWS envelope), §6.1, §6.2, §7.2 and §11 belong to S2–S5 and are deliberately out of this plan's scope.

**One inconsistency found and worth fixing in the design.** Design §8 assigns *"CLAUDE.md's three counts"* to S4. That is wrong: all three surfaces are **created** in S1, so all three counts change here — Task 4 (entry points 5→6), Task 6 (roots 8→9), Task 7 (packages 9→10). S4 should own only the schema, the `manifest` corpus, and the stale five-checks bullet. The plan does the right thing; the design line needs correcting.

**Placeholder scan.** No `TBD`, no "add appropriate error handling", no "similar to Task N". Every code step carries runnable code. Task 5 Step 4 specifies 22 named cases rather than "write some cases", with the hex values computed by a given command rather than guessed.

**Type consistency.** `CanonicalizationError` carries `.reason` in all three bindings; the token strings are identical across the TypeScript union, the Python tuple and the Go slice; `canonicalize` / `canonicalize_manifest` / `Canonicalize` / `CanonicalizeManifest` follow each language's convention and are used consistently in the corpus runners. Go alone returns `(value, error)` — stated in its Interfaces block, matching `ipc.PerformHandshake`.

**One risk the plan cannot remove.** Task 7's `writeNumber` distinguishes `non-integer-number` from `number-out-of-range` by inspecting the `json.Number` literal. The corpus is what proves that branch matches the other two bindings, and its cases were computed from the TypeScript reference — so if a disagreement exists, it surfaces as a Go corpus failure in Task 7 Step 6, not as a silent divergence. That is the intended failure mode.
