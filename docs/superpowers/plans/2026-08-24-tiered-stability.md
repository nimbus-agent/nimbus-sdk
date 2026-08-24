# Tiered Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every published export in all three bindings a stability tier, project it into the generated API-surface goldens, and enforce a tier-driven minimum Conventional Commit type in CI.

**Architecture:** Tiers are declared at module scope with a per-export override, in a mechanism idiomatic to each binding. Each of the three surface generators resolves the tier and emits it into its golden file, making the goldens the single machine-readable projection. A second rule inside the existing `conventional-commit-guard.ts` diffs the base and head goldens, maps each change through a `(tier × change-kind) → ReleaseImpact` table, and reuses the guard's existing *declared ≥ required* comparison.

**Tech Stack:** TypeScript (Bun test, `tsc`), Python 3.11+ (pytest, `ast`), Go 1.26 (stdlib `testing`, `go/ast`), GitHub Actions.

**Spec:** [`docs/superpowers/specs/2026-08-24-tiered-stability-design.md`](../specs/2026-08-24-tiered-stability-design.md)

## Global Constraints

- **Dependency-free at runtime, in all three languages.** No `dependencies` in any `package.json`, `[project].dependencies` stays empty, `sdks/go/go.mod` keeps zero `require` lines. Tests included for Go.
- **No `any`; TypeScript strict.** Biome enforces `noExplicitAny` and `noConsole` in `sdks/typescript/src/`. Scripts under `sdks/typescript/scripts/` may use `console` — the existing guards do.
- **The three tiers are exactly `frozen`, `stable`, `experimental`.** No other value is valid anywhere; an unrecognised value is a hard error, never a default.
- **No default tier.** A module reachable from a published surface with no tier fails CI. This is spec §7, bullet 1.
- **Python reads the spec from `src/nimbus_sdk/_data/spec`.** After editing anything under `docs/spec/`, run `python -m pip install -e .` from `sdks/python/` before `pytest`. No task here edits `docs/spec/`, but the trap is live for anyone rebasing.
- **Regenerate goldens, never hand-edit them.** `bun run build && bun run api:surface`; `python scripts/api_surface.py`; `go -C sdks/go run ./internal/apisurface/cmd`.
- **This worktree borrows the parent checkout's `node_modules`.** A green local run does not prove CI green. See CLAUDE.md.
- **One shipment per pull request**, and shipments 3 and 4 stay in *separate* pull requests: release-please assigns a commit to a component by the paths it touches, so one PR touching `sdks/python/` and `sdks/go/` releases both under one subject line.

---

## File Structure

**Shipment 1 — the decision**
- Create: `docs/rfcs/0015-tiered-stability.md` — the vocabulary, rule table, classification, and stated limits.

**Shipment 2 — TypeScript**
- Modify: `sdks/typescript/scripts/api-surface.ts` — add `Tier`, `collectStability`, a `stability` field on `SurfaceExport`, and the rendered line.
- Create: `sdks/typescript/scripts/stability.test.ts` — unit tests for tag extraction and resolution.
- Modify: 35 modules under `sdks/typescript/src/` — one `@moduleStability` tag each, plus one `@stability` override.
- Modify: `docs/api-surface.md` — regenerated.

**Shipment 3 — Python**
- Modify: `sdks/python/scripts/api_surface.py` — add `defining_modules`, `stability_of`, a `stability` field on `Export`, and the rendered line.
- Create: `sdks/python/tests/test_stability.py` — resolver unit tests.
- Modify: 17 modules under `sdks/python/src/nimbus_sdk/` — one `__stability__` each, plus overrides. The 17th is `__init__.py`, which defines `__version__` itself; see Task 6.
- Modify: `docs/api-surface-python.md` — regenerated.

**Shipment 4 — Go**
- Modify: `sdks/go/internal/apisurface/surface.go` — package and declaration doc-comment scanning.
- Create: `sdks/go/internal/apisurface/stability_test.go`.
- Modify: 5 packages under `sdks/go/` — one `// Stability:` line each, plus two overrides.
- Modify: `docs/api-surface-go.md` — regenerated.

**Shipment 5 — the gate**
- Create: `sdks/typescript/scripts/stability-rules.ts` — the pure rule table and surface-diff classifier.
- Create: `sdks/typescript/scripts/stability-rules.test.ts`.
- Modify: `sdks/typescript/scripts/conventional-commit-guard.ts` — the second rule.
- Create: `.github/workflows/commit-subject.yml`.
- Modify: `.github/workflows/ci.yml` — remove the `commit-guard` job and its `ci-complete` dependency.

**Shipment 6 — trailing docs**
- Modify: `docs/ROADMAP.md`, `docs/DEPRECATION-POLICY.md`, `docs/INCLUSION-POLICY.md`, `CLAUDE.md`.

---

## Task 1: RFC-0015

**Files:**
- Create: `docs/rfcs/0015-tiered-stability.md`
- Modify: `docs/rfcs/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the RFC number `0015`, cited by every later shipment's commit body.

- [ ] **Step 1: Read the two most recent RFCs for house style**

Run: `sed -n 1,60p docs/rfcs/0013-go-sdk-official.md` and `sed -n 1,60p docs/rfcs/0014-utf8-replacement-count.md`

Match their front-matter shape, heading depth, and the way they state a decision before arguing it.

- [ ] **Step 2: Write the RFC**

It must contain, in this order:

1. **The limits, first.** A surface diff proves a bump is not too small and never that it is big enough; RFC-0014's U+FFFD fix was breaking with zero signature change. The deprecation-window check is half-checkable and TypeScript-only.
2. **The three tiers**, with `frozen` defined mechanically: a normative document under `docs/spec/` *and* a corpus guard that imports the module.
3. **Tier and deprecation are orthogonal**, with `audit-logger` as the worked example — `stable` and `@deprecated` at once.
4. **The rule table**, verbatim from spec §3.
5. **Why the table targets commit types, not version numbers** — TypeScript is `1.20.0` but `nimbus-dev-sdk` is `0.11.0`, `sdks/go` is `v0.8.1` and `@nimbus-dev/create-connector` is `0.3.0`; in `0.x` a breaking change bumps the minor, so a rule phrased against majors is uncomputable for three of four components.
6. **The classification**, all 56 rows, from spec §4, §5.1 and §5.2.
7. **The two recorded classification calls** — `agents/*` is `stable`; `handshake` is the single exception to the greppable `frozen` rule.
8. **The `+ RFC` requirement**, and that it makes GOVERNANCE.md's existing "contract-affecting changes take the RFC path" enforceable for the first time.

- [ ] **Step 3: Add the RFC to the index**

Add a row to `docs/rfcs/README.md` matching the existing format. Confirm the format first with `grep -n "0014" docs/rfcs/README.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/rfcs/0015-tiered-stability.md docs/rfcs/README.md
git commit -m "docs: RFC-0015 — tiered stability markers"
```

`docs:` is correct here and deliberate: the RFC is the decision, not the commitment, and it must cut no release.

---

## Task 2: TypeScript tag extraction

**Files:**
- Modify: `sdks/typescript/scripts/api-surface.ts`
- Create: `sdks/typescript/scripts/stability.test.ts`

**Interfaces:**
- Consumes: `declaredNameOf(statement: string): string | null` and the `JSDOC_BLOCK` / `SKIPPABLE_BEFORE_DECLARATION` constants, all already in `api-surface.ts`.
- Produces:
  ```ts
  export type Tier = "frozen" | "stable" | "experimental";
  export type ModuleStability = { module: Tier | null; overrides: Map<string, Tier> };
  export function collectStability(rawText: string): ModuleStability;
  ```

- [ ] **Step 1: Write the failing test**

Create `sdks/typescript/scripts/stability.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { collectStability } from "./api-surface.ts";

describe("collectStability", () => {
  test("reads the module default from @moduleStability", () => {
    const text = `/** @moduleStability experimental */\nexport declare const a: number;\n`;
    expect(collectStability(text).module).toBe("experimental");
  });

  test("reads a per-export override from @stability", () => {
    const text = [
      "/** @moduleStability experimental */",
      "/** @stability frozen */",
      "export declare function resolveUrlWithBase(): string;",
      "",
    ].join("\n");
    const result = collectStability(text);
    expect(result.module).toBe("experimental");
    expect(result.overrides.get("resolveUrlWithBase")).toBe("frozen");
  });

  // The trap this design exists to avoid: tsc emits the module docblock immediately
  // adjacent to the first declaration, so a position-based rule would read the module
  // default as an override on ParsedEvent.
  test("a module tag adjacent to the first declaration is not an override", () => {
    const text = `/**\n * Docs.\n * @moduleStability stable\n */\nexport interface ParsedEvent {\n}\n`;
    const result = collectStability(text);
    expect(result.module).toBe("stable");
    expect(result.overrides.size).toBe(0);
  });

  test("rejects an unknown tier", () => {
    expect(() => collectStability("/** @moduleStability sortof */")).toThrow(/sortof/);
  });

  test("rejects two module tags in one file", () => {
    const text = "/** @moduleStability stable */\n/** @moduleStability frozen */\n";
    expect(() => collectStability(text)).toThrow(/more than one/i);
  });

  test("returns a null module tier when the file carries no tag", () => {
    expect(collectStability("export declare const a: number;\n").module).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sdks/typescript && bun test scripts/stability.test.ts`
