# Phase 0 Slice 2 — The Written Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the batteries inclusion policy and the export deprecation policy that three shipped documents already cite as governing rules, and make the deprecation marker visible in the API-surface guard so the policy is enforceable rather than aspirational.

**Architecture:** One contained addition to the existing text-based `.d.ts` extractor — a pure `collectDeprecations` function that reads `@deprecated` JSDoc tags before comments are stripped — plus two new prose documents and four link fixes. The extractor change must leave the committed `docs/api-surface.md` byte-identical, since nothing in the surface is deprecated today.

**Tech Stack:** TypeScript 7 (strict), Bun 1.3 test runner, Biome 2.5. No new dependencies.

**Design spec:** [`../specs/2026-07-26-phase0-policies-design.md`](../specs/2026-07-26-phase0-policies-design.md)

## Global Constraints

- **No runtime dependencies and no new devDependencies.** The extractor must not import `typescript` — TypeScript 7 does not ship the classic compiler API.
- **No `any`,** explicit or implicit. `unknown` for external data, narrowed with a type guard.
- **`scripts/` is typechecked** by `tsconfig.json` under `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`. Index into strings with `.charAt(i)`, not `s[i]`.
- **`bun run lint` is `biome check src/ scripts/`** and must pass. `noConsole` is an error — use `process.stdout.write`.
- **Never `String.prototype.localeCompare`.** The shared `ordinalCompare` helper is the only sanctioned comparator; locale collation is ICU-dependent and would make the golden file differ between platforms.
- **Local imports use the `./name.js` form** even for `.ts` files.
- **LF line endings.** `docs/api-surface.md` must contain no `\r` and end with exactly one newline.
- **Conventional Commits.** Commit 1 touches only `scripts/`, which never ships in `dist/` — use `test:`, never `fix:` or `feat:`, so it does not influence the published version.
- **The committed `docs/api-surface.md` must be byte-identical** after Task 1. This is a required verification, not a nicety.

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `scripts/api-surface.ts` | modify | Add `collectDeprecations`; add `deprecated` to `SurfaceExport`; thread it through `buildSurface` and `renderSurface` |
| `scripts/api-surface.test.ts` | modify | Unit tests for the new function and renderer; update existing whole-object assertions |
| `docs/INCLUSION-POLICY.md` | create | The four battery admission criteria |
| `docs/DEPRECATION-POLICY.md` | create | The window, the marking, the worked precedents |
| `docs/GOVERNANCE.md` | modify | Link line 37's "inclusion policy" |
| `docs/ARCHITECTURE.md` | modify | Link line 80's "inclusion policy" |
| `docs/GLOSSARY.md` | modify | Link lines 61 and 84; drop "deliverable" |
| `CONTRIBUTING.md` | modify | Link both policies |
| `README.md` | modify | Add both to the documentation list |
| `docs/ROADMAP.md` | modify | Tick Phase 0 boxes 7 and 8 |

---

### Task 1: The guard records `@deprecated` markers

**Files:**
- Modify: `scripts/api-surface.ts`
- Modify: `scripts/api-surface.test.ts`

**Interfaces:**
- Consumes: existing `normalizeEol`, `declaredNameOf`, `ordinalCompare`, `tidy`, `declarationsOf`, `parseBarrel`, `resolveSpecifier`, `DECLARATION_NOT_FOUND`
- Produces:
  - `collectDeprecations(rawText: string): Map<string, string>`
  - `SurfaceExport` gains `deprecated: string | null`

- [ ] **Step 1: Write the failing tests for `collectDeprecations`**

Append to `scripts/api-surface.test.ts`, and add `collectDeprecations` to the existing import from `./api-surface.js`:

```ts
describe("collectDeprecations", () => {
  test("records a tag with explanatory text", () => {
    const src = [
      "/** @deprecated since 1.8.0 — use `newThing` instead. May be removed in 2.0.0. */",
      "export declare const oldThing: string;",
    ].join("\n");
    expect(collectDeprecations(src).get("oldThing")).toBe(
      "since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.",
    );
  });

  test("records a tag with no text as an empty string", () => {
    const src = "/** @deprecated */\nexport declare const bare: number;";
    expect(collectDeprecations(src).get("bare")).toBe("");
  });

  test("stops at the next JSDoc tag rather than swallowing it", () => {
    const src = [
      "/**",
      " * @deprecated since 1.8.0 — use `newThing` instead.",
      " * @param options Configuration options.",
      " * @see https://example.com",
      " */",
      "export declare const oldThing: string;",
    ].join("\n");
    const message = collectDeprecations(src).get("oldThing");
    expect(message).toBe("since 1.8.0 — use `newThing` instead.");
    expect(message).not.toContain("@param");
    expect(message).not.toContain("@see");
  });

  test("strips leading asterisks and collapses a multi-line message to one line", () => {
    const src = [
      "/**",
      " * @deprecated since 1.8.0 because the underlying format changed;",
      " * use `newThing`, which takes the same options.",
      " */",
      "export declare const oldThing: string;",
    ].join("\n");
    expect(collectDeprecations(src).get("oldThing")).toBe(
      "since 1.8.0 because the underlying format changed; use `newThing`, which takes the same options.",
    );
  });

  test("ignores a JSDoc block with no @deprecated tag", () => {
    const src = "/** Just a description. */\nexport declare const fine: string;";
    expect(collectDeprecations(src).has("fine")).toBe(false);
  });

  test("ignores a non-JSDoc block comment mentioning @deprecated", () => {
    const src = "/* @deprecated not a doc comment */\nexport declare const fine: string;";
    expect(collectDeprecations(src).has("fine")).toBe(false);
  });

  test("pairs across an intervening comment", () => {
    const src = [
      "/** @deprecated since 1.8.0 */",
      "// a note tsc would not emit, tolerated anyway",
      "export declare const oldThing: string;",
    ].join("\n");
    expect(collectDeprecations(src).get("oldThing")).toBe("since 1.8.0");
  });

  test("is unaffected by CRLF line endings", () => {
    const lf = "/**\n * @deprecated since 1.8.0\n */\nexport declare const a: string;";
    expect(collectDeprecations(lf.replace(/\n/g, "\r\n"))).toEqual(collectDeprecations(lf));
  });

  test("records several deprecated declarations in one module", () => {
    const src = [
      "/** @deprecated first */",
      "export declare const a: string;",
      "export declare const b: string;",
      "/** @deprecated second */",
      "export declare const c: string;",
    ].join("\n");
    const found = collectDeprecations(src);
    expect(found.get("a")).toBe("first");
    expect(found.has("b")).toBe(false);
    expect(found.get("c")).toBe("second");
  });

  // Pins JSDoc semantics: a line-initial `@word` starts a new tag, so it ends the
  // message even when it is not a tag JSDoc knows. This is correct, not a bug —
  // absorbing such a line would surprise anyone who knows how JSDoc parses.
  test("ends the message at any line-initial @tag, known to JSDoc or not", () => {
    const src = [
      "/**",
      " * @deprecated since 1.8.0.",
      " * @override is now the default behavior.",
      " */",
      "export declare const oldThing: string;",
    ].join("\n");
    expect(collectDeprecations(src).get("oldThing")).toBe("since 1.8.0.");
  });

  // Dropping this is correct: a non-exported declaration is not part of the public
  // surface, so its deprecation state is not the guard's business. `dist/` contains
  // such a declaration today (`type SignedManifestShape`), so warning here would be
  // a false positive on real output.
  test("ignores a @deprecated tag on a non-exported declaration", () => {
    const src = "/** @deprecated internal only */\ndeclare const hidden: string;";
    expect(collectDeprecations(src).size).toBe(0);
  });

  // No emitted .d.ts in this package has duplicate top-level declared names today
  // (verified across all 28). If overloads ever appear, deprecation resolves
  // last-wins — the same limitation `declarationsOf` already has for the declaration
  // text itself. Pinned so a future change to it is a deliberate one.
  test("resolves a repeated declared name last-wins", () => {
    const src = [
      "/** @deprecated first overload */",
      "export declare function f(x: string): void;",
      "/** @deprecated second overload */",
      "export declare function f(x: number): void;",
    ].join("\n");
    expect(collectDeprecations(src).get("f")).toBe("second overload");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test scripts/api-surface.test.ts`
Expected: FAIL — `collectDeprecations` is not exported.

- [ ] **Step 3: Implement `collectDeprecations`**

Add to `scripts/api-surface.ts`, immediately after the `declaredNameOf` function:

```ts
/** A JSDoc block, its `@deprecated` message, and everything after it. */
const JSDOC_BLOCK = /\/\*\*([\s\S]*?)\*\//g;

/** Anything that can precede the declaration a JSDoc block annotates. */
const SKIPPABLE_BEFORE_DECLARATION = /^(?:\s|\/\/[^\n]*\n|\/\*(?!\*)[\s\S]*?\*\/)*/;

/**
 * Map each declared name to its `@deprecated` message, for declarations that carry one.
 *
 * Runs on the RAW module text, before `stripComments` — the deprecation marker lives in
 * a comment, so by the time the rest of the extractor sees a module the marker is gone.
 * Without this, deprecating an export would produce no diff in the golden file, and the
 * one contract change the deprecation policy governs would be the one the contract guard
 * cannot see.
 *
 * The message stops at the next JSDoc tag: tsc emits multi-tag blocks verbatim, so a
 * `@deprecated` followed by `@param` would otherwise swallow it.
 */
export function collectDeprecations(rawText: string): Map<string, string> {
  const text = normalizeEol(rawText);
  const found = new Map<string, string>();

  JSDOC_BLOCK.lastIndex = 0;
  let block = JSDOC_BLOCK.exec(text);
  while (block !== null) {
    const body = block[1] ?? "";
    const message = deprecationMessage(body);
    if (message !== null) {
      const after = text.slice(block.index + block[0].length);
      const declaration = after.replace(SKIPPABLE_BEFORE_DECLARATION, "");
      const name = declaredNameOf(declaration);
      if (name !== null) found.set(name, message);
    }
    block = JSDOC_BLOCK.exec(text);
  }

  return found;
}

/**
 * The text of a JSDoc body's `@deprecated` tag, or null if it has none.
 *
 * The message ends at the next line-initial `@word`, whether or not JSDoc knows that
 * tag. That matches how JSDoc itself parses — a line starting `@override` opens a new
 * tag — so a message cannot continue onto a line beginning with `@`. Matching against a
 * whitelist of known tags instead would absorb such a line and surprise anyone who
 * knows JSDoc.
 *
 * A `@deprecated` tag whose following declaration is not exported is dropped, because
 * `declaredNameOf` returns null for it. That is correct: a non-exported declaration is
 * not part of the public surface, so its deprecation state is not this guard's
 * business. `dist/` contains one today — `type SignedManifestShape` — so treating this
 * as an error would fail on real output.
 */
function deprecationMessage(body: string): string | null {
  const lines = body.split("\n").map((line) => line.replace(/^\s*\*?\s?/, ""));
  const start = lines.findIndex((line) => /^@deprecated\b/.test(line));
  if (start === -1) return null;

  const collected: string[] = [(lines[start] ?? "").replace(/^@deprecated\b/, "")];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^@\w+/.test(line.trim())) break;
    collected.push(line);
  }

  return collected.join(" ").replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test scripts/api-surface.test.ts`
Expected: PASS, 73 tests (61 existing + 12 new).

- [ ] **Step 5: Add `deprecated` to `SurfaceExport` and thread it through**

In `scripts/api-surface.ts`, change the `SurfaceExport` type:

```ts
export type SurfaceExport = {
  name: string;
  typeOnly: boolean;
  /** The module specifier it came from, or `(local)` if the barrel declares it. */
  source: string;
  declaration: string;
  /** The `@deprecated` message, or null when the export is not deprecated. */
  deprecated: string | null;
};
```

A nullable field rather than an optional one is deliberate: this repo compiles under `exactOptionalPropertyTypes`, where an optional property is friction for no benefit.

Then replace the body of `buildSurface` with:

```ts
export function buildSurface(entries: EntryPoint[], readFile: ReadFile): EntrySurface[] {
  return entries.map((entry) => {
    const barrelText = readFile(entry.file);
    const barrel = parseBarrel(barrelText);
    const barrelDeprecations = collectDeprecations(barrelText);
    const exports: SurfaceExport[] = [];

    for (const statement of barrel.locals) {
      const name = declaredNameOf(statement);
      if (name === null) continue;
      exports.push({
        name,
        typeOnly: false,
        source: "(local)",
        declaration: tidy(statement),
        deprecated: barrelDeprecations.get(name) ?? null,
      });
    }

    const cache = new Map<string, ModuleIndex>();
    for (const ref of barrel.reexports) {
      const target = resolveSpecifier(entry.file, ref.module);
      let index = cache.get(target);
      if (index === undefined) {
        const text = readFile(target);
        index = {
          declarations: declarationsOf(text, target),
          deprecations: collectDeprecations(text),
        };
        cache.set(target, index);
      }
      exports.push({
        name: ref.name,
        typeOnly: ref.typeOnly,
        source: ref.module,
        declaration: index.declarations.get(ref.sourceName) ?? DECLARATION_NOT_FOUND,
        deprecated: index.deprecations.get(ref.sourceName) ?? null,
      });
    }

    exports.sort((a, b) => ordinalCompare(a.name, b.name));
    return { label: entry.label, exports };
  });
}
```

Note the lookups use `ref.sourceName`, not `ref.name` — for `export { a as b }` the declaration and its deprecation both live under `a` in the target module.

Add the `ModuleIndex` type immediately above `buildSurface`:

```ts
/** One target module's declarations and deprecations, read once and reused. */
type ModuleIndex = {
  declarations: Map<string, string>;
  deprecations: Map<string, string>;
};
```

- [ ] **Step 6: Fix the existing assertions the new field breaks**

