# Review of Python IPC Binding Implementation Plan

This document compiles reviews, improvements, suggestions, and open questions regarding the proposed Python IPC Binding implementation plan.

---

## 1. Performance & $O(N^2)$ Complexity in `push`

* **Observation:** In Task 2, Step 3, the `NdjsonLineReader.push` method performs a byte-length check on the remaining pending buffer on every call:
  ```python
  if len(self._pending.encode("utf-8")) > IPC_MAX_LINE_BYTES:
      self._too_long()
  ```
* **Details:** Since `_pending` is a string, calling `.encode("utf-8")` on every chunk push creates a new `bytes` object and processes the entire buffered string. If a caller feeds a 1MB stream in small 1-byte or 10-byte chunks, this results in $O(N^2)$ byte-encoding operations, which could cause high CPU usage or test timeouts.
* **Suggestion:** Optimize the check by using string length bounds. Since 1 UTF-8 character is at least 1 byte, and at most 4 bytes:
  1. If `len(self._pending) > IPC_MAX_LINE_BYTES`, it is guaranteed to exceed the byte limit.
  2. If `len(self._pending) * 4 <= IPC_MAX_LINE_BYTES` (e.g. fewer than 262,144 characters), it cannot possibly exceed the byte limit, and the expensive `.encode("utf-8")` call can be skipped entirely.
  This ensures that we only encode and check when the string length is in the zone where it could actually cross the 1MB threshold.

---

## 2. Invalid UTF-8 Replacement and Limit Checks

* **Observation:** The incremental decoder is configured with `errors="replace"`.
* **Details:** When invalid UTF-8 sequences are replaced by `\ufffd` (which is 3 bytes in UTF-8), the length of the decoded string in UTF-8 bytes can be larger than the original raw bytes.
* **Question:** Does the conformance suite/framing spec expect the limit checks to be performed against the raw input octets (before decoding/replacement) or the decoded string representation (after replacement)?
* **Recommendation:** If the spec defines the limit in terms of the input stream octets, checking `len(trimmed.encode("utf-8"))` on the replaced string might reject a line that was exactly 1MB of raw bytes but expanded during replacement. Clarify if this edge case is expected or handled by the conformance suite.

---

## 3. Position-Parallel Exception Handling in Loop

* **Observation:** In Task 3, Step 1, the test runner checks parallel pushes using a loop:
  ```python
  for chunk, wanted in zip(chunks, pushes, strict=True):
      octets = _octets(chunk)
      if isinstance(wanted, dict) and "error" in wanted:
          assert wanted["error"] == "frame-too-long"
          with pytest.raises(FrameTooLongError):
              reader.push(octets)
  ```
* **Details:** If a chunk raises `FrameTooLongError`, the `pytest.raises` context manager handles it and the loop proceeds to the next iteration. This behaves correctly for latching verification where subsequent chunks are also expected to raise an error.
* **Suggestion:** Explicitly document this behavior in a comment in the test runner to prevent future developers from thinking the loop aborts on the first raised exception.
