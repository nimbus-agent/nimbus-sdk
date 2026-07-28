# ESM Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two defects that make published exports fail for real consumers, and close the CI gap that let both ship.

**Architecture:** Both bugs work in-repo and fail from the published package, because the `exports` map's `bun` condition resolves to `src/` while consumers get `dist/`. Task 1 fixes them. Task 2 adds a static scan over emitted `dist/` that catches CJS constructs anywhere, including in code no test calls. Task 3 adds an invocation phase to the ESM smoke, with its module coverage enforced against the same surface the docs guard uses.

**Tech Stack:** TypeScript 7 (strict), Bun test runner, Biome 2.5, plain Node for the smoke. No new dependencies.

## Global Constraints

Copied from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **Dependency-free at runtime.** No `dependencies` in `package.json`, ever. No new devDependencies in this change.
- **No `any`.** Use `unknown` for external data and narrow with a type guard. `noExplicitAny` is an error.
- **`noConsole` is an error** in non-test files. It is `off` inside `**/*.test.ts`. `scripts/smoke-esm.mjs` is neither — it writes via `process.stdout.write`, which is not `console` and is the existing convention in that file. Keep it.
- **TypeScript strict**, plus `noUncheckedIndexedAccess` (array indexing yields `T | undefined` — narrow it), `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`.
- **Line width 100**, 2-space indent, double quotes, trailing commas, semicolons, LF. Run `bunx @biomejs/biome check --write` on files you touch if formatting fights you — expected, and disclose it.
- **`docs/api-surface.md` MUST stay byte-identical.** No exported signature changes anywhere in this plan. That file staying still is the evidence this is a patch. Verify with `git diff --exit-code docs/api-surface.md`.
- **Commit type is `fix:` for the source changes** — this is the one change in this sequence that *should* cut a release. `test:` and `chore:` are correct for guard-only commits.
- **Branch:** `fix/esm-correctness`, already created off `main`.

## Reference: exact facts this plan depends on

**The two defects, verified on `main`:**

- `src/crypto/verify-signature.ts:120` — `const nodeCrypto: typeof import("node:crypto") = require("node:crypto");`, emitted verbatim to `dist/crypto/verify-signature.js:81`.
- `src/testing/sandbox-contract.ts:67` — resolves `"sandbox-probe.ts"`. `dist/testing/` ships `sandbox-probe.js`; `src/testing/` has only `sandbox-probe.ts`.

**Precedent for the fix:** `src/crypto/jwt.ts:12` is already `import crypto from "node:crypto"` at module scope, and both modules are re-exported from `src/index.ts` — so `node:crypto` already loads whenever anyone imports the SDK.

**`probePath` can be exported without touching the published surface.** `src/testing/index.ts` re-exports only `runSandboxContractTests` (line 12) and declares `MockGateway` locally (line 14). `api-surface.md` is built from the barrels, so a new export in `sandbox-contract.ts` that the barrel does not re-export never appears in it. This is what makes `probePath` directly testable.

