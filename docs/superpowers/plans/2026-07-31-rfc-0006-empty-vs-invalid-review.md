# Review of RFC-0006 Empty-vs-Invalid Negotiation Implementation Plan

This document reviews the proposed implementation plan for RFC-0006 empty-vs-invalid negotiation, highlighting observations, potential edge cases, and suggestions for improvement.

---

## 1. Type Annotations & `mypy --strict` in Python Anti-Binding

* **Observation:** In Task 2, Step 4, the type signature for `_short_circuiting_on_empty` is defined as:
  ```python
  def _short_circuiting_on_empty(
      local: Sequence[object], remote: Sequence[object]
  ) -> NegotiationResult:
  ```
  And the test iterates over cases via:
  ```python
  for case in (c for c in CASES if c["kind"] == "negotiate"):
      actual = _short_circuiting_on_empty(case["local"], case["remote"])  # type: ignore[arg-type]
  ```
* **Details:** Since `CASES` is loaded using `load_corpus` which returns `list[dict[str, object]]`, the type of `case["local"]` is `object`. Python's `object` is not compatible with `Sequence[object]`. While the plan correctly includes `# type: ignore[arg-type]` to suppress the error, is it cleaner to cast or assert the types?
* **Suggestion:** To make the test logic strictly type-safe under `mypy` without relying on `type: ignore` (or to justify it more explicitly), one could check or cast the keys:
  ```python
  local = case.get("local")
  remote = case.get("remote")
  assert isinstance(local, list)
  assert isinstance(remote, list)
  actual = _short_circuiting_on_empty(local, remote)
  ```
  If `type: ignore[arg-type]` is preferred to match the rest of the file (e.g., `test_negotiate_cases` at line 42), the current approach is perfectly fine but is worth noting as a deliberate compromise for brevity.

---

## 2. Symmetry and Mirroring of Cases

* **Observation:** The plan implements:
  * `negotiate-empty-local-invalid-remote.json`: `local: []`, `remote: ["01"]`
  * `negotiate-invalid-local-empty-remote.json`: `local: ["01"]`, `remote: []`
  * `negotiate-both-empty.json`: `local: []`, `remote: []`
* **Details:** This covers the empty/invalid permutations comprehensively and ensures a local-only validator or remote-only validator fails the conformance check.
* **Suggestion:** Verify if there's any value in adding a case where both sides are invalid (e.g., `["01"]` vs `["02"]`). As RFC-0006 notes under *Alternatives rejected*, this is rejected as coverage theater because both readings fail with `invalid-version` anyway, but validating the rationale in the plan itself is excellent.

---

## 3. Python Spec Data Cache Traps

* **Observation:** The constraint "Python reads `src/nimbus_sdk/_data/spec`, NOT `docs/spec`" and the requirement to run `python -m pip install -e .` from `sdks/python/` is a critical developer-experience watchpoint.
* **Suggestion:** Since this is a recurring trap for local testing, consider adding a brief warning comment to `sdks/python/tests/test_negotiation_corpus.py` or the readme reminding developers to reinstall/refresh the bundled data if they add new spec files, so future developers working on new RFCs don't lose time debugging why their new cases aren't executing.
