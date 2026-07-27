# Phase 1 Slice 1 — Schemas and Their Guard: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish versioned JSON Schemas for `ExtensionManifest` and `NimbusItem`, and prove in CI that they cannot drift from the TypeScript.

**Architecture:** A pure shape module (`scripts/schema-shape.ts`) parses an emitted `.d.ts` interface body into a property tree and derives the same tree from a JSON Schema, then diffs them — recursing one level into inline object types so `oauth` is covered. A second guard validates a fixture corpus against both `ajv` and the SDK's own `runContractTests`, asserting they agree wherever both apply. Schemas are hand-written because TypeScript 7 ships no classic compiler API, so no generator can run here.

**Tech Stack:** TypeScript 7 (strict), Bun test runner, Biome 2.5, `ajv` 8 as the only new devDependency.

## Global Constraints

Copied from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **Dependency-free at runtime.** No `dependencies` in `package.json`, ever. `ajv` goes in `devDependencies` and nowhere else.
- **No `any`.** Use `unknown` for external data and narrow with a type guard. Biome enforces `noExplicitAny` as an error. **JSON parsed from disk is external data** — this matters constantly in this slice.
- **`noConsole` is an error** in non-test files; it is `off` inside `**/*.test.ts`.
- **TypeScript strict**, plus `noUncheckedIndexedAccess` (array and record indexing yields `T | undefined` — narrow it), `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature` (use `obj["key"]`, not `obj.key`, on index-signature types).
- **Line width 100**, 2-space indent, double quotes, trailing commas, semicolons, LF. Run `bunx @biomejs/biome check --write` on files you create if formatting fights you.
- **Tests live alongside source**; scripts' tests live in `scripts/`. Import with an explicit `.ts` extension (`from "./api-surface.ts"`), matching `scripts/api-surface.test.ts`.
- **`docs/api-surface.md` and `scripts/api-surface.ts` must be byte-identical when you finish**, and **no file under `src/` may change.** Verify with `git diff --exit-code docs/api-surface.md scripts/api-surface.ts src/`.
- **Commit as `docs:`, `test:`, or `chore:` — never `feat:` or `fix:`.** This slice changes no published runtime code and must cut no release.
- **Branch:** `docs/phase1-slice1`, already created off `main`.

## Reference: exact facts this plan depends on

**`ExtensionManifest`** (`src/types.ts:28-51`). Required: `id`, `displayName`, `version`, `description`, `author`, `entrypoint`, `runtime`, `permissions`, `hitlRequired`, `minNimbusVersion`. Optional: `$schema`, `homepage`, `icon`, `oauth`, `syncInterval`, `tags`.

`oauth` is an **inline** object: `{ provider: string; scopes: string[]; authUrl: string; tokenUrl: string; pkce: boolean }` — all five required, no optionals.

**`NimbusItem`** (`src/types.ts:14-26`). Required: `id`, `service`, `itemType`, `name`. Optional: `mimeType`, `sizeBytes`, `createdAt`, `modifiedAt`, `url`, `parentId`, `rawMeta`.

**What `runContractTests` actually checks** (`src/contract-tests.ts`) — the schema must agree exactly, or `equivalence` fixtures fail:

- `isNonEmptyString` is `typeof v === "string" && v.trim() !== ""`. So `"   "` is **invalid**. Schema uses `"pattern": "\\S"`, never `"minLength": 1`.
- Non-empty is required for exactly six fields: `id`, `displayName`, `version`, `description`, `author`, `entrypoint`. **`version` has no semver check** — do not add a pattern to it.
- `runtime` must be `"bun"` or `"node"`.
- `permissions` must be an array; every entry in `{read, write, delete}`.
- `hitlRequired` must be an array; every entry in `{write, delete}`.
- `minNimbusVersion` is checked with `isNonEmptyString` **and then** `/^\d+\.\d+\.\d+/.test(v.trim())`. Two consequences:
  - It is **unanchored at the end** — `"1.2.3-beta"` passes. Do not add `$`.
  - It is tested against the **trimmed** value — `"  1.2.3"` passes. The schema pattern must therefore be `"^\\s*\\d+\\.\\d+\\.\\d+"`, with the leading `\s*`.
- Nothing inspects `oauth`, `syncInterval`, `tags`, `homepage`, or `icon`.

**`ajv` 8's default export is draft-07.** `import Ajv from "ajv"` is correct; `ajv/dist/2019` and `ajv/dist/2020` are the other drafts and are not used here.

**From `scripts/api-surface.ts`** (already exported — import, never modify):

```ts
export type EntryPoint = { label: string; file: string };
export type SurfaceExport = { name: string; typeOnly: boolean; source: string; declaration: string; deprecated: string | null };
export type EntrySurface = { label: string; exports: SurfaceExport[] };
export type ReadFile = (path: string) => string;
export function collectEntryPoints(packageJsonText: string): EntryPoint[];
export function buildSurface(entries: EntryPoint[], readFile: ReadFile): EntrySurface[];
export function normalizeEol(text: string): string;
```