**`stripComments` is a character scanner, not a regex.** `scripts/api-surface.ts` exports it; it tracks `"`, `'` and `` ` `` as string delimiters and honors backslash escapes, preserving string contents. Zero regex uses in the function.

**`dist/testing/sandbox-contract.js:59` contains the literal text `require("@nimbus-dev/client")` inside a doc comment.** A scan that does not strip comments fails on this repository today.

**Exact signatures for the smoke's calls, from `docs/api-surface.md` — do not guess these:**

```ts
generateEd25519Keypair(): { privkey: Uint8Array; pubkey: Uint8Array }
parseICalendar(ics: string): ParsedEvent[]
parseCsvHeader(firstLine: string): DataColumn[]
jsKind(v: unknown): string
isKnownItemType(v: unknown): v is KnownItemType
channelUpgradeHint(channel: DistributionChannel): string
capPreview(text: string): string
trimTrailingSlash(s: string): string
parseStorybookIndex(parsed: unknown): StorybookStory[]
createScopedAuditLogger(extensionId: string, emit: AuditEmit): AuditLogger
isExpertBrief: (x: unknown) => x is ExpertBrief
runContractTests(manifest: ExtensionManifest): Promise<void>
```

`FLUX_KINDS` and `KNOWN_ITEM_TYPES` are exported constants, not functions.

**From `scripts/docs-modules.ts`** (used by Task 3's coverage test):

```ts
export function modulesInSurface(
  entries: readonly EntryPoint[],
  surfaces: readonly EntrySurface[],
): Map<string, string[]>;   // module key -> sorted export names
```

Module keys look like `crypto/jwt`, `icalendar`, `ipc/ndjson-line-reader`, `testing/index`.

## File Structure

| File | Responsibility |
|------|----------------|
| `src/crypto/verify-signature.ts:114-127` | **Modify.** Top-level import; corrected docstring. |
| `src/testing/sandbox-contract.ts:66-68` | **Modify.** Extension follows the running module; `export` for testability. |
| `src/testing/sandbox-contract.test.ts` | **Modify.** Assert `probePath()`'s target exists. |
| `scripts/cjs-scan.ts` | **Create.** Pure: find CJS constructs in a source string. |
| `scripts/cjs-scan.test.ts` | **Create.** Unit tests on synthetic input, plus integration over real `dist/`. |
| `scripts/smoke-calls.mjs` | **Create.** The machine-readable `{ module, run }` call list. |
| `scripts/smoke-esm.mjs` | **Modify.** Add the invocation phase. |
| `scripts/smoke-calls.test.ts` | **Create.** Coverage of the call list against `modulesInSurface()`. |

---

### Task 1: Fix both defects

**Files:**
- Modify: `src/crypto/verify-signature.ts:114-127`
- Modify: `src/testing/sandbox-contract.ts:66-68`
- Modify: `src/testing/sandbox-contract.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function probePath(): string` in `src/testing/sandbox-contract.ts` — module-local export, deliberately NOT re-exported from `src/testing/index.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/testing/sandbox-contract.test.ts`:

```ts
import { existsSync } from "node:fs";
import { probePath } from "./sandbox-contract.ts";

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
```

Add the imports to the file's **existing** import block rather than appending new statements, and reuse whatever `describe`/`test`/`expect` import is already there.

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `bun test src/testing/sandbox-contract.test.ts`
Expected: FAIL — either `probePath` is not exported, or it returns a path ending `sandbox-probe.ts` that does exist under Bun. Under Bun the *first* test may pass while `probePath` is unexported, so the real signal here is the import error. That is fine; Step 4 is where both must pass.

- [ ] **Step 3: Fix `probePath`**

In `src/testing/sandbox-contract.ts`, replace the function at lines 66-68:

```ts
export function probePath(): string {
  // The extension must follow whichever copy is executing: under the `bun` export
  // condition this module runs from src/, where only sandbox-probe.ts exists; from the
  // published package it runs from dist/, where only sandbox-probe.js does. A hardcoded
  // extension is wrong from one side or the other, whichever one is chosen — and the
  // previous hardcoded ".ts" made every dist/ consumer's probe spawn fail, reported as
  // an fs-denied sandbox failure rather than as the packaging bug it was.
  const here = fileURLToPath(import.meta.url);
  const ext = here.endsWith(".ts") ? ".ts" : ".js";
  return resolve(dirname(here), `sandbox-probe${ext}`);
}
```

**Keep it lazy.** The comment block above this function records a real incident: computing the path at module scope baked the build machine's absolute path into `dist/`. Do not hoist any of this to module scope, and do not delete that comment.

**Do NOT add `probePath` to `src/testing/index.ts`.** Exporting it from this module makes it testable; re-exporting it from the barrel would change the published surface and break the `api-surface.md` guard.

- [ ] **Step 4: Run the test again**

Run: `bun test src/testing/sandbox-contract.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Fix the `require()`**

In `src/crypto/verify-signature.ts`, add to the file's existing import block at the top:

```ts
import { generateKeyPairSync } from "node:crypto";
```

Then replace the function body at lines 114-127:

```ts
/**
 * Generate a fresh Ed25519 keypair and export both halves as raw 32-byte arrays.
 * Used by `nimbus extension keygen` and by every test fixture (no committed crypto
 * material — see spec §6.3).
 *
 * Uses `node:crypto` rather than WebCrypto because this function is synchronous and
 * WebCrypto's `generateKey` is async; the rest of this module uses `crypto.subtle`.
 * Changing that would alter the signature, which is a breaking change.
 */
export function generateEd25519Keypair(): { privkey: Uint8Array; pubkey: Uint8Array } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privJwk = privateKey.export({ format: "jwk" }) as { d: string };
  const pubJwk = publicKey.export({ format: "jwk" }) as { x: string };
  const privkey = new Uint8Array(Buffer.from(privJwk.d, "base64url"));
  const pubkey = new Uint8Array(Buffer.from(pubJwk.x, "base64url"));
  return { privkey, pubkey };
}
```

