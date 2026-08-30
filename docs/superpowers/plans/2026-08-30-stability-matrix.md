# Cross-Language Stability / Support Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `docs/stability-matrix.md` — a generated page crossing each capability with each language binding, showing the resolved stability tier per cell — and gate it so a gap or a stale tier cannot hide.

**Architecture:** The 18 existing `docs/modules/*.md` pages become the capability rows; their `<!-- covers: -->` markers gain `py:` and `go:` claims. The claim unit is the **defining source file**, which TypeScript's golden already records and Python's and Go's must learn to record. The tier is read from the three goldens at generation time and never copied into the claim comment, so a stale cell is unrepresentable rather than merely detected.

**Tech Stack:** TypeScript (Bun test), Python 3.11+ (pytest, ruff, mypy strict), Go 1.26 (stdlib `testing`), all dependency-free.

**Spec:** [`docs/superpowers/specs/2026-08-30-stability-matrix-design.md`](../specs/2026-08-30-stability-matrix-design.md) — read it alongside this plan; every task argues from a numbered section of it.

## Global Constraints

- **Dependency-free at runtime in all three bindings.** No `dependencies` in `package.json`, `[project].dependencies` stays empty, `sdks/go/go.mod` keeps zero `require` lines. Inline any helper you need.
- **No `any`; TypeScript strict.** Use `unknown` at boundaries and narrow with a type guard. Biome enforces `noExplicitAny` and `noConsole` in `sdks/typescript/src/` (scripts and tests may log).
- **Python is `mypy --strict` and `ruff` clean.** Run `python -m ruff check . && python -m ruff format --check .` and `python -m mypy` from `sdks/python/`.
- **Go is `gofmt` clean and `go vet` clean.** `gofmt -l` alone exits 0 even when it lists files — always use `test -z "$(gofmt -l sdks/go)"`.
- **Claim key grammar (spec §4):** the defining file's path relative to its binding's source root, extension stripped, `/` separated. TypeScript root `sdks/typescript/src/`, Python root `sdks/python/src/nimbus_sdk/`, Go root `sdks/go/`. Never a dotted import path, never repo-relative.
- **Golden bullet format (spec §5.1):** `` - `decl` — **tier** — from `claim/key` `` . The annotation goes **after** the tier and the path is backtick-delimited.
- **Commit types (spec Shipments):** Tasks 1–3 are `docs:` or `chore:` and MUST NOT use a releasing type — `feat:`/`fix:` would cut a `nimbus-dev-sdk` or `sdks/go` release for a rendering change, and a published Go tag cannot be withdrawn.
- **End every commit message with:**
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011VGtoSyAtRkqA3RWsfUjTu
  ```
- **Build before testing.** `bun run build` from the repo root before any `bun test` — `api-surface`, `docs-coverage` and `smoke-calls` execute the built `dist/`, not the source tree.
- **Python reads a bundled spec copy.** After editing anything under `docs/spec/`, run `python -m pip install -e .` from `sdks/python/` before `pytest`. No task here edits `docs/spec/`, so this should not arise — but if a test reads spec data unexpectedly, this is why.

---

### Task 1: Widen the guard's bullet pattern to tolerate a source annotation

Lands first and alone. Tasks 2 and 3 regenerate goldens in the new format; if this pattern has not already widened, `commit-guard` parses zero entries from those goldens and silently passes everything.

**Files:**
- Modify: `sdks/typescript/scripts/stability-rules.ts` — the `BULLET` constant
- Test: `sdks/typescript/scripts/stability-rules.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `parseSurface(markdown: string): Map<string, SurfaceEntry>` unchanged in signature, now accepting bullets of the form ``- `decl` — **tier** — from `key` ``. `SurfaceEntry` stays `{ tier, declaration, deprecated, name }`. Tasks 2, 3 and 5 depend on this tolerance.

- [ ] **Step 1: Write the failing test**

Add to `sdks/typescript/scripts/stability-rules.test.ts`:

```ts
describe("source annotations on bullets", () => {
  const withoutSource = "## `ipc`\n\n- `func ParseHello(s string) HelloResult` — **frozen**\n";
  const withSource =
    "## `ipc`\n\n- `func ParseHello(s string) HelloResult` — **frozen** — from `ipc/hello`\n";

  test("an annotation after the tier leaves the key and the entry identical", () => {
    const before = parseSurface(withoutSource);
    const after = parseSurface(withSource);

    expect([...after.keys()]).toEqual([...before.keys()]);
    expect([...after.keys()]).toEqual(["ipc::func ParseHello(s string) HelloResult"]);
    expect(after.get("ipc::func ParseHello(s string) HelloResult")).toEqual(
      before.get("ipc::func ParseHello(s string) HelloResult") as SurfaceEntry,
    );
  });

  test("adding the annotation to a whole golden produces no SurfaceChange", () => {
    expect(diffSurfaces(parseSurface(withoutSource), parseSurface(withSource), "go")).toEqual([]);
  });

  test("a doubled-backtick span (a Go struct tag) still parses with an annotation", () => {
    const entries = parseSurface(
      "## `connectorkit`\n\n- ``type T struct { X string `json:\"x\"` }`` — **experimental** — from `connectorkit/types`\n",
    );
    expect(entries.size).toBe(1);
    expect([...entries.values()][0]?.tier).toBe("experimental");
  });
});
```

Ensure `SurfaceEntry` and `diffSurfaces` are in the file's import list from `./stability-rules.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/stability-rules.test.ts` from `sdks/typescript/`
Expected: FAIL. The annotated bullets parse to an empty map, so `after.keys()` is `[]` while `before.keys()` has one entry.

- [ ] **Step 3: Write minimal implementation**

In `sdks/typescript/scripts/stability-rules.ts`, replace the `BULLET` constant:

```ts
// The optional trailing ` — from \`key\`` is the defining file the Python and Go
// generators record (RFC/design §5.1). It is a NON-capturing group on purpose: group 1
// is this map's key and `declaration` is what `diffSurfaces` compares for a signature
// change, so anything that reached either would turn a pure rendering change into 294
// removals plus 294 additions. Placing it before the tier, or omitting the group while
// the goldens carry the suffix, are the two ways to get this wrong — the first captures
// it into the key, the second breaks the end anchor and drops every entry.
const BULLET =
  /^- `(.+)` — \*\*(frozen|stable|experimental)\*\*(?: — from `[^`]+`)?\s*$/;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/stability-rules.test.ts` from `sdks/typescript/`
Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 5: Verify nothing else regressed**

Run from the repo root: `bun run build && bun run test`
Expected: PASS. The goldens are still in the old format and must still parse — that is what the non-capturing `?` guarantees.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/scripts/stability-rules.ts sdks/typescript/scripts/stability-rules.test.ts
git commit -m "chore(guard): tolerate a defining-file annotation on surface bullets"
```

---

### Task 2: Python records the defining file in its golden

**Files:**
- Modify: `sdks/python/scripts/api_surface.py` — `Export`, `defining_modules`, `stability_of`, `collect`, `render_export`
- Modify: `docs/api-surface-python.md` (regenerated, never hand-edited)
- Test: `sdks/python/tests/test_api_surface.py`

**Interfaces:**
- Consumes: Task 1's widened `BULLET`.
- Produces: every export bullet in `docs/api-surface-python.md` ends `` — **tier** — from `key` `` where `key` is Python-source-root-relative (`ipc/hello`, `connector_kit/urls`, `__init__`). Task 5 parses these keys.

- [ ] **Step 1: Write the failing test**

Add to `sdks/python/tests/test_api_surface.py`:

```python
import re

