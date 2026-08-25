# Review & Feedback: Tiered Stability Design

**Date:** 2026-08-24  
**Design Reference:** [2026-08-24-tiered-stability-design.md](./2026-08-24-tiered-stability-design.md)

---

## 1. Open Questions

### Q1.1: Python Re-exports and Tier Resolution
*   **Context:** Section 2.1 states that tiers are declared at module scope and can be overridden per export using module-level attributes: `__stability__` and `__stability_overrides__`. Python's `api_surface.py` works by importing each root and reading `__all__`, rather than parsing the source.
*   **Question:** Since public APIs in Python are typically imported from internal submodules and re-exported at the root package level (via `__all__`), how will `api_surface.py` resolve the stability tier of these exports? Will it look at the defining submodule's `__stability__` and `__stability_overrides__` (by tracing the object's `__module__`), or must the root package declare overrides for all its submodules' exports?
*   **Recommendation:** Clarify that `api_surface.py` should resolve the tier by tracing the defining module of each exported object (via its `__module__` attribute) and reading that module's `__stability__` and `__stability_overrides__`. If an override is needed, it should be defined in the module that actually implements/defines the export, keeping the root package's attributes clean.

### Q1.2: Locating Go Package Doc Comments
*   **Context:** Section 2.1 specifies that Go packages will declare stability via a `// Stability: frozen` package doc comment.
*   **Question:** Unlike other languages, a Go package is a directory composed of multiple files, and the package doc comment can reside in any file in that package (conventionally in a `doc.go` file, but often in the main file or spread across multiple files). How will the Go package walker locate and read this package-level doc comment?
*   **Recommendation:** Clarify that the walker will scan the AST of all files in the package directory to find the package-level documentation (i.e., `ast.File.Doc` comments preceding the `package` keyword). If multiple package doc comments are found, the walker should combine them or look for the first match, but recommend establishing a convention (e.g., placing it in `doc.go` or `package.go`) to keep it clean.

### Q1.3: Verifying the RFC File Existence
*   **Context:** Section 3.2 states: *"Any change to a `frozen` module's surface, additions included, must cite an RFC: the pull request body names `RFC-NNNN` and `docs/rfcs/NNNN-*.md` exists."*
*   **Question:** When the Conventional Commit guard checks for the existence of `docs/rfcs/NNNN-*.md`, against which Git reference or branch will it check? If the RFC is introduced in the *same* pull request as the change, checking the base branch (`main`) will fail, whereas checking the PR's head branch (or the local checkouts) will succeed.
*   **Recommendation:** Explicitly state that the guard must verify the file's existence in the current workspace (the checkout of the PR's head branch), since the RFC may either have merged previously (in which case it exists in both base and head) or be included in the current pull request.

---

## 2. Technical Suggestions & Improvements

### S2.1: Optimizing CI Runs on PR Title Edits
*   **Context:** Section 7 identifies a hole where editing a PR title after CI runs does not re-trigger the check because the workflow uses default triggers which exclude the `edited` event. The design plans to add the `edited` trigger to `ci.yml`.
*   **Suggestion:** Since adding the `edited` activity type to `pull_request` triggers will run the *entire* CI workflow (including all tests and linting steps) whenever a PR title or description is updated, this could waste significant CI minutes. We should isolate the Conventional Commit check into a lightweight, fast-running workflow or job that only triggers on `pull_request` events (including `edited`), while leaving heavy test suites to run only on `synchronize` and `opened` to conserve resources.

### S2.2: Mitigating the Lack of Deprecation Checks in Python and Go
*   **Context:** Section 6 specifies that the `+ window` deprecation enforcement works only in TypeScript since Python and Go surface generators do not currently record deprecation markers, and teaching them to do so is out of scope.
*   **Suggestion:** To ensure this asymmetry is not forgotten, the Conventional Commit guard should output a clear warning/notice in CI when a Python or Go `stable` or `frozen` export is removed, reminding the PR author and reviewers that the deprecation window must be verified manually. Additionally, we should explicitly document this as a known limitation in the codebase tasks to be picked up in Phase 4 or Phase 5.