Three places construct or assert whole `SurfaceExport` objects and will now fail. **Add `deprecated: null` to each — do not loosen `toEqual` to `toMatchObject`.** Exact equality on the whole object is what makes these tests catch an unintended field change; weakening them would defeat the purpose.

In `scripts/api-surface.test.ts`:

1. The local-export assertion (`name: "MockGateway"`) — add `deprecated: null` after its `declaration` line.
2. The unresolved-declaration assertion (`name: "Public"`) — add `deprecated: null` after its `declaration` line.
3. The `renderSurface` fixture at the top of `describe("renderSurface", …)` — add `deprecated: null` to both the `Item` and `VERSION` objects. These are inputs, and TypeScript will reject them without the field.

- [ ] **Step 7: Run the tests to verify everything passes**

Run: `bun run typecheck && bun test scripts/api-surface.test.ts`
Expected: typecheck clean, PASS 73 tests.

- [ ] **Step 8: Test the re-export path, which is the real-world case**

Almost every deprecation will be on a declaration in a source module, re-exported through a barrel — the tag is never on the barrel clause. That resolution goes through `ref.sourceName`, and using `ref.name` instead would work for plain re-exports and break silently for aliased ones. Append to `scripts/api-surface.test.ts`:

```ts
describe("buildSurface — deprecations", () => {
  test("carries a deprecation from the source module through a re-export", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": 'export { oldThing, fine } from "./t.js";',
      "dist/t.d.ts": [
        "/** @deprecated since 1.8.0 — use `fine`. */",
        "export declare const oldThing: string;",
        "export declare const fine: string;",
      ].join("\n"),
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    const old = entry?.exports.find((e) => e.name === "oldThing");
    const fine = entry?.exports.find((e) => e.name === "fine");
    expect(old?.deprecated).toBe("since 1.8.0 — use `fine`.");
    expect(fine?.deprecated).toBeNull();
  });

  test("resolves an aliased re-export's deprecation by its source name", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": 'export { internalName as publicName } from "./t.js";',
      "dist/t.d.ts": [
        "/** @deprecated since 1.8.0 */",
        "export declare const internalName: string;",
      ].join("\n"),
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    expect(entry?.exports[0]?.name).toBe("publicName");
    expect(entry?.exports[0]?.deprecated).toBe("since 1.8.0");
  });

  test("carries a deprecation on a barrel-local declaration", () => {
    const files: Record<string, string> = {
      "dist/testing/index.d.ts": [
        "/** @deprecated since 1.8.0 — use the real gateway. */",
        "export declare class MockGateway {",
        "    m(): void;",
        "}",
      ].join("\n"),
    };
    const [entry] = buildSurface(
      [{ label: "./testing", file: "dist/testing/index.d.ts" }],
      (p) => files[p] ?? "",
    );
    expect(entry?.exports[0]?.name).toBe("MockGateway");
    expect(entry?.exports[0]?.deprecated).toBe("since 1.8.0 — use the real gateway.");
  });
});
```

Run: `bun test scripts/api-surface.test.ts`
Expected: PASS, 76 tests. If the aliased case fails, the lookup is using `ref.name` where it must use `ref.sourceName`.

- [ ] **Step 9: Write the failing renderer tests**

Append to `scripts/api-surface.test.ts`:

```ts
describe("renderSurface — deprecations", () => {
  const withDeprecated = [
    {
      label: ".",
      exports: [
        {
          name: "oldThing",
          typeOnly: false,
          source: "./old-thing.js",
          declaration: "export declare const oldThing: string;",
          deprecated: "since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.",
        },
        {
          name: "stillFine",
          typeOnly: false,
          source: "./fine.js",
          declaration: "export declare const stillFine: number;",
          deprecated: null,
        },
      ],
    },
  ];

  test("renders the marker for a deprecated export", () => {
    expect(renderSurface(withDeprecated)).toContain(
      "**Deprecated:** since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.",
    );
  });

  test("places the marker between the heading and the source line", () => {
    expect(renderSurface(withDeprecated)).toContain(
      "### `oldThing`\n\n**Deprecated:** since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.\n\nFrom `./old-thing.js`.",
    );
  });

  test("still renders the fenced declaration for a deprecated export", () => {
    expect(renderSurface(withDeprecated)).toContain(
      "```ts\nexport declare const oldThing: string;\n```",
    );
  });

  test("renders nothing extra for a non-deprecated export", () => {
    expect(renderSurface(withDeprecated)).toContain(
      "### `stillFine`\n\nFrom `./fine.js`.",
    );
  });

  test("a deprecated tag with no message renders the label alone", () => {
    const bare = [
      {
        label: ".",
        exports: [
          {
            name: "bare",
            typeOnly: false,
            source: "./bare.js",
            declaration: "export declare const bare: number;",
            deprecated: "",
          },
        ],
      },
    ];
    expect(renderSurface(bare)).toContain("**Deprecated**\n");
  });
});
```

