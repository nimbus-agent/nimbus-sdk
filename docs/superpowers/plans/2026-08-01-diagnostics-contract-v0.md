# Diagnostics / Telemetry Contract v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a structured, redaction-safe diagnostic event envelope that the TypeScript and Python SDKs encode identically, proven by a shared conformance corpus.

**Architecture:** A normative spec under `docs/spec/diagnostics/v1/` is the source of truth; a language-neutral corpus under `docs/spec/conformance/v1/diagnostics/` is its executable form. Both bindings implement a pure, total encoder that validates rather than trusts. Redaction is structural — the envelope admits bounded identifiers, integers, and booleans, and nothing else, so there is nowhere to put a secret.

**Tech Stack:** TypeScript (strict, Bun test, Biome), Python 3.11+ (mypy strict, ruff, pytest), JSON Schema draft-07 validated with Ajv.

**Design spec:** [`../specs/2026-08-01-diagnostics-contract-v0-design.md`](../specs/2026-08-01-diagnostics-contract-v0-design.md)
**Review answered:** [`../specs/2026-08-01-diagnostics-contract-v0-design-review.md`](../specs/2026-08-01-diagnostics-contract-v0-design-review.md)

## Global Constraints

- **Zero runtime dependencies** in both bindings. No `dependencies` in `package.json`; `[project].dependencies` stays empty. Inline any helper.
- **No `any`. TypeScript strict.** Cross-boundary data is `unknown`, narrowed by a type guard. Biome enforces `noExplicitAny` and `noConsole` in `sdks/typescript/src/` (tests may log).
- **No `\d` in any published pattern.** Spell `[0-9]`. A binding transcribing `\d` into Python or Rust silently acquires a Unicode-aware class.
- **No `Buffer`.** Use `new TextEncoder().encode(s).length` for byte length — `Buffer` is Node-only and the package must load under plain ESM.
- **Tests live beside source** as `*.test.ts` in `sdks/typescript/src/`; guards live in `sdks/typescript/scripts/*.test.ts`.
- **`docs/spec/` is language-neutral** and stays at the repository root. Scripts reach it via `repoRoot` from `scripts/paths.ts`, never by computing a root.
- **Python local trap:** after editing anything under `docs/spec/`, run `python -m pip install -e .` from `sdks/python/` **before** `pytest`. `spec_root()` prefers the gitignored bundled copy at `src/nimbus_sdk/_data/spec`, so without the reinstall the suite runs the previous snapshot and passes while executing none of your cases.
- **Conventional Commits drive releases.** The audit-logger deprecation commit MUST be `feat:` — `docs:`/`chore:` cut no release, so the deprecation window would never open.
- **Canonical line form** (used by every task): members in the fixed order `nimbus, ts, level, extensionId, event, kind, correlationId, fields, error`; `fields` keys sorted ascending by code point; no whitespace; non-ASCII **not** escaped.

---

## Why CI stays green between tasks

Tasks 2–5 build `src/diagnostics/` **without exporting it**. The four TypeScript gates key on the *published surface* (`api-surface`, `docs-coverage`, `smoke-calls`) or on fenced `ts` blocks (`docs-snippets`), so an unexported module trips none of them. Task 6 publishes the module and satisfies all four in one commit. Do not reorder 6 before 5.

## File Structure

**Spec (language-neutral, repo root)**
- `docs/spec/diagnostics/v1/diagnostics.md` — the normative document
- `docs/spec/diagnostics/v1/diagnostic-event.schema.json` — independent second expression
- `docs/spec/diagnostics/v1/levels.json` — the published ordered level set (drift-guarded)
- `docs/spec/conformance/v1/diagnostics/{index,index.schema,case.schema}.json` + `cases/*.json`

**TypeScript**
- `src/diagnostics/event.ts` — constants, types, `encodeDiagnostic`, `parseDiagnostic`, `isDiagnosticEvent`, `meetsLevel`
- `src/diagnostics/emitter.ts` — `createEmitter`
- `src/diagnostics/index.ts` — barrel
- `src/testing/diagnostics-assert.ts` — `expectNoRejectedDiagnostics`
- `scripts/diagnostics-guard.test.ts` — corpus runner, drift guard, anti-vacuity gates

**Python**
- `src/nimbus_sdk/diagnostics/{__init__,event,timestamp}.py`
- `tests/test_diagnostics.py`, `tests/test_diagnostics_corpus.py`

---

### Task 1: The normative spec, schema, and level data

**Files:**
- Create: `docs/spec/diagnostics/v1/diagnostics.md`
- Create: `docs/spec/diagnostics/v1/diagnostic-event.schema.json`
- Create: `docs/spec/diagnostics/v1/levels.json`
- Create: `docs/rfcs/0010-diagnostics-contract-v0.md`
- Modify: `docs/spec/README.md`
- Test: `sdks/typescript/scripts/diagnostics-guard.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the file paths above, cited by every later task. `levels.json` has shape `{ "levels": ["debug", "info", "warn", "error"] }`.

- [ ] **Step 1: Write the failing test**

Create `sdks/typescript/scripts/diagnostics-guard.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/diagnostics/v1/diagnostics.md";
const EVENT_SCHEMA_PATH = "docs/spec/diagnostics/v1/diagnostic-event.schema.json";
const LEVELS_PATH = "docs/spec/diagnostics/v1/levels.json";

/** The one normative spelling of each pattern. Every other copy is compared against this. */
const TS_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$";
const NAME_PATTERN = "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)*$";
const FIELD_KEY_PATTERN = "^[a-z][a-z0-9]*$";
const CORRELATION_ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$";