The docstring previously said "via WebCrypto", which was false — it has always called `node:crypto`. Behavior is unchanged; only the import mechanism and the sentence are corrected.

- [ ] **Step 6: Prove the fix against the built output, the way a consumer would**

Run:

```bash
bun run build && node -e "import('@nimbus-dev/sdk').then(m => { const k = m.generateEd25519Keypair(); console.log('privkey', k.privkey.length, 'pubkey', k.pubkey.length); })"
```

Expected: `privkey 32 pubkey 32`.

Before the fix this command fails with `ReferenceError: require is not defined in ES module scope`. Run it on the pre-fix code first if you want to see it — that failure is the entire reason this task exists.

- [ ] **Step 7: Verify the whole suite and that the surface did not move**

Run: `bun run typecheck && bun run lint && bun test && git diff --exit-code docs/api-surface.md`
Expected: all exit 0. The existing crypto suite must pass with no assertion changed.

- [ ] **Step 8: Commit**

```bash
git add src/crypto/verify-signature.ts src/testing/sandbox-contract.ts src/testing/sandbox-contract.test.ts
git commit -m "fix: make generateEd25519Keypair and the sandbox probe work from dist/

generateEd25519Keypair called require() inside a \"type\": \"module\" package,
so every Node consumer got ReferenceError on first call. It survived in-repo
because the bun export condition resolves to src/.

probePath named sandbox-probe.ts, but dist/testing ships only .js — so from
the published package the spawn failed and was reported as an fs-denied
sandbox failure. Hardcoding .js would break Bun, whose tree has only .ts, so
the extension now follows the running module's own."
```

---

### Task 2: The static CJS scan

**Files:**
- Create: `scripts/cjs-scan.ts`
- Create: `scripts/cjs-scan.test.ts`

**Interfaces:**
- Consumes: `stripComments` from `./api-surface.ts`.
- Produces: `CjsFinding`, `findCjsConstructs`, `CJS_CONSTRUCTS` — not consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `scripts/cjs-scan.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCjsConstructs } from "./cjs-scan.ts";

describe("findCjsConstructs", () => {
  test("finds a top-level require", () => {
    expect(findCjsConstructs('const c = require("node:crypto");').map((f) => f.construct)).toEqual([
      "require(",
    ]);
  });

  test("finds a require nested in a function body", () => {
    const src = "export function f() {\n  const c = require('node:crypto');\n  return c;\n}";
    expect(findCjsConstructs(src)).toHaveLength(1);
    expect(findCjsConstructs(src)[0]?.line).toBe(2);
  });

  test("finds a require behind a conditional and with a computed specifier", () => {
    expect(findCjsConstructs('if (x) { require(name + ".js"); }')).toHaveLength(1);
  });

  test("finds __dirname, __filename and module.exports", () => {
    const src = "const a = __dirname;\nconst b = __filename;\nmodule.exports = a;";
    expect(findCjsConstructs(src).map((f) => f.construct).sort()).toEqual([
      "__dirname",
      "__filename",
      "module.exports",
    ]);
  });

  test("finds a require reached through createRequire", () => {
    const src = 'import { createRequire } from "node:module";\nconst r = createRequire(import.meta.url);\nconst j = r("./x.json");\nconst c = require("y");';
    expect(findCjsConstructs(src).some((f) => f.construct === "require(")).toBe(true);
  });

  test("ignores a require inside a line comment", () => {
    expect(findCjsConstructs('// see require("x") for context\nconst a = 1;')).toEqual([]);
  });

  test("ignores a require inside a block comment", () => {
    expect(findCjsConstructs('/**\n * so `require("@nimbus-dev/client")` threw\n */\nconst a = 1;')).toEqual([]);
  });

  test("catches a require inside a string literal", () => {
    expect(findCjsConstructs('const msg = "call require(x) instead";')).toHaveLength(1);
  });

  test("catches a require inside a template literal", () => {
    expect(findCjsConstructs("const msg = `use require(x)`;")).toHaveLength(1);
  });

  test("reports 1-based line numbers", () => {
    expect(findCjsConstructs("const a = 1;\nconst b = 2;\nconst c = require('x');")[0]?.line).toBe(3);
  });

  test("returns nothing for clean ESM", () => {
    const src = 'import { x } from "node:fs";\nexport const y = () => x();';
    expect(findCjsConstructs(src)).toEqual([]);
  });
});

describe("the emitted dist/ contains no CJS constructs", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  function emittedJsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...emittedJsFiles(full));
      else if (entry.name.endsWith(".js")) out.push(full);
    }
    return out;
  }

  test("dist/ has been built", () => {
    expect(
      existsSync(join(repoRoot, "dist/index.js")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("every emitted .js is free of require, __dirname, __filename and module.exports", () => {
    const files = emittedJsFiles(join(repoRoot, "dist"));
    expect(files.length, "found no emitted .js files — the scan would pass vacuously").toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(repoRoot.length + 1).split("\\").join("/");
      for (const finding of findCjsConstructs(readFileSync(file, "utf8"))) {
        offenders.push(`${rel}:${finding.line} — ${finding.construct}`);
      }
    }

    expect(
      offenders,
      "CommonJS constructs found in the emitted ESM package:\n  " +
        offenders.join("\n  ") +
        "\n\npackage.json declares \"type\": \"module\", so these throw for consumers at " +
        "runtime. If you genuinely need CJS interop — including via createRequire — amend " +
        "scripts/cjs-scan.ts deliberately rather than working around this check.",
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test scripts/cjs-scan.test.ts`
Expected: FAIL — `Cannot find module './cjs-scan.ts'`.

