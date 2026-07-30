# Review of sdks-typescript-move Implementation Plan

This document compiles reviews, suggestions, and open questions regarding the proposed TypeScript SDK migration plan.

---

## 1. Tooling & Platform Compatibility

### 1.1 Windows PowerShell/pwsh Command Compatibility
* **Observation:** The verification and helper commands in the plan (e.g., `rm -rf`, `cp`, `grep -rn`, `ls -la`) are written in Unix/Bash syntax. Since developers or agentic tools might execute this plan on Windows machines (e.g. running in `pwsh`), some commands will fail or behave unexpectedly.
* **Suggestions:**
  * Mention that commands are written for a Bash-compatible environment (or Git Bash).
  * Provide or suggest PowerShell equivalents for high-risk cleanup steps:
    * `rm -rf node_modules` -> `Remove-Item -Recurse -Force node_modules` (or `git clean -fdx`)
    * `cp LICENSE ...` -> `Copy-Item LICENSE ...`
    * `grep -rn ...` -> `Select-String` equivalents.

---

## 2. Release Configuration & Guard Extensions

### 2.2 TOML Parsing / Regex for Python Version Verification
* **Observation:** In Task 6 Step 1 (`release-config-guard.test.ts`), the version validation explicitly skips non-node packages:
  ```ts
  if (pkg["release-type"] !== "node") continue;
  ```
* **Suggestion:** Since Python packages (`pyproject.toml`) will be introduced in PR 2, we should prepare the guard to validate their version on disk as well. Since adding a TOML parser dependency is restricted, we can suggest a simple regex validator to extract the version string from `pyproject.toml`:
  ```ts
  // Example simple regex check for pyproject.toml version
  const toml = readFromRepo(`${path}/pyproject.toml`);
  const versionMatch = toml.match(/^version\s*=\s*["']([^"']+)["']/m);
  if (versionMatch) {
    expect(versionMatch[1]).toBe(manifest[path]);
  }
  ```

---

## 3. Workflow & Actions

### 3.1 Upload/Download Artifact Pinned SHAs
* **Observation:** In Task 4 Step 3, the `download-artifact` action is referenced as:
  ```yaml
  uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
  ```
* **Question:** Is the comment `# v8.0.1` correct, or is it referencing a future/different versioning schema? Currently, `actions/download-artifact` is on `v4` (e.g., `v4.1.7`).
* **Suggestion:** Verify the tag/version comment associated with the pinned SHA to avoid confusion for maintainers checking GHA version history.
