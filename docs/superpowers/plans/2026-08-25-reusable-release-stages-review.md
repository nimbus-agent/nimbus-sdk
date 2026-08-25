# Reusable Release Stages — Plan Review

**Date:** 2026-08-25
**Reviewers:** Antigravity AI
**Status:** pending discussion
**Related Plan:** [2026-08-25-reusable-release-stages.md](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/reusable-release/docs/superpowers/plans/2026-08-25-reusable-release-stages.md)

---

## 1. Suggestions & Improvements

### 1.1. Cleanup of Temporary Directory in `verify-npm-publish`
* **Context:** In Task 2, Step 1, the action creates a temporary directory using `tmp="$(mktemp -d)"` and changes directories (`cd "$tmp"`). However, it never deletes this directory upon exit.
* **Suggestion:** Add a trap to clean up the directory, or explicitly remove it at the end of the run step. For example:
  ```bash
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  cd "$tmp"
  ```
  This is a good hygiene practice, especially if self-hosted runners are ever used where `/tmp` space is persistent across jobs.

### 1.2. Verify `yaml` Package in `sdks/typescript` Dependencies
* **Context:** Task 4 uses the `yaml` package to parse the workflow files in the guard tests: `const workflow = parse(readFromRepo(".github/workflows/release.yml"))`.
* **Suggestion:** Explicitly verify that the `yaml` package is declared in `package.json`'s `devDependencies` (or `dependencies`) under `sdks/typescript`. If it is not, a `bun install --dev yaml` step should be added to Task 4 before running the tests.

---

## 2. Open Questions

### 2.1. Handling of `package.json` Missing or Malformed Errors
* **Question:** In the preflight action, if `EXPECTED_VERSION` is provided but `package.json` is missing or contains malformed JSON, `node -p` will throw an unhandled error and crash. Since `set -euo pipefail` is active, the script will exit immediately. Is this the desired behavior (failing fast), or should we catch the error to print a cleaner user-facing diagnostic?