- [ ] **Step 3: Write the scanner**

Create `scripts/cjs-scan.ts`:

```ts
/**
 * Static scan for CommonJS constructs in emitted ESM.
 *
 * `package.json` declares `"type": "module"`, so a `require(` reaching `dist/` throws
 * `ReferenceError: require is not defined in ES module scope` for every consumer that
 * executes that line. The existing ESM smoke cannot see this: it imports each entry point
 * but never calls anything, and the construct that shipped sat inside a function body.
 *
 * This scan is the complete guard for the class. It catches a construct in code no test
 * ever calls, needs no curated list, and does not rot as the surface grows.
 *
 * Comments are stripped first, because `dist/testing/sandbox-contract.js` legitimately
 * contains `require("@nimbus-dev/client")` inside a doc comment — the comment describing
 * the incident that made the probe path lazy. String *contents* are deliberately kept, so
 * a construct hidden in a string or template literal is still reported.
 *
 * `createRequire` is not exempt. Nothing in a dependency-free package of types and pure
 * helpers needs to load a CJS module, and the call site it produces is a `require(` like
 * any other. A genuine need is a deliberate amendment to this file, not a rename that
 * slips past it.
 */

import { stripComments } from "./api-surface.ts";

export type CjsFinding = {
  /** The offending construct, exactly as searched for. */
  construct: string;
  /** 1-based line number in the original source. */
  line: number;
};

/** Searched literally, after comments are stripped. */
export const CJS_CONSTRUCTS: readonly string[] = [
  "require(",
  "__dirname",
  "__filename",
  "module.exports",
];

/**
 * Every CommonJS construct in a source string, with 1-based line numbers.
 *
 * Line numbers survive comment stripping because `stripComments` preserves newlines.
 */
export function findCjsConstructs(source: string): CjsFinding[] {
  const lines = stripComments(source).split("\n");
  const findings: CjsFinding[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    for (const construct of CJS_CONSTRUCTS) {
      if (text.includes(construct)) {
        findings.push({ construct, line: i + 1 });
      }
    }
  }

  return findings;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun run build && bun test scripts/cjs-scan.test.ts`
Expected: PASS, including the integration test over the real `dist/` — which is a real assertion, not a formality, because Task 1 removed the only genuine `require(` and `dist/testing/sandbox-contract.js` still has one in a comment.

If the integration test fails naming `dist/testing/sandbox-contract.js` at the comment, `stripComments` is not being applied. If it fails naming `dist/crypto/verify-signature.js`, Task 1 was not completed or `dist/` is stale — rebuild.

- [ ] **Step 5: Prove the guard actually fails when it should**

Temporarily add `const x = require("node:fs");` inside any function body in `src/crypto/canonical-json.ts`, then run:

```bash
bun run build && bun test scripts/cjs-scan.test.ts
```

Expected: FAIL, naming `dist/crypto/canonical-json.js` and the line. Revert the edit and rebuild. Report what the message said — a guard nobody has seen fail is a guard nobody knows works.

- [ ] **Step 6: Verify and commit**

Run: `bun run typecheck && bun run lint && git diff --exit-code docs/api-surface.md`
Expected: all exit 0.

```bash
git add scripts/cjs-scan.ts scripts/cjs-scan.test.ts
git commit -m "test(scripts): fail CI on CommonJS constructs in the emitted ESM"
```

---

### Task 3: The smoke invocation phase

**Files:**
- Create: `scripts/smoke-calls.mjs`
- Create: `scripts/smoke-calls.test.ts`
- Modify: `scripts/smoke-esm.mjs`

**Interfaces:**
- Consumes: `modulesInSurface`, and `collectEntryPoints` / `buildSurface` from `./api-surface.ts`.
- Produces: `SMOKE_CALLS` — an array of `{ module: string, run: (sdk, testing, ipc) => void | Promise<void> }`.

- [ ] **Step 1: Write the call list**

Create `scripts/smoke-calls.mjs`:

```js
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
  { module: "crypto/jwt", run: (sdk) => void sdk.signJwt },
  { module: "crypto/service-account-token", run: (sdk) => void sdk.mintGoogleAccessToken },
  { module: "crypto/app-store-connect-jwt", run: (sdk) => void sdk.signAppStoreConnectJwt },
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
      if (!sdk.isHitlRequest({ actionId: "a", summary: "b" })) throw new Error("rejected a valid request");
    },
  },
  {
    module: "agents/brief-guards",
    run: (sdk) => {
      if (sdk.isExpertBrief({}) !== false) throw new Error("accepted an empty object");
    },
  },
  { module: "agents/guard-factory", run: (sdk) => void sdk.createBriefGuard },
  { module: "agents/agent-names", run: (sdk) => { if (sdk.AGENT_NAMES.length === 0) throw new Error("empty"); } },
  { module: "agents/brief-types", run: () => {} },
  { module: "agents/brief-composites", run: () => {} },
  { module: "types", run: () => {} },
  { module: "server", run: (sdk) => void new sdk.NimbusExtensionServer({ manifest: MANIFEST }) },
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
```

**Verify every export name against `docs/api-surface.md` before running.** Names such as `canonicalizeManifest`, `signJwt`, `mintGoogleAccessToken`, `signAppStoreConnectJwt` and `createBriefGuard` are used here as `void sdk.X` touches; if any name is wrong, that entry silently reads `undefined` instead of failing. Where a name does not match, correct it — do not delete the entry.

`MANIFEST` is declared after `SMOKE_CALLS` on purpose: `const` in a module is hoisted to the top of the module scope and only read inside `run` callbacks, which execute later.

- [ ] **Step 2: Write the coverage test**

Create `scripts/smoke-calls.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSurface, collectEntryPoints } from "./api-surface.ts";
import { modulesInSurface } from "./docs-modules.ts";
import { SMOKE_CALLS } from "./smoke-calls.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readFromRoot = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

describe("smoke call coverage", () => {
  test("every module in the published surface has a smoke call", () => {
    const entries = collectEntryPoints(readFromRoot("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromRoot));
    const called = new Set(SMOKE_CALLS.map((entry) => entry.module));

    const uncovered = [...modules.keys()].filter((key) => !called.has(key)).sort();
    expect(
      uncovered,
      `these modules have no entry in scripts/smoke-calls.mjs: ${uncovered.join(", ")} — ` +
        "a module with no smoke call is never executed against the built dist/, which is " +
        "exactly how a require() inside a function body shipped undetected.",
    ).toEqual([]);
  });

  test("no smoke call names a module the surface does not reach", () => {
    const entries = collectEntryPoints(readFromRoot("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromRoot));

    const stale = SMOKE_CALLS.map((e) => e.module).filter((m) => !modules.has(m)).sort();
    expect(stale, `smoke calls name modules that no longer exist: ${stale.join(", ")}`).toEqual([]);
  });

  test("every entry has a callable run", () => {
    expect(SMOKE_CALLS.length).toBeGreaterThan(10);
    for (const entry of SMOKE_CALLS) {
      expect(typeof entry.run, `${entry.module}'s run is not a function`).toBe("function");
    }
  });
});
```

- [ ] **Step 3: Run the coverage test and reconcile**

Run: `bun run build && bun test scripts/smoke-calls.test.ts`
Expected: initially FAIL, listing any module key whose name differs from the list above.

Fix by correcting the `module` strings in `scripts/smoke-calls.mjs` to the keys the failure prints. **Use the guard's output as the source of truth**, not this plan's list — if the two disagree, the guard is right.

- [ ] **Step 4: Add the invocation phase to the smoke**

In `scripts/smoke-esm.mjs`, add to the existing import block:

```js
import { SMOKE_CALLS } from "./smoke-calls.mjs";
```

Then, after the existing entry-point loop and **before** the `if (failures.length > 0)` block, insert:

```js
// Phase 2: call real code. Loading an entry point proves the module resolves; it does not
// prove the module runs. The defect this phase exists for was a `require(` inside a
// function body, which every import-only check passed.
const [sdk, testing, ipc] = await Promise.all([
  import(pkg.name),
  import(`${pkg.name}/testing`),
  import(`${pkg.name}/ipc`),
]);