Expected: FAIL — `collectStability` is not exported from `./api-surface.ts`.

- [ ] **Step 3: Implement `collectStability`**

Add to `sdks/typescript/scripts/api-surface.ts`, directly below `collectDeprecations`:

```ts
/** The three stability tiers. No other value is valid, and there is no default. */
export type Tier = "frozen" | "stable" | "experimental";

const TIERS: readonly string[] = ["frozen", "stable", "experimental"];

/** A module's default tier and its per-export overrides. */
export type ModuleStability = { module: Tier | null; overrides: Map<string, Tier> };

/** The single-word value of `tag` in a JSDoc body, or null when the tag is absent. */
function tagWord(body: string, tag: string): string | null {
  const match = new RegExp(`(?<=^|\\s)@${tag}\\s+(\\S+)`).exec(body);
  return match?.[1] ?? null;
}

function asTier(value: string, tag: string): Tier {
  if (!TIERS.includes(value)) {
    throw new Error(`@${tag} has unknown tier "${value}" — expected one of ${TIERS.join(", ")}`);
  }
  return value as Tier;
}

/**
 * A module's `@moduleStability` default and every `@stability` override in it.
 *
 * TWO tags rather than one distinguished by position, and that is load-bearing. This
 * runs on `dist/`, and `tsc` emits a module's file-level JSDoc block immediately
 * adjacent to the first declaration with no blank line — verified against
 * `dist/icalendar.d.ts`, where the block ends at line 14 and `export interface
 * ParsedEvent` begins at line 15. So `declaredNameOf` returns `ParsedEvent` for the
 * module's own docblock, and any rule of the form "a tag annotating no declaration is
 * the module default" would silently attribute it to whichever export is declared
 * first.
 */
export function collectStability(rawText: string): ModuleStability {
  const text = normalizeEol(rawText);
  const overrides = new Map<string, Tier>();
  let moduleTier: Tier | null = null;

  JSDOC_BLOCK.lastIndex = 0;
  let block = JSDOC_BLOCK.exec(text);
  while (block !== null) {
    const body = block[1] ?? "";

    const moduleWord = tagWord(body, "moduleStability");
    if (moduleWord !== null) {
      if (moduleTier !== null) {
        throw new Error("more than one @moduleStability tag in a single module");
      }
      moduleTier = asTier(moduleWord, "moduleStability");
    }

    const exportWord = tagWord(body, "stability");
    if (exportWord !== null) {
      const after = text.slice(block.index + block[0].length);
      const name = declaredNameOf(after.replace(SKIPPABLE_BEFORE_DECLARATION, ""));
      if (name !== null) overrides.set(name, asTier(exportWord, "stability"));
    }

    block = JSDOC_BLOCK.exec(text);
  }

  return { module: moduleTier, overrides };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sdks/typescript && bun test scripts/stability.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `cd sdks/typescript && bun run typecheck && bun run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/scripts/api-surface.ts sdks/typescript/scripts/stability.test.ts
git commit -m "feat(typescript): extract @moduleStability and @stability from module text"
```

---

## Task 3: Project the tier into the TypeScript golden

**Files:**
- Modify: `sdks/typescript/scripts/api-surface.ts:444-452` (`SurfaceExport`), `:581` (`buildSurface`), `:635-672` (`renderSurface`)
- Modify: `sdks/typescript/scripts/stability.test.ts`

**Interfaces:**
- Consumes: `collectStability` from Task 2; `Tier`.
- Produces: `SurfaceExport.stability: Tier`, and the rendered line `**Stability:** <tier>`.

- [ ] **Step 1: Write the failing test**

Append to `sdks/typescript/scripts/stability.test.ts`:

```ts
import { buildSurface, renderSurface } from "./api-surface.ts";

describe("stability in the surface", () => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ exports: { ".": { types: "./dist/index.d.ts" } } }),
    "dist/index.d.ts": `/** @moduleStability stable */\nexport declare const a: number;\n`,
  };
  const read = (path: string): string => {
    const text = files[path];
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  };

  test("buildSurface resolves the module default onto each export", () => {
    const [surface] = buildSurface([{ label: ".", types: "dist/index.d.ts" }], read);
    expect(surface?.exports[0]?.stability).toBe("stable");
  });

  test("renderSurface emits the tier line", () => {
    const markdown = renderSurface([
      {
        label: ".",
        exports: [
          {
            name: "a",
            typeOnly: false,
            source: "(local)",
            declaration: "export declare const a: number;",
            deprecated: null,
            stability: "stable",
          },
        ],
      },
    ]);
    expect(markdown).toContain("**Stability:** stable");
  });
});
```

Confirm the `EntryPoint` shape before running — `grep -n "type EntryPoint" sdks/typescript/scripts/api-surface.ts` — and adjust the literal in the first test to match its real fields.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sdks/typescript && bun test scripts/stability.test.ts`
Expected: FAIL — `stability` is not a property of `SurfaceExport`.

- [ ] **Step 3: Add the field**

In `SurfaceExport` (line 444):

```ts
  /** The `@deprecated` message, or null when the export is not deprecated. */
  deprecated: string | null;
  /** The resolved tier: the module's `@moduleStability`, or a `@stability` override. */
  stability: Tier;
```

- [ ] **Step 4: Resolve it in `buildSurface`**

`buildSurface` already calls `collectDeprecations` per module. Call `collectStability` on the same raw text, and for each export resolve `overrides.get(name) ?? module`. If the result is `undefined`, throw:

```ts
throw new Error(
  `${modulePath} has no @moduleStability tag and no @stability override for "${name}".\n` +
    "Every module reachable from the published surface must declare a tier.\n" +
    'Fix: add `/** @moduleStability frozen|stable|experimental */` to the module in ' +
    "sdks/typescript/src/, then re-run `bun run build && bun run api:surface`.\n" +
    "See docs/rfcs/0015-tiered-stability.md for which tier applies.",
);
```

That throw *is* the no-default guard from the global constraints; no separate test file is needed for it.

**Every error this plan adds must name its remedy**, in all three bindings. These fire on a contributor who has never heard of tiers — most likely someone adding an unrelated module and hitting the gate for the first time. A message that states only what is wrong sends them to read the generator's source; one that states the tag to add, the command to re-run, and where the tiers are defined does not. Apply the same shape to the Python errors in Task 5 Step 3 (`__stability__ = "..."` plus `python scripts/api_surface.py`) and the Go error in Task 7 Step 4 (`// Stability: ...` plus `go -C sdks/go run ./internal/apisurface/cmd`).

- [ ] **Step 5: Render it**

In `renderSurface`, immediately after the `**Deprecated:**` block and before the `From \`...\`` line:

```ts
      lines.push(`**Stability:** ${entry.stability}`, "");
```

Ordering matters for the golden: deprecation first, tier second, source third.

- [ ] **Step 6: Run the tests**

Run: `cd sdks/typescript && bun test scripts/stability.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add sdks/typescript/scripts/api-surface.ts sdks/typescript/scripts/stability.test.ts
git commit -m "feat(typescript): render the resolved stability tier into api-surface.md"
```

---

## Task 4: Tag the 35 TypeScript modules and regenerate