- [ ] **Step 10: Run to verify they fail**

Run: `bun test scripts/api-surface.test.ts`
Expected: FAIL — the renderer does not emit any `**Deprecated` line yet.

- [ ] **Step 11: Implement the renderer change**

In `renderSurface`, replace the `for (const entry of surface.exports)` loop body with:

```ts
    for (const entry of surface.exports) {
      lines.push(`### \`${entry.name}\`${entry.typeOnly ? " *(type-only)*" : ""}`, "");

      if (entry.deprecated !== null) {
        lines.push(
          entry.deprecated === "" ? "**Deprecated**" : `**Deprecated:** ${entry.deprecated}`,
          "",
        );
      }

      lines.push(`From \`${entry.source}\`.`, "", "```ts", entry.declaration, "```", "");
    }
```

- [ ] **Step 12: Run to verify they pass**

Run: `bun test scripts/api-surface.test.ts`
Expected: PASS, 81 tests.

- [ ] **Step 13: Verify the committed baseline is byte-unchanged**

This is the load-bearing check for the whole task. Nothing in the surface is deprecated today, so a correct implementation must leave `docs/api-surface.md` exactly as it is.

```bash
bun run build && bun run api:surface
git diff --stat docs/api-surface.md
```

Expected: `wrote docs/api-surface.md — 140 exports across 3 entry points`, and **empty output from `git diff`**. If the baseline changed, the renderer is emitting something for non-deprecated exports — fix that before continuing; do not re-baseline.

- [ ] **Step 14: Prove the marker actually reaches the real pipeline**

A test using fixtures does not prove the wiring. Confirm end to end that a deprecation on a real source file surfaces in the generated document:

```bash
printf '\n/** @deprecated since 1.8.0 — canary. */\nexport const CANARY_DEPRECATED = 1;\n' >> src/index.ts
bun run build && bun run api:surface
grep -A2 'CANARY_DEPRECATED' docs/api-surface.md
git checkout src/index.ts docs/api-surface.md && bun run build
```

Expected: the grep shows `**Deprecated:** since 1.8.0 — canary.` Then the checkout restores both files. Confirm with `git status --short` that the tree is clean afterwards.

- [ ] **Step 15: Full verification and commit**

Run: `bun run typecheck && bun run lint && bun run build && bun run test`
Expected: all pass, 440 tests total.

```bash
git add scripts/api-surface.ts scripts/api-surface.test.ts
git commit -m "test(api-surface): record @deprecated markers in the surface

The extractor strips comments before capturing declarations, so a @deprecated
tag produced no diff in docs/api-surface.md — deprecation was the one contract
change the contract guard could not see, which would have made the deprecation
policy unenforceable in exactly the way it claims to be enforceable.

collectDeprecations runs on the raw module text and stops the message at the
next JSDoc tag, because tsc emits multi-tag blocks verbatim and a @deprecated
followed by @param would otherwise swallow it.

Nothing in the surface is deprecated today, so the committed baseline is
byte-unchanged."
```

---

### Task 2: The batteries inclusion policy

**Files:**
- Create: `docs/INCLUSION-POLICY.md`

**Interfaces:**
- Consumes: nothing
- Produces: `docs/INCLUSION-POLICY.md`, linked by Task 4

- [ ] **Step 1: Write the policy**

Create `docs/INCLUSION-POLICY.md` with exactly this content:

```markdown
# Batteries — inclusion policy

`@nimbus-dev/sdk` ships **batteries**: pure, dependency-free helper modules so common
connector work isn't reinvented per connector. `crypto`, `jmap-fastmail`, `icalendar`,
`data-profile`, `flux-cd`, `storybook`, and `distribution-channel` are the ones that
exist today.

This policy is the test a reviewer applies when someone proposes another. It exists so
the surface grows on purpose rather than by accretion — every export here is one more
thing every language binding must eventually implement and every consumer may depend on.

## The default answer is no