for (const entry of SMOKE_CALLS) {
  try {
    await entry.run(sdk, testing, ipc);
    process.stdout.write(`ok   call ${entry.module}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`call ${entry.module} — ${message}`);
  }
}
```

Update the two closing messages so they report both phases:

```js
process.stderr.write(
  `\n${failures.length} check(s) failed under Node ${process.version}:\n`,
);
```

and

```js
process.stdout.write(
  `\nall ${specifiers.length} entry points loaded and ${SMOKE_CALLS.length} calls ran under Node ${process.version}\n`,
);
```

- [ ] **Step 5: Run the smoke under plain Node**

Run: `bun run build && node scripts/smoke-esm.mjs`
Expected: `ok` for all three entry points, then `ok call <module>` for every entry, then the summary line. Exit code 0.

Any `call <module> — <message>` failure is a real defect in that module as published, not a smoke-test problem. Fix the call only if the *call* is wrong (bad argument, wrong export name); if the module genuinely throws, stop and report it.

- [ ] **Step 6: Prove the phase catches what it exists for**

Temporarily restore the old form in `src/crypto/verify-signature.ts` — replace the `generateKeyPairSync(...)` call with `require("node:crypto").generateKeyPairSync("ed25519")` — then:

```bash
bun run build && node scripts/smoke-esm.mjs
```

Expected: FAIL, with `call crypto/verify-signature — require is not defined in ES module scope`. Revert, rebuild, confirm green. Report the exact message.

This is the check that would have caught the original bug. If it does not fail here, the phase is not doing its job.

- [ ] **Step 7: Verify everything**

Run: `bun run typecheck && bun run lint && bun run build && bun test && node scripts/smoke-esm.mjs`
Expected: all exit 0.

Run: `git diff --exit-code docs/api-surface.md`
Expected: exit 0 — no exported signature changed anywhere in this plan.

- [ ] **Step 8: Commit**

```bash
git add scripts/smoke-calls.mjs scripts/smoke-calls.test.ts scripts/smoke-esm.mjs
git commit -m "test(scripts): call real code in the ESM smoke, with coverage enforced

Loading an entry point proves it resolves, not that it runs — the require()
that shipped sat inside a function body. The call list is checked against
modulesInSurface(), so a new battery fails until it has one."
```

---

## Self-Review

**Spec coverage.** Component 1 (`require()` fix) → Task 1 Steps 5-6. Component 2 (`probePath`) → Task 1 Steps 1-4. Component 3 (static scan, comment stripping, `createRequire` banned) → Task 2. Component 4 (invocation phase, curated list, `testing` checked not spawned, drift detection) → Task 3. The spec's named test cases all appear: `require(` in comments/strings/template literals/nested/conditional/computed positions, `__dirname`/`__filename`/`module.exports`, `createRequire`, the real-`dist/` integration, and module coverage against `modulesInSurface()`.

**Placeholder scan.** None. Every step carries real code; both guards have an explicit "prove it fails" step rather than an assertion that they work.

**Type consistency.** `CjsFinding` is defined in Task 2 and used only there. `SMOKE_CALLS` entries are `{ module: string, run: (sdk, testing, ipc) => void | Promise<void> }` in Task 3 Step 1 and consumed with that exact shape in Steps 2 and 4. `probePath(): string` is exported in Task 1 Step 3 and imported in Step 1's test. `modulesInSurface(entries, surfaces)` keeps its argument order from `scripts/docs-modules.ts`.

**Two things the plan deliberately does not resolve, both flagged inline.** The `module` keys in `smoke-calls.mjs` are my best reading of what `modulesInSurface()` produces; Task 3 Step 3 tells the implementer to trust the guard's output over this plan if they differ. And several `void sdk.X` touches name exports I have not individually verified against `docs/api-surface.md`; Step 1 tells the implementer to check each and correct rather than delete. Both are places where a wrong guess degrades silently, which is why each carries an instruction rather than a hope.