**Files:**
- Modify: 35 modules under `sdks/typescript/src/`
- Modify: `docs/api-surface.md`

**Interfaces:**
- Consumes: the tags from Task 2, the renderer from Task 3.
- Produces: a fully-tiered `docs/api-surface.md`.

- [ ] **Step 1: Add `@moduleStability frozen` to the ten frozen modules**

`types.ts`, `item-types.ts`, `contract-version.ts`, `ipc/hello.ts`, `ipc/ndjson-line-reader.ts`, `ipc/handshake.ts`, `diagnostics/event.ts`, `contract-tests.ts`, `hitl-request.ts`, `testing/sandbox-contract.ts`.

Add the tag to each module's existing file-level JSDoc block. Where a module has none, add one:

```ts
/** @moduleStability frozen */
```

- [ ] **Step 2: Add `@moduleStability stable` to the twenty stable modules**

`crypto/app-store-connect-jwt.ts`, `crypto/canonical-json.ts`, `crypto/jwt.ts`, `crypto/service-account-token.ts`, `crypto/verify-signature.ts`, `icalendar.ts`, `jmap-fastmail/index.ts`, `data-profile/index.ts`, `distribution-channel.ts`, `audit-logger.ts`, `server.ts`, `testing/index.ts`, `testing/diagnostics-assert.ts`, `agents/agent-names.ts`, `agents/brief-types.ts`, `agents/brief-composites.ts`, `agents/brief-guards.ts`, `agents/guard-factory.ts`, `connector-kit/search-filter.ts`, `connector-kit/mcp-tool-kit.ts`.

- [ ] **Step 3: Add `@moduleStability experimental` to the five experimental modules**

`flux-cd/index.ts`, `storybook/index.ts`, `diagnostics/emitter.ts`, `connector-kit/rest-tool-kit.ts`, `connector-kit/fetch-bearer-json.ts`.

- [ ] **Step 4: Add the one per-export override**

In `sdks/typescript/src/connector-kit/fetch-bearer-json.ts`, on the `resolveUrlWithBase` declaration:

```ts
/**
 * ...existing docs...
 *
 * @stability frozen
 */
```

The module stays `experimental`; only this export is pinned, because `url-resolution.md` and its corpus pin it.

- [ ] **Step 5: Build and regenerate**

Run: `cd sdks/typescript && bun run build && bun run api:surface`
Expected: `docs/api-surface.md` gains a `**Stability:**` line under all 226 exports. If the run throws the Task 3 Step 4 error, a module was missed — the message names it.

- [ ] **Step 6: Verify no export was mis-tiered**

Run: `grep -c "Stability:" docs/api-surface.md`
Expected: `226`.

Run: `grep -B8 "Stability:. frozen" docs/api-surface.md | grep "^### " | wc -l`
Expected: the frozen export count. Spot-check that `resolveUrlWithBase` is `frozen` while `fetchBearerAuthorizedJson` beside it is `experimental`:

Run: `grep -A4 '^### `fetchBearerAuthorizedJson`' docs/api-surface.md`

- [ ] **Step 7: Run the full suite**

Run: `cd sdks/typescript && bun run typecheck && bun run lint && bun test`
Expected: all green, including `scripts/api-surface.test.ts`, which compares the regenerated output to the committed golden.

- [ ] **Step 8: Commit**

```bash
git add sdks/typescript/src docs/api-surface.md
git commit -m "feat(typescript): declare a stability tier for every published module"
```

---

## Task 5: The Python defining-module resolver

**Files:**
- Modify: `sdks/python/scripts/api_surface.py`
- Create: `sdks/python/tests/test_stability.py`

**Interfaces:**
- Consumes: the `_SRC` constant and the `ast` import, both already in `api_surface.py`; the existing `alias_sources()` at line 118 is the pattern to follow, not to modify.
- Produces:
  ```python
  def defining_modules() -> dict[str, str]: ...   # exported name -> dotted module path
  def stability_of(name: str, defining: dict[str, str]) -> str: ...
  ```

- [ ] **Step 1: Write the failing test**

Create `sdks/python/tests/test_stability.py`:

```python
"""The two-step tier resolver: AST for location, runtime for value."""

from __future__ import annotations

import pytest

from scripts.api_surface import defining_modules, stability_of

TIERS = {"frozen", "stable", "experimental"}


def test_locates_a_constant_that_has_no_dunder_module() -> None:
    """The case that defeats ``obj.__module__``.

    ``CONTRACT_VERSIONS`` is a tuple. Tuples carry no ``__module__``, so a resolver
    built on that attribute cannot place it — and it is a published export.
    """
    assert defining_modules()["CONTRACT_VERSIONS"] == "nimbus_sdk.contract"


def test_locates_a_class_in_the_same_module_as_that_constant() -> None:
    assert defining_modules()["NegotiationOk"] == "nimbus_sdk.contract"


def test_locates_a_name_from_a_module_with_no_dunder_all() -> None:
    """Only 5 of 20 files under src/nimbus_sdk/ declare __all__, and four are barrels."""
    assert defining_modules()["load_schema"] == "nimbus_sdk.spec"


def test_a_reexport_does_not_count_as_a_definition() -> None:
    """nimbus_sdk/__init__.py imports CONTRACT_VERSIONS; it must not claim it."""
    assert defining_modules()["CONTRACT_VERSIONS"] != "nimbus_sdk"


def test_locates_a_name_defined_inside_a_try_block() -> None:
    """``__version__`` is in ``nimbus_sdk.__all__`` and is bound in BOTH arms of a
    try/except at module level. Walking only ``tree.body`` misses it entirely.

    It is also the one name a published root defines itself rather than re-exporting,
    which is why ``nimbus_sdk/__init__.py`` carries a ``__stability__`` and the other
    three barrels do not.
    """
    assert defining_modules()["__version__"] == "nimbus_sdk"


def test_every_published_name_resolves_to_a_tier() -> None:
    defining = defining_modules()
    for root in ("nimbus_sdk", "nimbus_sdk.ipc", "nimbus_sdk.diagnostics", "nimbus_sdk.connector_kit"):
        module = __import__(root, fromlist=["__all__"])
        for name in module.__all__:
            assert stability_of(name, defining) in TIERS


def test_an_override_wins_over_the_module_default() -> None:
    defining = defining_modules()
    assert stability_of("resolve_url_with_base", defining) == "frozen"


def test_an_unresolvable_name_is_an_error() -> None:
    with pytest.raises(RuntimeError, match="no defining module"):
        stability_of("not_a_real_export", {})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sdks/python && python -m pytest tests/test_stability.py -q`
Expected: FAIL — `ImportError: cannot import name 'defining_modules'`.

If the import of `scripts.api_surface` itself fails, check how `tests/test_api_surface.py` imports it and copy that mechanism rather than inventing one.

- [ ] **Step 3: Implement the resolver**

Add to `sdks/python/scripts/api_surface.py`, directly below `alias_sources()`:

```python
#: The three tiers. No other value is valid, and there is no default.
_TIERS = frozenset({"frozen", "stable", "experimental"})

#: AST nodes that DEFINE a name at module level. `ast.ImportFrom` is deliberately
#: absent: an import is a re-export, and every published root is a re-export barrel.
_DEFINITION_NODES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Assign, ast.AnnAssign)

#: Blocks whose bodies are still module scope. A name bound inside one is as published
#: as any other — `nimbus_sdk/__init__.py` defines `__version__`, which IS in `__all__`,
#: inside a try/except that falls back to "0.0.0+unknown" for an uninstalled source
#: tree. Walking only `tree.body` misses it and reports it as having no defining module.
_SCOPED_BLOCKS = (ast.If, ast.Try, ast.With)


def _dotted(path: Path) -> str:
    """`src/nimbus_sdk/ipc/hello.py` -> `nimbus_sdk.ipc.hello`; a package -> its dir."""
    relative = path.relative_to(_SRC.parent).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _module_scope(body: list[ast.stmt]) -> Iterator[ast.stmt]:
    """Every definition node at module scope, descending through conditional blocks.

    A definition inside ``if``/``try``/``with`` at module level is still module scope —
    it binds a name the module exports. It is NOT nested scope: a ``def`` or ``class``
    body introduces its own scope and is deliberately not descended into, so a method
    named like an export cannot shadow it.

    Binding the same name twice in one module is fine and expected: the try/except that
    defines ``__version__`` binds it in both arms. The caller's collision check only
    fires across DIFFERENT modules.
    """
    for node in body:
        if isinstance(node, _DEFINITION_NODES):
            yield node
        elif isinstance(node, _SCOPED_BLOCKS):
            yield from _module_scope(node.body)
            yield from _module_scope(getattr(node, "orelse", []))
            yield from _module_scope(getattr(node, "finalbody", []))
            for handler in getattr(node, "handlers", []):
                yield from _module_scope(handler.body)


def _bound_names(node: ast.stmt) -> list[str]:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return [node.target.id]
    if isinstance(node, ast.Assign):
        return [t.id for t in node.targets if isinstance(t, ast.Name)]
    return []


def defining_modules() -> dict[str, str]:
    """Map each module-level name under ``src/nimbus_sdk/`` to the module DEFINING it.

    The second departure from this module's import-don't-parse rule, and narrower than
    the first. That rule exists so rendered *signatures* match what a consumer imports.
    Where a name is defined is not a signature — it is a static fact about the source,
    and the source is the only place it is written down.

    It cannot be answered at runtime. Only classes and functions carry ``__module__``;
    four of the thirteen names in ``nimbus_sdk.__all__`` are plain values that do not
    (``CONTRACT_HANDSHAKE_EXIT``, ``CONTRACT_VERSIONS``, ``CONTRACT_VERSION_PATTERN``,
    ``__version__``), and constants are a deliberate part of this surface. Searching
    submodules' ``__all__`` fails too: only 5 of the 20 files declare one, and four of
    those five are re-export barrels.
    """
    found: dict[str, str] = {}
    for path in sorted(_SRC.rglob("*.py")):
        module = _dotted(path)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in _module_scope(tree.body):
            for name in _bound_names(node):
                if name.startswith("_") and not name.startswith("__"):
                    continue
                previous = found.get(name)
                if previous is not None and previous != module:
                    raise RuntimeError(
                        f'"{name}" is defined in both {previous} and {module}; '
                        "the tier resolver cannot say which module's tier applies"
                    )
                found[name] = module
    return found


def stability_of(name: str, defining: dict[str, str]) -> str:
    """The tier for ``name``: its defining module's default, or that module's override."""
    module_path = defining.get(name)
    if module_path is None:
        raise RuntimeError(f'"{name}" has no defining module under src/nimbus_sdk/')
    module = importlib.import_module(module_path)
    overrides = getattr(module, "__stability_overrides__", {})
    tier = overrides.get(name, getattr(module, "__stability__", None))
    if tier is None:
        raise RuntimeError(f"{module_path} declares no __stability__ (needed for {name})")
    if tier not in _TIERS:
        raise RuntimeError(f'{module_path} declares unknown tier "{tier}"')
    return tier
```

Confirm `Path` and `importlib` are already imported at the top of the file; both are used by existing code, but check rather than assume. `Iterator` — used in `_module_scope`'s return annotation — is **not** currently imported; add `from collections.abc import Iterator`. `ruff` will fail the file otherwise, and `from __future__ import annotations` does not save you here because the name still has to resolve for `mypy`.

- [ ] **Step 4: Run the tests**

Run: `cd sdks/python && python -m pytest tests/test_stability.py -q`
Expected: the four location tests PASS; the three tier tests FAIL, because no module declares `__stability__` yet. That is the correct intermediate state — Task 6 fixes it.

- [ ] **Step 5: Commit the resolver alone**

```bash
git add sdks/python/scripts/api_surface.py sdks/python/tests/test_stability.py
git commit -m "feat(python): resolve each export's defining module by AST"
```

---

## Task 6: Tag the 16 Python modules and project the tier

**Files:**
- Modify: 17 modules under `sdks/python/src/nimbus_sdk/`
- Modify: `sdks/python/scripts/api_surface.py` — `Export`, `collect`, `render_export`
- Modify: `docs/api-surface-python.md`

**Interfaces:**
- Consumes: `defining_modules`, `stability_of` from Task 5.
- Produces: `Export.stability: str`, and the rendered tier in `docs/api-surface-python.md`.

- [ ] **Step 1: Declare the tiers**

Add `__stability__` at module level, after the imports, in each of:

- `frozen`: `contract.py`, `ipc/hello.py`, `ipc/ndjson.py`, `ipc/handshake.py`, `diagnostics/event.py`, `connector_kit/urls.py`
- `stable`: `spec.py`, `diagnostics/timestamp.py`, `connector_kit/errors.py`, `connector_kit/env.py`, `connector_kit/types.py`, `connector_kit/results.py`, `connector_kit/search_filter.py`
- `experimental`: `connector_kit/transport.py`, `connector_kit/router.py`, `connector_kit/rest.py`

```python
__stability__ = "frozen"
```

**Three of the four `__init__.py` barrels get no `__stability__`; `nimbus_sdk/__init__.py` does get one.** `nimbus_sdk.ipc`, `nimbus_sdk.diagnostics` and `nimbus_sdk.connector_kit` define nothing — they are pure re-export barrels, so the resolver never asks them. But `nimbus_sdk/__init__.py` defines `__version__` itself, inside the try/except that falls back to `"0.0.0+unknown"` for an uninstalled source tree, and `__version__` is in its `__all__`. Add:

```python
__stability__ = "stable"
```

`stable` rather than `frozen`: no spec or corpus pins the package version string. That makes it **17 tagged modules**, not 16.

- [ ] **Step 2: Add the tier to `Export` and `collect`**

In the `Export` dataclass (line 55):

```python
    name: str
    kind: Kind
    obj: object
    stability: str
```

In `collect` (line 95), resolve once per call rather than per name:

```python
    defining = defining_modules()
    exports = [
        Export(
            name=name,
            kind=_classify(getattr(module, name)),
            obj=getattr(module, name),
            stability=stability_of(name, defining),
        )
        for name in names
    ]
```

- [ ] **Step 3: Render it**

`render_export` (line 262) emits a bullet per name. Append the tier to that bullet in a form that survives the existing renderer — check the current output shape first with `sed -n 36,45p docs/api-surface-python.md`, then match it:

```
- `CONTRACT_VERSIONS: tuple[str, ...]` — **frozen**
```

- [ ] **Step 4: Run the tests**

Run: `cd sdks/python && python -m pytest tests/test_stability.py -q`
Expected: all 7 PASS now.

- [ ] **Step 5: Regenerate and check the whole suite**

Run: `cd sdks/python && python -m pip install -e . && python scripts/api_surface.py && python -m pytest -q && python -m mypy && python -m ruff check . && python -m ruff format --check .`
Expected: all green. `tests/test_api_surface.py` compares the regenerated golden to the committed one.

- [ ] **Step 6: Commit**

```bash
git add sdks/python/src sdks/python/scripts/api_surface.py docs/api-surface-python.md
git commit -m "feat(python): declare a stability tier for every published module"
```

---

## Task 7: Go package doc scanning

**Files:**
- Modify: `sdks/go/internal/apisurface/surface.go`
- Create: `sdks/go/internal/apisurface/stability_test.go`

**Interfaces:**
- Consumes: the existing file walker in `surface.go`.
- Produces:
  ```go
  func PackageStability(files []*ast.File) (string, error)
  func DeclStability(doc *ast.CommentGroup) string
  ```

- [ ] **Step 1: Read the current walker**

Run: `sed -n 1,80p sdks/go/internal/apisurface/surface.go`

Note how it obtains its `[]*ast.File` — `PackageStability` must take the same collection, and it must exclude `_test.go` files.

- [ ] **Step 2: Write the failing test**

Create `sdks/go/internal/apisurface/stability_test.go`:

```go
package apisurface

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

func parse(t *testing.T, sources ...string) []*ast.File {
	t.Helper()
	fset := token.NewFileSet()
	files := make([]*ast.File, 0, len(sources))
	for i, src := range sources {
		f, err := parser.ParseFile(fset, "f"+string(rune('a'+i))+".go", src, parser.ParseComments)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		files = append(files, f)
	}
	return files
}

// connectorkit and diagnostics carry the package doc in doc.go; contract, ipc and
// spec put it atop an ordinary source file. The walker must find both.
func TestPackageStabilityFromAnyFile(t *testing.T) {
	files := parse(t,
		"package k\n\nfunc A() {}\n",
		"// Package k does things.\n//\n// Stability: experimental\npackage k\n",
	)
	got, err := PackageStability(files)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "experimental" {
		t.Fatalf("got %q, want experimental", got)
	}
}

func TestPackageStabilityRejectsTwoDeclarations(t *testing.T) {
	files := parse(t,
		"// Stability: stable\npackage k\n",
		"// Stability: frozen\npackage k\n",
	)
	if _, err := PackageStability(files); err == nil {
		t.Fatal("want an error when two files declare a tier, got nil")
	}
}

func TestPackageStabilityRejectsUnknownTier(t *testing.T) {
	if _, err := PackageStability(parse(t, "// Stability: sortof\npackage k\n")); err == nil {
		t.Fatal("want an error for an unknown tier, got nil")
	}
}

func TestPackageStabilityRequiresATier(t *testing.T) {
	if _, err := PackageStability(parse(t, "package k\n")); err == nil {
		t.Fatal("want an error when no file declares a tier, got nil")
	}
}

func TestDeclStabilityReadsAnOverride(t *testing.T) {
	files := parse(t, "package k\n\n// A does things.\n//\n// Stability: frozen\nfunc A() {}\n")
	decl, ok := files[0].Decls[0].(*ast.FuncDecl)
	if !ok {
		t.Fatal("expected a FuncDecl")
	}
	if got := DeclStability(decl.Doc); got != "frozen" {
		t.Fatalf("got %q, want frozen", got)
	}
}

// A CRLF checkout must not change the parsed tier. `strings.TrimSpace` in
// `stabilityIn` already strips the trailing \r — unicode.IsSpace includes it — so this
// test locks that in rather than driving a change. Without it, a later "simplification"
// to TrimPrefix-only would yield the tier "frozen\r", which fails the tiers lookup with
// a message that names a value the source does not appear to contain.
func TestPackageStabilityToleratesCRLF(t *testing.T) {
	got, err := PackageStability(parse(t, "// Package k does things.\r\n//\r\n// Stability: frozen\r\npackage k\r\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "frozen" {
		t.Fatalf("got %q, want frozen", got)
	}
}

func TestDeclStabilityIsEmptyWithoutATag(t *testing.T) {
	files := parse(t, "package k\n\n// A does things.\nfunc A() {}\n")
	decl := files[0].Decls[0].(*ast.FuncDecl)
	if got := DeclStability(decl.Doc); got != "" {
		t.Fatalf("got %q, want empty", got)
	}
}

var _ = strings.TrimSpace
```

- [ ] **Step 3: Run it to verify it fails**

Run: `go -C sdks/go test ./internal/apisurface/ -run TestPackageStability -v`
Expected: FAIL — `undefined: PackageStability`.

- [ ] **Step 4: Implement**

Add to `sdks/go/internal/apisurface/surface.go`:

```go
// tiers are the only valid stability values. There is no default.
var tiers = map[string]bool{"frozen": true, "stable": true, "experimental": true}

const stabilityPrefix = "Stability:"

// stabilityIn returns the tier named by a `Stability:` line in doc, or "".
func stabilityIn(doc *ast.CommentGroup) string {
	if doc == nil {
		return ""
	}
	for _, line := range strings.Split(doc.Text(), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, stabilityPrefix) {
			continue
		}
		return strings.TrimSpace(strings.TrimPrefix(line, stabilityPrefix))
	}
	return ""
}

// DeclStability is the per-declaration override, or "" when the declaration has none.
func DeclStability(doc *ast.CommentGroup) string { return stabilityIn(doc) }

// PackageStability is the tier declared by the package doc comment.
//
// A Go package is a directory, and its package doc may precede the `package` keyword in
// ANY file. This module is already inconsistent about where: connectorkit and
// diagnostics use a doc.go, while contract, ipc and spec put it atop an ordinary source
// file (version.go, hello.go, spec.go). So every file is scanned.
//
// Exactly one file may declare a tier. Two is an error rather than a first-match win:
// silently picking one of two disagreeing tiers is the failure this design exists to
// prevent.
func PackageStability(files []*ast.File) (string, error) {
	found, from := "", ""
	for _, f := range files {
		tier := stabilityIn(f.Doc)
		if tier == "" {
			continue
		}
		if !tiers[tier] {
			return "", fmt.Errorf("unknown stability tier %q in package %s", tier, f.Name.Name)
		}
		if found != "" {
			return "", fmt.Errorf("package %s declares a stability tier in two files (%s and %s)", f.Name.Name, from, f.Name.Name)
		}
		found, from = tier, f.Name.Name
	}
	if found == "" {
		return "", fmt.Errorf("package declares no `// Stability:` line in any file")
	}
	return found, nil
}
```

Confirm `fmt` and `strings` are imported in `surface.go`; add them if not.

- [ ] **Step 5: Run the tests**

Run: `go -C sdks/go test ./internal/apisurface/ -v`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add sdks/go/internal/apisurface/
git commit -m "feat(go): read stability tiers from package and declaration doc comments"
```

---

## Task 8: Tag the 5 Go packages and project the tier

**Files:**
- Modify: `sdks/go/contract/version.go`, `sdks/go/ipc/hello.go`, `sdks/go/spec/spec.go`, `sdks/go/connectorkit/doc.go`, `sdks/go/diagnostics/doc.go`
- Modify: `sdks/go/internal/apisurface/surface.go` (rendering), `sdks/go/internal/apisurface/cmd/main.go` if the walker's call site needs the file list
- Modify: `docs/api-surface-go.md`

**Interfaces:**
- Consumes: `PackageStability`, `DeclStability` from Task 7.
- Produces: a fully-tiered `docs/api-surface-go.md`.

- [ ] **Step 1: Declare the package tiers**

Append a `Stability:` line to the existing package doc comment in each. The line goes last in the comment, separated by a blank comment line:

```go
// Package contract binds docs/spec/negotiation/v1/contract-version.md to Go.
//
// ...existing text...
//
// Stability: frozen
package contract
```

- `frozen`: `contract/version.go`, `ipc/hello.go`, `diagnostics/doc.go`
- `stable`: `spec/spec.go`
- `experimental`: `connectorkit/doc.go`

- [ ] **Step 2: Add the two per-declaration overrides**

On `connectorkit.ResolveURLWithBase` — pinned by `url-resolution.md` and its corpus, in a package that is otherwise `experimental`:

```go
// Stability: frozen
```

On `contract.IsContractVersion` — an override *down* to `experimental` in a `frozen` package:

```go
// Stability: experimental
//
// Public only in Go: TypeScript's isContractVersion is module-private and Python's
// _is_contract_version is underscore-private. It is exported here because the hello
// parser lives in a different package (RFC-0012 D2) and Go's only visibility control
// is the capital letter — a packaging decision, not a contract commitment. Tiered
// experimental so it can be withdrawn without a major.
```

- [ ] **Step 3: Render the tier**

In `surface.go`, resolve `DeclStability(decl.Doc)` falling back to the package tier, and emit it on each declaration's bullet. Match the existing bullet format — check it first with `sed -n 20,30p docs/api-surface-go.md` — for example:

```
- `func RequireEnv(name string) (string, error)` — **experimental**
```

- [ ] **Step 4: Regenerate**

Run: `go -C sdks/go run ./internal/apisurface/cmd`

- [ ] **Step 5: Verify the two overrides landed**

Run: `grep -n "ResolveURLWithBase\|IsContractVersion" docs/api-surface-go.md`
Expected: `ResolveURLWithBase` marked **frozen**, `IsContractVersion` marked **experimental**.

- [ ] **Step 6: Run the full Go suite**

Run: `go -C sdks/go build ./... && go -C sdks/go vet ./... && NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...`
Run: `test -z "$(gofmt -l sdks/go)"`
Expected: all green. `internal/apisurface/cmd/golden_test.go` compares the regenerated file to the committed one.

- [ ] **Step 7: Commit**

```bash
git add sdks/go docs/api-surface-go.md
git commit -m "feat(go): declare a stability tier for every published package"
```

---

## Task 9: The pure rule table

