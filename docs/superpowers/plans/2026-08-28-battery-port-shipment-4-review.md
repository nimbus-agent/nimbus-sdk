# Review & Feedback: Battery Port — Shipment 4 (`jmap`) Implementation Plan

**Date:** 2026-08-28  
**Plan Reference:** [2026-08-28-battery-port-shipment-4.md](./2026-08-28-battery-port-shipment-4.md)

---

## 1. Open Questions

### Q1.1: Error Schema Consistency for Conformance Cases (`raises` vs `message`)
* **Context:** In `url-resolution`, the case schema maps failures using `{ ok: false, reason: string, message: string }`. In Task 1 Step 2 of this plan, the expectation for `validate-url` uses `{ url: string }` or `{ raises: string }` under a `oneOf` branch.
* **Question:** Is there a preference for standardizing the schema structures for failure cases across all conformance tests, or is using the `{ raises: ... }` variant the preferred contract/style for JMAP?
* **Recommendation:** If standardizing, define the `case.schema.json` format to align with preceding batteries where applicable, or document the rationale for the variant in the plan.

### Q1.2: URL Host/Userinfo Normalization Parity
* **Context:** §5.2 states that the URL parser's own `host` accessor should handle case and userinfo normalization rather than manual parsing. 
* **Question:** Do all three target language URL parsers behave identically regarding userinfo and case normalization? Specifically:
  - Python: `urllib.parse.urlsplit` / `urlparse` requires checking `.hostname` (which is lowercased) and `.port` separately, as `.netloc` retains userinfo and raw casing.
  - Go: `net/url`'s `URL.Host` strips userinfo but retains port if present.
* **Recommendation:** Explicitly detail the composition/normalisation step for each language runner/binding to guarantee they compare identical string structures.

---

## 2. Technical Suggestions & Improvements

### S2.1: In-Place Go Rune Truncation to Avoid Allocations
* **Context:** Task 7 specifies that Go truncation must count runes, not bytes, suggesting `[]rune(s)[:2000]`.
* **Suggestion:** Converting a potentially large email string `s` to a `[]rune` allocates a new slice of runes. To avoid unnecessary memory allocation, recommend using a `range` loop to locate the byte index of the 2000th rune:
  ```go
  func capPreview(normalized string) string {
      // ... normalization steps ...
      count := 0
      for idx := range normalized {
          if count == 2000 {
              return normalized[:idx]
          }
          count++
      }
      return normalized
  }
  ```

### S2.2: Thread-Safety and Cleanup of python transport test server
* **Context:** Task 0 suggests adding `SEEN_BODY` to Python's test server.
* **Suggestion:** Since `pytest` might run tests in parallel in some environments (e.g. if `pytest-xdist` is introduced), utilizing global state dicts (`SEEN` and `SEEN_BODY`) can lead to race conditions. A thread-safe lock or container, or storing the request history inside the `HTTPServer` instance, would make the test server more robust.

### S2.3: Python `isinstance` Check for Boolean `size`
* **Context:** Task 5 mentions that `isinstance(v, bool)` must be checked first before evaluating `math.isfinite` for the `sizeBytes` member.
* **Suggestion:** Explicitly document the recommended check snippet in Python:
  ```python
  # Since bool is a subclass of int in Python:
  if isinstance(size_val, bool) or not isinstance(size_val, (int, float)) or not math.isfinite(size_val):
      # treat size_val as absent
  ```