`SurfaceExport.declaration` for `ExtensionManifest` is the full emitted text, e.g. `export interface ExtensionManifest {\n    $schema?: string;\n    ...\n}` with tsc's 4-space indent.

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/schema-shape.ts` | **Create.** Pure: parse a `.d.ts` interface body into a property tree, derive the same tree from a JSON Schema, diff them. No I/O. |
| `scripts/schema-shape.test.ts` | **Create.** Unit tests on synthetic input only. |
| `docs/spec/schemas/v1/extension-manifest.schema.json` | **Create.** |
| `docs/spec/schemas/v1/nimbus-item.schema.json` | **Create.** |
| `scripts/schema-guard.test.ts` | **Create.** Integration: real diff, real fixtures, ajv wiring. |
| `docs/spec/conformance/v1/index.schema.json` | **Create.** Schema for the fixture index. |
| `docs/spec/conformance/v1/index.json` | **Create.** The fixture index. |
| `docs/spec/conformance/v1/{manifest,item}/*.json` | **Create.** The fixtures. |
| `package.json` | **Modify.** Add `ajv` to `devDependencies`. |
| `docs/spec/README.md` | **Modify.** Rewrite: no longer a stub. |
| `docs/README.md:44` | **Modify.** One line. |
| `docs/ROADMAP.md` | **Modify.** Tick Phase 1 boxes 1 and 4. |

---

### Task 1: The pure shape module

**Files:**
- Create: `scripts/schema-shape.ts`
- Test: `scripts/schema-shape.test.ts`

**Interfaces:**
- Consumes: `normalizeEol` from `./api-surface.ts`.
- Produces: `PropertyShape`, `ShapeDiff`, `interfaceBodyOf`, `parseMembers`, `tsShapeOf`, `schemaShapeOf`, `diffShapes`, `isEmptyDiff` — all consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Create `scripts/schema-shape.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  diffShapes,
  interfaceBodyOf,
  isEmptyDiff,
  parseMembers,
  schemaShapeOf,
  tsShapeOf,
} from "./schema-shape.ts";

describe("interfaceBodyOf", () => {
  test("returns the text between the outermost braces", () => {
    expect(interfaceBodyOf("export interface A {\n    id: string;\n}")).toBe("\n    id: string;\n");
  });

  test("keeps nested braces intact", () => {
    const decl = "export interface A {\n    o?: {\n        p: string;\n    };\n}";
    expect(interfaceBodyOf(decl)).toContain("o?: {");
    expect(interfaceBodyOf(decl)).toContain("p: string;");
  });

  test("throws when there is no brace", () => {
    expect(() => interfaceBodyOf("export type A = string;")).toThrow(/no braced body/);
  });

  test("throws when the body is never closed", () => {
    expect(() => interfaceBodyOf("export interface A {\n    id: string;")).toThrow(/never closed/);
  });
});

describe("parseMembers", () => {
  test("reads names and optionality", () => {
    expect(parseMembers("id: string;\n name?: string;")).toEqual([
      { name: "id", optional: false, nested: null },
      { name: "name", optional: true, nested: null },
    ]);
  });

  test("reads a member whose name starts with $", () => {
    expect(parseMembers("$schema?: string;")).toEqual([
      { name: "$schema", optional: true, nested: null },
    ]);
  });

  test("does not split inside a nested object, and recurses into it", () => {
    const body = "a: string;\n o?: {\n   p: string;\n   q?: boolean;\n };\n b: number;";
    expect(parseMembers(body)).toEqual([
      { name: "a", optional: false, nested: null },
      {
        name: "o",
        optional: true,
        nested: [
          { name: "p", optional: false, nested: null },
          { name: "q", optional: true, nested: null },
        ],
      },
      { name: "b", optional: false, nested: null },
    ]);
  });

  test("does not recurse into a named type or a Record", () => {
    expect(parseMembers("meta?: Record<string, unknown>;")).toEqual([
      { name: "meta", optional: true, nested: null },
    ]);
  });

  test("does not split inside a union containing a brace-free generic", () => {
    expect(parseMembers("p: Array<'a' | 'b'>;\n q: string;")).toEqual([
      { name: "p", optional: false, nested: null },
      { name: "q", optional: false, nested: null },
    ]);
  });

  test("is CRLF-independent", () => {
    expect(parseMembers("id: string;\r\n name?: string;")).toEqual([
      { name: "id", optional: false, nested: null },
      { name: "name", optional: true, nested: null },
    ]);
  });

  test("ignores an index signature rather than misreading it as a property", () => {
    expect(parseMembers("[k: string]: unknown;\n id: string;")).toEqual([
      { name: "id", optional: false, nested: null },
    ]);
  });

  test("throws on a member it cannot parse, rather than dropping it", () => {
    expect(() => parseMembers("id string;")).toThrow(/could not parse interface member/);
  });
});

describe("tsShapeOf", () => {
  test("composes body extraction and member parsing", () => {
    expect(tsShapeOf("export interface A {\n    id: string;\n}")).toEqual([
      { name: "id", optional: false, nested: null },
    ]);
  });
});

describe("schemaShapeOf", () => {
  test("derives optionality from the required array", () => {
    const schema = {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" }, name: { type: "string" } },
    };
    expect(schemaShapeOf(schema)).toEqual([
      { name: "id", optional: false, nested: null },
      { name: "name", optional: true, nested: null },
    ]);
  });

  test("recurses into an object property that declares its own properties", () => {
    const schema = {
      type: "object",
      required: ["o"],
      properties: {
        o: { type: "object", required: ["p"], properties: { p: { type: "string" }, q: { type: "boolean" } } },
      },
    };
    expect(schemaShapeOf(schema)).toEqual([
      {
        name: "o",
        optional: false,
        nested: [
          { name: "p", optional: false, nested: null },
          { name: "q", optional: true, nested: null },
        ],
      },
    ]);
  });

  test("does not recurse into an open object with no properties", () => {
    const schema = { type: "object", properties: { meta: { type: "object" } } };
    expect(schemaShapeOf(schema)).toEqual([{ name: "meta", optional: true, nested: null }]);
  });

  test("throws when the schema has no properties object", () => {
    expect(() => schemaShapeOf({ type: "object" })).toThrow(/has no "properties" object/);
  });

  test("throws when required is not an array of strings", () => {
    expect(() => schemaShapeOf({ type: "object", required: "id", properties: {} })).toThrow(
      /"required" must be an array/,
    );
  });
});

describe("diffShapes", () => {
  const ts = [
    { name: "id", optional: false, nested: null },
    { name: "name", optional: true, nested: null },
  ];

  test("reports nothing when the shapes agree", () => {
    expect(isEmptyDiff(diffShapes(ts, ts))).toBe(true);
  });

  test("catches a property in TypeScript that the schema omits", () => {
    const schema = [{ name: "id", optional: false, nested: null }];
    expect(diffShapes(ts, schema).onlyInTs).toEqual(["name"]);
  });

  test("catches a property in the schema that TypeScript omits", () => {
    const schema = [...ts, { name: "extra", optional: true, nested: null }];
    expect(diffShapes(ts, schema).onlyInSchema).toEqual(["extra"]);
  });

  test("catches an optionality mismatch in each direction", () => {
    const schemaRequired = [
      { name: "id", optional: false, nested: null },
      { name: "name", optional: false, nested: null },
    ];
    expect(diffShapes(ts, schemaRequired).optionalityMismatch).toEqual([
      "name (TypeScript: optional, schema: required)",
    ]);

    const schemaOptional = [
      { name: "id", optional: true, nested: null },
      { name: "name", optional: true, nested: null },
    ];
    expect(diffShapes(ts, schemaOptional).optionalityMismatch).toEqual([
      "id (TypeScript: required, schema: optional)",
    ]);
  });

  test("catches all three failures one level down, with dotted paths", () => {
    const tsNested = [
      {
        name: "o",
        optional: true,
        nested: [
          { name: "p", optional: false, nested: null },
          { name: "q", optional: true, nested: null },
        ],
      },
    ];
    const schemaNested = [
      {
        name: "o",
        optional: true,
        nested: [
          { name: "p", optional: true, nested: null },
          { name: "r", optional: true, nested: null },
        ],
      },
    ];
    const diff = diffShapes(tsNested, schemaNested);
    expect(diff.onlyInTs).toEqual(["o.q"]);
    expect(diff.onlyInSchema).toEqual(["o.r"]);
    expect(diff.optionalityMismatch).toEqual(["o.p (TypeScript: required, schema: optional)"]);
  });

  test("reports a nesting mismatch when one side recurses and the other does not", () => {
    const tsNested = [{ name: "o", optional: false, nested: [{ name: "p", optional: false, nested: null }] }];
    const schemaFlat = [{ name: "o", optional: false, nested: null }];
    expect(diffShapes(tsNested, schemaFlat).nestingMismatch).toEqual([
      "o (TypeScript describes members, schema does not)",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/schema-shape.test.ts`
Expected: FAIL — `Cannot find module './schema-shape.ts'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/schema-shape.ts`:

```ts
/**
 * Shape comparison between an emitted TypeScript interface and a JSON Schema.
 *
 * Both sides are reduced to the same small structure — a list of property names, each
 * marked optional or required, each optionally carrying its own nested member list — and
 * then diffed. That is deliberately far less than either format can express: this module
 * answers "do these two declare the same fields, with the same optionality" and nothing
 * about what values are legal. Value-level agreement is the fixture corpus's job.
 *
 * Pure: no file reads, no compiler, no ajv. Its tests run on synthetic input so that
 * editing a real schema never forces a test edit.
 *
 * Known limitation, and the reason it is acceptable today: a property whose type is a
 * *named* type declared elsewhere is not followed — only inline object literals are
 * descended into. `ExtensionManifest` has no such property (`oauth` is inline, everything
 * else is a primitive, array, or union), so nothing is currently missed. Extracting
 * `oauth` into a named interface would add an exported type — a semver-relevant change —
 * and whoever does that must extend this module in the same commit.
 */