#: Every export bullet, after this change, carries its defining file. Anchored at both
#: ends so a missing or malformed annotation fails rather than partially matching.
_EXPORT_BULLET = re.compile(
    r"^- `.+` — \*\*(?:frozen|stable|experimental)\*\* — from `[^`]+`$"
)


def test_every_export_records_a_defining_file() -> None:
    for root in IMPORT_ROOTS:
        exports = collect(root)
        assert exports, root
        for export in exports:
            assert export.claim_key, f"{root}.{export.name} has no claim key"
            assert not export.claim_key.endswith(".py"), export.claim_key
            assert not export.claim_key.startswith("nimbus_sdk"), export.claim_key


def test_every_rendered_export_bullet_carries_its_defining_file() -> None:
    # Top-level export bullets only: a class member renders indented, and the
    # preamble's prose bullets start `- **`, so neither matches `- \``.
    bullets = [line for line in render().splitlines() if line.startswith("- `")]
    assert bullets, "no export bullets rendered — this guard would pass vacuously"
    for line in bullets:
        assert _EXPORT_BULLET.match(line), line
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_api_surface.py -q` from `sdks/python/`
Expected: FAIL with `AttributeError: 'Export' object has no attribute 'claim_key'`.

- [ ] **Step 3: Write minimal implementation**

In `sdks/python/scripts/api_surface.py`:

Add `NamedTuple` to the `typing` import, then add above `defining_modules`:

```python
class Defining(NamedTuple):
    """Where a published name is defined.

    ``module`` is the dotted path the tier resolver imports to read ``__stability__``.
    ``claim_key`` is the same file spelled the way a documentation page claims it —
    source-root-relative, extension stripped. Both come from one walk because they are
    two readings of the same file, and re-walking to get the second invites them to
    disagree.
    """

    module: str
    claim_key: str


def _claim_key(path: Path) -> str:
    """`src/nimbus_sdk/ipc/hello.py` -> `ipc/hello`; the root barrel -> `__init__`.

    Derived from the path rather than from ``_dotted``, which collapses a package's
    ``__init__.py`` onto the package name and so cannot distinguish ``ipc/__init__.py``
    from a hypothetical ``ipc.py``.
    """
    return path.relative_to(_SRC).with_suffix("").as_posix()
```

Change the two write sites in `defining_modules` — the collision check compares the module, and the stored value gains the key:

```python
                previous = found.get(name)
                if previous is not None and previous.module != module:
                    raise RuntimeError(
                        f'"{name}" is defined in both {previous.module} and {module}.\n'
```

```python
                found[name] = Defining(module=module, claim_key=_claim_key(path))
```

and its signature and annotation:

```python
def defining_modules() -> dict[str, Defining]:
```
```python
    found: dict[str, Defining] = {}
```

Update `stability_of` to take the same map and read `.module`:

```python
def stability_of(name: str, defining: dict[str, Defining]) -> str:
    """The tier for ``name``: its defining module's default, or that module's
    override."""
    entry = defining.get(name)
    if entry is None:
        raise RuntimeError(
            f'"{name}" has no defining module under src/nimbus_sdk/.\n'
            "Fix: check for a typo in the name, or add a module-level "
            f"definition for `{name}` under src/nimbus_sdk/, then re-run "
            "`python scripts/api_surface.py`.\n"
            "See docs/rfcs/0015-tiered-stability.md."
        )
    module_path = entry.module
```

Keep the remainder of `stability_of`'s body unchanged from `module_path` onward.

Add the field to `Export`:

```python
class Export:
    """One name from a root's ``__all__``."""

    name: str
    kind: Kind
    obj: object
    stability: str
    claim_key: str
```

Populate it in `collect`:

```python
    exports = [
        Export(
            name=name,
            kind=_classify(getattr(module, name)),
            obj=getattr(module, name),
            stability=stability_of(name, defining),
            claim_key=defining[name].claim_key,
        )
        for name in names
    ]
```

Append it in `render_export`, replacing the single tier line:

```python
    lines[0] = f"{lines[0]} — **{export.stability}** — from `{export.claim_key}`"
```

and extend that function's docstring after the existing sentence about the tier shape:

```python
    The defining file follows the tier, in the same hard-contract shape: `` — from
    `key` ``, backtick-delimited so the guard's pattern can terminate it. It must not
    precede the tier — the guard keys a bullet by the declaration text, so anything
    inserted before the tier changes every key.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_api_surface.py -q` from `sdks/python/`
Expected: PASS.

- [ ] **Step 5: Regenerate the golden**

Run from `sdks/python/`:
```bash
python -m pip install -e .
python scripts/api_surface.py
```
Expected: `docs/api-surface-python.md` now shows every export bullet ending `` — from `…` ``. Confirm the diff is **only** the appended suffix — no reordering, no changed declarations:

```bash
git diff --stat docs/api-surface-python.md
git diff docs/api-surface-python.md | grep '^-' | grep -v '^---' | head -5
```
Expected: 119 changed lines; each removed line is the same text as its replacement minus the suffix.

- [ ] **Step 6: Prove the rendering change produces no surface change**

This is the property the whole shipment exists to establish. Run from `sdks/typescript/`:

```bash
bun run --cwd ../.. build
bun test scripts/stability-rules.test.ts
```

Then verify directly against the real goldens with a throwaway script (do not commit it):

```bash
git show HEAD:docs/api-surface-python.md > /tmp/base-python.md
bun -e '
import { parseSurface, diffSurfaces } from "./scripts/stability-rules.ts";
import { readFileSync } from "node:fs";
const base = parseSurface(readFileSync("/tmp/base-python.md", "utf8"));
const head = parseSurface(readFileSync("../../docs/api-surface-python.md", "utf8"));
const changes = diffSurfaces(base, head, "python");
console.log(base.size, head.size, JSON.stringify(changes));
'
```
Expected: identical non-zero sizes and `[]` for the changes. A non-empty array means the annotation reached the key or the declaration — re-read spec §5.1 before proceeding.

- [ ] **Step 7: Run the full Python gates**

Run from `sdks/python/`:
```bash
python -m ruff check . && python -m ruff format --check .
python -m mypy
python -m pytest -q
```
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add sdks/python/scripts/api_surface.py sdks/python/tests/test_api_surface.py docs/api-surface-python.md
git commit -m "docs(python): record each export's defining file in the surface golden"
```

Use `docs:` — not `feat:`. A releasing type here cuts a `nimbus-dev-sdk` release for a rendering change.

---

### Task 3: Go records the defining file in its golden

**Files:**
- Modify: `sdks/go/internal/apisurface/surface.go` — `declEntry`, `RenderPackage`, plus a new `claimKey` helper
- Modify: `docs/api-surface-go.md` (regenerated)
- Test: `sdks/go/internal/apisurface/surface_test.go`

**Interfaces:**
- Consumes: Task 1's widened `BULLET`.
- Produces: every declaration bullet in `docs/api-surface-go.md` ends `` — **tier** — from `key` `` where `key` is module-root-relative (`ipc/hello`, `connectorkit/urls`). Exported helper for tests: `func ClaimKey(filename string) string`.

- [ ] **Step 1: Write the failing test**

Add to `sdks/go/internal/apisurface/surface_test.go`:

```go
func TestClaimKey(t *testing.T) {
	cases := []struct{ in, want string }{
		{"ipc/hello.go", "ipc/hello"},
		{"connectorkit/urls.go", "connectorkit/urls"},
		{filepath.FromSlash("ipc/hello.go"), "ipc/hello"},
	}
	for _, c := range cases {
		if got := ClaimKey(c.in); got != c.want {
			t.Errorf("ClaimKey(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestRenderPackageAnnotatesEveryBulletWithItsFile(t *testing.T) {
	out, err := RenderPackage("../../ipc")
	if err != nil {
		t.Fatalf("RenderPackage: %v", err)
	}

	bullets := 0
	for _, line := range strings.Split(out, "\n") {
		if !strings.HasPrefix(line, "- ") {
			continue
		}
		bullets++
		if !strings.Contains(line, " — from `ipc/") {
			t.Errorf("bullet carries no defining file: %s", line)
		}
	}
	if bullets == 0 {
		t.Fatal("no bullets rendered — this guard would pass vacuously")
	}
}
```

Ensure `path/filepath` and `strings` are imported in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `go -C sdks/go test ./internal/apisurface/ -run 'ClaimKey|AnnotatesEvery' -v`
Expected: FAIL — `undefined: ClaimKey`.

- [ ] **Step 3: Write minimal implementation**

In `sdks/go/internal/apisurface/surface.go`, add the field to `declEntry`:

```go
	file string
