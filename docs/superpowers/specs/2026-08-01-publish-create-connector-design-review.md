# Review of Publishing the Connector Scaffolder Design

This document compiles reviews, improvements, suggestions, and open questions regarding the proposed design for publishing the connector scaffolder (`create-nimbus-connector`).

---

## 1. Invocation Ergonomics and Alternatives (`npx` vs `npm create`)

* **Observation:** The design highlights that getting `--` or `@latest` wrong in `npm create @nimbus-dev/connector@latest my-connector -- --lang python` fails silently and results in a TypeScript project instead of a Python project.
* **Suggestion:** We should recommend and document the direct `npx` invocation as a robust alternative. 
  ```bash
  npx @nimbus-dev/create-connector@latest my-connector --lang python
  ```
  Unlike `npm create` (which wraps `npm init` and intercepts options), `npx` forwards all trailing flags to the executable directly. This removes the risk of `--` being consumed by npm, making the onboarding path less prone to silent failures.

---

## 2. Registry Lag and Post-Publish Smoke Robustness

* **Observation:** The design notes that the post-publish smoke test is highly susceptible to npm registry propagation lag.
* **Suggestion:** To prevent CI pipeline flakes, we suggest:
  * Implementing a structured retry loop in the smoke workflow rather than a simple command rerun.
  * Setting a maximum retry duration (e.g., 5 to 10 minutes) with exponential backoff.
  * Using `--registry=https://registry.npmjs.org/` explicitly, and verifying if a cache-busting technique (like appending a random query parameter to the registry URL or executing `npm cache clean --force` inside the runner) is useful, though `--prefer-online` or `--no-cache` is usually the cleanest first step.

---

## 3. Template Dotfiles and Future Extensibility

* **Observation:** The design introduces `TEMPLATE_FILE_RENAMES` with a single entry `_gitignore` -> `.gitignore`.
* **Suggestion:** While a simple map is preferred over regex patterns, we should verify if any other files in the template directory are vulnerable to default npm stripping/ignores (e.g., `.npmrc` or `.env` templates if they exist/are added later).
* **Recommendation:** In the packaging unit test (`pack-and-generate`), we should add an assertion that ensures *all* files present in the checkout templates directory are present (under their final renamed paths) in the tarball-generated output, preventing silent omission of any new files added in future template versions.

---

## 4. Release-Please Bootstrapping Recommendation

* **Observation:** The design notes that the bootstrap SHA must be pinned to prevent release-please from scanning the entire history and pulling in D1 commits.
* **Recommendation:** We should explicitly recommend specifying `bootstrap-sha` in the release-please config. This should be set to the merge commit SHA of D1 (PR #95) or the commit immediately prior to the implementation of D2, ensuring the changelog for the `0.1.0` release only captures changes introduced in D2.

---

## 5. Python Scaffolding Developer Experience

* **Observation:** The design specifies that Python developers must use the Node CLI at scaffold time.
* **Question:** For environments where Node is completely unavailable or restricted, should we document a containerized fallback?
* **Suggestion:** We can provide a simple `docker` or `podman` runner command in the Python quickstart to run the scaffolder without needing a local Node installation, for example:
  ```bash
  docker run --rm -v "$(pwd)":/app -w /app node:22-alpine npx @nimbus-dev/create-connector@latest my-connector --lang python
  ```