import { normalizeEol } from "./api-surface.ts";

/** One property, as declared by either side. `nested` is null unless the side describes members. */
export type PropertyShape = {
  name: string;
  optional: boolean;
  nested: PropertyShape[] | null;
};

export type ShapeDiff = {
  /** Dotted paths declared by TypeScript and absent from the schema. */
  onlyInTs: string[];
  /** Dotted paths declared by the schema and absent from TypeScript. */
  onlyInSchema: string[];
  /** Dotted paths whose optionality disagrees, with both readings named. */
  optionalityMismatch: string[];
  /** Dotted paths where one side describes members and the other does not. */
  nestingMismatch: string[];
};

export function isEmptyDiff(diff: ShapeDiff): boolean {
  return (
    diff.onlyInTs.length === 0 &&
    diff.onlyInSchema.length === 0 &&
    diff.optionalityMismatch.length === 0 &&
    diff.nestingMismatch.length === 0
  );
}

/**
 * The text between an interface declaration's outermost braces.
 *
 * Depth-tracked rather than matched to the last `}`, so a nested object literal cannot
 * truncate the body.
 */
export function interfaceBodyOf(declaration: string): string {
  const text = normalizeEol(declaration);
  const open = text.indexOf("{");
  if (open === -1) {
    throw new Error(`declaration has no braced body: ${text}`);
  }

  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }

  throw new Error(`declaration's braced body was never closed: ${text}`);
}

/** `name`, `name?`, quoted names, and names beginning with `$`. */
const MEMBER = /^(\$?[A-Za-z_][\w$]*|"[^"]+"|'[^']+')(\?)?\s*:\s*([\s\S]+)$/;

/** An index signature — `[k: string]: unknown` — is not a named property and is skipped. */
const INDEX_SIGNATURE = /^\[[^\]]*\]\s*:/;

/**
 * Split an interface body into members at top-level `;` and parse each one.
 *
 * Depth tracking covers `{}`, `[]`, `()` and `<>` so that a nested object, a tuple, or a
 * generic argument list never causes a split mid-member. A member the pattern does not
 * recognize throws rather than being dropped: this module exists to detect drift, and a
 * silently skipped member is drift it would report as agreement.
 */