```

Add the helper (exported so a test can drive it with synthetic input rather than depending on the process's working directory):

```go
// ClaimKey is a parsed file's path with the .go suffix removed and separators
// normalised to slashes — `ipc/hello` for `ipc/hello.go`. It is the same key a
// documentation page claims, so a file is spelled one way in the golden and in the
// claim comment rather than two.
//
// The input is whatever path was handed to parser.ParseFile, which RenderPackage
// builds from its `dir` argument. The cmd runs from the module root and passes a
// package name, so the key comes out module-root-relative.
func ClaimKey(filename string) string {
	return strings.TrimSuffix(filepath.ToSlash(filename), ".go")
}
```

Set it in `RenderPackage`'s per-file loop:

```go
	var lines []declEntry
	for _, file := range files {
		entries, err := declarations(fset, file, pkgTier)
		if err != nil {
			return "", fmt.Errorf("apisurface: %s: %w", dir, err)
		}
		key := ClaimKey(fset.Position(file.Pos()).Filename)
		for i := range entries {
			entries[i].file = key
		}
		lines = append(lines, entries...)
	}
```

And render it, changing only the format string:

```go
	for _, e := range lines {
		fmt.Fprintf(&b, "- %s — **%s** — from `%s`\n", codeSpan(e.line), e.tier, e.file)
	}
```

Leave the `sort.Slice` on `e.line` untouched — ordering must not change, or the diff stops being annotation-only.

- [ ] **Step 4: Run test to verify it passes**

Run: `go -C sdks/go test ./internal/apisurface/ -v`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Regenerate the golden**

Run: `go -C sdks/go run ./internal/apisurface/cmd`

Confirm the diff is annotation-only:
```bash
git diff --stat docs/api-surface-go.md
```
Expected: 175 changed lines, no reordering.

- [ ] **Step 6: Prove the rendering change produces no surface change**

Run from `sdks/typescript/`:
```bash
git show HEAD:docs/api-surface-go.md > /tmp/base-go.md
bun -e '
import { parseSurface, diffSurfaces } from "./scripts/stability-rules.ts";
import { readFileSync } from "node:fs";
const base = parseSurface(readFileSync("/tmp/base-go.md", "utf8"));
const head = parseSurface(readFileSync("../../docs/api-surface-go.md", "utf8"));
console.log(base.size, head.size, JSON.stringify(diffSurfaces(base, head, "go")));
'
```
Expected: identical non-zero sizes and `[]`.

- [ ] **Step 7: Run the full Go gates**

```bash
go -C sdks/go build ./...
go -C sdks/go vet ./...
test -z "$(gofmt -l sdks/go)"
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
```
Expected: all PASS. The golden test in `internal/apisurface/cmd/golden_test.go` passes because Step 5 regenerated the file it compares against.

- [ ] **Step 8: Commit**

```bash
git add sdks/go/internal/apisurface/surface.go sdks/go/internal/apisurface/surface_test.go docs/api-surface-go.md
git commit -m "docs(go): record each declaration's defining file in the surface golden"
```

Use `docs:`. A releasing type here cuts an `sdks/go` tag, and `proxy.golang.org` caches a version permanently.

---

### Task 4: Teach `parseCovers` the language-qualified grammar

**Files:**
- Modify: `sdks/typescript/scripts/docs-modules.ts` — `parseCovers` and its return type
- Modify: `sdks/typescript/scripts/docs-coverage.test.ts` — the one call site
- Test: `sdks/typescript/scripts/docs-modules.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure string work).
- Produces:
  ```ts
  export type Binding = "typescript" | "python" | "go";
  export type Claims = Record<Binding, readonly string[]>;
  export function parseCovers(pageText: string): Claims | null;
  ```
  Task 5 consumes `Claims`.

- [ ] **Step 1: Write the failing test**

Add to `sdks/typescript/scripts/docs-modules.test.ts`:

```ts
describe("language-qualified claims", () => {
  test("an unprefixed list is all TypeScript, unchanged from today", () => {
    const claims = parseCovers("<!-- covers: icalendar -->");
    expect(claims).toEqual({ typescript: ["icalendar"], python: [], go: [] });
  });

  test("a wrapped unprefixed list still parses", () => {
    const claims = parseCovers("<!-- covers: crypto/jwt,\n     crypto/canonical-json -->");
    expect(claims?.typescript).toEqual(["crypto/jwt", "crypto/canonical-json"]);
  });

  test("a prefix sets the active binding for itself and every later token", () => {
    const claims = parseCovers(
      "<!-- covers: contract-version, ipc/hello\n     py: contract, ipc/hello\n     go: contract/negotiate, contract/version -->",
    );
    expect(claims).toEqual({
      typescript: ["contract-version", "ipc/hello"],
      python: ["contract", "ipc/hello"],
      go: ["contract/negotiate", "contract/version"],
    });
  });

  test("a page may claim nothing in TypeScript", () => {
    const claims = parseCovers("<!-- covers: go: spec/spec -->");
    expect(claims).toEqual({ typescript: [], python: [], go: ["spec/spec"] });
  });

  test("a prefix with an empty remainder throws", () => {
    expect(() => parseCovers("<!-- covers: icalendar, py: -->")).toThrow(/empty/i);
  });

  test("a page with no comment is still null", () => {
    expect(parseCovers("# icalendar\n")).toBeNull();
  });

  test("two comments still throw", () => {
    expect(() => parseCovers("<!-- covers: a -->\n<!-- covers: b -->")).toThrow(/more than one/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/docs-modules.test.ts` from `sdks/typescript/`
Expected: FAIL — `parseCovers` returns `string[] | null`, so the object comparisons fail.

- [ ] **Step 3: Write minimal implementation**

In `sdks/typescript/scripts/docs-modules.ts`, add above `parseCovers`:

```ts
/** The three bindings a page may claim files in. */
export type Binding = "typescript" | "python" | "go";

/** A page's claims, partitioned by binding. Empty arrays are legitimate. */
export type Claims = Record<Binding, readonly string[]>;

/** The prefix token that switches the active binding, and the key it switches to. */
const BINDING_PREFIX = /^(py|go):\s*(.*)$/;
const BINDING_OF: Record<string, Binding> = { py: "python", go: "go" };
```