**Files:**
- Create: `sdks/typescript/scripts/stability-rules.ts`
- Create: `sdks/typescript/scripts/stability-rules.test.ts`

**Interfaces:**
- Consumes: `ReleaseImpact` and the impact ordering from `sdks/typescript/scripts/conventional-commit.ts`.
- Produces:
  ```ts
  export type ChangeKind = "added" | "removed" | "signature" | "promoted" | "demoted";
  export type SurfaceChange = {
    name: string; kind: ChangeKind; tier: Tier;
    binding: "typescript" | "python" | "go"; wasDeprecated: boolean;
  };
  export type Requirement = { impact: ReleaseImpact; breaking: boolean; needsRfc: boolean; notices: string[] };
  export function parseSurface(markdown: string): Map<string, SurfaceEntry>;
  export function diffSurfaces(base: Map<string, SurfaceEntry>, head: Map<string, SurfaceEntry>, binding: SurfaceChange["binding"]): SurfaceChange[];
  export function requiredFor(changes: SurfaceChange[]): Requirement;
  ```

- [ ] **Step 1: Write the failing test**

Create `sdks/typescript/scripts/stability-rules.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { type SurfaceChange, requiredFor } from "./stability-rules.ts";

const change = (over: Partial<SurfaceChange>): SurfaceChange => ({
  name: "x",
  kind: "added",
  tier: "stable",
  binding: "typescript",
  wasDeprecated: false,
  ...over,
});

describe("requiredFor", () => {
  test("adding is a minor at every tier", () => {
    for (const tier of ["frozen", "stable", "experimental"] as const) {
      expect(requiredFor([change({ kind: "added", tier })]).impact).toBe("minor");
    }
  });

  test("breaking an experimental export is only a minor", () => {
    const r = requiredFor([change({ kind: "removed", tier: "experimental" })]);
    expect(r.impact).toBe("minor");
    expect(r.breaking).toBe(false);
  });

  test("breaking a stable export demands a breaking change", () => {
    const r = requiredFor([change({ kind: "signature", tier: "stable" })]);
    expect(r.impact).toBe("major");
    expect(r.breaking).toBe(true);
    expect(r.needsRfc).toBe(false);
  });

  test("any frozen surface change demands an RFC, additions included", () => {
    expect(requiredFor([change({ kind: "added", tier: "frozen" })]).needsRfc).toBe(true);
  });

  test("demoting a tier is breaking; promoting is not", () => {
    expect(requiredFor([change({ kind: "demoted", tier: "stable" })]).breaking).toBe(true);
    expect(requiredFor([change({ kind: "promoted", tier: "experimental" })]).breaking).toBe(false);
  });

  test("the requirement is the max across every change", () => {
    const r = requiredFor([
      change({ kind: "added", tier: "experimental" }),
      change({ kind: "removed", tier: "frozen", wasDeprecated: true }),
    ]);
    expect(r.impact).toBe("major");
    expect(r.needsRfc).toBe(true);
  });

  test("removing an unmarked stable TypeScript export is reported", () => {
    const r = requiredFor([change({ kind: "removed", tier: "stable", wasDeprecated: false })]);
    expect(r.notices.some((n) => /deprecation window/i.test(n))).toBe(true);
  });

  test("removing a stable Python export notices that the window is uncheckable", () => {
    const r = requiredFor([change({ kind: "removed", tier: "stable", binding: "python" })]);
    expect(r.notices.some((n) => /could not be checked/i.test(n))).toBe(true);
  });

  test("no changes means no requirement", () => {
    expect(requiredFor([]).impact).toBe("none");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sdks/typescript && bun test scripts/stability-rules.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `requiredFor`**

Create `sdks/typescript/scripts/stability-rules.ts`. The rule table from spec §3, as data rather than branches:

```ts
/**
 * The tier-driven rule table, and the surface diff it consumes.
 *
 * A FLOOR, never a certificate. A surface diff proves a declared bump is not too small.
 * It can never prove one is big enough: RFC-0014's U+FFFD fix was a genuinely breaking
 * behavioral change with zero signature change, invisible to all three golden files.
 */
import type { ReleaseImpact } from "./conventional-commit.ts";
import type { Tier } from "./api-surface.ts";

export type ChangeKind = "added" | "removed" | "signature" | "promoted" | "demoted";

export type SurfaceChange = {
  name: string;
  kind: ChangeKind;
  tier: Tier;
  binding: "typescript" | "python" | "go";
  /** Whether the export carried a deprecation marker in the BASE golden. */
  wasDeprecated: boolean;
};

export type Requirement = {
  impact: ReleaseImpact;
  breaking: boolean;
  needsRfc: boolean;
  notices: string[];
};

/** True when the change kind retracts something a consumer could depend on. */
const BREAKING_KINDS: ReadonlySet<ChangeKind> = new Set(["removed", "signature", "demoted"]);

const IMPACT_RANK: Record<ReleaseImpact, number> = { none: 0, patch: 1, minor: 2, major: 3 };