The burden is on the proposal. This mirrors the posture
[GOVERNANCE.md](./GOVERNANCE.md#the-rfc-process) already takes on the narrow waist: the
question is never "is this useful?" but "does the contract get worse if this is *not*
here?"

## Admission criteria

A proposed battery must satisfy **all four**.

### 1. No runtime dependency

It compiles and runs with nothing in `dependencies`. If it needs a helper, that helper
is inlined. This is not a preference — it is the guarantee that makes the SDK safe to
depend on across an ecosystem, and `package.json` has no `dependencies` key at all.

### 2. Pure

No I/O, no credentials, no network, no filesystem, no global mutable state, and no
clock or randomness reachable from its result. Given the same input it returns the same
output on every supported platform. Anything that must touch the outside world belongs
in the gateway, not here.

### 3. Genuinely reused

Used by at least two connectors — or by one, plus a written case for the second.

This one cannot be checked mechanically. The first-party connectors live in the
[Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo, so this is a claim the
proposing author makes and a reviewer accepts on the evidence offered. A weaker
criterion that CI *could* check would admit exactly the helpers this policy exists to
keep out.

### 4. Contract-shaped

It serves the job of authoring a Nimbus connector or app. A correct, pure,
dependency-free utility that any project might want is still out of scope — that is
what a general-purpose library is for.

## Standing scope constraints

Independent of the four criteria, and non-negotiable because they are
data-minimization guarantees the SDK already makes:

- `jmap-fastmail` stays **headers-only**.
- `data-profile` stays **metadata-only** — never cell values.
- No battery may place row or body data anywhere it could reach a log.

A proposal needing any of these relaxed is contract-affecting and takes the RFC path in
[GOVERNANCE.md](./GOVERNANCE.md#the-rfc-process).

## What acceptance means

A new battery is an **additive** change under
[GOVERNANCE.md's change classes](./GOVERNANCE.md#change-classes): PR plus review, minor
bump, and it will show up as new entries in [`api-surface.md`](./api-surface.md). Adding
it is easy; removing it later requires the
[deprecation policy](./DEPRECATION-POLICY.md) and a major version. Decide accordingly.
```

- [ ] **Step 2: Verify the links resolve**

Run: `ls docs/GOVERNANCE.md docs/DEPRECATION-POLICY.md docs/api-surface.md`
Expected: `GOVERNANCE.md` and `api-surface.md` exist. `DEPRECATION-POLICY.md` does not yet — it is created in Task 3, which lands before any of this is pushed. Note it and continue.

- [ ] **Step 3: Commit**

```bash
git add docs/INCLUSION-POLICY.md
git commit -m "docs: add the batteries inclusion policy

ARCHITECTURE.md, GOVERNANCE.md, and GLOSSARY.md have all cited an inclusion
policy as a governing rule while none existed. This writes the one they
describe — dep-free, pure, genuinely reused — as a test a reviewer can apply,
rather than inventing new criteria.

States plainly that the reuse criterion cannot be checked mechanically, since
the first-party connectors live in the Nimbus monorepo. A weaker criterion CI
could check would admit the helpers the policy exists to keep out."
```

---

### Task 3: The deprecation policy

**Files:**
- Create: `docs/DEPRECATION-POLICY.md`

**Interfaces:**
- Consumes: the `@deprecated` rendering built in Task 1
- Produces: `docs/DEPRECATION-POLICY.md`, linked by Task 4

- [ ] **Step 1: Write the policy**

Create `docs/DEPRECATION-POLICY.md` with exactly this content:

```markdown
# Deprecation policy

How an export of `@nimbus-dev/sdk` is marked deprecated, how long it survives, and when
it may be removed.

The contract is a shared law that connectors and, eventually, other language bindings
depend on. Changing it is fine. Changing it *without warning* is not.

## The window

An export must be marked deprecated in a **released minor**, and **at least one minor
must ship carrying that marker**, before a major may remove it. Removal is always a
major bump.

```text
1.8.0   mark @deprecated              window opens
1.9.0   still present, still marked   window satisfied
2.0.0   may remove
```

The window is tied to **releases, not the calendar**. This package releases on its own
clock, driven by release-please and Conventional Commits, so a date-based promise is one
the maintainers cannot keep: during a quiet quarter the window would elapse with no
release ever carrying the warning.

Nothing may be removed without passing through this window. "It was obviously unused" is
not an exception — the SDK has third-party consumers it cannot enumerate.

## Marking

A `@deprecated` JSDoc tag on the export, stating three things: the version it was
deprecated in, the replacement, and the earliest version that may remove it.

```ts
/** @deprecated since 1.8.0 — use `newThing` instead. May be removed in 2.0.0. */
export const oldThing = …;
```

Keep the message on the `@deprecated` tag. Any following tag (`@param`, `@see`) ends it.

## Visibility

The marker is recorded in [`api-surface.md`](./api-surface.md), the generated snapshot
of every public export:

```markdown
### `oldThing`

**Deprecated:** since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.
```

So **opening and closing a deprecation are both reviewable diffs** in the artifact that
already gates the contract — the same property adds, removals, and signature changes
have. A deprecation that does not show up there has not really been made.

## Worked precedents

Real classification calls and the reasoning behind them, so the next similar decision is
cheap.

### `engines: ">=22"` shipped as `feat:` — a minor, not a major

Introducing an engine constraint where none existed narrows what the package claims to
support, which is superficially breaking. It shipped as a minor because:

1. **Nothing stops working.** The SDK is dependency-free types and pure helpers with no
   Node-22-only code. A consumer on Node 20 keeps working — they lose a promise, not a
   capability.
2. **npm's default response to an engine mismatch is a warning**, not a failure.
3. **The excluded line was already end-of-life.** Node 20 ended support 2026-04-30.

The reasoning generalizes: **a narrowing of a support claim is not by itself a breaking
change if no behavior changes.**

**With a caveat.** "npm warns" is not universal — under `engine-strict`, and by default
in some package managers, an engine mismatch is a hard install failure. A consumer on an
excluded line who could install the previous version cannot install the new one. The
classification still holds, because the excluded line was EOL and the alternative was
promising support the project does not test. But it is why a support narrowing warrants
a release note even as a minor, and why the bar is "the excluded line is already EOL"
rather than "we would rather not test it."

## Relationship to the RFC process

Removing an export is contract-affecting and takes the RFC path in
[GOVERNANCE.md](./GOVERNANCE.md#the-rfc-process). This policy governs the *timing*; the
RFC governs the *decision*. An RFC that proposes a removal must state which release
opened the window.
```

- [ ] **Step 2: Verify the rendering example matches what the guard actually emits**

The policy claims a specific rendered form. Confirm the claim is true rather than aspirational:

```bash
printf '\n/** @deprecated since 1.8.0 — use `newThing` instead. May be removed in 2.0.0. */\nexport const POLICY_CHECK = 1;\n' >> src/index.ts
bun run build && bun run api:surface
grep -A2 'POLICY_CHECK' docs/api-surface.md
git checkout src/index.ts docs/api-surface.md && bun run build
```

Expected: the output contains `**Deprecated:** since 1.8.0 — use \`newThing\` instead. May be removed in 2.0.0.`, matching the policy's example. Then the tree is restored — confirm with `git status --short`.

- [ ] **Step 3: Commit**

```bash
git add docs/DEPRECATION-POLICY.md
git commit -m "docs: add the deprecation policy

GLOSSARY.md has defined this policy as 'a Pillar 7 deliverable' while none
existed. The window is release-based — one minor must ship carrying the marker
before a major may remove it — rather than calendar-based, because a date
promise is one this release cadence cannot keep.

Records the engines >=22 classification as the first worked precedent, which
slice 1 explicitly deferred pending this policy, including the caveat that an
engine mismatch is a hard failure under engine-strict."
```

---

### Task 4: Point the existing documents at the written policies

Three shipped documents cite these policies as governing rules. Until this task they point at nothing.

**Files:**
- Modify: `docs/GOVERNANCE.md:37`
- Modify: `docs/ARCHITECTURE.md:80`
- Modify: `docs/GLOSSARY.md:61` and `docs/GLOSSARY.md:84-86`
- Modify: `CONTRIBUTING.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `docs/INCLUSION-POLICY.md` and `docs/DEPRECATION-POLICY.md` from Tasks 2 and 3
- Produces: nothing

- [ ] **Step 1: Link from `docs/GOVERNANCE.md`**

On line 37, change `must satisfy the inclusion policy` to:

```
must satisfy the [inclusion policy](./INCLUSION-POLICY.md)
```

Change only those words. Do not reflow the table row.

- [ ] **Step 2: Link from `docs/ARCHITECTURE.md`**

Around line 80, the text reads:

```
Growth here is deliberately gated by an inclusion policy (dep-free, pure, genuinely
reused) — see the [roadmap](./ROADMAP.md#3-batteries-for-connectors--apps).
```

Change it to:

```
Growth here is deliberately gated by the [inclusion policy](./INCLUSION-POLICY.md)
(dep-free, pure, genuinely reused) — see also the
[roadmap](./ROADMAP.md#3-batteries-for-connectors--apps).
```

- [ ] **Step 3: Link from `docs/GLOSSARY.md`**

On line 61, change `Governed by the inclusion policy.` to:

```
Governed by the [inclusion policy](./INCLUSION-POLICY.md).
```

On lines 84-86, the entry currently reads:

```
**Deprecation policy** — the rules for marking an export deprecated and how long it
survives before a major bump removes it (a [Pillar 7](./ROADMAP.md#7-versioning--compatibility)
deliverable).
```

Change it to:

```
**Deprecation policy** — the rules for marking an export deprecated and how long it
survives before a major bump removes it. See
[DEPRECATION-POLICY.md](./DEPRECATION-POLICY.md).
```

The word "deliverable" must go — it asserts the policy does not exist yet.

- [ ] **Step 4: Link from `CONTRIBUTING.md`**

In the `## Architecture notes` section, after the existing dependency-free bullet, add:

```markdown
- **Adding a battery?** It must satisfy the
  [inclusion policy](./docs/INCLUSION-POLICY.md) — dep-free, pure, genuinely reused,
  contract-shaped. The default answer is no.
- **Removing or renaming an export?** It must pass through the
  [deprecation policy](./docs/DEPRECATION-POLICY.md) — marked in a released minor, at
  least one minor shipped carrying the marker, removed only in a major.
```

- [ ] **Step 5: Add both to `README.md`'s documentation list**

In the `## Documentation` section, after the Governance entry, add:

```markdown
- [Inclusion policy](./docs/INCLUSION-POLICY.md) — the bar a new battery must clear.
- [Deprecation policy](./docs/DEPRECATION-POLICY.md) — how an export is marked
  deprecated and how long it survives before removal.
```

- [ ] **Step 6: Verify no document still calls either policy unwritten**

Run:

```bash
grep -rniE 'inclusion policy|deprecation policy' docs/*.md CONTRIBUTING.md README.md | grep -viE 'INCLUSION-POLICY\.md|DEPRECATION-POLICY\.md'
```

Expected: **no output**. Every mention now carries a link. If a line appears, it is a reference this task missed.

Then confirm every link resolves:

```bash
grep -rohE '\]\(\./(docs/)?[A-Z-]+\.md\)' docs/*.md CONTRIBUTING.md README.md | sort -u
```

Expected: every path listed exists on disk.

- [ ] **Step 7: Commit**

```bash
git add docs/GOVERNANCE.md docs/ARCHITECTURE.md docs/GLOSSARY.md CONTRIBUTING.md README.md
git commit -m "docs: point governance, architecture, and glossary at the written policies

These three documents cited the inclusion and deprecation policies as
governing rules while neither existed — GOVERNANCE gated additive changes on
one, GLOSSARY called the other a future deliverable. Now that both are
written, every reference links to them, and the glossary no longer describes
the deprecation policy as unwritten.

Also surfaces both from CONTRIBUTING.md and README.md, so a contributor meets
them before proposing a battery or removing an export."
```

---

### Task 5: Close the roadmap boxes

**Files:**
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Tick boxes 7 and 8**

In the Phase 0 checklist in `docs/ROADMAP.md`, change these two from `- [ ]` to `- [x]`:

- The task beginning `The written **inclusion policy** for the batteries, linked from`
- The task beginning `The written **deprecation policy** (how an export is marked and how long it`

Change only the two characters inside each bracket. Three boxes are already ticked from slice 1; leave them and the remaining three untouched.

- [ ] **Step 2: Verify the count**

Run: `grep -c '^- \[x\]' docs/ROADMAP.md`
Expected: `5` — the three from slice 1 plus these two.

Run: `sed -n '/### Phase 0/,/\*\*Exit criteria/p' docs/ROADMAP.md | grep -c '^- \[ \]'`
Expected: `3` — per-module docs, the docs surface, and the example connector remain open.

- [ ] **Step 3: Full verification**

Run: `bun run typecheck && bun run lint && bun run build && bun run test && node scripts/smoke-esm.mjs`
Expected: every command exits 0, 440 tests pass.

Run: `bun run api:surface && git diff --stat docs/api-surface.md`
Expected: empty — the baseline is unchanged by this entire slice.

Then:

```bash
git status --short
git log --oneline origin/main..HEAD
```

Expected: no output from `git status`; the commits from Tasks 1–5 plus the two spec commits already on the branch.

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: tick Phase 0 boxes 7 and 8"
```

---

## What "done" looks like

From the design spec's exit criteria:

- [ ] `docs/INCLUSION-POLICY.md` and `docs/DEPRECATION-POLICY.md` are committed
- [ ] No document refers to either policy as unwritten or as a future deliverable
- [ ] Both are reachable from `README.md` and from `CONTRIBUTING.md`
- [ ] A `@deprecated` export renders its marker in `docs/api-surface.md`, verified end to end with a real canary on `src/index.ts`
- [ ] A non-deprecated export renders exactly what it renders today, and the committed baseline is byte-unchanged
- [ ] The deprecation policy records the `engines: ">=22"` precedent, including the strict-package-manager caveat
- [ ] Phase 0 boxes 7 and 8 are ticked; three boxes remain open

## Known limitations, recorded deliberately

- **"Genuinely reused" is not machine-checkable.** Stated in the policy rather than papered over — the connectors live in another repository.
- **The window can be satisfied without real elapsed time.** Two minors cut in one afternoon technically clear it. A maintainer racing releases to force a removal is a governance problem, not a policy-wording one.
- **`collectDeprecations` is text-based**, inheriting the extractor's existing limitations. It sees what `tsc` emits, which is what ships.