export function parseMembers(body: string): PropertyShape[] {
  const text = normalizeEol(body);
  const members: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === "{" || ch === "[" || ch === "(" || ch === "<") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")" || ch === ">") depth -= 1;
    else if (ch === ";" && depth === 0) {
      members.push(text.slice(start, i));
      start = i + 1;
    }
  }
  members.push(text.slice(start));

  const shapes: PropertyShape[] = [];
  for (const raw of members) {
    const member = raw.trim();
    if (member.length === 0) continue;
    if (INDEX_SIGNATURE.test(member)) continue;

    const match = MEMBER.exec(member);
    if (match === null) {
      throw new Error(
        `could not parse interface member: ${member}\n` +
          "This module must never silently drop a member — a dropped member is drift " +
          "reported as agreement. Extend the pattern deliberately if this form is real.",
      );
    }

    const name = (match[1] ?? "").replace(/^["']|["']$/g, "");
    const optional = match[2] !== undefined;
    const type = (match[3] ?? "").trim();

    shapes.push({
      name,
      optional,
      nested: type.startsWith("{") ? parseMembers(interfaceBodyOf(type)) : null,
    });
  }

  return shapes;
}

/** The property tree of an emitted interface declaration. */
export function tsShapeOf(declaration: string): PropertyShape[] {
  return parseMembers(interfaceBodyOf(declaration));
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * The property tree of a JSON Schema object.
 *
 * Recurses only where the schema itself describes members — `type: "object"` *with* a
 * `properties` map. An open object such as `{"type":"object"}` (the shape
 * `Record<string, unknown>` maps to) yields `nested: null`, matching what the TypeScript
 * side produces for the same declaration.
 */
export function schemaShapeOf(schema: unknown): PropertyShape[] {
  const root = asRecord(schema, "schema");

  const rawRequired = root["required"] ?? [];
  if (!Array.isArray(rawRequired) || rawRequired.some((r) => typeof r !== "string")) {
    throw new Error('schema\'s "required" must be an array of strings');
  }
  const required = new Set(rawRequired as string[]);

  const properties = root["properties"];
  if (properties === undefined) {
    throw new Error('schema has no "properties" object');
  }
  const props = asRecord(properties, 'schema\'s "properties"');

  return Object.keys(props)
    .sort()
    .map((name) => {
      const child = asRecord(props[name], `property "${name}"`);
      const describesMembers = child["type"] === "object" && child["properties"] !== undefined;
      return {
        name,
        optional: !required.has(name),
        nested: describesMembers ? schemaShapeOf(child) : null,
      };
    });
}

function byName(shapes: readonly PropertyShape[]): Map<string, PropertyShape> {
  return new Map(shapes.map((shape) => [shape.name, shape]));
}

/**
 * Diff two property trees, reporting dotted paths.
 *
 * Every category is reported in both directions. A one-directional diff would let a
 * property added to the schema alone pass, which is the same silent divergence a property
 * added to TypeScript alone represents.
 */
export function diffShapes(
  ts: readonly PropertyShape[],
  schema: readonly PropertyShape[],
  path = "",
): ShapeDiff {
  const diff: ShapeDiff = {
    onlyInTs: [],
    onlyInSchema: [],
    optionalityMismatch: [],
    nestingMismatch: [],
  };

  const tsByName = byName(ts);
  const schemaByName = byName(schema);
  const at = (name: string): string => (path === "" ? name : `${path}.${name}`);

  for (const shape of ts) {
    if (!schemaByName.has(shape.name)) diff.onlyInTs.push(at(shape.name));
  }
  for (const shape of schema) {
    if (!tsByName.has(shape.name)) diff.onlyInSchema.push(at(shape.name));
  }

  for (const tsShape of ts) {
    const schemaShape = schemaByName.get(tsShape.name);
    if (schemaShape === undefined) continue;

    if (tsShape.optional !== schemaShape.optional) {
      diff.optionalityMismatch.push(
        `${at(tsShape.name)} (TypeScript: ${tsShape.optional ? "optional" : "required"}, ` +
          `schema: ${schemaShape.optional ? "optional" : "required"})`,
      );
    }

    const tsNested = tsShape.nested;
    const schemaNested = schemaShape.nested;
    if (tsNested !== null && schemaNested !== null) {
      const child = diffShapes(tsNested, schemaNested, at(tsShape.name));
      diff.onlyInTs.push(...child.onlyInTs);
      diff.onlyInSchema.push(...child.onlyInSchema);
      diff.optionalityMismatch.push(...child.optionalityMismatch);
      diff.nestingMismatch.push(...child.nestingMismatch);
    } else if (tsNested !== null) {
      diff.nestingMismatch.push(`${at(tsShape.name)} (TypeScript describes members, schema does not)`);
    } else if (schemaNested !== null) {
      diff.nestingMismatch.push(`${at(tsShape.name)} (schema describes members, TypeScript does not)`);
    }
  }

  return diff;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/schema-shape.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify lint, types, and that nothing else moved**

Run: `bun run lint && bun run typecheck && git diff --exit-code docs/api-surface.md scripts/api-surface.ts src/`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/schema-shape.ts scripts/schema-shape.test.ts
git commit -m "test(spec): shape comparison between emitted interfaces and JSON Schemas"
```

---

### Task 2: The two schemas, and the structural diff against reality

**Files:**
- Create: `docs/spec/schemas/v1/extension-manifest.schema.json`
- Create: `docs/spec/schemas/v1/nimbus-item.schema.json`
- Create: `scripts/schema-guard.test.ts`
- Modify: `package.json` (add `ajv` to `devDependencies`)

**Interfaces:**
- Consumes: `tsShapeOf`, `schemaShapeOf`, `diffShapes`, `isEmptyDiff` from Task 1; `collectEntryPoints`, `buildSurface` from `./api-surface.ts`.
- Produces: the two published schemas, consumed by Task 3's fixtures.

- [ ] **Step 1: Add ajv**

Run: `bun add --dev ajv`

Then confirm `package.json` gained `ajv` under `devDependencies` **and** that `dependencies` still does not exist as a key. If `bun add` created a `dependencies` key, move the entry and delete the empty key.

Run: `node -e "const p=require('./package.json'); if(p.dependencies) throw new Error('dependencies key must not exist'); if(!p.devDependencies.ajv) throw new Error('ajv missing'); console.log('ok', p.devDependencies.ajv)"`
Expected: `ok ^8.x.x`

- [ ] **Step 2: Write the manifest schema**

Create `docs/spec/schemas/v1/extension-manifest.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/schemas/v1/extension-manifest.schema.json",
  "title": "ExtensionManifest",
  "description": "The manifest a Nimbus connector or extension ships. Contract version v1.",
  "type": "object",
  "required": [
    "id",
    "displayName",
    "version",
    "description",
    "author",
    "entrypoint",
    "runtime",
    "permissions",
    "hitlRequired",
    "minNimbusVersion"
  ],
  "properties": {
    "$schema": {
      "type": "string",
      "description": "Optional pointer to this schema, for editor completion."
    },
    "id": { "type": "string", "pattern": "\\S", "description": "Stable connector identifier." },
    "displayName": { "type": "string", "pattern": "\\S" },
    "version": {
      "type": "string",
      "pattern": "\\S",
      "description": "Connector version. Deliberately unconstrained beyond non-empty: runContractTests applies no semver check here."
    },
    "description": { "type": "string", "pattern": "\\S" },
    "author": { "type": "string", "pattern": "\\S" },
    "homepage": { "type": "string" },
    "icon": { "type": "string" },
    "entrypoint": { "type": "string", "pattern": "\\S" },
    "runtime": { "enum": ["bun", "node"] },
    "permissions": {
      "type": "array",
      "items": { "enum": ["read", "write", "delete"] }
    },
    "hitlRequired": {
      "type": "array",
      "items": { "enum": ["write", "delete"] },
      "description": "Operations that require human approval before the gateway will run them."
    },
    "oauth": {
      "type": "object",
      "required": ["provider", "scopes", "authUrl", "tokenUrl", "pkce"],
      "properties": {
        "provider": { "type": "string" },
        "scopes": { "type": "array", "items": { "type": "string" } },
        "authUrl": { "type": "string" },
        "tokenUrl": { "type": "string" },
        "pkce": { "type": "boolean" }
      }
    },
    "syncInterval": { "type": "number" },
    "tags": { "type": "array", "items": { "type": "string" } },
    "minNimbusVersion": {
      "type": "string",
      "pattern": "^\\s*\\d+\\.\\d+\\.\\d+",
      "description": "Minimum gateway version. The pattern is unanchored at the end and tolerates leading whitespace, matching runContractTests, which tests /^\\d+\\.\\d+\\.\\d+/ against the trimmed value."
    }
  }
}
```

Two constraints in there are easy to "tidy" into a bug, and both are load-bearing:

- **`"pattern": "\\S"` rather than `"minLength": 1`.** `isNonEmptyString` trims before comparing, so `"   "` is invalid; `minLength: 1` would accept it.
- **`minNimbusVersion` has a leading `\\s*` and no trailing `$`.** The runtime regex is unanchored at the end and runs against the trimmed value, so both `"1.2.3-beta"` and `"  1.2.3"` pass. Anchoring or dropping `\\s*` would make the schema reject manifests the SDK accepts.

There is deliberately **no `additionalProperties: false`.**

- [ ] **Step 3: Write the item schema**

Create `docs/spec/schemas/v1/nimbus-item.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/schemas/v1/nimbus-item.schema.json",
  "title": "NimbusItem",
  "description": "One item the gateway has indexed. Contract version v1.",
  "type": "object",
  "required": ["id", "service", "itemType", "name"],
  "properties": {
    "id": { "type": "string", "pattern": "\\S" },
    "service": { "type": "string", "pattern": "\\S" },
    "itemType": {
      "type": "string",
      "pattern": "\\S",
      "description": "OPEN vocabulary. Deliberately not an enum: src/item-types.ts states that rejecting an item because its type is absent from KNOWN_ITEM_TYPES would break on the next connector. The examples below are hints, never a whitelist.",
      "examples": ["file", "message", "issue", "document", "event"]
    },
    "name": { "type": "string", "pattern": "\\S" },
    "mimeType": { "type": "string" },
    "sizeBytes": { "type": "number" },
    "createdAt": { "type": "number" },
    "modifiedAt": { "type": "number" },
    "url": { "type": "string" },
    "parentId": { "type": "string" },
    "rawMeta": {
      "type": "object",
      "description": "Open by design — Record<string, unknown>. No properties are declared, so the shape guard does not descend into it."
    }
  }
}
```

- [ ] **Step 4: Write the failing structural-diff guard**

Create `scripts/schema-guard.test.ts`:

```ts
/**
 * Schema guard — the published JSON Schemas cannot drift from the TypeScript.
 *
 * Two independent checks. The structural diff proves both sides declare the same fields
 * with the same optionality, including one level into inline object types. The fixture
 * corpus (added in a later task) proves they agree on which documents are legal.
 *
 * Reuses scripts/api-surface.ts as a library and never writes docs/api-surface.md: a diff
 * in that file means a contract change requiring a semver bump, and this slice must not
 * produce one.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { buildSurface, collectEntryPoints } from "./api-surface.ts";
import { diffShapes, isEmptyDiff, schemaShapeOf, tsShapeOf } from "./schema-shape.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readFromRoot = (path: string): string => readFileSync(join(repoRoot, path), "utf8");
const readJson = (path: string): unknown => JSON.parse(readFromRoot(path));

const SCHEMA_DIR = "docs/spec/schemas/v1";
const MANIFEST_SCHEMA = `${SCHEMA_DIR}/extension-manifest.schema.json`;
const ITEM_SCHEMA = `${SCHEMA_DIR}/nimbus-item.schema.json`;

/** The emitted declaration text of one exported type, from the built dist/. */
function declarationOf(name: string): string {
  const entries = collectEntryPoints(readFromRoot("package.json"));
  for (const surface of buildSurface(entries, readFromRoot)) {
    for (const exported of surface.exports) {
      if (exported.name === name) return exported.declaration;
    }
  }
  throw new Error(`no exported declaration named "${name}" in the published surface`);
}

/**
 * An Ajv instance with both schemas registered by $id, so nothing resolves over the
 * network. Ajv never fetches remote refs itself — synchronous compilation raises
 * MissingRefError — but registering locally is what makes an http-scheme $id behave as
 * the identifier it is, and it is what CI needs: the workflows run under harden-runner,
 * which restricts egress.
 */
function makeAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(readJson(MANIFEST_SCHEMA));
  ajv.addSchema(readJson(ITEM_SCHEMA));
  return ajv;
}