export function requiredFor(changes: SurfaceChange[]): Requirement {
  let impact: ReleaseImpact = "none";
  let breaking = false;
  let needsRfc = false;
  const notices: string[] = [];

  for (const change of changes) {
    // Every surface change is at least a minor: adding a public export is a `feat:`,
    // and nothing smaller than that can move the surface.
    if (IMPACT_RANK[impact] < IMPACT_RANK.minor) impact = "minor";

    if (change.tier === "frozen") needsRfc = true;

    const isBreaking = BREAKING_KINDS.has(change.kind) && change.tier !== "experimental";
    if (isBreaking) {
      breaking = true;
      impact = "major";
    }

    if (change.kind === "removed" && change.tier !== "experimental") {
      if (change.binding === "typescript") {
        if (!change.wasDeprecated) {
          notices.push(
            `${change.name}: removed from a ${change.tier} module with no deprecation ` +
              "marker in the base surface — the deprecation window was not opened.",
          );
        }
      } else {
        notices.push(
          `${change.name}: removed from a ${change.tier} ${change.binding} module. The ` +
            "deprecation window could not be checked — that surface records no markers. " +
            "A reviewer must confirm it manually.",
        );
      }
    }
  }

  return { impact, breaking, needsRfc, notices };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd sdks/typescript && bun test scripts/stability-rules.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/scripts/stability-rules.ts sdks/typescript/scripts/stability-rules.test.ts
git commit -m "feat(typescript): the tier-driven required-impact rule table"
```

---

## Task 10: Parse and diff the golden files

**Files:**
- Modify: `sdks/typescript/scripts/stability-rules.ts`
- Modify: `sdks/typescript/scripts/stability-rules.test.ts`

**Interfaces:**
- Consumes: `SurfaceChange` from Task 9.
- Produces: `parseSurface`, `diffSurfaces`, and `type SurfaceEntry = { tier: Tier; declaration: string; deprecated: boolean }`.

- [ ] **Step 1: Write the failing test**

Append to `stability-rules.test.ts`:

```ts
import { diffSurfaces, parseSurface } from "./stability-rules.ts";

const surface = (name: string, tier: string, decl: string, deprecated = false): string =>
  [
    `### \`${name}\``,
    "",
    ...(deprecated ? ["**Deprecated:** gone soon", ""] : []),
    `**Stability:** ${tier}`,
    "",
    "From `./m.js`.",
    "",
    "```ts",
    decl,
    "```",
    "",
  ].join("\n");

describe("parseSurface / diffSurfaces", () => {
  test("parses name, tier, declaration and deprecation", () => {
    const entry = parseSurface(surface("a", "stable", "declare const a: number;", true)).get("a");
    expect(entry?.tier).toBe("stable");
    expect(entry?.deprecated).toBe(true);
    expect(entry?.declaration).toContain("const a");
  });

  test("detects an addition", () => {
    const base = parseSurface("");
    const head = parseSurface(surface("a", "experimental", "declare const a: number;"));
    expect(diffSurfaces(base, head, "typescript")).toEqual([
      { name: "a", kind: "added", tier: "experimental", binding: "typescript", wasDeprecated: false },
    ]);
  });

  test("a removal carries the BASE tier and the BASE deprecation state", () => {
    const base = parseSurface(surface("a", "stable", "declare const a: number;", true));
    const [change] = diffSurfaces(base, parseSurface(""), "typescript");
    expect(change?.kind).toBe("removed");
    expect(change?.tier).toBe("stable");
    expect(change?.wasDeprecated).toBe(true);
  });

  test("detects a signature change", () => {
    const base = parseSurface(surface("a", "stable", "declare const a: number;"));
    const head = parseSurface(surface("a", "stable", "declare const a: string;"));
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("signature");
  });

  test("detects a demotion and a promotion", () => {
    const base = parseSurface(surface("a", "frozen", "declare const a: number;"));
    const head = parseSurface(surface("a", "stable", "declare const a: number;"));
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("demoted");
    expect(diffSurfaces(head, base, "typescript")[0]?.kind).toBe("promoted");
  });

  test("an unchanged export produces no change", () => {
    const only = surface("a", "stable", "declare const a: number;");
    expect(diffSurfaces(parseSurface(only), parseSurface(only), "typescript")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sdks/typescript && bun test scripts/stability-rules.test.ts`
Expected: FAIL — `parseSurface` is not exported.

- [ ] **Step 3: Implement**

Add to `stability-rules.ts`:

```ts
export type SurfaceEntry = { tier: Tier; declaration: string; deprecated: boolean };

const TIER_RANK: Record<Tier, number> = { experimental: 0, stable: 1, frozen: 2 };

const HEADING = /^### `([^`]+)`/;
const STABILITY_LINE = /^\*\*Stability:\*\* (frozen|stable|experimental)\b/;
const BULLET = /^- `(.+)` — \*\*(frozen|stable|experimental)\*\*\s*$/;

/**
 * Parse a generated surface golden into one entry per export.
 *
 * Two shapes, because the three generators produce two. TypeScript emits a
 * `### \`name\`` heading with a fenced declaration under it; Python and Go emit
 * `- \`decl\` — **tier**` bullets.
 *
 * THE KEY DIFFERS BY SHAPE, DELIBERATELY. Headings key by name. Bullets key by the
 * whole declaration text, because a Go bullet's name is not unique: `func (e *Error)
 * Error() string` and `func (e *HTTPStatusError) Error() string` are both `Error`, and
 * `connectorkit` publishes several such methods. The consequence is that a signature
 * change in Python or Go reads as a removal plus an addition rather than as a
 * `signature` change. That is coarser but never wrong in the dimension the rule table
 * cares about: `removed` and `signature` require the same impact at every tier, and the
 * added row is a minor that the max absorbs. It costs one extra `::notice::` on such a
 * change, which is noise, not a false gate.
 */
export function parseSurface(markdown: string): Map<string, SurfaceEntry> {
  const entries = new Map<string, SurfaceEntry>();
  const lines = markdown.split("\n");

  let name: string | null = null;
  let tier: Tier | null = null;
  let deprecated = false;
  let declaration = "";
  let inFence = false;

  const flush = (): void => {
    if (name !== null && tier !== null) {
      entries.set(name, { tier, declaration: declaration.trim(), deprecated });
    }
    name = null;
    tier = null;
    deprecated = false;
    declaration = "";
  };

  for (const line of lines) {
    const bullet = BULLET.exec(line);
    if (bullet !== null && !inFence) {
      const decl = bullet[1] ?? "";
      entries.set(decl, { tier: bullet[2] as Tier, declaration: decl, deprecated: false });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      name = heading[1] ?? null;
      continue;
    }

    if (line.startsWith("**Deprecated")) {
      deprecated = true;
      continue;
    }

    const stability = STABILITY_LINE.exec(line);
    if (stability !== null) {
      tier = stability[1] as Tier;
      continue;
    }

    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) declaration += `${line}\n`;
  }

  flush();
  return entries;
}

export function diffSurfaces(
  base: Map<string, SurfaceEntry>,
  head: Map<string, SurfaceEntry>,
  binding: SurfaceChange["binding"],
): SurfaceChange[] {
  const changes: SurfaceChange[] = [];

  for (const [name, headEntry] of head) {
    const baseEntry = base.get(name);
    if (baseEntry === undefined) {
      changes.push({ name, kind: "added", tier: headEntry.tier, binding, wasDeprecated: false });
      continue;
    }
    if (baseEntry.tier !== headEntry.tier) {
      const kind = TIER_RANK[headEntry.tier] < TIER_RANK[baseEntry.tier] ? "demoted" : "promoted";
      // A demotion is judged at the tier being LEFT — the promise being retracted.
      changes.push({ name, kind, tier: baseEntry.tier, binding, wasDeprecated: baseEntry.deprecated });
    }
    if (baseEntry.declaration !== headEntry.declaration) {
      changes.push({ name, kind: "signature", tier: baseEntry.tier, binding, wasDeprecated: baseEntry.deprecated });
    }
  }

  for (const [name, baseEntry] of base) {
    if (!head.has(name)) {
      changes.push({ name, kind: "removed", tier: baseEntry.tier, binding, wasDeprecated: baseEntry.deprecated });
    }
  }

  return changes;
}
```

Write `parseSurface` to handle both golden shapes. Confirm the exact Python and Go bullet formats produced in Tasks 6 and 8 before writing the parser — they are what it must read.

- [ ] **Step 4: Run the tests**

Run: `cd sdks/typescript && bun test scripts/stability-rules.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/scripts/stability-rules.ts sdks/typescript/scripts/stability-rules.test.ts
git commit -m "feat(typescript): classify surface-golden diffs into tiered changes"
```

---

## Task 11: Wire the second rule into the guard

**Files:**
- Modify: `sdks/typescript/scripts/conventional-commit-guard.ts`

**Interfaces:**
- Consumes: `requiredFor`, `diffSurfaces`, `parseSurface` from Tasks 9–10; the guard's existing `checkAggregate` and its exit codes (`0` pass/not-applicable, `1` rule failed, `2` could not run).
- Produces: no new exports — this is the CI entry point.

- [ ] **Step 1: Read the guard end to end**

Run: `cat sdks/typescript/scripts/conventional-commit-guard.ts`

Note where it reads the event payload, where it decides "not applicable", and how it prints. The new rule must follow the same shape: everything decidable stays in the pure modules, this file only does I/O and exit codes.

- [ ] **Step 2: Fetch the base revision of the three goldens**

`actions/checkout` on a `pull_request` event resolves `refs/pull/N/merge` at depth 1, so the base commit is not present. Add to `conventional-commit-guard.ts`:

```ts
import { existsSync, readdirSync } from "node:fs";
import { diffSurfaces, parseSurface, requiredFor, type SurfaceChange } from "./stability-rules.ts";

const GOLDENS = [
  { path: "docs/api-surface.md", binding: "typescript" },
  { path: "docs/api-surface-python.md", binding: "python" },
  { path: "docs/api-surface-go.md", binding: "go" },
] as const;

/** The golden at `revision`, or "" when it did not exist there. */
async function goldenAt(revision: string, path: string): Promise<string> {
  const shown = Bun.spawnSync(["git", "show", `${revision}:${path}`]);
  // A file absent at the base is not an error: the first shipment to add a golden
  // must read as an all-additions diff, not as a failure to run.
  return shown.exitCode === 0 ? shown.stdout.toString() : "";
}

/**
 * Make `baseSha`'s tree readable, fetching only if it is not already present.
 *
 * The test is `^{tree}`, NOT `git cat-file -t <sha>`. On the `--depth=1` merge-ref
 * checkout CI uses, the base commit exists as a shallow boundary — `cat-file -t`
 * happily answers "commit" — while its tree does not, so `git show <sha>:path` still
 * fails and every golden would read as empty. Every export in the repository would then
 * look newly added. Resolving the tree is what actually proves the read will work.
 */
function ensureBaseTree(baseSha: string): void {
  if (Bun.spawnSync(["git", "cat-file", "-e", `${baseSha}^{tree}`]).exitCode === 0) return;

  const fetched = Bun.spawnSync(["git", "fetch", "--depth=1", "origin", baseSha]);
  if (fetched.exitCode !== 0) {
    throw new Error(
      `could not fetch base ${baseSha}: ${fetched.stderr.toString()}\n` +
        "Running locally against a fork or a remote not named `origin`? Fetch the base " +
        "commit yourself first, then re-run — this guard will then skip the fetch.",
    );
  }
}

async function surfaceChanges(baseSha: string): Promise<SurfaceChange[]> {
  ensureBaseTree(baseSha);
  const changes: SurfaceChange[] = [];
  for (const golden of GOLDENS) {
    const base = parseSurface(await goldenAt(baseSha, golden.path));
    const head = parseSurface(existsSync(golden.path) ? await Bun.file(golden.path).text() : "");
    changes.push(...diffSurfaces(base, head, golden.binding));
  }
  return changes;
}
```

The base SHA comes from the workflow as `GITHUB_BASE_SHA` (wired in Task 12) — read it with `process.env.GITHUB_BASE_SHA`. When it is unset the guard is running outside a pull request: return `[]` and skip the rule, matching how the existing rule handles non-PR events by exiting 0 from the inside rather than being `if:`-skipped.

- [ ] **Step 3: Check the RFC citation against the workspace**

A plain filesystem glob, **not** a `git show`. The merge ref is base ⊕ head, so an RFC that landed earlier is present via the base and one added by this pull request via the head — both cases pass with no extra fetch.

```ts
/** True when `body` cites an RFC whose file exists in the workspace. */
function citesAnExistingRfc(body: string): boolean {
  const cited = [...body.matchAll(/RFC-(\d{4})/g)].map((match) => match[1] ?? "");
  if (cited.length === 0) return false;
  const present = readdirSync("docs/rfcs");
  return cited.some((number) => present.some((file) => file.startsWith(`${number}-`)));
}
```

- [ ] **Step 4: Compose and compare**

```ts
const changes = await surfaceChanges(baseSha);
const required = requiredFor(changes);

for (const notice of required.notices) out(`::notice::${notice}\n`);

const failures: string[] = [];
if (IMPACT_RANK[declared] < IMPACT_RANK[required.impact]) {
  failures.push(
    `the surface diff requires at least "${required.impact}" but the subject declares ` +
      `"${declared}". Changed: ${changes.map((c) => `${c.name} (${c.kind}, ${c.tier})`).join(", ")}`,
  );
}
if (required.breaking && !declaredBreaking) {
  failures.push("a stable or frozen export was removed, changed or demoted — the subject needs `!`");
}
if (required.needsRfc && !citesAnExistingRfc(prBody)) {
  failures.push("a frozen module's surface changed — the PR body must cite an RFC-NNNN that exists under docs/rfcs/");
}

for (const failure of failures) out(`::error::${failure}\n`);
```

Take the `max` of this requirement and the existing carried-commits requirement rather than replacing it — both rules stand, and `checkAggregate`'s result is unchanged. `declared` and `declaredBreaking` come from parsing the PR title with the existing `parseSubject`; confirm its exact export name with `grep -n "^export function" sdks/typescript/scripts/conventional-commit.ts` before wiring, and reuse the existing `IMPACT_ORDER` rather than declaring a second rank map.

- [ ] **Step 5: Verify against real history**

The guard already supports `--pr N` locally. Run it against a merged pull request that changed the surface:

```bash
GITHUB_REPOSITORY=nimbus-agent/nimbus-sdk GH_TOKEN=$(gh auth token) \
  bun run sdks/typescript/scripts/conventional-commit-guard.ts --pr 171
```

Expected: it reports a requirement consistent with what that pull request actually declared. If it demands *more* than a merged PR declared, do not "fix" it by weakening the table — check whether the PR genuinely under-declared, which is the outcome this gate exists to find.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/scripts/conventional-commit-guard.ts
git commit -m "feat(typescript): require a bump matching the tier of every surface change"
```

---

## Task 12: Move the guard to its own workflow

**Files:**
- Create: `.github/workflows/commit-subject.yml`
- Modify: `.github/workflows/ci.yml` — remove the `commit-guard` job and its entry in `ci-complete`'s `needs` and error message

**Interfaces:**
- Consumes: the guard from Task 11.
- Produces: a status check named `commit-subject`, to be marked required in branch protection.

- [ ] **Step 1: Create the workflow**

Copy the `commit-guard` job body out of `ci.yml` verbatim — harden-runner block, checkout, Setup Bun, the guard step, and its `GITHUB_TOKEN` env. Keep the "No `bun install`" comment; it is still true. The trigger is the only change:

```yaml
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, edited]
```

`edited` is the point of the split: a squash merge makes the pull request title the commit subject, so a title edited after a green run must re-check. `ci.yml` carries no `types:` key and so uses the default set, which excludes `edited`.

Add `GITHUB_BASE_SHA: ${{ github.event.pull_request.base.sha }}` to the guard step's `env`, and give the job `contents: read`.

- [ ] **Step 2: Remove the job from `ci.yml`**

Delete the `commit-guard` job, remove `commit-guard` from `ci-complete`'s `needs` array, and remove `commit-guard=${{ needs.commit-guard.result }}` from its error message. Leaving it in either place fails the workflow with an unresolved dependency.

- [ ] **Step 3: Verify the workflows parse**

Run: `python -c "import yaml,sys;[yaml.safe_load(open(p)) for p in ('.github/workflows/ci.yml','.github/workflows/commit-subject.yml')];print('ok')"`
Expected: `ok`.

- [ ] **Step 4: Check the release-workflow guard still passes**

`sdks/typescript/scripts/release-workflow-guard.test.ts` reads workflow files. Confirm it does not assert on the `commit-guard` job:

Run: `cd sdks/typescript && bun test scripts/release-workflow-guard.test.ts`
Expected: PASS. If it fails, update its expectations to match the new layout.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/commit-subject.yml .github/workflows/ci.yml
git commit -m "ci: run the commit-subject guard in its own workflow, including on edits"
```

- [ ] **Step 6: DEPLOYMENT STEP — mark the check required**

**This shipment is not done when the pull request merges.** In repository settings → branch protection for `main`, add `commit-subject` to the required status checks. `ci-complete` stays required. Until this is done the check reports but blocks nothing.

---

## Task 13: Trailing documentation

**Files:**
- Modify: `docs/ROADMAP.md`, `docs/DEPRECATION-POLICY.md`, `docs/INCLUSION-POLICY.md`, `CLAUDE.md`

- [ ] **Step 1: Tick the ROADMAP box**

In Phase 3, change the tiered-stability box to `[x]` and record what shipped, in the style the Go provenance box uses for a correction: the box asks to separate helpers from the frozen core, which is a *per-export* property, while the exit criterion says "each SDK's stability tier", which reads as a *per-binding* one. State that Phase 3 delivers the per-export tier axis enforced per binding, and that Phase 4's matrix crosses it with language. Note the gate is a floor, not a certificate.

- [ ] **Step 2: Amend `DEPRECATION-POLICY.md`**

Add two sections: **tier and deprecation are orthogonal** (`audit-logger` is `stable` and `@deprecated` at once), and **`experimental` exports are exempt from the window** — they may be removed under `feat:` with no marker. State that the window half-check is TypeScript-only and why.

- [ ] **Step 3: Amend `INCLUSION-POLICY.md`**

Add: a newly admitted battery enters at `experimental`. Today a battery is effectively frozen the moment it ships because no other tier exists, and part of why "the default answer is no" is that admission is irreversible. This makes it less so.

- [ ] **Step 4: Update `CLAUDE.md`**

Document the three declaration mechanisms under the existing surface-gate sections, and add `commit-subject.yml` to the CI description. Note that the four TypeScript CI gates are now five checks across two workflows.

- [ ] **Step 5: Commit**

```bash
git add docs/ROADMAP.md docs/DEPRECATION-POLICY.md docs/INCLUSION-POLICY.md CLAUDE.md
git commit -m "docs: record tiered stability in the roadmap and the two policies"
```

---

## Verification

Before opening any pull request, reproduce CI honestly. This worktree resolves `node_modules` from the parent checkout, so a green run here does not prove a green run in CI.

```bash
git clone --branch <branch> . <tmpdir>
cd <tmpdir> && bun install --frozen-lockfile
bun run build
bun run --cwd tools/create-connector build
bun run test
cd sdks/python && python -m pip install -e . && python -m pytest -q && python -m mypy
cd ../.. && NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
```

Build before testing — `api-surface`, `smoke-calls` and `pack-and-generate` execute the built package, not the source tree, and fail on a missing `dist/` for the wrong reason.
