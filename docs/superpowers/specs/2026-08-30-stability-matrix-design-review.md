# Review & Feedback: Cross-Language Stability / Support Matrix Design

**Date:** 2026-08-30  
**Design Reference:** [2026-08-30-stability-matrix-design.md](./2026-08-30-stability-matrix-design.md)

---

## 1. Open Questions

### Q1.1: Exact Formatting for Python and Go Golden Files
*   **Context:** Section 5 states that Python and Go goldens will record the defining file, causing a large rendering-only diff. It notes that `stability-rules.ts`'s parser must be updated to tolerate the new format and output zero `SurfaceChange`.
*   **Question:** What is the proposed markdown format for these new bullet items? Having a concrete example helps ensure we don't break downstream parsers or regexes.
*   **Recommendation:** Propose a clean, standard format. E.g.:
    *   **Python:** `- nimbus_sdk.ipc.hello_frame (from ipc/hello.py) — stable`
    *   **Go:** `- ipc.HelloFrame (from ipc/hello.go) — stable`
    *   This keeps the existing trailing `— **tier**` structure intact so regex matching for tiers remains simple, while appending the source location in a predictable parenthetical block.

### Q1.2: Location and Format of Disagreement Notes
*   **Context:** Section 7 and 9 discuss the requirement for a recorded reason when a row's cells disagree (different tiers across bindings). Section 9 (Open questions) mentions a possible `<!-- tier-note: … -->` comment block.
*   **Question:** How should the disagreement note be structured so that the TypeScript documentation gate can easily parse it without creating fragile comment blocks?
*   **Recommendation:** Instead of a separate `<!-- tier-note: ... -->` block, consider embedding it directly in the existing `<!-- covers: ... -->` block or standardizing a frontmatter field or table within the capability page itself. Alternatively, if a comment is preferred, support a specific prefix within the `covers` block (e.g., `disagreement: "Go is experimental due to lack of connection caching"`). This keeps all metadata in a single place.

### Q1.3: Parsing Grammar of Multi-line, Multi-binding `covers` Comments
*   **Context:** Section 4 illustrates a multi-line comment spanning `py:` and `go:` prefixes.
*   **Question:** What are the exact delimiters and parsing rules for `parseCovers`? Are the entries comma-separated, space-separated, or newline-terminated?
*   **Recommendation:** Explicitly specify that the parser:
    1. Trims whitespace and splits elements by commas or whitespace.
    2. Identifies language prefixes (`py:`, `go:`) to partition the remaining entries.
    3. Ignores empty entries or trailing punctuation.
    Documenting a regex or formal parsing algorithm in the spec prevents parser drift.

---

## 2. Technical Suggestions & Improvements

### S2.1: Preventing Unnecessary Releases from Tooling Updates
*   **Context:** The "Shipments" section mentions that Shipment 2 will likely trigger a release-please bump for `nimbus-dev-sdk` because `sdks/python/scripts/api_surface.py` lies within the Python component path.
*   **Suggestion:** We can configure `release-please` to ignore changes in `scripts/` directories using path filters if supported, or ensure that shipments use the `chore:` or `docs:` semantic commit prefix (e.g., `chore(python): update api_surface.py to output defining modules`). If the commit type is `chore` or `docs`, release-please will not bump the package version or cut a release, avoiding unnecessary package bumps.

### S2.2: Guideline for Source File Granularity
*   **Context:** Section 1 establishes the source file as the claim unit.
*   **Suggestion:** Since a source file maps to exactly one capability page, developers might accidentally mix exports belonging to different capabilities in a single Python or Go source file. We should add a brief guideline to `CLAUDE.md` warning developers not to mix capabilities in a single file, and if they do, they will be forced to split the file to pass the exactly-one coverage gate.