describe("published artifacts", () => {
  test("the spec document exists and is normative", () => {
    const text = readText(SPEC_PATH);
    expect(text).toContain("**Status:** normative");
    expect(text).toContain("RFC 2119");
  });

  test("the event schema compiles under Ajv", () => {
    const ajv = new Ajv({ strict: false });
    expect(() => ajv.compile(readJson(EVENT_SCHEMA_PATH) as object)).not.toThrow();
  });

  test("levels.json publishes the four levels in order", () => {
    expect(readJson(LEVELS_PATH)).toEqual({ levels: ["debug", "info", "warn", "error"] });
  });

  test("no published pattern uses a shorthand digit class", () => {
    // `\d` is ASCII-only in JavaScript and Unicode-aware in Python and Rust. A binding
    // transcribing it silently accepts "١٢٣". Spelled classes remove the keystroke.
    expect(readText(EVENT_SCHEMA_PATH)).not.toContain("\\\\d");
  });

  test("the schema spells every pattern exactly as the spec does", () => {
    const schema = readJson(EVENT_SCHEMA_PATH) as {
      properties: Record<string, { pattern?: string; propertyNames?: { pattern: string } }>;
    };
    expect(schema.properties.ts.pattern).toBe(TS_PATTERN);
    expect(schema.properties.event.pattern).toBe(NAME_PATTERN);
    expect(schema.properties.correlationId.pattern).toBe(CORRELATION_ID_PATTERN);
    expect(schema.properties.fields.propertyNames?.pattern).toBe(FIELD_KEY_PATTERN);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sdks/typescript && bun test scripts/diagnostics-guard.test.ts`
Expected: FAIL — `ENOENT` on `docs/spec/diagnostics/v1/diagnostics.md`.

- [ ] **Step 3: Write `levels.json`**

```json
{
  "levels": ["debug", "info", "warn", "error"]
}
```

- [ ] **Step 4: Write `diagnostic-event.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/diagnostics/v1/diagnostic-event.schema.json",
  "title": "Nimbus diagnostic event",
  "description": "One diagnostic event as it appears on the wire. Closed: members this schema does not name are rejected, because an open envelope has unlimited places to put a secret.",
  "type": "object",
  "required": ["nimbus", "ts", "level", "extensionId", "event"],
  "additionalProperties": false,
  "properties": {
    "nimbus": { "const": "diag" },
    "ts": {
      "type": "string",
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
      "description": "One canonical form, not RFC 3339 generally: fixed-width UTC, exactly three fractional digits, Z only. Makes a plain string sort chronological in every language."
    },
    "level": { "enum": ["debug", "info", "warn", "error"] },
    "extensionId": {
      "type": "string",
      "minLength": 1,
      "description": "Emptiness, not blankness. No trimming is defined, so no two languages' disagreement about trim can reach this contract. The format belongs to the manifest rule registry, not here."
    },
    "event": { "type": "string", "pattern": "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)*$" },
    "kind": { "enum": ["diagnostic", "audit"] },
    "correlationId": { "type": "string", "pattern": "^[A-Za-z0-9_-]{1,64}$" },
    "fields": {
      "type": "object",
      "maxProperties": 16,
      "propertyNames": { "pattern": "^[a-z][a-z0-9]*$" },
      "additionalProperties": {
        "anyOf": [
          { "type": "boolean" },
          {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "An integer VALUE, not an integer host type. JSON has one number type; 1.0 and 1 are the same JSON value and MUST both be accepted, then encoded as 1."
          }
        ]
      }
    },
    "error": {
      "type": "object",
      "required": ["code"],
      "additionalProperties": false,
      "properties": {
        "code": { "type": "string", "pattern": "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)*$" },
        "retriable": { "type": "boolean" }
      }
    }
  }
}
```

- [ ] **Step 5: Write `diagnostics.md`**

Follow the structure of `docs/spec/negotiation/v1/contract-version.md`. Required sections, with the content sourced from the design spec's "The envelope" and "Why each constraint exists":

1. Header — `**Status:** normative. **Contract version:** `v1`.` plus the RFC 2119 paragraph and the "corpus is the tiebreaker" paragraph naming `../../conformance/v1/diagnostics/`.
2. **§1 Scope.** In: the envelope, the levels, the encoding rules, the rejection reasons. Out: the transport (SHOULD stderr-NDJSON, MUST NOT the frame stream — cite `negotiation/v1/contract-version.md` §5), sampling, rate limiting, retention, and `createScopedAuditLogger`'s free-form payload, which is deprecated on its own schedule.
3. **§2 Terminology** — event, level, emitter, sink.
4. **§3 The envelope** — the member table from the design spec, verbatim.
5. **§4 Encoding** — the canonical line form. State all four rules: fixed member order, `fields` keys sorted ascending by code point, no insignificant whitespace, and non-ASCII characters NOT escaped. State the integral-value rule explicitly: *"A binding MUST accept a JSON number whose value is an integer, however its host language types it, and MUST encode it without a fractional part. `1.0` and `1` are the same JSON value; a binding that rejects the former is non-conformant."*
6. **§5 Rejection reasons** — the ordered table (copy from Task 2's `ENCODE_REASONS`), with the note that a conformant implementation checks them in that order, each row reachable only once every row above passes.
7. **§6 Levels** — the ordered set, `levels.json` as its published form, and the definition of "at or above".
8. **§7 Transport** — the SHOULD/MUST NOT split.
9. **§8 What this specification does not give you** — no proof any connector emits anything; `correlationId` bounding is a speed bump not a secrecy proof; **lone surrogates in `extensionId` are undefined behaviour in v0** (JS emits `\uD800`, Python's `ensure_ascii=False` cannot encode it — no case pins it and none should until the manifest registry constrains the id); no cross-member constraints.
10. Closing line: `Changes here follow the [RFC process](../../../GOVERNANCE.md#the-rfc-process) — see [RFC-0010](../../../rfcs/0010-diagnostics-contract-v0.md).`

- [ ] **Step 6: Write `docs/rfcs/0010-diagnostics-contract-v0.md`**

Follow `docs/rfcs/0005-contract-version-negotiation.md`'s structure. State: the problem (Pillar 8's guarantee is currently author discipline); the proposal (this envelope); the five decisions and their rejected branches, copied from the design spec's table; the compatibility impact (**additive** — one new entry point per binding, no existing behaviour changes); and the migration plan (`createScopedAuditLogger`'s payload marked deprecated in this change, removed no earlier than 2.0.0, with the removal RFC citing the release that actually opened the window).

- [ ] **Step 7: Index the new area in `docs/spec/README.md`**

Add `diagnostics/v1/` to the area list alongside `negotiation/v1/`, `predicates/v1/`, `probe/v1/`, `rules/v1/`, `schemas/v1/`, and `wire/v1/`, with a one-line description and a link to the corpus.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd sdks/typescript && bun test scripts/diagnostics-guard.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add docs/spec/diagnostics docs/spec/README.md docs/rfcs/0010-diagnostics-contract-v0.md sdks/typescript/scripts/diagnostics-guard.test.ts
git commit -m "docs: publish the diagnostics contract v0 spec and schema (RFC-0010)"
```

---

### Task 2: The TypeScript encoder

**Files:**
- Create: `sdks/typescript/src/diagnostics/event.ts`
- Test: `sdks/typescript/src/diagnostics/event.test.ts`

**Interfaces:**
- Consumes: `IPC_MAX_LINE_BYTES` from `../ipc/ndjson-line-reader.js`.
- Produces:
  - `DIAGNOSTIC_LEVELS: readonly ["debug","info","warn","error"]`, `type DiagnosticLevel`
  - `DIAGNOSTIC_KINDS: readonly ["diagnostic","audit"]`, `type DiagnosticKind`
  - `interface DiagnosticEvent { ts: string; level: DiagnosticLevel; extensionId: string; event: string; kind?: DiagnosticKind; correlationId?: string; fields?: Record<string, number | boolean>; error?: DiagnosticError }`
  - `interface DiagnosticError { code: string; retriable?: boolean }`
  - `type DiagnosticEncodeReason` (13 tokens, listed below)
  - `type EncodeResult = { ok: true; line: string } | { ok: false; reason: DiagnosticEncodeReason; path: string }`
  - `function encodeDiagnostic(event: unknown): EncodeResult`

- [ ] **Step 1: Write the failing test**

Create `sdks/typescript/src/diagnostics/event.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { IPC_MAX_LINE_BYTES } from "../ipc/ndjson-line-reader.js";
import { type EncodeResult, encodeDiagnostic } from "./event.js";

const BASE = {
  ts: "2026-08-01T12:00:00.000Z",
  level: "info" as const,
  extensionId: "acme-gcal",
  event: "sync.page",
};

const line = (result: EncodeResult): string => {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason} at ${result.path}`);
  return result.line;
};

const rejection = (result: EncodeResult): { reason: string; path: string } => {
  if (result.ok) throw new Error(`expected a rejection, got ${result.line}`);
  return { reason: result.reason, path: result.path };
};

describe("encodeDiagnostic — the canonical line", () => {
  test("emits members in the fixed order with no whitespace", () => {
    expect(line(encodeDiagnostic(BASE))).toBe(
      '{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page"}',
    );
  });

  test("sorts field keys ascending by code point, not insertion order", () => {
    const result = line(encodeDiagnostic({ ...BASE, fields: { zulu: 1, alpha: 2, mike: 3 } }));
    expect(result).toContain('"fields":{"alpha":2,"mike":3,"zulu":1}');
  });

  test("encodes an integral float without a fractional part", () => {
    // JSON has one number type. 1.0 and 1 are the same JSON value, so both are
    // accepted and both encode as 1 — otherwise Python and JavaScript disagree.
    expect(line(encodeDiagnostic({ ...BASE, fields: { ms: 118.0 } }))).toContain('"ms":118');
  });

  test("does not escape non-ASCII", () => {
    // Python's json.dumps escapes by default; ensure_ascii=False is required to match.
    expect(line(encodeDiagnostic({ ...BASE, extensionId: "acmé" }))).toContain('"acmé"');
  });
});

describe("encodeDiagnostic — structural redaction", () => {
  test("rejects an unknown member, naming it", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, message: "row 7 failed" }))).toEqual({
      reason: "unknown-member",
      path: "/message",
    });
  });

  test("rejects a string field value", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { user: "ana@x.com" } }))).toEqual({
      reason: "invalid-field-value",
      path: "/fields/user",
    });
  });

  test("rejects a non-integral number", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { rate: 1.5 } })).reason).toBe(
      "invalid-field-value",
    );
  });

  test("rejects a non-finite number", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { n: Number.NaN } })).reason).toBe(
      "invalid-field-value",
    );
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { n: Number.POSITIVE_INFINITY } })).reason).toBe(
      "invalid-field-value",
    );
  });

  test("rejects an integer beyond the safe range", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { n: 2 ** 53 } })).reason).toBe(
      "invalid-field-value",
    );
  });

  test("rejects more than sixteen fields", () => {
    const fields = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]));
    expect(rejection(encodeDiagnostic({ ...BASE, fields })).reason).toBe("too-many-fields");
  });

  test("rejects a nested object", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { a: { b: 1 } } })).reason).toBe(
      "invalid-field-value",
    );
  });
});

describe("encodeDiagnostic — member validation", () => {
  test("rejects a non-object", () => {
    for (const value of [null, [], "x", 1, true]) {
      expect(rejection(encodeDiagnostic(value)).reason).toBe("not-object");
    }
  });

  test("rejects every non-canonical timestamp", () => {
    for (const ts of [
      "2026-08-01T12:00:00.123456Z", // Python's isoformat() default
      "2026-08-01T12:00:00.123+00:00", // timespec='milliseconds' — the obvious fix
      "2026-08-01t12:00:00.000z", // valid RFC 3339, breaks string sort
      "2026-08-01T12:00:00Z", // no fractional digits
      "٢٠٢٦-08-01T12:00:00.000Z", // Arabic-Indic digits
    ]) {
      expect(rejection(encodeDiagnostic({ ...BASE, ts })).reason).toBe("invalid-ts");
    }
  });

  test("rejects an empty extensionId but accepts a whitespace one", () => {
    // Emptiness, not blankness — a binding reaching for trim() fails the second case.
    expect(rejection(encodeDiagnostic({ ...BASE, extensionId: "" })).reason).toBe(
      "invalid-extension-id",
    );
    expect(line(encodeDiagnostic({ ...BASE, extensionId: " " }))).toContain('"extensionId":" "');
  });

  test("rejects uppercase and separator characters in an event name", () => {
    for (const event of ["Sync.Page", "sync_page", "sync-page", "sync.", ".sync", "sync..page", "1sync"]) {
      expect(rejection(encodeDiagnostic({ ...BASE, event })).reason).toBe("invalid-event");
    }
  });

  test("treats an undefined optional as absent but rejects null", () => {
    // TypeScript-only: { ...spread } produces undefined members. The wire has no
    // undefined, so this accommodation has no Python counterpart and no corpus case.
    expect(line(encodeDiagnostic({ ...BASE, correlationId: undefined }))).not.toContain(
      "correlationId",
    );
    expect(rejection(encodeDiagnostic({ ...BASE, correlationId: null })).reason).toBe(
      "invalid-correlation-id",
    );
  });

  test("bounds correlationId to 64 URL-safe characters", () => {
    expect(line(encodeDiagnostic({ ...BASE, correlationId: "a".repeat(64) }))).toContain("aaa");
    expect(rejection(encodeDiagnostic({ ...BASE, correlationId: "a".repeat(65) })).reason).toBe(
      "invalid-correlation-id",
    );
    expect(rejection(encodeDiagnostic({ ...BASE, correlationId: "ana@x.com" })).reason).toBe(
      "invalid-correlation-id",
    );
  });

  test("requires error.code and forbids message and stack", () => {
    expect(line(encodeDiagnostic({ ...BASE, error: { code: "token.expired" } }))).toContain(
      '"error":{"code":"token.expired"}',
    );
    expect(rejection(encodeDiagnostic({ ...BASE, error: {} })).path).toBe("/error/code");
    expect(
      rejection(encodeDiagnostic({ ...BASE, error: { code: "x", message: "boom" } })).path,
    ).toBe("/error/message");
  });

  test("rejects a line over the framing limit", () => {
    // IPC_MAX_LINE_BYTES is 1 MiB. Repeating it exactly puts the extensionId alone at
    // the limit, so the surrounding envelope carries the line over it. Driving this off
    // the imported constant rather than a literal is the idiom handshake.test.ts uses.
    const result = encodeDiagnostic({ ...BASE, extensionId: "x".repeat(IPC_MAX_LINE_BYTES) });
    expect(rejection(result).reason).toBe("line-too-long");
  });
});

describe("encodeDiagnostic — reason order", () => {
  test("an unknown member is reported before a bad timestamp", () => {
    // Both are wrong. §5's order makes unknown-member reachable first; a binding that
    // validates ts before scanning members passes every single-fault case and fails here.
    expect(rejection(encodeDiagnostic({ ...BASE, ts: "nope", oops: 1 })).reason).toBe(
      "unknown-member",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sdks/typescript && bun test src/diagnostics/event.test.ts`
Expected: FAIL — `Cannot find module './event.js'`.

- [ ] **Step 3: Write the implementation**

Create `sdks/typescript/src/diagnostics/event.ts`:

```ts
/**
 * The diagnostic event envelope — `docs/spec/diagnostics/v1/diagnostics.md`.
 *
 * Pure and total: no clock, no entropy, no I/O, and never throws. The caller supplies
 * `ts` and `correlationId`; this module only ever validates and encodes them.
 *
 * The envelope is CLOSED where the hello frame is open. `contract-version.md` §5 requires
 * unknown members be ignored; §5 here requires they be rejected. That inversion is the
 * redaction guarantee — an open envelope has unlimited places to put a secret.
 */
import { IPC_MAX_LINE_BYTES } from "../ipc/ndjson-line-reader.js";

export const DIAGNOSTIC_LEVELS = ["debug", "info", "warn", "error"] as const;
export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number];

export const DIAGNOSTIC_KINDS = ["diagnostic", "audit"] as const;
export type DiagnosticKind = (typeof DIAGNOSTIC_KINDS)[number];

/** Spelled `[0-9]`, never `\d` — see the spec's §3 note on Unicode-aware digit classes. */
export const DIAGNOSTIC_TS_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
export const DIAGNOSTIC_NAME_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;
export const DIAGNOSTIC_FIELD_KEY_PATTERN = /^[a-z][a-z0-9]*$/;
export const DIAGNOSTIC_CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DIAGNOSTIC_MAX_FIELDS = 16;

export interface DiagnosticError {
  code: string;
  retriable?: boolean;
}

export interface DiagnosticEvent {
  ts: string;
  level: DiagnosticLevel;
  extensionId: string;
  event: string;
  kind?: DiagnosticKind;
  correlationId?: string;
  fields?: Record<string, number | boolean>;
  error?: DiagnosticError;
}

export type DiagnosticEncodeReason =
  | "not-object"
  | "unknown-member"
  | "invalid-ts"
  | "invalid-level"
  | "invalid-extension-id"
  | "invalid-event"
  | "invalid-kind"
  | "invalid-correlation-id"
  | "invalid-fields"
  | "invalid-field-key"
  | "invalid-field-value"
  | "too-many-fields"
  | "invalid-error"
  | "line-too-long";

export type EncodeResult =
  | { readonly ok: true; readonly line: string }
  | { readonly ok: false; readonly reason: DiagnosticEncodeReason; readonly path: string };

/** The member order of the canonical line. Also the closed set of accepted members. */
const MEMBER_ORDER = [
  "ts",
  "level",
  "extensionId",
  "event",
  "kind",
  "correlationId",
  "fields",
  "error",
] as const;

const KNOWN_MEMBERS: ReadonlySet<string> = new Set(MEMBER_ORDER);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const no = (reason: DiagnosticEncodeReason, path: string): EncodeResult => ({
  ok: false,
  reason,
  path,
});

/**
 * True for a JSON number whose VALUE is an integer, whatever its host type.
 *
 * `1.0` and `1` are the same JSON value, so both are accepted — a binding that rejects
 * integral floats disagrees with one that cannot tell them apart, which is exactly the
 * JavaScript/Python split. `Number.isSafeInteger` also excludes NaN, both infinities,
 * and anything past 2^53-1 where a float can no longer represent every integer.
 */
const isEncodableInteger = (value: number): boolean => Number.isSafeInteger(value);

const validateFields = (fields: unknown): EncodeResult | null => {
  if (!isRecord(fields)) return no("invalid-fields", "/fields");
  const keys = Object.keys(fields);
  if (keys.length > DIAGNOSTIC_MAX_FIELDS) return no("too-many-fields", "/fields");
  for (const key of keys) {
    if (!DIAGNOSTIC_FIELD_KEY_PATTERN.test(key)) return no("invalid-field-key", `/fields/${key}`);
    const value = fields[key];
    if (typeof value === "boolean") continue;
    if (typeof value !== "number" || !isEncodableInteger(value)) {
      return no("invalid-field-value", `/fields/${key}`);
    }
  }
  return null;
};

const validateError = (error: unknown): EncodeResult | null => {
  if (!isRecord(error)) return no("invalid-error", "/error");
  for (const key of Object.keys(error)) {
    if (key !== "code" && key !== "retriable") return no("invalid-error", `/error/${key}`);
  }
  const { code, retriable } = error;
  if (typeof code !== "string" || !DIAGNOSTIC_NAME_PATTERN.test(code)) {
    return no("invalid-error", "/error/code");
  }
  if (retriable !== undefined && typeof retriable !== "boolean") {
    return no("invalid-error", "/error/retriable");
  }
  return null;
};

export function encodeDiagnostic(event: unknown): EncodeResult {
  if (!isRecord(event)) return no("not-object", "");

  // Closedness is checked first: an unknown member is a leak, and reporting it before
  // any value problem is what §5's reason order requires.
  for (const key of Object.keys(event)) {
    if (!KNOWN_MEMBERS.has(key)) return no("unknown-member", `/${key}`);
  }

  const { ts, level, extensionId, event: name, kind, correlationId, fields, error } = event;

  if (typeof ts !== "string" || !DIAGNOSTIC_TS_PATTERN.test(ts)) return no("invalid-ts", "/ts");
  if (typeof level !== "string" || !(DIAGNOSTIC_LEVELS as readonly string[]).includes(level)) {
    return no("invalid-level", "/level");
  }
  if (typeof extensionId !== "string" || extensionId === "") {
    return no("invalid-extension-id", "/extensionId");
  }
  if (typeof name !== "string" || !DIAGNOSTIC_NAME_PATTERN.test(name)) {
    return no("invalid-event", "/event");
  }
  if (kind !== undefined && !(DIAGNOSTIC_KINDS as readonly unknown[]).includes(kind)) {
    return no("invalid-kind", "/kind");
  }
  if (
    correlationId !== undefined &&
    (typeof correlationId !== "string" || !DIAGNOSTIC_CORRELATION_ID_PATTERN.test(correlationId))
  ) {
    return no("invalid-correlation-id", "/correlationId");
  }
  if (fields !== undefined) {
    const failure = validateFields(fields);
    if (failure) return failure;
  }
  if (error !== undefined) {
    const failure = validateError(error);
    if (failure) return failure;
  }

  const wire: Record<string, unknown> = { nimbus: "diag" };
  for (const key of MEMBER_ORDER) {
    const value = event[key];
    if (value === undefined) continue;
    // Key order is normative, so `fields` is rebuilt sorted rather than passed through:
    // insertion order is the caller's, and two callers must not produce two lines.
    wire[key] =
      key === "fields"
        ? Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
              .sort()
              .map((k) => [k, (value as Record<string, unknown>)[k]]),
          )
        : value;
  }

  const line = JSON.stringify(wire);
  if (new TextEncoder().encode(line).length > IPC_MAX_LINE_BYTES) return no("line-too-long", "");
  return { ok: true, line };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sdks/typescript && bun test src/diagnostics/event.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `cd sdks/typescript && bun run typecheck && bun run lint`
Expected: both clean. If Biome reports the `as readonly string[]` casts, keep them — they are the narrowing idiom this codebase uses and are not `any`.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/src/diagnostics/event.ts sdks/typescript/src/diagnostics/event.test.ts
git commit -m "feat(diagnostics): add the pure, total diagnostic event encoder"
```

---

### Task 3: `parseDiagnostic`, `isDiagnosticEvent`, `meetsLevel`

**Files:**
- Modify: `sdks/typescript/src/diagnostics/event.ts`
- Modify: `sdks/typescript/src/diagnostics/event.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces:
  - `type DiagnosticParseReason = DiagnosticEncodeReason | "not-json" | "wrong-message"`
  - `type ParseResult = { ok: true; event: DiagnosticEvent } | { ok: false; reason: DiagnosticParseReason; path: string }`
  - `function parseDiagnostic(line: string): ParseResult`
  - `function isDiagnosticEvent(value: unknown): value is DiagnosticEvent`
  - `function meetsLevel(level: DiagnosticLevel, threshold: DiagnosticLevel): boolean`

- [ ] **Step 1: Write the failing test**

Append to `sdks/typescript/src/diagnostics/event.test.ts`:

```ts
import { type DiagnosticLevel, isDiagnosticEvent, meetsLevel, parseDiagnostic } from "./event.js";

describe("parseDiagnostic", () => {
  test("round-trips the canonical line", () => {
    const encoded = line(encodeDiagnostic({ ...BASE, fields: { items: 42 } }));
    const parsed = parseDiagnostic(encoded);
    if (!parsed.ok) throw new Error(`expected ok, got ${parsed.reason}`);
    // `nimbus` is wire framing, not event data, so it is absent from the parsed event —
    // which is what makes encode(parse(line)) === line hold.
    expect(parsed.event).toEqual({ ...BASE, fields: { items: 42 } });
    expect(line(encodeDiagnostic(parsed.event))).toBe(encoded);
  });

  test("rejects a line that is not JSON", () => {
    expect(rejection(parseDiagnostic("not json") as EncodeResult).reason).toBe("not-json");
  });

  test("rejects a line whose discriminator is wrong or missing", () => {
    expect(
      rejection(parseDiagnostic('{"nimbus":"hello","contractVersions":["1"]}') as EncodeResult).reason,
    ).toBe("wrong-message");
    expect(rejection(parseDiagnostic("{}") as EncodeResult).reason).toBe("wrong-message");
  });

  test("rejects an unknown member on the wire", () => {
    const bad = '{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"a","event":"b","message":"leak"}';
    expect(rejection(parseDiagnostic(bad) as EncodeResult)).toEqual({
      reason: "unknown-member",
      path: "/message",
    });
  });
});

describe("meetsLevel", () => {
  test("is true at or above the threshold", () => {
    expect(meetsLevel("warn", "info")).toBe(true);
    expect(meetsLevel("info", "info")).toBe(true);
    expect(meetsLevel("debug", "info")).toBe(false);
    expect(meetsLevel("error", "debug")).toBe(true);
  });

  test("answers false for an unpublished level in either position", () => {
    // Types are erased at runtime and this is a published export. Without the explicit
    // guard TypeScript answers false by accident (indexOf → -1) and Python raises
    // (ValueError) — the same call behaving two different ways.
    const bogus = "trace" as unknown as DiagnosticLevel;
    expect(meetsLevel(bogus, "info")).toBe(false);
    expect(meetsLevel("error", bogus)).toBe(false);
    expect(meetsLevel(bogus, bogus)).toBe(false);
  });
});

describe("isDiagnosticEvent", () => {
  test("agrees with encodeDiagnostic on every input", () => {
    for (const value of [BASE, { ...BASE, fields: { a: 1 } }, {}, null, { ...BASE, x: 1 }]) {
      expect(isDiagnosticEvent(value)).toBe(encodeDiagnostic(value).ok);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sdks/typescript && bun test src/diagnostics/event.test.ts`
Expected: FAIL — `parseDiagnostic is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `sdks/typescript/src/diagnostics/event.ts`:

```ts
export type DiagnosticParseReason = DiagnosticEncodeReason | "not-json" | "wrong-message";

export type ParseResult =
  | { readonly ok: true; readonly event: DiagnosticEvent }
  | { readonly ok: false; readonly reason: DiagnosticParseReason; readonly path: string };

/**
 * The gateway's direction: one decoded line in, an event or a refusal out.
 *
 * `nimbus` is stripped from the returned event. It is wire framing rather than event
 * data, and stripping it is what makes `encodeDiagnostic(parseDiagnostic(l).event)`
 * reproduce `l` exactly.
 */
export function parseDiagnostic(line: string): ParseResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return { ok: false, reason: "not-json", path: "" };
  }
  if (!isRecord(decoded)) return { ok: false, reason: "not-object", path: "" };
  if (decoded.nimbus !== "diag") return { ok: false, reason: "wrong-message", path: "/nimbus" };

  const { nimbus: _discriminator, ...rest } = decoded;
  const encoded = encodeDiagnostic(rest);
  if (!encoded.ok) return { ok: false, reason: encoded.reason, path: encoded.path };
  return { ok: true, event: rest as unknown as DiagnosticEvent };
}

/** Whether a value is an encodable diagnostic event. Total; never throws. */
export function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  return encodeDiagnostic(value).ok;
}

/**
 * Whether `level` is at or above `threshold` in the published order — a host filtering
 * at `threshold` keeps the event. Defined on `DIAGNOSTIC_LEVELS`' index rather than a
 * hard-coded number, which is what the drift guard in Task 4 protects.
 *
 * **Total: an argument that is not a published level answers `false`.** The types say
 * both arguments are levels, but the types are erased at runtime and this is a published
 * export — a JavaScript caller, or data crossing a boundary, reaches it untyped.
 *
 * The explicit guard is what keeps the two bindings honest. Left implicit, TypeScript's
 * `indexOf` returns `-1` and answers `false` by accident, while Python's `.index()`
 * raises `ValueError` — the same call, one silent answer and one crash. Neither language
 * may rely on its own default here.
 */
export function meetsLevel(level: DiagnosticLevel, threshold: DiagnosticLevel): boolean {
  const at = DIAGNOSTIC_LEVELS.indexOf(level);
  const floor = DIAGNOSTIC_LEVELS.indexOf(threshold);
  if (at < 0 || floor < 0) return false;
  return at >= floor;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sdks/typescript && bun test src/diagnostics/event.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
cd sdks/typescript && bun run typecheck && bun run lint
git add sdks/typescript/src/diagnostics/
git commit -m "feat(diagnostics): add parseDiagnostic, isDiagnosticEvent and meetsLevel"
```

---

### Task 4: The conformance corpus and its guard

**Files:**
- Create: `docs/spec/conformance/v1/diagnostics/case.schema.json`
- Create: `docs/spec/conformance/v1/diagnostics/index.schema.json`
- Create: `docs/spec/conformance/v1/diagnostics/index.json`
- Create: `docs/spec/conformance/v1/diagnostics/cases/*.json` (one per row of the table in Step 3)
- Modify: `sdks/typescript/scripts/diagnostics-guard.test.ts`

**Interfaces:**
- Consumes: `encodeDiagnostic`, `parseDiagnostic`, `meetsLevel`, `DIAGNOSTIC_LEVELS` from Task 3.
- Produces: `load_corpus("diagnostics")` becomes valid for Task 8.

- [ ] **Step 1: Write `case.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/conformance/v1/diagnostics/case.schema.json",
  "title": "Diagnostics conformance case",
  "description": "One case. Three kinds, because the specification has three separable assertions: encoding a value (encode), reading a line (parse), and the level ordering (level). A runner reads `kind` and dispatches.",
  "type": "object",
  "required": ["description", "kind"],
  "additionalProperties": false,
  "properties": {
    "description": { "type": "string", "pattern": "\\S" },
    "kind": { "enum": ["encode", "parse", "level"] },
    "event": {
      "description": "encode only. The candidate event. Deliberately unconstrained: most cases assert a malformed value is refused."
    },
    "line": {
      "type": "string",
      "description": "parse only. One decoded line, without its terminating LF. A string rather than a parsed object, because what is under test is the parsing."
    },
    "level": { "enum": ["debug", "info", "warn", "error"], "description": "level only." },
    "threshold": { "enum": ["debug", "info", "warn", "error"], "description": "level only." },
    "expect": {
      "type": "object",
      "required": ["ok"],
      "additionalProperties": false,
      "properties": {
        "ok": { "type": "boolean" },
        "line": { "type": "string", "description": "encode only, on success: the exact canonical line." },
        "event": { "description": "parse only, on success: the decoded event, without `nimbus`." },
        "meets": { "type": "boolean", "description": "level only." },
        "reason": {
          "enum": [
            "not-json",
            "not-object",
            "wrong-message",
            "unknown-member",
            "invalid-ts",
            "invalid-level",
            "invalid-extension-id",
            "invalid-event",
            "invalid-kind",
            "invalid-correlation-id",
            "invalid-fields",
            "invalid-field-key",
            "invalid-field-value",
            "too-many-fields",
            "invalid-error",
            "line-too-long"
          ]
        },
        "path": { "type": "string", "description": "On refusal: the JSON Pointer naming the offending member." }
      },
      "allOf": [
        {
          "if": { "properties": { "ok": { "const": false } }, "required": ["ok"] },
          "then": { "required": ["reason", "path"] }
        }
      ]
    }
  },
  "allOf": [
    {
      "if": { "properties": { "kind": { "const": "encode" } }, "required": ["kind"] },
      "then": { "required": ["event", "expect"] }
    },
    {
      "if": { "properties": { "kind": { "const": "parse" } }, "required": ["kind"] },
      "then": { "required": ["line", "expect"] }
    },
    {
      "if": { "properties": { "kind": { "const": "level" } }, "required": ["kind"] },
      "then": { "required": ["level", "threshold", "expect"] }
    }
  ]
}
```

- [ ] **Step 2: Write `index.schema.json`**

Copy `docs/spec/conformance/v1/negotiation/index.schema.json` verbatim, changing only the `$id` path segment from `negotiation` to `diagnostics` and the `spec` property's description to name `diagnostics/v1/diagnostics.md`.

- [ ] **Step 3: Write the case files**

Each file is `{ "description": "…", "kind": "…", …inputs…, "expect": {…} }`. `BASE` below abbreviates the four required members — **write them out in full in every file**; the corpus has no includes:

```json
"ts": "2026-08-01T12:00:00.000Z", "level": "info", "extensionId": "acme-gcal", "event": "sync.page"
```

Two complete examples showing the exact shape:

`cases/encode-canonical.json`
```json
{
  "description": "The canonical line the reference encoder emits.",
  "kind": "encode",
  "event": {
    "ts": "2026-08-01T12:00:00.000Z",
    "level": "info",
    "extensionId": "acme-gcal",
    "event": "sync.page"
  },
  "expect": {
    "ok": true,
    "line": "{\"nimbus\":\"diag\",\"ts\":\"2026-08-01T12:00:00.000Z\",\"level\":\"info\",\"extensionId\":\"acme-gcal\",\"event\":\"sync.page\"}"
  }
}
```

`cases/fields-string-rejected.json`
```json
{
  "description": "A string field value is refused — the structural redaction guarantee.",
  "kind": "encode",
  "event": {
    "ts": "2026-08-01T12:00:00.000Z",
    "level": "info",
    "extensionId": "acme-gcal",
    "event": "sync.page",
    "fields": { "user": "ana@x.com" }
  },
  "expect": { "ok": false, "reason": "invalid-field-value", "path": "/fields/user" }
}
```

Write one file per row. `event`/`line` is the input, `expect` the required outcome. The
"every case on disk is indexed, and every indexed case exists" gate in Step 5 is what
enforces completeness — a row skipped here fails that test rather than passing quietly:

| File (`cases/`) | Kind | Input delta from BASE | Expect |
|---|---|---|---|
| `encode-canonical.json` | encode | — | ok, line above |
| `encode-all-members.json` | encode | `kind:"audit"`, `correlationId:"01J9Z4Q7"`, `fields:{items:42,partial:true}`, `error:{code:"token.expired",retriable:true}` | ok, full canonical line |
| `fields-sorted-by-key.json` | encode | `fields:{zulu:1,alpha:2,mike:3}` | ok, `"fields":{"alpha":2,"mike":3,"zulu":1}` |
| `fields-integral-float-accepted.json` | encode | `fields:{ms:118.0}` | ok, `"ms":118` |
| `fields-float-rejected.json` | encode | `fields:{rate:1.5}` | `invalid-field-value`, `/fields/rate` |
| `fields-nan-rejected.json` | encode | `fields:{n:1e400}` (JSON has no NaN literal; a value overflowing to Infinity is the expressible form) | `invalid-field-value`, `/fields/n` |
| `fields-two-pow-53-plus-one-rejected.json` | encode | `fields:{n:9007199254740993}` | `invalid-field-value`, `/fields/n` |
| `fields-two-pow-53-minus-one-accepted.json` | encode | `fields:{n:9007199254740991}` | ok |
| `fields-negative-integer-accepted.json` | encode | `fields:{delta:-42}` | ok |
| `fields-zero-accepted.json` | encode | `fields:{n:0}` | ok |
| `fields-negative-zero-normalized.json` | encode | `fields:{n:-0.0}` | ok, `"n":0`. Verified: naive Python emits `-0.0` where JavaScript emits `0`. The integral-float narrowing already fixes this, so the case is a **regression pin** on that narrowing, not a new rule — a binding that skips `int()` passes every other numeric case and fails here |
| `fields-boolean-accepted.json` | encode | `fields:{partial:true}` | ok |
| `fields-null-rejected.json` | encode | `fields:{n:null}` | `invalid-field-value`, `/fields/n` |
| `fields-nested-object-rejected.json` | encode | `fields:{a:{"b":1}}` | `invalid-field-value`, `/fields/a` |
| `fields-array-rejected.json` | encode | `fields:{a:[1]}` | `invalid-field-value`, `/fields/a` |
| `fields-empty-object-accepted.json` | encode | `fields:{}` | ok, `"fields":{}` |
| `fields-not-object-rejected.json` | encode | `fields:5` | `invalid-fields`, `/fields` |
| `fields-uppercase-key-rejected.json` | encode | `fields:{Items:1}` | `invalid-field-key`, `/fields/Items` |
| `fields-underscore-key-rejected.json` | encode | `fields:{item_count:1}` | `invalid-field-key`, `/fields/item_count` |
| `fields-sixteen-accepted.json` | encode | 16 keys `k0`…`k15` | ok |
| `fields-seventeen-rejected.json` | encode | 17 keys `k0`…`k16` | `too-many-fields`, `/fields` |
| `unknown-member-rejected.json` | encode | `message:"row 7 failed"` | `unknown-member`, `/message`. **Reason text must cite `negotiation/cases/hello-unknown-member.json`, which requires the opposite** |
| `not-object-null-rejected.json` | encode | event is `null` | `not-object`, `""` |
| `not-object-array-rejected.json` | encode | event is `[]` | `not-object`, `""` |
| `ts-missing-rejected.json` | encode | `ts` absent | `invalid-ts`, `/ts` |
| `ts-microseconds-rejected.json` | encode | `ts:"2026-08-01T12:00:00.123456Z"` | `invalid-ts`. Python's `isoformat()` default |
| `ts-offset-rejected.json` | encode | `ts:"2026-08-01T12:00:00.123+00:00"` | `invalid-ts`. `timespec="milliseconds"` — the obvious fix, which also fails |
| `ts-lowercase-z-rejected.json` | encode | `ts:"2026-08-01t12:00:00.000z"` | `invalid-ts` |
| `ts-no-fraction-rejected.json` | encode | `ts:"2026-08-01T12:00:00Z"` | `invalid-ts` |
| `ts-non-ascii-digit-rejected.json` | encode | `ts:"٢٠٢٦-08-01T12:00:00.000Z"` | `invalid-ts` |
| `level-debug-accepted.json` | encode | `level:"debug"` | ok — plus three siblings for `info`, `warn`, `error`, named `level-info-accepted.json` etc. |
| `level-unknown-rejected.json` | encode | `level:"trace"` | `invalid-level`, `/level` |
| `level-uppercase-rejected.json` | encode | `level:"INFO"` | `invalid-level`, `/level` |
| `extension-id-empty-rejected.json` | encode | `extensionId:""` | `invalid-extension-id` |
| `extension-id-whitespace-accepted.json` | encode | `extensionId:" "` | ok — emptiness, not blankness |
| `extension-id-non-ascii-accepted.json` | encode | `extensionId:"acmé"` | ok, line contains a literal `é` — pins `ensure_ascii=False` |
| `event-uppercase-rejected.json` | encode | `event:"Sync.Page"` | `invalid-event` |
| `event-underscore-rejected.json` | encode | `event:"sync_page"` | `invalid-event` |
| `event-hyphen-rejected.json` | encode | `event:"sync-page"` | `invalid-event` |
| `event-empty-segment-rejected.json` | encode | `event:"sync..page"` | `invalid-event` |
| `event-leading-digit-rejected.json` | encode | `event:"1sync"` | `invalid-event` |
| `kind-audit-accepted.json` | encode | `kind:"audit"` | ok |
| `kind-unknown-rejected.json` | encode | `kind:"trace"` | `invalid-kind`, `/kind` |
| `correlation-id-absent-accepted.json` | encode | — | ok, line has no `correlationId` |
| `correlation-id-null-rejected.json` | encode | `correlationId:null` | `invalid-correlation-id`. `dict.get()` collapses absent and null |
| `correlation-id-64-accepted.json` | encode | 64 × `a` | ok |
| `correlation-id-65-rejected.json` | encode | 65 × `a` | `invalid-correlation-id` |
| `correlation-id-at-sign-rejected.json` | encode | `"ana@x.com"` | `invalid-correlation-id` |
| `error-code-only-accepted.json` | encode | `error:{code:"token.expired"}` | ok |
| `error-missing-code-rejected.json` | encode | `error:{}` | `invalid-error`, `/error/code` |
| `error-message-rejected.json` | encode | `error:{code:"x",message:"boom"}` | `invalid-error`, `/error/message` |
| `error-stack-rejected.json` | encode | `error:{code:"x",stack:"at foo"}` | `invalid-error`, `/error/stack` |
| `reason-order-unknown-before-ts.json` | encode | `ts:"nope"` **and** `oops:1` | `unknown-member`. Two faults; pins §5's order |
| `parse-canonical.json` | parse | the canonical line | ok, event without `nimbus` |
| `parse-not-json.json` | parse | `not json` | `not-json`, `""` |
| `parse-wrong-message.json` | parse | `{"nimbus":"hello","contractVersions":["1"]}` | `wrong-message`, `/nimbus` |
| `parse-missing-discriminator.json` | parse | `{}` | `wrong-message`, `/nimbus` |
| `parse-unknown-member.json` | parse | canonical line plus `"message":"leak"` | `unknown-member`, `/message` |
| `level-warn-meets-info.json` | level | `level:"warn"`, `threshold:"info"` | `meets: true` |
| `level-info-meets-info.json` | level | `level:"info"`, `threshold:"info"` | `meets: true` |
| `level-debug-below-info.json` | level | `level:"debug"`, `threshold:"info"` | `meets: false` |

- [ ] **Step 4: Write `index.json`**

`{ "spec": "../../../diagnostics/v1/diagnostics.md", "cases": [ … ] }` with one entry per file: `{ "file": "cases/<name>.json", "section": "§N", "reason": "<why a binding fails without it>" }`. Copy the "why" column above into `reason`.

- [ ] **Step 5: Write the corpus runner and anti-vacuity gates**

Append to `sdks/typescript/scripts/diagnostics-guard.test.ts`. **First widen its existing
`node:fs` import to `import { readdirSync, readFileSync } from "node:fs";`** — Task 1 could
not import `readdirSync` unused without failing Biome's lint, so adding it is this task's job:

```ts
import {
  DIAGNOSTIC_LEVELS,
  encodeDiagnostic,
  meetsLevel,
  parseDiagnostic,
} from "../src/diagnostics/event.ts";

const CORPUS_DIR = "docs/spec/conformance/v1/diagnostics";
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const CORPUS_INDEX_PATH = `${CORPUS_DIR}/index.json`;

interface IndexEntry { file: string; section: string; reason: string }
interface Case {
  description: string;
  kind: "encode" | "parse" | "level";
  event?: unknown;
  line?: string;
  level?: string;
  threshold?: string;
  expect: Record<string, unknown>;
}

const index = readJson(CORPUS_INDEX_PATH) as { spec: string; cases: IndexEntry[] };
const cases: Case[] = index.cases.map((e) => readJson(`${CORPUS_DIR}/${e.file}`) as Case);

describe("diagnostics corpus", () => {
  test("every case validates against case.schema.json", () => {
    const validate = new Ajv({ strict: false }).compile(readJson(CASE_SCHEMA_PATH) as object);
    for (const [i, c] of cases.entries()) {
      if (!validate(c)) throw new Error(`${index.cases[i].file}: ${JSON.stringify(validate.errors)}`);
    }
  });

  test("every case on disk is indexed, and every indexed case exists", () => {
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases")).filter((f) => f.endsWith(".json"));
    expect(new Set(index.cases.map((e) => e.file.replace("cases/", "")))).toEqual(new Set(onDisk));
  });

  test("the corpus is not empty", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test("every level appears in an accepted encode case", () => {
    const accepted = new Set(
      cases
        .filter((c) => c.kind === "encode" && c.expect.ok)
        .map((c) => (c.event as { level?: string } | null)?.level),
    );
    for (const level of DIAGNOSTIC_LEVELS) expect(accepted).toContain(level);
  });

  test("every reason token is produced by at least one case", () => {
    const schema = readJson(CASE_SCHEMA_PATH) as {
      properties: { expect: { properties: { reason: { enum: string[] } } } };
    };
    const produced = new Set(cases.filter((c) => !c.expect.ok).map((c) => c.expect.reason));
    for (const reason of schema.properties.expect.properties.reason.enum) {
      expect(produced).toContain(reason);
    }
  });

  test("every envelope member has both an accept and a reject case", () => {
    // The gate with no precedent: it is what stops a member shipping unpinned.
    const members = ["ts", "level", "extensionId", "event", "kind", "correlationId", "fields", "error"];
    const touched = (ok: boolean): Set<string> =>
      new Set(
        cases
          .filter((c) => c.kind === "encode" && Boolean(c.expect.ok) === ok)
          .flatMap((c) => Object.keys((c.event ?? {}) as object)),
      );
    const accepted = touched(true);
    const rejectedPaths = new Set(
      cases.filter((c) => !c.expect.ok).map((c) => String(c.expect.path ?? "").split("/")[1]),
    );
    for (const member of members) {
      expect(accepted).toContain(member);
      expect(rejectedPaths).toContain(member);
    }
  });

  test("the runtime level set matches the published data", () => {
    // Drift: the package is dependency-free and does no I/O, so the runtime holds its
    // own copy. Same situation as row-data-segments.json, same guard.
    expect([...DIAGNOSTIC_LEVELS]).toEqual((readJson(LEVELS_PATH) as { levels: string[] }).levels);
  });
});

describe("diagnostics corpus — execution", () => {
  for (const [i, c] of cases.entries()) {
    test(`${index.cases[i].file}: ${c.description}`, () => {
      if (c.kind === "encode") {
        const result = encodeDiagnostic(c.event);
        if (c.expect.ok) {
          expect(result).toEqual({ ok: true, line: c.expect.line as string });
        } else {
          expect(result).toEqual({
            ok: false,
            reason: c.expect.reason as never,
            path: c.expect.path as string,
          });
        }
      } else if (c.kind === "parse") {
        const result = parseDiagnostic(c.line as string);
        if (c.expect.ok) {
          expect(result).toEqual({ ok: true, event: c.expect.event as never });
        } else {
          expect(result).toEqual({
            ok: false,
            reason: c.expect.reason as never,
            path: c.expect.path as string,
          });
        }
      } else {
        expect(meetsLevel(c.level as never, c.threshold as never)).toBe(c.expect.meets as boolean);
      }
    });
  }
});
```

- [ ] **Step 6: Run and iterate until green**

Run: `cd sdks/typescript && bun test scripts/diagnostics-guard.test.ts`
Expected: PASS. A failing case means either the expected line in the case file is wrong or the encoder is — check the canonical form rules before changing the encoder.

- [ ] **Step 7: Commit**

```bash
git add docs/spec/conformance/v1/diagnostics sdks/typescript/scripts/diagnostics-guard.test.ts
git commit -m "test(diagnostics): publish the conformance corpus and its anti-vacuity gates"
```

---

### Task 5: The emitter and the testing helper

**Files:**
- Create: `sdks/typescript/src/diagnostics/emitter.ts`
- Create: `sdks/typescript/src/diagnostics/emitter.test.ts`
- Create: `sdks/typescript/src/testing/diagnostics-assert.ts`
- Modify: `sdks/typescript/src/testing/index.ts`

**Interfaces:**
- Consumes: `encodeDiagnostic`, `DiagnosticEvent`, `EncodeResult`, `DiagnosticLevel` from Task 3.
- Produces:
  - `type DiagnosticEmit = (line: string) => void | Promise<void>`
  - `type EmitResult = EncodeResult | { readonly ok: false; readonly reason: "sink-failed"; readonly path: "" }`
  - `interface DiagnosticEmitter { debug/info/warn/error/audit(event: string, detail: EmitDetail): Promise<EmitResult> }`
  - `interface EmitDetail { ts: string; correlationId?: string; fields?: Record<string, number | boolean>; error?: DiagnosticError }`
  - `function createEmitter(extensionId: string, emit: DiagnosticEmit): DiagnosticEmitter`
  - `function expectNoRejectedDiagnostics(results: readonly EmitResult[]): void` (from `./testing`)

> **`sink-failed` is deliberately NOT a contract reason.** It is not in
> `DiagnosticEncodeReason`, not in `case.schema.json`'s enum, and not in the spec's §5
> table. A closed pipe is a property of one TypeScript wrapper's host environment — Python
> ships no emitter at all and could never produce this token. Putting it in the
> language-neutral contract would oblige every future binding to carry a reason its own
> architecture may have no analogue for, and would force the "every reason token is
> produced" gate to grow a permanent carve-out for a token no corpus case can ever reach.
> A separate union at the wrapper layer costs one type alias and keeps that gate total.

- [ ] **Step 1: Write the failing test**

Create `sdks/typescript/src/diagnostics/emitter.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createEmitter } from "./emitter.js";

const TS = "2026-08-01T12:00:00.000Z";

describe("createEmitter", () => {
  test("writes the canonical line and reports success", async () => {
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", (line) => {
      written.push(line);
    });
    const result = await nimbus.info("sync.page", { ts: TS, fields: { items: 42 } });
    expect(result.ok).toBe(true);
    expect(written).toEqual([
      '{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page","fields":{"items":42}}',
    ]);
  });

  test("audit() sets kind, the level methods do not", async () => {
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", (line) => {
      written.push(line);
    });
    await nimbus.audit("calendar.event.deleted", { ts: TS });
    await nimbus.warn("quota.low", { ts: TS });
    expect(written[0]).toContain('"kind":"audit"');
    expect(written[1]).not.toContain('"kind"');
  });

  test("awaits an asynchronous sink", async () => {
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", async (line) => {
      await Promise.resolve();
      written.push(line);
    });
    await nimbus.info("sync.page", { ts: TS });
    expect(written).toHaveLength(1);
  });

  test("drops an invalid event without writing, and never throws", async () => {
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", (line) => {
      written.push(line);
    });
    const result = await nimbus.info("sync.page", { ts: TS, fields: { user: "ana@x.com" } });
    expect(result).toEqual({ ok: false, reason: "invalid-field-value", path: "/fields/user" });
    // A half-valid line on a stream the gateway parses as NDJSON is worse than silence.
    expect(written).toEqual([]);
  });

  test("captures a throwing sink instead of rethrowing", async () => {
    const nimbus = createEmitter("acme-gcal", () => {
      throw new Error("stderr closed");
    });
    // Diagnostics must not be able to take down the connector they describe.
    const result = await nimbus.error("boom", { ts: TS });
    expect(result).toEqual({ ok: false, reason: "sink-failed", path: "" });
  });

  test("sink-failed is distinguishable from a refused event", async () => {
    // Reusing an encoder reason here would tell an author their event was malformed
    // when the event was fine and the pipe was closed.
    const nimbus = createEmitter("acme-gcal", () => {
      throw new Error("stderr closed");
    });
    const sink = await nimbus.info("sync.page", { ts: TS });
    const refused = await nimbus.info("sync.page", { ts: TS, fields: { user: "ana@x.com" } });
    expect(sink.ok || refused.ok).toBe(false);
    expect(sink).not.toEqual(refused);
  });

  test("rejects an empty extensionId at construction", () => {
    expect(() => createEmitter("", () => {})).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sdks/typescript && bun test src/diagnostics/emitter.test.ts`
Expected: FAIL — `Cannot find module './emitter.js'`.

- [ ] **Step 3: Write the implementation**

Create `sdks/typescript/src/diagnostics/emitter.ts`:

```ts
/**
 * The authoring ergonomics over the envelope.
 *
 * Three properties this module must never lose:
 *   1. It never throws from a log call. Diagnostics must not be able to take down the
 *      connector they are describing.
 *   2. It never writes a line the encoder refused. A half-valid line on a stream a
 *      gateway parses as NDJSON turns an authoring bug into the gateway's problem.
 *   3. It reads no clock. `ts` is the caller's, per the spec's purity rule.
 *
 * The methods return a Promise because `predicates/v1` §5 records the audit-logging
 * operation as one that must not block its caller, and `contract-tests.ts` enforces it.
 */
import {
  type DiagnosticError,
  type DiagnosticLevel,
  type EncodeResult,
  encodeDiagnostic,
} from "./event.js";

export type DiagnosticEmit = (line: string) => void | Promise<void>;

/**
 * A sink failure is a property of THIS wrapper's host, not of the contract — Python
 * ships no emitter and could never produce it — so it lives in a union here rather than
 * in `DiagnosticEncodeReason`, and never reaches `case.schema.json`.
 */
export type EmitResult =
  | EncodeResult
  | { readonly ok: false; readonly reason: "sink-failed"; readonly path: "" };

export interface EmitDetail {
  ts: string;
  correlationId?: string;
  fields?: Record<string, number | boolean>;
  error?: DiagnosticError;
}

export interface DiagnosticEmitter {
  debug(event: string, detail: EmitDetail): Promise<EmitResult>;
  info(event: string, detail: EmitDetail): Promise<EmitResult>;
  warn(event: string, detail: EmitDetail): Promise<EmitResult>;
  error(event: string, detail: EmitDetail): Promise<EmitResult>;
  audit(event: string, detail: EmitDetail): Promise<EmitResult>;
}

export function createEmitter(extensionId: string, emit: DiagnosticEmit): DiagnosticEmitter {
  if (extensionId === "") throw new Error("extensionId must be non-empty");

  const send = async (
    level: DiagnosticLevel,
    kind: "audit" | undefined,
    event: string,
    detail: EmitDetail,
  ): Promise<EmitResult> => {
    const encoded = encodeDiagnostic({ ...detail, level, extensionId, event, ...(kind ? { kind } : {}) });
    if (!encoded.ok) return encoded;
    try {
      await emit(encoded.line);
    } catch {
      // Captured, never rethrown: an awaited method that can reject is exactly the
      // hazard property 1 exists to prevent.
      return { ok: false, reason: "sink-failed", path: "" };
    }
    return encoded;
  };

  return {
    debug: (event, detail) => send("debug", undefined, event, detail),
    info: (event, detail) => send("info", undefined, event, detail),
    warn: (event, detail) => send("warn", undefined, event, detail),
    error: (event, detail) => send("error", undefined, event, detail),
    audit: (event, detail) => send("info", "audit", event, detail),
  };
}
```

Note that `send` returns `encoded` unchanged on success, so a caller receives the exact
line that was written and can compare it — the emitter adds no information of its own on
the happy path.

- [ ] **Step 4: Write the testing helper**

Create `sdks/typescript/src/testing/diagnostics-assert.ts`:

```ts
/**
 * Make dropped diagnostics loud where it is free to be loud.
 *
 * The emitter drops invalid events in production on purpose. That is the right runtime
 * behaviour and the wrong test behaviour, so a connector's own suite collects the
 * results it got and asserts none were refused. The alternative — a NODE_ENV check
 * inside the emitter — would be an untestable, platform-dependent normative claim.
 */
import type { EmitResult } from "../diagnostics/emitter.js";

export function expectNoRejectedDiagnostics(results: readonly EmitResult[]): void {
  const rejected = results.filter((r) => !r.ok);
  if (rejected.length > 0) {
    const detail = rejected
      .map((r) => (r.ok ? "" : `${r.reason} at ${r.path === "" ? "<root>" : r.path}`))
      .join("; ");
    throw new Error(`${rejected.length} diagnostic event(s) were refused and dropped: ${detail}`);
  }
}
```

Add to `sdks/typescript/src/testing/index.ts`:

```ts
export { expectNoRejectedDiagnostics } from "./diagnostics-assert.js";
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `cd sdks/typescript && bun test src/diagnostics/ && bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/src/diagnostics/emitter.ts sdks/typescript/src/diagnostics/emitter.test.ts sdks/typescript/src/testing/
git commit -m "feat(diagnostics): add createEmitter and the rejected-event test helper"
```

---

### Task 6: Publish the fifth entry point

**Files:**
- Create: `sdks/typescript/src/diagnostics/index.ts`
- Create: `docs/modules/diagnostics.md`
- Modify: `sdks/typescript/package.json` (exports map)
- Modify: `sdks/typescript/scripts/smoke-calls.mjs`
- Modify: `sdks/typescript/scripts/smoke-esm.mjs`
- Modify: `docs/api-surface.md` (generated — do not hand-edit)

**Interfaces:**
- Consumes: everything from Tasks 2, 3, 5.
- Produces: `@nimbus-dev/sdk/diagnostics` as a resolvable specifier.

- [ ] **Step 1: Write the barrel**

Create `sdks/typescript/src/diagnostics/index.ts`:

```ts
/**
 * `@nimbus-dev/sdk/diagnostics` — the structured, redaction-safe diagnostic envelope.
 *
 * A separate entry point because diagnostics is a separate contract with its own spec
 * area (`docs/spec/diagnostics/v1/`), the same claim the `.` vs `./ipc` split makes.
 */
export {
  createEmitter,
  type DiagnosticEmit,
  type DiagnosticEmitter,
  type EmitDetail,
  type EmitResult,
} from "./emitter.js";
export {
  DIAGNOSTIC_CORRELATION_ID_PATTERN,
  DIAGNOSTIC_FIELD_KEY_PATTERN,
  DIAGNOSTIC_KINDS,
  DIAGNOSTIC_LEVELS,
  DIAGNOSTIC_MAX_FIELDS,
  DIAGNOSTIC_NAME_PATTERN,
  DIAGNOSTIC_TS_PATTERN,
  type DiagnosticEncodeReason,
  type DiagnosticError,
  type DiagnosticEvent,
  type DiagnosticKind,
  type DiagnosticLevel,
  type DiagnosticParseReason,
  type EncodeResult,
  encodeDiagnostic,
  isDiagnosticEvent,
  meetsLevel,
  type ParseResult,
  parseDiagnostic,
} from "./event.js";
```

- [ ] **Step 2: Add the entry to the exports map**

In `sdks/typescript/package.json`, after the `"./connector-kit"` block:

```json
    "./diagnostics": {
      "bun": "./src/diagnostics/index.ts",
      "types": "./dist/diagnostics/index.d.ts",
      "import": "./dist/diagnostics/index.js",
      "default": "./dist/diagnostics/index.js"
    }
```

- [ ] **Step 3: Run the surface and packaging gates to see them fail**

Run: `cd sdks/typescript && bun test scripts/api-surface.test.ts scripts/docs-coverage.test.ts scripts/smoke-calls.test.ts scripts/packed-exports.test.ts`
Expected: FAIL — `api-surface.md` is stale, `src/diagnostics/*` is unclaimed by any docs page, and `smoke-calls.mjs` has no entry for the new modules.

- [ ] **Step 4: Write `docs/modules/diagnostics.md`**

First line must be the coverage claim — `docs-coverage.test.ts` requires every module in the surface be claimed by exactly one page:

```markdown
<!-- covers: diagnostics/event, diagnostics/emitter, testing/diagnostics-assert -->

# `diagnostics`
```

Then: what the envelope is, the member table, the level set, a `createEmitter` example, and the redaction rationale. **Every fenced `ts` block is typechecked against `dist/` by `docs-snippets.test.ts` and must import nothing third-party** — import only from `@nimbus-dev/sdk/diagnostics`. Link the normative spec at `../spec/diagnostics/v1/diagnostics.md`.

- [ ] **Step 5: Add the smoke-call entries**

In `sdks/typescript/scripts/smoke-calls.mjs`, add to `SMOKE_CALLS`:

```js
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
    run: (_sdk, _testing, _ipc, _connectorKit, diagnostics) => {
      const lines = [];
      const emitter = diagnostics.createEmitter("smoke", (line) => {
        lines.push(line);
      });
      if (typeof emitter.info !== "function") throw new Error("createEmitter returned no info()");
    },
  },
  {
    module: "testing/diagnostics-assert",
    run: (_sdk, testing) => {
      testing.expectNoRejectedDiagnostics([]);
    },
  },
```

Check the actual `run` signature in the file's header comment before writing — it documents which entry points are passed. Adding a fifth entry point means `smoke-calls.mjs`'s caller must import and pass it; update that call site too.

- [ ] **Step 6: Add the entry point to the ESM smoke**

In `sdks/typescript/scripts/smoke-esm.mjs`, add `@nimbus-dev/sdk/diagnostics` alongside the four existing specifiers so the new entry point is proven to load under each supported Node LTS.

- [ ] **Step 7: Regenerate the API surface**

Run: `cd sdks/typescript && bun run api:surface`
Expected: `docs/api-surface.md` gains the `diagnostics` exports. Review the diff — it is the reviewable record of a surface change.

- [ ] **Step 8: Run every gate**

Run: `cd sdks/typescript && bun run build && bun test && bun run typecheck && bun run lint`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add sdks/typescript/package.json sdks/typescript/src/diagnostics/index.ts sdks/typescript/scripts/ docs/modules/diagnostics.md docs/api-surface.md
git commit -m "feat(diagnostics): publish @nimbus-dev/sdk/diagnostics as a fifth entry point"
```

---

### Task 7: Open the audit-logger deprecation window

**Files:**
- Modify: `sdks/typescript/src/audit-logger.ts`
- Modify: `docs/api-surface.md` (generated)
- Modify: `docs/modules/audit-logger.md`

**Interfaces:**
- Consumes: `createEmitter` from Task 6 — named in the deprecation message.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append to `sdks/typescript/scripts/diagnostics-guard.test.ts`:

```ts
describe("audit-logger deprecation window", () => {
  test("all three exports are marked, and the message survives extraction", () => {
    const surface = readText("docs/api-surface.md");
    for (const name of ["createScopedAuditLogger", "AuditLogger", "AuditEmit"]) {
      const section = surface.split(`### \`${name}\``)[1] ?? "";
      expect(section).toContain("**Deprecated:**");
      // The extractor ends a @deprecated message at the next whitespace-preceded @word,
      // so an unwrapped @nimbus-dev/sdk truncates it to "use". Backticks are required.
      expect(section).toContain("`@nimbus-dev/sdk/diagnostics`");
      expect(section).toContain("2.0.0");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sdks/typescript && bun test scripts/diagnostics-guard.test.ts -t "deprecation window"`
Expected: FAIL — no `**Deprecated:**` marker.

- [ ] **Step 3: Mark the declarations**

In `sdks/typescript/src/audit-logger.ts`, mark each of the three at its declaration (not at the barrel re-export in `index.ts` — the policy is explicit):

```ts
/** @deprecated since 1.15.0 — use `createEmitter` from `@nimbus-dev/sdk/diagnostics` instead. May be removed in 2.0.0. */
export type AuditEmit = (action: string, payload: Record<string, unknown>) => Promise<void>;

/** @deprecated since 1.15.0 — use `DiagnosticEmitter` from `@nimbus-dev/sdk/diagnostics` instead. May be removed in 2.0.0. */
export interface AuditLogger { … }

/** @deprecated since 1.15.0 — use `createEmitter` from `@nimbus-dev/sdk/diagnostics` instead. May be removed in 2.0.0. */
export function createScopedAuditLogger(…) { … }
```

Leave the bodies untouched. This change is additive: nothing stops working.

- [ ] **Step 4: Note the successor in the module docs**

At the top of `docs/modules/audit-logger.md`, add a short note that the free-form payload is deprecated, that `@nimbus-dev/sdk/diagnostics` is the replacement, and that removal is no earlier than 2.0.0.

- [ ] **Step 5: Regenerate and verify**

Run: `cd sdks/typescript && bun run api:surface && bun test scripts/diagnostics-guard.test.ts`
Expected: PASS. Confirm the diff to `docs/api-surface.md` shows all three `**Deprecated:**` lines **in full** — a message truncated at `use` means a backtick is missing.

- [ ] **Step 6: Commit — this one MUST be `feat:`**

```bash
git add sdks/typescript/src/audit-logger.ts docs/api-surface.md docs/modules/audit-logger.md sdks/typescript/scripts/diagnostics-guard.test.ts
git commit -m "feat(audit-logger): deprecate the free-form payload in favour of the diagnostics envelope"
```

> `docs:` or `chore:` here would pass CI, update `api-surface.md`, and ship in **no release** — the deprecation window would silently never open and a later removal would cite a marking release that does not exist.

---

### Task 8: The Python binding

**Files:**
- Create: `sdks/python/src/nimbus_sdk/diagnostics/__init__.py`
- Create: `sdks/python/src/nimbus_sdk/diagnostics/event.py`
- Create: `sdks/python/src/nimbus_sdk/diagnostics/timestamp.py`
- Create: `sdks/python/tests/test_diagnostics.py`
- Create: `sdks/python/tests/test_diagnostics_corpus.py`

**Interfaces:**
- Consumes: the corpus from Task 4 via `load_corpus("diagnostics")`.
- Produces: `nimbus_sdk.diagnostics` exporting `DIAGNOSTIC_LEVELS`, `EncodeOk`, `EncodeRejected`, `EncodeResult`, `ParseOk`, `ParseRejected`, `ParseResult`, `encode_diagnostic`, `parse_diagnostic`, `meets_level`, `format_timestamp`. **Not re-exported from `nimbus_sdk`.**

- [ ] **Step 1: Reinstall so the spec data is current**

Run: `cd sdks/python && python -m pip install -e .`
Expected: succeeds. **Skipping this makes every later step read the pre-Task-4 snapshot and pass while executing none of the new corpus.**

- [ ] **Step 2: Write the failing corpus test**

Create `sdks/python/tests/test_diagnostics_corpus.py`:

```python
"""Drive the diagnostics envelope from the published conformance corpus.

Reads the spec data bundled at build time into ``src/nimbus_sdk/_data/spec``, which
``spec_root()`` prefers over the repository's ``docs/spec``. That copy is gitignored and
regenerated by the hatch build hook, so **adding a case to docs/spec is not enough
locally**: without ``python -m pip install -e .`` first, this suite runs the previous
snapshot and passes while executing none of the new cases.
"""

from __future__ import annotations

import pytest

from nimbus_sdk import load_corpus
from nimbus_sdk.diagnostics import (
    EncodeOk,
    EncodeRejected,
    ParseOk,
    ParseRejected,
    encode_diagnostic,
    meets_level,
    parse_diagnostic,
)

CASES = load_corpus("diagnostics")

IMPLEMENTED_KINDS = {"encode", "parse", "level"}
DEFERRED_KINDS: set[str] = set()


def test_every_corpus_kind_is_accounted_for() -> None:
    assert {case["kind"] for case in CASES} == IMPLEMENTED_KINDS | DEFERRED_KINDS


@pytest.mark.parametrize(
    "case",
    [c for c in CASES if c["kind"] == "encode"],
    ids=lambda c: str(c["description"])[:60],
)
def test_encode_cases(case: dict[str, object]) -> None:
    expect = case["expect"]
    assert isinstance(expect, dict)
    result = encode_diagnostic(case["event"])
    if expect["ok"]:
        assert result == EncodeOk(line=str(expect["line"]))
    else:
        assert result == EncodeRejected(
            reason=str(expect["reason"]), path=str(expect["path"])
        )


@pytest.mark.parametrize(
    "case",
    [c for c in CASES if c["kind"] == "parse"],
    ids=lambda c: str(c["description"])[:60],
)
def test_parse_cases(case: dict[str, object]) -> None:
    expect = case["expect"]
    assert isinstance(expect, dict)
    result = parse_diagnostic(str(case["line"]))
    if expect["ok"]:
        assert result == ParseOk(event=expect["event"])  # type: ignore[arg-type]
    else:
        assert result == ParseRejected(
            reason=str(expect["reason"]), path=str(expect["path"])
        )


@pytest.mark.parametrize(
    "case",
    [c for c in CASES if c["kind"] == "level"],
    ids=lambda c: str(c["description"])[:60],
)
def test_level_cases(case: dict[str, object]) -> None:
    expect = case["expect"]
    assert isinstance(expect, dict)
    assert meets_level(str(case["level"]), str(case["threshold"])) is expect["meets"]
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd sdks/python && python -m pytest tests/test_diagnostics_corpus.py -q`
Expected: FAIL — `ModuleNotFoundError: nimbus_sdk.diagnostics`.

- [ ] **Step 4: Write `timestamp.py`**

```python
"""Rendering a datetime in the one canonical form the contract accepts.

Pure: it takes the caller's datetime and reads no clock of its own.

This helper exists because the two standard libraries are not symmetric here.
``new Date().toISOString()`` is already exactly conformant; Python's
``datetime.isoformat()`` produces six fractional digits and a ``+00:00`` offset, and
``timespec="milliseconds"`` fixes only the first of those — so the obvious fix fails
too, and an author who finds one problem lands on a second that looks identical.
"""

from __future__ import annotations

from datetime import datetime, timezone


def format_timestamp(value: datetime) -> str:
    """Render a timezone-aware datetime as ``YYYY-MM-DDTHH:MM:SS.mmmZ``.

    Raises ``ValueError`` on a naive datetime rather than guessing a zone: guessing is
    how a connector's diagnostics end up an unpredictable number of hours off.
    """
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        raise ValueError("format_timestamp requires a timezone-aware datetime")
    utc = value.astimezone(timezone.utc)
    return f"{utc.strftime('%Y-%m-%dT%H:%M:%S')}.{utc.microsecond // 1000:03d}Z"
```

- [ ] **Step 5: Write `event.py`**

Mirror `sdks/typescript/src/diagnostics/event.ts` exactly, with these Python-specific requirements:

```python
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Final

DIAGNOSTIC_LEVELS: Final[tuple[str, ...]] = ("debug", "info", "warn", "error")
DIAGNOSTIC_KINDS: Final[tuple[str, ...]] = ("diagnostic", "audit")

TS_PATTERN: Final = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$")
NAME_PATTERN: Final = re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$")
FIELD_KEY_PATTERN: Final = re.compile(r"^[a-z][a-z0-9]*$")
CORRELATION_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_FIELDS: Final = 16
MAX_SAFE_INT: Final = 9007199254740991

MEMBER_ORDER: Final[tuple[str, ...]] = (
    "ts", "level", "extensionId", "event", "kind", "correlationId", "fields", "error",
)


@dataclass(frozen=True)
class EncodeOk:
    line: str


@dataclass(frozen=True)
class EncodeRejected:
    reason: str
    path: str


EncodeResult = EncodeOk | EncodeRejected
```

Five rules a Python implementation must get right. The corpus catches the first four; the
fifth it cannot, because `case.schema.json` constrains `level` and `threshold` to the
published enum — correctly, since an out-of-enum level is not a contract case:

1. **`bool` before `int`.** `isinstance(True, int)` is `True` in Python, so the boolean branch must be checked first or `True` is treated as the integer 1.
2. **Integral floats are accepted, then narrowed to `int`.** A JSON `1.0` arrives as a Python `float`; it is the same JSON value as `1` and must encode as `1`. Use:
   ```python
   if isinstance(value, float):
       if not value.is_integer():
           return EncodeRejected(reason="invalid-field-value", path=f"/fields/{key}")
       value = int(value)
   ```
   `float.is_integer()` returns `False` for `nan` and both infinities, so this also implements the non-finite rejection.
3. **`json.dumps` must be `json.dumps(wire, ensure_ascii=False, separators=(",", ":"))`.** The defaults escape non-ASCII as `\uXXXX` (JavaScript does not) and insert a space after `:` and `,` (JavaScript does not). Both produce a line that fails `extension-id-non-ascii-accepted` and every exact-line case.
4. **Byte length, not character length**, for the `IPC_MAX_LINE_BYTES` check: `len(line.encode("utf-8"))`.
5. **`meets_level` is total and MUST NOT use bare `.index()`.** `tuple.index()` raises
   `ValueError` on an unpublished level where TypeScript's `indexOf` returns `-1` and
   answers `False` — the same call, one crash and one silent answer. Guard explicitly so
   neither language relies on its own default:
   ```python
   def meets_level(level: str, threshold: str) -> bool:
       if level not in DIAGNOSTIC_LEVELS or threshold not in DIAGNOSTIC_LEVELS:
           return False
       return DIAGNOSTIC_LEVELS.index(level) >= DIAGNOSTIC_LEVELS.index(threshold)
   ```

Also implement `parse_diagnostic`, `meets_level`, `ParseOk`, `ParseRejected`, `ParseResult` mirroring Task 3, and import `IPC_MAX_LINE_BYTES` from `nimbus_sdk.ipc.ndjson`.

- [ ] **Step 6: Write `__init__.py`**

```python
"""The diagnostics envelope — the Python binding of ``docs/spec/diagnostics/v1/``.

Deliberately NOT re-exported from ``nimbus_sdk``. The split mirrors the ``.`` vs
``./diagnostics`` boundary the TypeScript exports map publishes: it states that the
diagnostics surface is a separate contract.
"""

from __future__ import annotations

from nimbus_sdk.diagnostics.event import (
    DIAGNOSTIC_KINDS,
    DIAGNOSTIC_LEVELS,
    EncodeOk,
    EncodeRejected,
    EncodeResult,
    ParseOk,
    ParseRejected,
    ParseResult,
    encode_diagnostic,
    meets_level,
    parse_diagnostic,
)
from nimbus_sdk.diagnostics.timestamp import format_timestamp

__all__ = [
    "DIAGNOSTIC_KINDS",
    "DIAGNOSTIC_LEVELS",
    "EncodeOk",
    "EncodeRejected",
    "EncodeResult",
    "ParseOk",
    "ParseRejected",
    "ParseResult",
    "encode_diagnostic",
    "format_timestamp",
    "meets_level",
    "parse_diagnostic",
]
```

- [ ] **Step 7: Write the unit tests**

Create `sdks/python/tests/test_diagnostics.py` covering what the corpus cannot:

```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from nimbus_sdk import __all__ as top_level
from nimbus_sdk.diagnostics import format_timestamp, meets_level


def test_format_timestamp_renders_the_canonical_form() -> None:
    value = datetime(2026, 8, 1, 12, 0, 0, 123456, tzinfo=timezone.utc)
    assert format_timestamp(value) == "2026-08-01T12:00:00.123Z"


def test_format_timestamp_converts_a_non_utc_offset() -> None:
    value = datetime(2026, 8, 1, 17, 30, 0, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    assert format_timestamp(value) == "2026-08-01T12:00:00.000Z"


def test_format_timestamp_refuses_a_naive_datetime() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        format_timestamp(datetime(2026, 8, 1, 12, 0, 0))


def test_format_timestamp_truncates_and_never_rounds() -> None:
    # 999999µs is 999.999ms. Rounding would carry into the next SECOND and report a
    # time that never happened; truncation cannot move the second, the day, or the year.
    # The contract has no opinion here, so this is a choice — pinned so it stays one.
    value = datetime(2026, 12, 31, 23, 59, 59, 999999, tzinfo=timezone.utc)
    assert format_timestamp(value) == "2026-12-31T23:59:59.999Z"


def test_format_timestamp_pads_sub_millisecond_values() -> None:
    # 1µs truncates to 0ms and must render as .000, not .0 — the pattern is fixed-width.
    value = datetime(2026, 8, 1, 12, 0, 0, 1, tzinfo=timezone.utc)
    assert format_timestamp(value) == "2026-08-01T12:00:00.000Z"


def test_meets_level_matches_the_typescript_binding_including_invalid_input() -> None:
    assert meets_level("warn", "info") is True
    assert meets_level("info", "info") is True
    assert meets_level("debug", "info") is False
    # tuple.index() would raise here; TypeScript's indexOf returns -1 and answers False.
    # The explicit guard is what makes both bindings answer False.
    assert meets_level("trace", "info") is False
    assert meets_level("error", "trace") is False


def test_diagnostics_names_are_not_hoisted_to_the_top_level() -> None:
    # The boundary is the point. Hoisting these as a convenience would erase the
    # statement that diagnostics is a separate contract.
    for name in ("encode_diagnostic", "parse_diagnostic", "format_timestamp"):
        assert name not in top_level
```

- [ ] **Step 8: Run everything**

Run: `cd sdks/python && python -m pytest -q && python -m mypy && python -m ruff check . && python -m ruff format --check .`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add sdks/python/src/nimbus_sdk/diagnostics sdks/python/tests/test_diagnostics.py sdks/python/tests/test_diagnostics_corpus.py
git commit -m "feat(python): bind the diagnostics envelope and run its conformance corpus"
```

---

### Task 9: Close the loop in the docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`
- Modify: `sdks/typescript/CHANGELOG.md`
- Modify: `sdks/python/CHANGELOG.md`

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Update `CLAUDE.md`**

Three edits:
1. In "Public surface (the `exports` map)", add a `./diagnostics` bullet and change the closing sentence of the `./connector-kit` bullet from "**four**-entry `exports` map" to "**five**-entry".
2. In "Python surface (two import roots, deliberately)", change the heading to **three** import roots and add `nimbus_sdk.diagnostics` with the same not-re-exported rationale.
3. In the same section, note the two surface asymmetries (no Python emitter; a Python-only `format_timestamp`) as distinct from the two *behavioral* divergences — sync-vs-async and isinstance-vs-tagged-union — which stay at two.

- [ ] **Step 2: Update `docs/ROADMAP.md`**

1. Tick Phase 2 box 4: `- [x] A **diagnostics / telemetry contract v0** emitted by both SDKs — *Pillar 8*`, with a sentence naming the spec, the corpus, and RFC-0010.
2. Rewrite the Phase 2 blockquote's closing sentence. It currently reads "What still remains is the diagnostics contract (box 4), plus a Python-authored connector running against the gateway". It must now say every box is ticked and that the single open exit clause is the Python-authored connector against the gateway, which this repository cannot demonstrate on its own.
3. **Do not mark Phase 2 complete.** Its exit criteria are not all met here.

- [ ] **Step 3: Update both CHANGELOGs**

Add the user-facing entries under the unreleased heading: the new entry point / import root, the envelope, and the audit-logger deprecation with its 2.0.0 horizon.

- [ ] **Step 4: Full verification from a clean clone**

A worktree under `.claude/worktrees/` silently borrows the parent checkout's `node_modules`, so local green does not mean CI green. Reproduce CI honestly:

```bash
git clone --branch feat/diagnostics-contract-v0 . /tmp/nimbus-verify
cd /tmp/nimbus-verify && bun install --frozen-lockfile
cd sdks/typescript && bun run build && bun test && bun run typecheck && bun run lint
cd ../.. && bun run scaffold:test
cd sdks/python && python -m pip install -e . && python -m pytest -q && python -m mypy && python -m ruff check .
```

Expected: all green. Anything that fails here and passed in the working tree is a dependency the package resolved by walking up out of its own directory.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/ROADMAP.md sdks/typescript/CHANGELOG.md sdks/python/CHANGELOG.md
git commit -m "docs: record the diagnostics contract in the roadmap and both changelogs"
```

---

## Self-Review

**Spec coverage.** Every section of the design spec maps to a task: envelope → 1, 2; bindings' API → 2, 3, 8; emitter and audit migration → 5, 7; conformance → 4; CI gates → 6; docs → 1, 9. The `./testing` helper the review added is Task 5; `format_timestamp` is Task 8.

**Three defects this plan found in the design spec.** Each was invisible until real code was written, and each would have produced two bindings that disagree:

1. **`fields-float-rejected` cannot use `1.0`.** JSON has one number type: `JSON.parse('{"a":1.0}')` yields `1`, indistinguishable from an integer, while Python's `json.loads` yields `1.0`. A corpus case pinning `1.0` as rejected would be accepted by JavaScript and rejected by Python. The rule is therefore **integral value, not integer host type** — `1.0` is accepted by both and encodes as `1`, and the rejection case uses `1.5`. Spec §4 needs this stated; Task 1 Step 5 and Task 8 Step 5 carry it.
2. **Python must pass `ensure_ascii=False, separators=(",", ":")`.** Both `json.dumps` defaults diverge from `JSON.stringify` — non-ASCII escaping and whitespace — and every exact-line case fails without them. Pinned by `extension-id-non-ascii-accepted`.
3. **Field key order had to become normative.** The design assumed an exact-line corpus without saying what fixes key order; caller insertion order differs per call site. Keys are now sorted ascending by code point, which is identical in both languages for the `[a-z0-9]` alphabet.

**Three fixes from the plan review**, all in the "same call, two behaviours" family the corpus exists to prevent:

1. **`sink-failed` is its own union at the wrapper layer**, not a contract reason. The earlier draft returned `line-too-long` for a closed pipe — wrong, and it would have told an author their event was malformed when the event was fine. Adding it to `DiagnosticEncodeReason` and `case.schema.json` instead (as the review proposed) would oblige every future binding to carry a token its architecture may have no analogue for — Python ships no emitter and can never produce it — and force a permanent carve-out in the "every reason token is produced" gate. A separate `EmitResult` union costs one type alias and keeps that gate total.
2. **`meetsLevel` / `meets_level` is explicitly total.** Left to language defaults, TypeScript's `indexOf` answers `false` by accident while Python's `.index()` raises `ValueError`. The corpus cannot catch this — `case.schema.json` constrains `level` and `threshold` to the enum, correctly — so it is pinned by unit tests on both sides.
3. **`fields-negative-zero-normalized`** pins that `-0.0` encodes as `0`. Verified: naive Python emits `-0.0` where JavaScript emits `0`. The integral-float narrowing already fixes it, which makes this a regression pin on that narrowing rather than a new rule.

**Placeholder scan.** No TBD/TODO. The corpus case table specifies every file — name, kind, exact input delta, exact expected outcome — with two written out in full to fix the format, and the indexing gate enforces that none is skipped.

**Type consistency.** `EncodeResult` / `ParseResult` / `EncodeOk` / `EncodeRejected` are used identically in Tasks 2, 3, 5, 6, 8. `EmitResult` appears only where the emitter does — Task 5's emitter and testing helper, and Task 6's barrel — and never in the encoder or the corpus. `createEmitter` is the name in the emitter, the barrel, the smoke call, and all three deprecation messages. `meetsLevel` (TS) / `meets_level` (Python) follow each language's convention, as the existing bindings already do.