describe("schema guard — structural", () => {
  test("dist/ has been built", () => {
    expect(
      existsSync(join(repoRoot, "dist/index.d.ts")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("both schemas compile under ajv with no network access", () => {
    const ajv = makeAjv();
    expect(typeof ajv.getSchema(String((readJson(MANIFEST_SCHEMA) as { $id: string }).$id))).toBe(
      "function",
    );
    expect(typeof ajv.getSchema(String((readJson(ITEM_SCHEMA) as { $id: string }).$id))).toBe(
      "function",
    );
  });

  test("the extracted shapes are not empty — a broken parser must not pass vacuously", () => {
    expect(tsShapeOf(declarationOf("ExtensionManifest")).length).toBeGreaterThan(5);
    expect(schemaShapeOf(readJson(MANIFEST_SCHEMA)).length).toBeGreaterThan(5);
  });

  test("ExtensionManifest and its schema declare the same shape, including oauth", () => {
    const diff = diffShapes(
      tsShapeOf(declarationOf("ExtensionManifest")),
      schemaShapeOf(readJson(MANIFEST_SCHEMA)),
    );
    expect(
      isEmptyDiff(diff),
      `ExtensionManifest and ${MANIFEST_SCHEMA} disagree:\n` +
        `  only in TypeScript: ${diff.onlyInTs.join(", ") || "(none)"}\n` +
        `  only in schema:     ${diff.onlyInSchema.join(", ") || "(none)"}\n` +
        `  optionality:        ${diff.optionalityMismatch.join(", ") || "(none)"}\n` +
        `  nesting:            ${diff.nestingMismatch.join(", ") || "(none)"}`,
    ).toBe(true);
  });

  test("the oauth object is actually being compared, not skipped", () => {
    const oauth = tsShapeOf(declarationOf("ExtensionManifest")).find((p) => p.name === "oauth");
    expect(oauth?.nested?.map((p) => p.name).sort()).toEqual([
      "authUrl",
      "pkce",
      "provider",
      "scopes",
      "tokenUrl",
    ]);
  });

  test("NimbusItem and its schema declare the same shape", () => {
    const diff = diffShapes(
      tsShapeOf(declarationOf("NimbusItem")),
      schemaShapeOf(readJson(ITEM_SCHEMA)),
    );
    expect(
      isEmptyDiff(diff),
      `NimbusItem and ${ITEM_SCHEMA} disagree:\n` +
        `  only in TypeScript: ${diff.onlyInTs.join(", ") || "(none)"}\n` +
        `  only in schema:     ${diff.onlyInSchema.join(", ") || "(none)"}\n` +
        `  optionality:        ${diff.optionalityMismatch.join(", ") || "(none)"}\n` +
        `  nesting:            ${diff.nestingMismatch.join(", ") || "(none)"}`,
    ).toBe(true);
  });
});
```

- [ ] **Step 5: Run it**

Run: `bun run build && bun test scripts/schema-guard.test.ts`
Expected: PASS.

If the manifest diff fails on `$schema`, that is the guard working — `$schema` is a real optional property of the interface and must appear in the schema's `properties`. It already does in Step 2; if you removed it, put it back.

If `NimbusItem`'s diff fails on `itemType`, check the schema declares it as a plain string. It must not be an `enum`.

- [ ] **Step 6: Verify nothing else moved**

Run: `bun run lint && bun run typecheck && git diff --exit-code docs/api-surface.md scripts/api-surface.ts src/`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add docs/spec/schemas package.json bun.lock scripts/schema-guard.test.ts
git commit -m "docs(spec): publish v1 JSON Schemas for ExtensionManifest and NimbusItem"
```

---

### Task 3: The fixture corpus and dual validation

**Files:**
- Create: `docs/spec/conformance/v1/index.schema.json`
- Create: `docs/spec/conformance/v1/index.json`
- Create: `docs/spec/conformance/v1/manifest/*.json` (7 files, listed below)
- Create: `docs/spec/conformance/v1/item/*.json` (4 files, listed below)
- Modify: `scripts/schema-guard.test.ts` (append a second `describe`)

**Interfaces:**
- Consumes: the schemas from Task 2; `runContractTests` and `ExtensionManifest` from the package.
- Produces: the fixture corpus, which seeds Phase 1 box 3.

- [ ] **Step 1: Write the index schema**

Create `docs/spec/conformance/v1/index.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/conformance/v1/index.schema.json",
  "title": "Conformance fixture index",
  "description": "Machine-readable manifest of the conformance fixtures, so a runner in any language can consume the corpus without parsing prose.",
  "type": "object",
  "required": ["fixtures"],
  "properties": {
    "fixtures": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["file", "shape", "expect", "class", "reason"],
        "properties": {
          "file": { "type": "string", "pattern": "\\S" },
          "shape": { "enum": ["ExtensionManifest", "NimbusItem"] },
          "expect": { "enum": ["valid", "invalid"] },
          "class": {
            "enum": ["equivalence", "schema-only"],
            "description": "equivalence: the schema and runContractTests both cover these fields and must agree. schema-only: the field is one the runtime never inspects, so only the schema is asserted."
          },
          "reason": { "type": "string", "pattern": "\\S" }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write the manifest fixtures**

A valid baseline, `docs/spec/conformance/v1/manifest/valid-minimal.json`:

```json
{
  "id": "example-connector",
  "displayName": "Example Connector",
  "version": "0.1.0",
  "description": "A minimal manifest that satisfies every required field.",
  "author": "Nimbus Contributors",
  "entrypoint": "./index.ts",
  "runtime": "bun",
  "permissions": ["read"],
  "hitlRequired": [],
  "minNimbusVersion": "0.1.0"
}
```

`valid-prerelease-min-version.json` — same as above but `"minNimbusVersion": "1.2.3-beta"`, and `"description": "minNimbusVersion is unanchored at the end, so a prerelease suffix is accepted."`

`valid-leading-space-min-version.json` — same as the baseline but `"minNimbusVersion": "  1.2.3"`, and `"description": "runContractTests trims before matching, so leading whitespace is accepted."`

`invalid-missing-id.json` — the baseline with the `"id"` key removed entirely.

`invalid-whitespace-id.json` — the baseline with `"id": "   "`.

`invalid-runtime.json` — the baseline with `"runtime": "deno"`.

`invalid-permission.json` — the baseline with `"permissions": ["read", "admin"]`.

And one that only the schema catches, `schema-only-bad-sync-interval.json` — the baseline plus `"syncInterval": "60"` (a string where the type says number). `runContractTests` never inspects `syncInterval`, so this fixture is `schema-only`.

- [ ] **Step 3: Write the item fixtures**

`docs/spec/conformance/v1/item/valid-minimal.json`:

```json
{
  "id": "item-1",
  "service": "example",
  "itemType": "file",
  "name": "notes.md"
}
```

`valid-unknown-item-type.json` — the same but `"itemType": "quantum_widget"`, proving the vocabulary is open.

`invalid-missing-name.json` — the same as the baseline with `"name"` removed.

`invalid-size-bytes-type.json` — the baseline plus `"sizeBytes": "1024"`.

- [ ] **Step 4: Write the index**

Create `docs/spec/conformance/v1/index.json`:

```json
{
  "fixtures": [
    { "file": "manifest/valid-minimal.json", "shape": "ExtensionManifest", "expect": "valid", "class": "equivalence", "reason": "Every required field present and well-formed." },
    { "file": "manifest/valid-prerelease-min-version.json", "shape": "ExtensionManifest", "expect": "valid", "class": "equivalence", "reason": "minNimbusVersion is unanchored at the end, so a prerelease suffix is accepted." },
    { "file": "manifest/valid-leading-space-min-version.json", "shape": "ExtensionManifest", "expect": "valid", "class": "equivalence", "reason": "runContractTests trims minNimbusVersion before matching." },
    { "file": "manifest/invalid-missing-id.json", "shape": "ExtensionManifest", "expect": "invalid", "class": "equivalence", "reason": "id is required." },
    { "file": "manifest/invalid-whitespace-id.json", "shape": "ExtensionManifest", "expect": "invalid", "class": "equivalence", "reason": "id must contain a non-whitespace character; isNonEmptyString trims." },
    { "file": "manifest/invalid-runtime.json", "shape": "ExtensionManifest", "expect": "invalid", "class": "equivalence", "reason": "runtime must be bun or node." },
    { "file": "manifest/invalid-permission.json", "shape": "ExtensionManifest", "expect": "invalid", "class": "equivalence", "reason": "admin is not a permission." },
    { "file": "manifest/schema-only-bad-sync-interval.json", "shape": "ExtensionManifest", "expect": "invalid", "class": "schema-only", "reason": "syncInterval must be a number. runContractTests never inspects it, so only the schema rejects this." },
    { "file": "item/valid-minimal.json", "shape": "NimbusItem", "expect": "valid", "class": "schema-only", "reason": "Every required field present. No runtime validator exists for items." },
    { "file": "item/valid-unknown-item-type.json", "shape": "NimbusItem", "expect": "valid", "class": "schema-only", "reason": "itemType is an open vocabulary; an unknown type must validate." },
    { "file": "item/invalid-missing-name.json", "shape": "NimbusItem", "expect": "invalid", "class": "schema-only", "reason": "name is required." },
    { "file": "item/invalid-size-bytes-type.json", "shape": "NimbusItem", "expect": "invalid", "class": "schema-only", "reason": "sizeBytes must be a number. TypeScript would catch this at compile time; nothing catches it at runtime." }
  ]
}
```

- [ ] **Step 5: Append the fixture guard**

Add these imports to the **existing** import block at the top of `scripts/schema-guard.test.ts` — do not add a second import statement from any module already imported there:

```ts
import { readdirSync } from "node:fs";
import { type ExtensionManifest, runContractTests } from "../src/index.ts";
```

Then append to the end of the file:

```ts
const CONFORMANCE_DIR = "docs/spec/conformance/v1";
const INDEX_PATH = `${CONFORMANCE_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CONFORMANCE_DIR}/index.schema.json`;

type FixtureEntry = {
  file: string;
  shape: "ExtensionManifest" | "NimbusItem";
  expect: "valid" | "invalid";
  class: "equivalence" | "schema-only";
  reason: string;
};

/** The index, validated against its own schema before anything trusts its contents. */
function loadIndex(): FixtureEntry[] {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(readJson(INDEX_SCHEMA_PATH));
  const index = readJson(INDEX_PATH);
  if (!validate(index)) {
    throw new Error(`${INDEX_PATH} is not a valid fixture index: ${ajv.errorsText(validate.errors)}`);
  }
  return (index as { fixtures: FixtureEntry[] }).fixtures;
}

/** Did runContractTests accept this document? */
async function runtimeAccepts(fixture: unknown): Promise<boolean> {
  try {
    await runContractTests(fixture as ExtensionManifest);
    return true;
  } catch {
    return false;
  }
}

describe("schema guard — fixtures", () => {
  const entries = loadIndex();
  const ajv = makeAjv();

  test("the index validates against its own schema and is not empty", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  test("every fixture on disk is listed in the index", () => {
    const listed = new Set(entries.map((e) => e.file));
    const onDisk: string[] = [];
    for (const shape of ["manifest", "item"]) {
      for (const name of readdirSync(join(repoRoot, CONFORMANCE_DIR, shape))) {
        if (name.endsWith(".json")) onDisk.push(`${shape}/${name}`);
      }
    }
    const unlisted = onDisk.filter((f) => !listed.has(f)).sort();
    expect(
      unlisted,
      `these fixtures are not in ${INDEX_PATH}: ${unlisted.join(", ")} — an unlisted fixture ` +
        "is never run, so it silently proves nothing",
    ).toEqual([]);
  });

  test("the corpus exercises both classes — otherwise half the guard is dead", () => {
    expect(entries.some((e) => e.class === "equivalence")).toBe(true);
    expect(entries.some((e) => e.class === "schema-only")).toBe(true);
  });

  for (const entry of entries) {
    test(`${entry.file} — schema says ${entry.expect} (${entry.reason})`, () => {
      const schemaId =
        entry.shape === "ExtensionManifest"
          ? String((readJson(MANIFEST_SCHEMA) as { $id: string }).$id)
          : String((readJson(ITEM_SCHEMA) as { $id: string }).$id);
      const validate = ajv.getSchema(schemaId);
      if (validate === undefined) throw new Error(`schema ${schemaId} was not registered`);

      const doc = readJson(`${CONFORMANCE_DIR}/${entry.file}`);
      const ok = validate(doc) === true;
      expect(
        ok,
        `expected the schema to consider ${entry.file} ${entry.expect}. ${entry.reason}\n` +
          `ajv: ${ajv.errorsText(validate.errors)}`,
      ).toBe(entry.expect === "valid");
    });
  }

  for (const entry of entries.filter((e) => e.class === "equivalence")) {
    test(`${entry.file} — schema and runContractTests agree`, async () => {
      const doc = readJson(`${CONFORMANCE_DIR}/${entry.file}`);
      const schemaId = String((readJson(MANIFEST_SCHEMA) as { $id: string }).$id);
      const validate = ajv.getSchema(schemaId);
      if (validate === undefined) throw new Error(`schema ${schemaId} was not registered`);

      const schemaOk = validate(doc) === true;
      const runtimeOk = await runtimeAccepts(doc);
      expect(
        schemaOk,
        `${entry.file} is classed "equivalence", so the schema and runContractTests must ` +
          `reach the same verdict. Schema: ${schemaOk ? "valid" : "invalid"}; ` +
          `runContractTests: ${runtimeOk ? "valid" : "invalid"}. ${entry.reason}`,
      ).toBe(runtimeOk);
    });
  }
});
```

Every `equivalence` fixture is an `ExtensionManifest` — `NimbusItem` has no runtime validator, so an item fixture can only ever be `schema-only`. The index schema does not encode that rule; the next step proves the corpus honors it.

- [ ] **Step 6: Run it**

Run: `bun run build && bun test scripts/schema-guard.test.ts`
Expected: PASS, every fixture listed as its own test.

If `valid-leading-space-min-version.json` fails, the schema's `minNimbusVersion` pattern is missing its leading `\\s*`. If `invalid-whitespace-id.json` passes the schema, a `pattern` of `\\S` was replaced by `minLength`.

- [ ] **Step 7: Verify nothing else moved**

Run: `bun run lint && bun run typecheck && bun test && git diff --exit-code docs/api-surface.md scripts/api-surface.ts src/`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add docs/spec/conformance scripts/schema-guard.test.ts
git commit -m "test(spec): conformance fixtures, dual-validated against ajv and runContractTests"
```

---

### Task 4: Documentation and roadmap

**Files:**
- Modify: `docs/spec/README.md` (rewrite)
- Modify: `docs/README.md:44`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the finished slice.

- [ ] **Step 1: Rewrite the spec README**

Replace `docs/spec/README.md` entirely:

````markdown
# nimbus-sdk — Contract spec

The language-neutral contract every Nimbus binding implements. TypeScript in `src/` is the
reference implementation; this directory is what a binding in another language reads.

## What is here today

### `schemas/v1/`

JSON Schemas, **draft-07**, for the two shapes the contract is built on:

| Schema | Shape |
|--------|-------|
| [`extension-manifest.schema.json`](./schemas/v1/extension-manifest.schema.json) | `ExtensionManifest` — what a connector ships |
| [`nimbus-item.schema.json`](./schemas/v1/nimbus-item.schema.json) | `NimbusItem` — one indexed item |

Reference the manifest schema from your own manifest for editor completion:

```json
{
  "$schema": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/schemas/v1/extension-manifest.schema.json",
  "id": "my-connector"
}
```

Draft-07 rather than 2020-12 deliberately: these schemas use only draft-07 vocabulary, and
draft-07 has the widest support across editors and across validators in the languages the
roadmap targets next.

### `conformance/v1/`

The fixture corpus, with [`index.json`](./conformance/v1/index.json) as its machine-readable
manifest — every fixture carries a shape, an expected verdict, a class, and a reason, so a
runner in any language consumes the corpus without parsing prose. The index is itself
validated against [`index.schema.json`](./conformance/v1/index.schema.json).

Two classes, because the schemas and the TypeScript runtime do not check identical things:

- **`equivalence`** — the schema and `runContractTests` both cover these fields and must
  reach the same verdict. CI asserts both directions.
- **`schema-only`** — the field is one the TypeScript runtime never inspects (`oauth`,
  `syncInterval`, `tags`), so only the schema is asserted. These fixtures record where the
  published contract is stricter than the reference implementation's runtime check.

## What versioning means here

`v1` is the **contract** version, not the package version. The package releases on its own
clock; a schema path changes only when the contract does. Within `v1` only additive change
is permitted — removing or narrowing a field requires a major, which means a new path
segment rather than an edit to this one. See the
[deprecation policy](../DEPRECATION-POLICY.md).

Both schemas are **open**: neither sets `additionalProperties: false`. An older consumer
validating against an older copy is therefore unaffected by additions.

## What is not here yet

- **The wire protocol.** `src/ipc/` currently provides only NDJSON line framing — UTF-8,
  LF-delimited, trailing `\r` stripped, blank lines skipped, 1 MB per line. The message
  envelopes and request/response shapes belong to the gateway, not to this package, and are
  not specified here. Phase 1, box 2.
- **Contract-version negotiation.** Nothing yet carries a contract version;
  `minNimbusVersion` is a floor, not a negotiation. Phase 1, box 5.
- **Agent brief schemas.** The two shapes above prove the mechanism; the brief shapes
  follow.

## How this stays true

`scripts/schema-guard.test.ts` runs on every pull request. It compares each schema's
declared properties and optionality against the emitted TypeScript — descending one level
into inline objects, so `oauth` is covered — and runs every fixture through `ajv`, plus
through `runContractTests` for the `equivalence` class. A schema that drifts from the
reference implementation fails CI.

Changes here follow the [RFC process](../GOVERNANCE.md#the-rfc-process): a change to the
spec is a change to the contract every binding must honor.
````

- [ ] **Step 2: Update the docs index**

In `docs/README.md:44`, replace:

```markdown
- [Contract spec](./spec/) — the language-neutral spec's future home (Phase 1)
```

with:

```markdown
- [Contract spec](./spec/) — versioned JSON Schemas and the conformance fixtures every
  language binding validates against
```

- [ ] **Step 3: Tick the roadmap boxes**

In `docs/ROADMAP.md`, change these two Phase 1 entries from `- [ ]` to `- [x]`:

```markdown
- [x] Publish **JSON Schemas** for `ExtensionManifest` and `NimbusItem`, versioned
  alongside the package, into [`spec/`](./spec/) — *Pillars 1, 7*
```

```markdown
- [x] Validate the TypeScript SDK **against its own spec** in CI — *Pillars 2, 5*
```

Leave boxes 2, 3 and 5 unticked. Do not edit any other phase.

- [ ] **Step 4: Confirm exactly three Phase 1 boxes remain**

Run:

```bash
awk '/^### Phase 1/,/^### Phase 2/' docs/ROADMAP.md | grep -c '^- \[ \]'
```

Expected: `3`.

- [ ] **Step 5: Run the full suite exactly as CI does**

Run: `bun run typecheck && bun run lint && bun run build && bun run test`
Expected: all four exit 0.

- [ ] **Step 6: Confirm the contract snapshot and src/ never moved**

Run: `git diff --exit-code origin/main -- docs/api-surface.md scripts/api-surface.ts src/`
Expected: exit 0, no output.

- [ ] **Step 7: Confirm the published tarball did not grow**

Run: `bun pm pack --dry-run 2>&1 | grep -E "docs/spec|conformance"`
Expected: no matches. `files: ["dist", "src"]` excludes them.

- [ ] **Step 8: Confirm no release-cutting commit is on the branch**

Run: `git log --format='%s' origin/main..HEAD | grep -E '^(feat|fix)(\(|:)' || echo NONE`
Expected: `NONE`.

- [ ] **Step 9: Commit**

```bash
git add docs/spec/README.md docs/README.md docs/ROADMAP.md
git commit -m "docs: document the published spec and tick Phase 1 boxes 1 and 4"
```

---

## Self-Review

**Spec coverage.** Component 1 (the schemas) → Task 2. Component 2 (the spec doc surface) → Task 4. Component 3 (structural diff) → Tasks 1 and 2. Component 4 (fixtures) → Task 3. The spec's named test cases all appear: the three diff failures in both directions and one level down (Task 1), class handling asserted (Task 3, "exercises both classes"), offline resolution (Task 2, "compile under ajv with no network access"), index validated against its own schema (Task 3), and the anti-vacuity floors (Tasks 2 and 3). The spec's two "easy to get wrong" constraints — `pattern: "\\S"` and the unanchored `minNimbusVersion` — each have a dedicated fixture, and the leading-`\s*` subtlety discovered while writing this plan has one too.

**Placeholders.** None. Every code step carries real content; every fixture is spelled out.

**Type consistency.** `PropertyShape` is defined once in Task 1 and consumed unchanged in Task 2. `ShapeDiff` gained a fourth field, `nestingMismatch`, which every failure message in Task 2 prints. `diffShapes(ts, schema, path?)` keeps that argument order in its tests and both call sites. `FixtureEntry.class` values match the `enum` in `index.schema.json` exactly. `makeAjv()`, `readJson()`, `MANIFEST_SCHEMA` and `ITEM_SCHEMA` are defined in Task 2 and reused by Task 3's appended block rather than redefined.

**One thing the plan corrects in the spec.** The spec says non-empty strings use `"pattern": "\\S"` and that `minNimbusVersion` is unanchored at the end. Both hold — but reading `validateMinNimbusVersion` while writing Task 2 showed it tests the regex against the **trimmed** value, so `"  1.2.3"` is accepted too. The schema pattern is therefore `^\\s*\\d+\\.\\d+\\.\\d+`, and `valid-leading-space-min-version.json` pins it. Without the leading `\s*` that fixture fails, which is how the plan proves the point rather than asserting it.
