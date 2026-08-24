# Review & Suggestions: Tiered Stability Implementation Plan

This review document provides feedback, open questions, and improvements on the implementation plan defined in [2026-08-24-tiered-stability.md](./2026-08-24-tiered-stability.md).

---

## 1. Open Questions

### Q1.1: Handling Conditional Python Definitions in AST Parsing
*   **Context:** In **Task 5 (Step 3)**, `defining_modules()` scans the module-level body of each file (`for node in tree.body`) using a static list of definition nodes (`ast.FunctionDef`, `ast.ClassDef`, `ast.Assign`, `ast.AnnAssign`).
*   **Question:** If a public export is defined conditionally inside an `if` block (e.g., `if sys.version_info >= (3, 11):` or `if TYPE_CHECKING:`) or a `try-except` block, the definitions will be nested under `ast.If.body` or `ast.Try.body` and will not be found by the top-level loop. Will this cause false-positive missing tier errors?
*   **Recommendation:** Clarify if the codebase currently has or permits conditional public exports. If not, add a comment in `defining_modules()` stating this limitation. If conditional definitions do exist, implement a recursive helper to search block bodies (like `ast.If` and `ast.Try`) for definition nodes.

### Q1.2: Git Fetch Optimization for Local Guard execution
*   **Context:** In **Task 11 (Step 2)**, `surfaceChanges` runs `git fetch --depth=1 origin baseSha` unconditionally to ensure the base commit is present.
*   **Question:** When developers run the guard locally (e.g., via the `--pr N` flag), running `git fetch` unconditionally on every execution is slow, requires network access, and can fail if the remote is not named `origin`.
*   **Recommendation:** Optimize the base commit retrieval by trying `git show` first. If the commit is already present locally, skip the fetch. Only run `git fetch` if `git show` fails with a non-zero exit code:
    ```ts
    // Try to see if the base SHA is already available locally
    const checkLocal = Bun.spawnSync(["git", "cat-file", "-t", baseSha]);
    if (checkLocal.exitCode !== 0) {
      const fetched = Bun.spawnSync(["git", "fetch", "--depth=1", "origin", baseSha]);
      if (fetched.exitCode !== 0) {
        throw new Error(`could not fetch base ${baseSha}: ${fetched.stderr.toString()}`);
      }
    }
    ```

---

## 2. Technical Suggestions & Improvements

### S2.1: Robust EOL Normalization in Go Package Doc Comments
*   **Context:** In **Task 7 (Step 4)**, the Go `stabilityIn` helper splits doc comments by `\n`:
    ```go
    for _, line := range strings.Split(doc.Text(), "\n")
    ```
*   **Suggestion:** Ensure that carriage returns (`\r\n`) are normalized before processing, or strip any trailing `\r` from each line (`strings.TrimRight(line, "\r")`), to prevent parser mismatches when files are checked out with CRLF on Windows.

### S2.2: Clarifying CLI Diagnostics and Exit Codes on Untagged Modules
*   **Context:** In **Task 3 (Step 4)** and **Task 5 (Step 3)**, errors are thrown when a module is untagged.
*   **Suggestion:** Ensure that when these errors are thrown, they clearly output the exact command needed to fix the issue (e.g., running the surface generator) and exit with a clean diagnostics message so that developers can quickly self-correct.