Replace `parseCovers`'s body from the `const body = …` line onward:

```ts
  const body = matches[0]?.[1] ?? "";

  // Comma-separated and trimmed, which is what lets a claim wrap across lines. Splitting
  // on whitespace as well was considered and rejected: module keys contain no spaces, so
  // it would appear to work while making a MISSING comma parse silently as two valid
  // claims. The comma is the only thing distinguishing a well-formed list from a typo.
  const tokens = body
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const claims: Record<Binding, string[]> = { typescript: [], python: [], go: [] };
  let active: Binding = "typescript";

  for (const token of tokens) {
    const prefixed = BINDING_PREFIX.exec(token);
    if (prefixed === null) {
      claims[active].push(token);
      continue;
    }
    const binding = BINDING_OF[prefixed[1] ?? ""];
    if (binding === undefined) {
      throw new Error(`unknown claim prefix "${prefixed[1]}:" — expected "py:" or "go:".`);
    }
    active = binding;
    const first = (prefixed[2] ?? "").trim();
    if (first.length === 0) {
      throw new Error(
        `page has an empty "${prefixed[1]}:" claim — a prefix that claims nothing cannot ` +
          "be checked. Name the files it documents, or drop the prefix.",
      );
    }
    claims[active].push(first);
  }

  if (claims.typescript.length === 0 && claims.python.length === 0 && claims.go.length === 0) {
    throw new Error(
      'page has an empty "covers:" list — a page that claims nothing cannot be checked. ' +
        "Name the modules it documents, or delete the page.",
    );
  }

  return claims;
```

Update the function's signature to `export function parseCovers(pageText: string): Claims | null` and its docstring to say the return is partitioned by binding, with empty arrays legitimate — a page may claim nothing in TypeScript (design §8).

- [ ] **Step 4: Update the existing call site**

In `sdks/typescript/scripts/docs-coverage.test.ts`, the call currently reads `parseCovers(readFromRoot(...))` and is used as a string array. Change it to read `.typescript` so this task compiles without changing the guard's behaviour yet:

```ts
      const claims = parseCovers(readFromRoot(`${MODULES_DIR}/${file}`));
      // Task 5 widens this guard to all three bindings; today it checks TypeScript only.
      const covers = claims === null ? null : claims.typescript;
```

Keep the rest of the existing assertions on `covers` unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run from `sdks/typescript/`:
```bash
bun run --cwd ../.. build
bun test scripts/docs-modules.test.ts scripts/docs-coverage.test.ts
bun run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/scripts/docs-modules.ts sdks/typescript/scripts/docs-modules.test.ts sdks/typescript/scripts/docs-coverage.test.ts
git commit -m "feat(docs): parse language-qualified claims in covers comments"
```

---

### Task 5: Claim every Python module and Go file, and extend the exhaustiveness gate

**Files:**
- Create: `sdks/typescript/scripts/surface-claims.ts` — extract claim keys from the Python and Go goldens
- Create: `sdks/typescript/scripts/surface-claims.test.ts`
- Modify: `sdks/typescript/scripts/docs-coverage.test.ts` — three bindings, reverse check, per-binding anti-vacuity
- Modify: all 18 files in `docs/modules/`

**Interfaces:**
- Consumes: Task 2's and Task 3's annotated goldens; Task 4's `Claims` type.
- Produces: `export function claimKeysIn(markdown: string): Set<string>` — every defining file recorded in a bullet-form golden.

- [ ] **Step 1: Write the failing test for the extractor**

Create `sdks/typescript/scripts/surface-claims.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { claimKeysIn } from "./surface-claims.ts";

describe("claimKeysIn", () => {
  test("collects each bullet's defining file, deduplicated", () => {
    const keys = claimKeysIn(
      [
        "## `ipc`",
        "",
        "- `func ParseHello(s string) HelloResult` — **frozen** — from `ipc/hello`",
        "- `func EncodeHello(v []string) string` — **frozen** — from `ipc/hello`",
        "- `type LineReader struct{}` — **frozen** — from `ipc/ndjson`",
        "",
      ].join("\n"),
    );
    expect([...keys].sort()).toEqual(["ipc/hello", "ipc/ndjson"]);
  });

  test("ignores indented sub-bullets, which belong to their parent's file", () => {
    const keys = claimKeysIn(
      "- `class HelloOk` — **frozen** — from `ipc/hello`\n  - `version: str`\n",
    );
    expect([...keys]).toEqual(["ipc/hello"]);
  });

  test("throws on a golden with no annotated bullets rather than returning empty", () => {
    expect(() => claimKeysIn("## `ipc`\n\n- `func F()` — **frozen**\n")).toThrow(/no defining/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/surface-claims.test.ts` from `sdks/typescript/`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the extractor**

Create `sdks/typescript/scripts/surface-claims.ts`:

```ts
/**
 * The defining files a bullet-form surface golden records.
 *
 * Python's and Go's goldens annotate each export with the file that defines it (design
 * §5.1). This reads those annotations back out, so the documentation gate can ask which
 * files a binding publishes without importing Python or Go tooling.
 *
 * Pure: it takes markdown text and returns keys. Reading the goldens off disk is the
 * caller's job, which keeps this drivable from synthetic input.
 */

/** A top-level export bullet carrying its defining file. Indented sub-bullets never match. */
const ANNOTATED = /^- .+ — \*\*(?:frozen|stable|experimental)\*\* — from `([^`]+)`\s*$/;

export function claimKeysIn(markdown: string): Set<string> {
  const keys = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = ANNOTATED.exec(line);
    if (match?.[1] !== undefined) keys.add(match[1]);
  }
  if (keys.size === 0) {
    throw new Error(
      "no defining files found in this golden — every export bullet should end with " +
        '" — from `key`". Regenerate it, or the coverage guard will pass vacuously.',
    );
  }
  return keys;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/surface-claims.test.ts` from `sdks/typescript/`
Expected: PASS.

- [ ] **Step 5: Extend the coverage guard to three bindings**

In `sdks/typescript/scripts/docs-coverage.test.ts`, add the imports:

```ts
import { claimKeysIn } from "./surface-claims.ts";
import type { Binding } from "./docs-modules.ts";
```

Add these tests inside the existing `describe("doc coverage", …)` block:

```ts
  const PY_GOLDEN = "docs/api-surface-python.md";
  const GO_GOLDEN = "docs/api-surface-go.md";

  /** Published files per binding, keyed the way a page claims them. */
  function publishedFiles(): Record<Exclude<Binding, "typescript">, Set<string>> {
    return {
      python: claimKeysIn(readFromRoot(PY_GOLDEN)),
      go: claimKeysIn(readFromRoot(GO_GOLDEN)),
    };
  }

  test("every Python module and Go file is claimed by exactly one page", () => {
    const published = publishedFiles();

    for (const binding of ["python", "go"] as const) {
      const claimedBy = new Map<string, string>();
      for (const file of pageFiles()) {
        const claims = parseCovers(readFromRoot(`${MODULES_DIR}/${file}`));
        for (const key of claims?.[binding] ?? []) {
          const already = claimedBy.get(key);
          expect(
            already,
            `${binding} file "${key}" is claimed by both ${already} and ${file}. ` +
              "Either split the file, or merge the two pages — a file that resists " +
              "splitting is usually evidence the two capabilities are one.",
          ).toBeUndefined();
          claimedBy.set(key, file);
        }
      }

      const unclaimed = [...published[binding]].filter((key) => !claimedBy.has(key)).sort();
      expect(
        unclaimed,
        `${binding} files claimed by no page: ${unclaimed.join(", ")}. ` +
          "Add them to the covers comment of the page that documents them. If no page " +
          "does, this binding has a capability TypeScript lacks — add a page claiming " +
          "zero TypeScript modules (design §8).",
      ).toEqual([]);

      const dead = [...claimedBy.keys()].filter((key) => !published[binding].has(key)).sort();
      expect(
        dead,
        `${binding} claims resolving to nothing: ${dead.join(", ")}. ` +
          "The file was renamed or removed, or it exports nothing and never appears in " +
          "the golden — a Go doc.go is the usual case. Drop the claim.",
      ).toEqual([]);
    }
  });

  test("each binding contributes a non-empty published set", () => {
    const published = publishedFiles();
    expect(published.python.size, "zero Python files — the guard would pass vacuously").toBeGreaterThan(0);
    expect(published.go.size, "zero Go files — the guard would pass vacuously").toBeGreaterThan(0);
  });
```

- [ ] **Step 6: Run the guard to obtain the exact unclaimed list**

Run from `sdks/typescript/`:
```bash
bun run --cwd ../.. build
bun test scripts/docs-coverage.test.ts
```
Expected: FAIL, listing every Python module and Go file claimed by no page. **This list is the authority** — add claims for exactly what it names. A `doc.go` or `spec/embed` that exports nothing will not appear, and must not be claimed, or the dead-claim check fails.

- [ ] **Step 7: Add the claims to all 18 pages**

Edit each `<!-- covers: -->` comment to append the `py:` and `go:` claims below. Nine pages are TypeScript-only and get no new claims: `agents.md`, `audit-logger.md`, `crypto.md`, `flux-cd.md`, `hitl-request.md`, `item-types.md`, `server.md`, `storybook.md`, `types.md`.

| Page | `py:` claims | `go:` claims |
|---|---|---|
| `connector-kit.md` | `connector_kit/env`, `connector_kit/errors`, `connector_kit/rest`, `connector_kit/results`, `connector_kit/router`, `connector_kit/search_filter`, `connector_kit/transport`, `connector_kit/types`, `connector_kit/urls` | `connectorkit/env`, `connectorkit/errors`, `connectorkit/rest`, `connectorkit/results`, `connectorkit/router`, `connectorkit/searchfilter`, `connectorkit/transport`, `connectorkit/types`, `connectorkit/urls` |
| `contract-version.md` | `contract`, `ipc/hello`, `__init__` | `contract/manifest`, `contract/negotiate`, `contract/sdkversion`, `contract/version`, `ipc/hello` |
| `data-profile.md` | `data_profile/profile` | `dataprofile/dataprofile` |
| `diagnostics.md` | `diagnostics/event`, `diagnostics/timestamp` | `diagnostics/emitter`, `diagnostics/encode`, `diagnostics/event`, `diagnostics/validate` |
| `distribution-channel.md` | `distribution_channel/channel` | `distributionchannel/distributionchannel` |
| `icalendar.md` | `icalendar/events` | `icalendar/icalendar` |
| `ipc.md` | `ipc/handshake`, `ipc/ndjson` | `ipc/handshake`, `ipc/ndjson`, `ipc/utf8stream` |
| `jmap-fastmail.md` | `jmap_fastmail/jmap` | `jmapfastmail/jmapfastmail` |
| `testing.md` | `spec` | `spec/spec` |

Worked example — `docs/modules/ipc.md`'s comment becomes:

```
<!-- covers: ipc/ndjson-line-reader, ipc/handshake
     py: ipc/handshake, ipc/ndjson
     go: ipc/handshake, ipc/ndjson, ipc/utf8stream -->
```

`__init__` on `contract-version.md` is Python's root barrel, which defines `__version__`; it sits with the contract because Go spells the same thing `contract/sdkversion`. If Step 6's list disagrees with any row here, **the list wins** — it is generated from the goldens and this table is not.

- [ ] **Step 8: Run the guard to verify it passes**

Run: `bun test scripts/docs-coverage.test.ts` from `sdks/typescript/`
Expected: PASS.

- [ ] **Step 9: Run the full suite**

Run from the repo root: `bun run build && bun run test && bun run lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add sdks/typescript/scripts/surface-claims.ts sdks/typescript/scripts/surface-claims.test.ts sdks/typescript/scripts/docs-coverage.test.ts docs/modules/
git commit -m "feat(docs): claim every Python module and Go file from a capability page"
```

---

### Task 6: Generate the matrix table

**Files:**
- Modify: `sdks/typescript/scripts/surface-claims.ts` — add `tiersByFile`, reimplement `claimKeysIn` on it
- Create: `sdks/typescript/scripts/stability-matrix.ts`
- Create: `sdks/typescript/scripts/stability-matrix.test.ts`
- Create: `docs/stability-matrix.md` (generated)
- Modify: `sdks/typescript/package.json`, root `package.json` — the `stability:matrix` script

**Interfaces:**
- Consumes: `claimKeysIn` (Task 5), `parseCovers` / `Claims` / `Binding` / `moduleKeyOf` / `MODULES_DIR` (Task 4 and existing), `collectEntryPoints` / `buildSurface` / `Tier` / `SurfaceExport` from `./api-surface.ts` (existing — `SurfaceExport.stability` is the resolved tier, so TypeScript needs no golden parsing).
- Produces:
  ```ts
  export type MatrixIO = {
    readRepo: (path: string) => string;
    readPackage: (path: string) => string;
    pages: () => readonly string[];
  };
  export function renderMatrix(io: MatrixIO): string;
  export function tiersByFile(markdown: string): Map<string, Tier[]>; // in surface-claims.ts
  ```
  Task 7 appends three more sections to `renderMatrix`'s output.

- [ ] **Step 1: Write the failing test for `tiersByFile`**

Add to `sdks/typescript/scripts/surface-claims.test.ts`:

```ts
test("tiersByFile groups every bullet's tier under its defining file", () => {
  const golden = [
    "- `func A()` — **frozen** — from `ipc/hello`",
    "- `func B()` — **stable** — from `ipc/hello`",
    "- `func C()` — **experimental** — from `ipc/ndjson`",
    "  - `member: str`",
  ].join("\n");

  const tiers = tiersByFile(golden);

  expect(tiers.get("ipc/hello")).toEqual(["frozen", "stable"]);
  expect(tiers.get("ipc/ndjson")).toEqual(["experimental"]);
  expect(tiers.size).toBe(2);
});
```

Add `tiersByFile` to the file's import list.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/surface-claims.test.ts` from `sdks/typescript/`
Expected: FAIL — `tiersByFile` is not exported.

- [ ] **Step 3: Implement `tiersByFile` and rebuild `claimKeysIn` on it**

Replace the body of `sdks/typescript/scripts/surface-claims.ts` below the doc comment:

```ts
import type { Tier } from "./api-surface.ts";

/** A top-level export bullet carrying its tier and defining file. Sub-bullets never match. */
const ANNOTATED =
  /^- .+ — \*\*(frozen|stable|experimental)\*\* — from `([^`]+)`\s*$/;

/**
 * Every tier a golden records, grouped by the file that defines the export carrying it.
 *
 * A file appears once per export, so the array length is that file's export count and its
 * contents are what `renderMatrix` reduces to one cell.
 */
export function tiersByFile(markdown: string): Map<string, Tier[]> {
  const byFile = new Map<string, Tier[]>();
  for (const line of markdown.split("\n")) {
    const match = ANNOTATED.exec(line);
    const tier = match?.[1] as Tier | undefined;
    const file = match?.[2];
    if (tier === undefined || file === undefined) continue;
    const list = byFile.get(file);
    if (list === undefined) byFile.set(file, [tier]);
    else list.push(tier);
  }
  return byFile;
}

/**
 * The defining files a bullet-form surface golden records.
 *
 * Throws rather than returning empty: a golden that records no files means the generator
 * was not re-run, and a silently empty set makes the coverage guard pass vacuously.
 */
export function claimKeysIn(markdown: string): Set<string> {
  const keys = new Set(tiersByFile(markdown).keys());
  if (keys.size === 0) {
    throw new Error(
      "no defining files found in this golden — every export bullet should end with " +
        '" — from `key`". Regenerate it, or the coverage guard will pass vacuously.',
    );
  }
  return keys;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/surface-claims.test.ts scripts/docs-coverage.test.ts` from `sdks/typescript/`
Expected: PASS — Task 5's tests still hold, because `claimKeysIn`'s contract is unchanged.

- [ ] **Step 5: Write the failing test for the matrix**

Create `sdks/typescript/scripts/stability-matrix.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULES_DIR } from "./docs-modules.ts";
import { packageRoot, repoRoot } from "./paths.ts";
import { type MatrixIO, renderMatrix } from "./stability-matrix.ts";

const io: MatrixIO = {
  readRepo: (path) => readFileSync(join(repoRoot, path), "utf8"),
  readPackage: (path) => readFileSync(join(packageRoot, path), "utf8"),
  pages: () =>
    readdirSync(join(repoRoot, MODULES_DIR))
      .filter((name) => name.endsWith(".md"))
      .sort(),
};

describe("stability matrix", () => {
  test("dist/ has been built", () => {
    expect(() => io.readPackage("dist/index.d.ts")).not.toThrow();
  });

  test("the committed page matches a fresh render", () => {
    expect(io.readRepo("docs/stability-matrix.md")).toBe(renderMatrix(io));
  });

  test("every capability page appears as a row linking to itself", () => {
    const rendered = renderMatrix(io);
    for (const page of ["ipc", "diagnostics", "connector-kit", "icalendar"]) {
      expect(rendered).toContain(`[\`${page}\`](./modules/${page}.md)`);
    }
  });

  test("a TypeScript-only capability shows a gap in the other two columns", () => {
    const row = renderMatrix(io)
      .split("\n")
      .find((line) => line.startsWith("| [`storybook`]"));
    expect(row).toBeDefined();
    expect(row?.split("|").filter((cell) => cell.trim() === "—")).toHaveLength(2);
  });

  test("a capability all three bind shows no gap", () => {
    const row = renderMatrix(io)
      .split("\n")
      .find((line) => line.startsWith("| [`icalendar`]"));
    expect(row).toBeDefined();
    expect(row?.split("|").filter((cell) => cell.trim() === "—")).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun run --cwd ../.. build && bun test scripts/stability-matrix.test.ts` from `sdks/typescript/`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the generator**

Create `sdks/typescript/scripts/stability-matrix.ts`:

```ts
/**
 * The cross-language stability matrix — capability rows, language columns, tier cells.
 *
 * The tier is READ from the three surface goldens on every render and never stored in the
 * claim comments, which carry grouping only. That is what makes a stale cell
 * unrepresentable rather than merely detectable: there is no second copy of the tier to go
 * stale. See docs/superpowers/specs/2026-08-30-stability-matrix-design.md §6.
 *
 * All I/O arrives through `MatrixIO` so the whole renderer is drivable from synthetic
 * input, for the same reason `docs-modules.ts` reads no files.
 */

import { buildSurface, collectEntryPoints, type Tier } from "./api-surface.ts";
import { type Binding, MODULES_DIR, moduleKeyOf, parseCovers } from "./docs-modules.ts";
import { tiersByFile } from "./surface-claims.ts";

export type MatrixIO = {
  /** Repo-root-relative read: `docs/…`, `sdks/…`. */
  readRepo: (path: string) => string;
  /** TypeScript-package-root-relative read: `package.json`, `dist/…`. */
  readPackage: (path: string) => string;
  /** The `docs/modules/*.md` file names, sorted. */
  pages: () => readonly string[];
};

const BINDINGS: readonly Binding[] = ["typescript", "python", "go"];
const COLUMN: Record<Binding, string> = {
  typescript: "TypeScript",
  python: "Python",
  go: "Go",
};

/** Weakest first — a capability promises no more than its weakest published part. */
const WEAKEST_FIRST: readonly Tier[] = ["experimental", "stable", "frozen"];

/** A page's optional explanation for a row whose cells disagree (design §7). */
const TIER_NOTE = /<!--\s*tier-note:([\s\S]*?)-->/;

/** Every tier TypeScript publishes, grouped by the module key a page claims. */
function typescriptTiers(io: MatrixIO): Map<string, Tier[]> {
  const entries = collectEntryPoints(io.readPackage("package.json"));
  const surfaces = buildSurface(entries, io.readPackage);
  const fileOf = new Map(entries.map((entry) => [entry.label, entry.file]));

  const byModule = new Map<string, Tier[]>();
  for (const surface of surfaces) {
    const entryFile = fileOf.get(surface.label);
    if (entryFile === undefined) {
      throw new Error(
        `surface has no entry point named "${surface.label}" — collectEntryPoints() and ` +
          "buildSurface() were called with different inputs.",
      );
    }
    for (const exported of surface.exports) {
      const key = moduleKeyOf(entryFile, exported.source);
      const list = byModule.get(key);
      if (list === undefined) byModule.set(key, [exported.stability]);
      else list.push(exported.stability);
    }
  }
  return byModule;
}

function weakest(tiers: readonly Tier[]): Tier {
  for (const tier of WEAKEST_FIRST) {
    if (tiers.includes(tier)) return tier;
  }
  throw new Error("weakest() called with an empty tier list");
}

/** The page name a row is titled by: `ipc.md` -> `ipc`. */
function capabilityOf(file: string): string {
  return file.replace(/\.md$/, "");
}

type Row = { capability: string; cells: Record<Binding, Tier | null>; note: string | null };

function buildRows(io: MatrixIO): Row[] {
  const tiers: Record<Binding, Map<string, Tier[]>> = {
    typescript: typescriptTiers(io),
    python: tiersByFile(io.readRepo("docs/api-surface-python.md")),
    go: tiersByFile(io.readRepo("docs/api-surface-go.md")),
  };

  const rows: Row[] = [];
  for (const file of io.pages()) {
    const text = io.readRepo(`${MODULES_DIR}/${file}`);
    const claims = parseCovers(text);
    if (claims === null) continue;

    const cells: Record<Binding, Tier | null> = { typescript: null, python: null, go: null };
    for (const binding of BINDINGS) {
      const claimed = claims[binding].flatMap((key) => tiers[binding].get(key) ?? []);
      cells[binding] = claimed.length === 0 ? null : weakest(claimed);
    }

    const noted = TIER_NOTE.exec(text);
    rows.push({
      capability: capabilityOf(file),
      cells,
      note: noted?.[1]?.trim() ?? null,
    });
  }
  return rows;
}

/**
 * A row whose bound cells disagree must explain itself.
 *
 * RFC-0015 §3 permits the same helper sitting at different tiers in two bindings, so a
 * disagreement is sometimes correct — which is exactly why it needs a recorded reason
 * rather than a rule. A gap needs none: gaps are the majority case and all say the same
 * thing (design §7).
 */
function assertDisagreementsExplained(rows: readonly Row[]): void {
  for (const row of rows) {
    const bound = BINDINGS.map((binding) => row.cells[binding]).filter(
      (tier): tier is Tier => tier !== null,
    );
    if (new Set(bound).size <= 1 || row.note !== null) continue;
    throw new Error(
      `"${row.capability}" is ${bound.join(" in one binding and ")} in another, with no ` +
        "explanation. A tier may honestly differ between bindings (RFC-0015 §3), so add " +
        `<!-- tier-note: … --> to docs/modules/${row.capability}.md saying why, or correct ` +
        "the tiers in source.",
    );
  }
}

const BANNER = `# Stability and support matrix

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with \`bun run build && bun run stability:matrix\`.
     Tiers are read from the three API-surface goldens on every render and are never
     stored here — see docs/superpowers/specs/2026-08-30-stability-matrix-design.md. -->

What each capability promises you, in each language that binds it. A \`—\` means that
binding does not publish the capability at all.
`;

function renderTable(rows: readonly Row[]): string {
  const head = `| Capability | ${BINDINGS.map((b) => COLUMN[b]).join(" | ")} |`;
  const rule = `|---|${BINDINGS.map(() => "---").join("|")}|`;
  const body = rows.map((row) => {
    const cells = BINDINGS.map((binding) => {
      const tier = row.cells[binding];
      return tier === null ? "—" : `\`${tier}\``;
    });
    return `| [\`${row.capability}\`](./modules/${row.capability}.md) | ${cells.join(" | ")} |`;
  });
  return [head, rule, ...body].join("\n");
}

export function renderMatrix(io: MatrixIO): string {
  const rows = buildRows(io);
  if (rows.length === 0) {
    throw new Error("no capability pages resolved — the matrix would render empty");
  }
  assertDisagreementsExplained(rows);
  return `${BANNER}\n${renderTable(rows)}\n`;
}

if (import.meta.main) {
  const { readdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { packageRoot, repoRoot } = await import("./paths.ts");

  const io: MatrixIO = {
    readRepo: (path) => readFileSync(join(repoRoot, path), "utf8"),
    readPackage: (path) => readFileSync(join(packageRoot, path), "utf8"),
    pages: () =>
      readdirSync(join(repoRoot, MODULES_DIR))
        .filter((name) => name.endsWith(".md"))
        .sort(),
  };
  writeFileSync(join(repoRoot, "docs/stability-matrix.md"), renderMatrix(io), "utf8");
}
```

- [ ] **Step 8: Wire the scripts and generate the page**

Add to `sdks/typescript/package.json`'s `scripts`:
```json
"stability:matrix": "bun run scripts/stability-matrix.ts"
```
Add to the root `package.json`'s `scripts`:
```json
"stability:matrix": "bun run --cwd sdks/typescript stability:matrix"
```

Run from the repo root:
```bash
bun run build && bun run stability:matrix
```
Expected: `docs/stability-matrix.md` written. If it throws about an unexplained disagreement, that is the design working — read the message, then either add the `<!-- tier-note: … -->` to the named page or fix the tier in source.

- [ ] **Step 9: Run tests to verify they pass**

Run from `sdks/typescript/`: `bun test scripts/stability-matrix.test.ts`
Expected: PASS. If "a capability all three bind shows no gap" fails on `icalendar`, check Task 5's claims for that page before changing the test — an unexpected gap is a missing claim, not a wrong assertion.

- [ ] **Step 10: Commit**

```bash
git add sdks/typescript/scripts/stability-matrix.ts sdks/typescript/scripts/stability-matrix.test.ts sdks/typescript/scripts/surface-claims.ts sdks/typescript/scripts/surface-claims.test.ts docs/stability-matrix.md sdks/typescript/package.json package.json
git commit -m "feat(docs): generate the cross-language stability matrix table"
```

---

### Task 7: Add the legend, binding status and runtime support, then publish

**Files:**
- Modify: `sdks/typescript/scripts/stability-matrix.ts` — three more sections
- Modify: `sdks/typescript/scripts/stability-matrix.test.ts`
- Modify: `docs/stability-matrix.md` (regenerated)
- Modify: `docs/README.md`, `docs/ROADMAP.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 6's `renderMatrix` and `MatrixIO`.
- Produces: the finished four-part page of design §3.

- [ ] **Step 1: Write the failing test**

Add to `sdks/typescript/scripts/stability-matrix.test.ts`, inside the existing `describe`:

```ts
  test("the tier legend states what each tier promises", () => {
    const rendered = renderMatrix(io);
    expect(rendered).toContain("## What each tier promises");
    for (const tier of ["frozen", "stable", "experimental"]) {
      expect(rendered).toContain(`| \`${tier}\` |`);
    }
  });

  test("binding status names each binding's officiality RFC and package", () => {
    const rendered = renderMatrix(io);
    expect(rendered).toContain("rfcs/0016-typescript-sdk-official.md");
    expect(rendered).toContain("rfcs/0008-python-sdk-official.md");
    expect(rendered).toContain("rfcs/0013-go-sdk-official.md");
    expect(rendered).toContain("@nimbus-dev/sdk");
    expect(rendered).toContain("nimbus-dev-sdk");
  });

  test("corpora counts are read from conformance-coverage.json, not restated", () => {
    const claimed = JSON.parse(io.readRepo("docs/conformance-coverage.json")) as {
      languages: Record<string, { claims: string[] }>;
    };
    const rendered = renderMatrix(io);
    for (const [language, entry] of Object.entries(claimed.languages)) {
      expect(rendered, language).toContain(`${entry.claims.length} of`);
    }
  });

  test("the runtime floors are read from the packages, not restated", () => {
    const rendered = renderMatrix(io);
    expect(rendered).toContain(">=22");
    expect(rendered).toContain(">=3.11");
    expect(rendered).toContain("1.26");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/stability-matrix.test.ts` from `sdks/typescript/`
Expected: FAIL — the rendered page carries only the table.

- [ ] **Step 3: Implement the three sections**

Add to `sdks/typescript/scripts/stability-matrix.ts`, above `renderMatrix`:

```ts
/**
 * What a tier buys a consumer. Sourced from RFC-0015 §1-2 and DEPRECATION-POLICY.md; a
 * literal here rather than parsed out of them, because prose is not a data source and a
 * regex over an RFC would break the next time someone rewords a sentence.
 */
const TIER_PROMISE: ReadonlyArray<readonly [Tier, string, string, string]> = [
  ["frozen", "Yes — a normative spec and a conformance corpus", "Full window", "Yes"],
  ["stable", "No", "Full window", "No"],
  ["experimental", "No", "None — may change or be removed at any time", "No"],
];

function renderLegend(): string {
  const rows = TIER_PROMISE.map(
    ([tier, backed, window, rfc]) => `| \`${tier}\` | ${backed} | ${window} | ${rfc} |`,
  );
  return [
    "## What each tier promises",
    "",
    "| Tier | Spec- and corpus-backed | Deprecation window before removal | RFC required to break |",
    "|---|---|---|---|",
    ...rows,
    "",
    "The window itself is [`DEPRECATION-POLICY.md`](./DEPRECATION-POLICY.md)'s: marked in a",
    "minor, surviving a later minor, removed at a major. Tier and deprecation are orthogonal —",
    "an export can be `stable` and `@deprecated` at once (RFC-0015 §1).",
  ].join("\n");
}

type BindingFacts = {
  readonly column: string;
  readonly pkg: string;
  readonly registry: string;
  readonly rfc: string;
};

const BINDING_FACTS: Record<Binding, BindingFacts> = {
  typescript: {
    column: "TypeScript",
    pkg: "`@nimbus-dev/sdk`",
    registry: "npm",
    rfc: "[RFC-0016](./rfcs/0016-typescript-sdk-official.md)",
  },
  python: {
    column: "Python",
    pkg: "`nimbus-dev-sdk`",
    registry: "PyPI",
    rfc: "[RFC-0008](./rfcs/0008-python-sdk-official.md)",
  },
  go: {
    column: "Go",
    pkg: "`github.com/nimbus-agent/nimbus-sdk/sdks/go`",
    registry: "module proxy (a `sdks/go/vX.Y.Z` tag)",
    rfc: "[RFC-0013](./rfcs/0013-go-sdk-official.md)",
  },
};

type Coverage = {
  languages: Record<string, { claims: string[]; unclaimed: Record<string, string> }>;
};

function renderBindingStatus(io: MatrixIO): string {
  const coverage = JSON.parse(io.readRepo("docs/conformance-coverage.json")) as Coverage;
  const rows = BINDINGS.map((binding) => {
    const facts = BINDING_FACTS[binding];
    const entry = coverage.languages[binding];
    if (entry === undefined) {
      throw new Error(
        `docs/conformance-coverage.json has no "${binding}" language entry — the matrix ` +
          "cannot state its corpora. Add it there rather than hard-coding a count here.",
      );
    }
    const total = entry.claims.length + Object.keys(entry.unclaimed).length;
    return `| ${facts.column} | Official — ${facts.rfc} | ${facts.pkg} | ${facts.registry} | ${entry.claims.length} of ${total} |`;
  });

  return [
    "## Binding status",
    "",
    "| Binding | Officiality | Package | Published through | Corpora executed |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "Officiality is a governance act, not a test result — it is",
    "[GOVERNANCE.md's four criteria](./GOVERNANCE.md#how-a-language-becomes-official), the",
    "fourth of which is an accepted RFC. Which corpora each binding executes, and why it",
    "does not claim the rest, is [`conformance-coverage.md`](./conformance-coverage.md)'s.",
  ].join("\n");
}

/** The first capture of `pattern` in `text`, or a failure naming what was being read. */
function must(text: string, pattern: RegExp, what: string): string {
  const found = pattern.exec(text)?.[1];
  if (found === undefined) {
    throw new Error(`could not read ${what} — the matrix will not restate a floor it cannot find.`);
  }
  return found;
}

function renderRuntimeSupport(io: MatrixIO): string {
  const node = (JSON.parse(io.readPackage("package.json")) as { engines?: { node?: string } })
    .engines?.node;
  if (node === undefined) {
    throw new Error("sdks/typescript/package.json declares no engines.node");
  }
  const python = must(
    io.readRepo("sdks/python/pyproject.toml"),
    /^requires-python\s*=\s*"([^"]+)"/m,
    "requires-python from sdks/python/pyproject.toml",
  );
  const go = must(io.readRepo("sdks/go/go.mod"), /^go\s+(\S+)/m, "the go directive from sdks/go/go.mod");

  return [
    "## Runtime support",
    "",
    "| Binding | Declared floor | Where it is declared |",
    "|---|---|---|",
    `| TypeScript | \`${node}\` | \`engines.node\` |`,
    `| Python | \`${python}\` | \`requires-python\` |`,
    `| Go | \`${go}\` | the \`go\` directive |`,
    "",
    "These are read from the packages themselves on every render, so this table cannot",
    "drift from what the packages declare. CI proves them on every pull request across",
    "Linux, macOS and Windows; Go's floor names the *older* of the two supported minors on",
    "purpose. Dropping a runtime version is a breaking change under",
    "[`DEPRECATION-POLICY.md`](./DEPRECATION-POLICY.md).",
  ].join("\n");
}
```

Then extend `renderMatrix`'s return:

```ts
export function renderMatrix(io: MatrixIO): string {
  const rows = buildRows(io);
  if (rows.length === 0) {
    throw new Error("no capability pages resolved — the matrix would render empty");
  }
  assertDisagreementsExplained(rows);
  return [
    BANNER,
    renderTable(rows),
    "",
    renderLegend(),
    "",
    renderBindingStatus(io),
    "",
    renderRuntimeSupport(io),
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Regenerate and verify the tests pass**

Run from the repo root:
```bash
bun run build && bun run stability:matrix
bun test --cwd sdks/typescript scripts/stability-matrix.test.ts
```
Expected: PASS.

- [ ] **Step 5: Review the generated page by hand**

Read `docs/stability-matrix.md` end to end. Confirm each disagreement's note is *true*, not merely present — the guard checks existence, never accuracy — and that no gap contradicts what you know a binding ships. This is the one step no gate can perform.

- [ ] **Step 6: Update the surrounding documentation**

- `docs/README.md`: replace the body of `### Supported versions` with a pointer to `docs/stability-matrix.md`'s Runtime support section. **Keep** the ESM-only paragraph and the no-declared-minimum-TypeScript-version paragraph — the matrix carries neither.
- `docs/ROADMAP.md`: change the Phase 4 box to `- [x] A published **stability / support matrix** per export tier and language — *Pillars 6, 7*` and add a short paragraph recording that the claim unit is the defining source file, that the entry point could not be it because Go's `ipc` package and Python's `nimbus_sdk.ipc` root each span two capabilities, and that the tier is read rather than copied.
- `CLAUDE.md`: add `bun run stability:matrix` to the Commands block beside `conformance:coverage`; add to Conventions that `docs/stability-matrix.md` is generated and gated, and that **one source file maps to exactly one capability page** — with both remedies, splitting the file *or* merging the pages, since a file that resists splitting usually means the two capabilities are one.

- [ ] **Step 7: Run every gate**

```bash
bun run build && bun run test && bun run lint && bun run typecheck
bun run --cwd tools/create-connector build && bun run scaffold:test
go -C sdks/go build ./... && go -C sdks/go vet ./... && test -z "$(gofmt -l sdks/go)"
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
```
Then from `sdks/python/`: `python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add sdks/typescript/scripts/stability-matrix.ts sdks/typescript/scripts/stability-matrix.test.ts docs/stability-matrix.md docs/README.md docs/ROADMAP.md CLAUDE.md
git commit -m "feat(docs): publish the stability matrix with legend, binding status and runtime support"
```

---

## Verification Before Done

Per CLAUDE.md, gate runs inside `.claude/worktrees/` are untrustworthy — resolution walks up into the parent checkout's `node_modules`, so a package can resolve a dependency it never declares and every local run goes green while CI fails. Before opening any pull request, reproduce CI honestly:

```bash
git clone --branch <branch> . <tmpdir>
cd <tmpdir>
bun install --frozen-lockfile
bun run build
bun run --cwd tools/create-connector build
bun run test && bun run lint && bun run typecheck && bun run scaffold:test
```

Build **before** testing, the order `.github/workflows/ci.yml` uses — `api-surface`, `smoke-calls` and `pack-and-generate` execute the built package, and skipping the build fails them for the wrong reason.
