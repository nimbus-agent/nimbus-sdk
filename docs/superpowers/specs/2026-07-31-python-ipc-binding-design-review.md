# Review of Python IPC Binding Design

This document compiles reviews, improvements, suggestions, and open questions regarding the proposed Python IPC Binding design.

---

## 1. Type Definitions and API Design

### `FlushResult` Structure
* **Observation:** The design mentions `flush_frames() -> FlushResult`, described in a comment as `FlushResult(frames, truncated)`.
* **Suggestion:** To match the pattern set by `contract.py` which uses `frozen` and `slotted` dataclasses, we should explicitly specify that `FlushResult` is either:
  * A `@dataclass(frozen=True, slots=True)` class:
    ```python
    @dataclass(frozen=True, slots=True)
    class FlushResult:
        frames: list[str]
        truncated: bool
    ```
  * Or a `NamedTuple`. Given `contract.py`'s preference for `@dataclass(frozen=True, slots=True)`, a dataclass is the recommended approach.

### `FrameTooLongError` Exception Hierarchy
* **Observation:** `FrameTooLongError` is introduced as a custom exception raised when the max line length limit is breached.
* **Question:** Should `FrameTooLongError` inherit from a generic `NimbusError` (if one exists or is planned), or should it inherit from a standard exception class like `ValueError`?
* **Suggestion:** If there is no SDK-wide base exception class yet, have it inherit directly from `Exception` (or `ValueError` if semantic mapping to a bad/oversized argument is preferred), but define it cleanly as a custom exception type in `ndjson.py`.

---

## 2. Parsing and Decoder Edge Cases

### BOM Stripping and State Tracking
* **Observation:** The document specifies that `U+FEFF` (BOM) must be stripped only if it is the first character the decoder ever produces, to handle BOMs split across chunk boundaries.
* **Suggestion:** Clarify how the reader tracks this state. Since the `TextDecoder` equivalent in Python is an incremental decoder, we should recommend tracking a boolean flag like `_first_char_seen: bool = False` or similar on `NdjsonLineReader` instances. Once any characters are emitted (BOM or otherwise), this flag is set to `True`, ensuring that a later `U+FEFF` is treated as a normal character.

### Decoder Line Ending Tolerance
* **Observation:** `NdjsonLineReader` splits lines on newlines.
* **Question:** Does the parser split on `\n` (LF) only, or does it also handle `\r\n` (CRLF)?
* **Recommendation:** Clarify if `\r` (carriage return) characters should be stripped or if the framing spec strictly enforces `\n` (LF) as the delimiter. TypeScript's `NdjsonLineReader` behavior on CR should be matched.

---

## 3. Conformance and Runner Specifics

### `parse_hello` Input Format
* **Observation:** `parse_hello` takes a `str` and parses it into `HelloResult` (union of `HelloOk` | `HelloRefused`).
* **Question:** Should `parse_hello` tolerate a trailing newline character (like `\n` or `\r\n`), or does it expect a pre-trimmed string?
* **Recommendation:** Ensure it is clear whether `parse_hello` performs whitespace stripping or direct JSON loading on the raw string it receives from the line reader.

---

## 4. Test Suite and Mutation Suggestions

### Split BOM Test Cases
* **Suggestion:** In the unit tests, verify a case where the UTF-8 BOM is split across push boundaries (e.g., `push(b'\xef')`, `push(b'\xbb')`, `push(b'\xbf{"a": 1}\n')`). This directly validates that the BOM stripping is deferred until the first character is successfully decoded, rather than checked per-chunk.

### Post-Latching Behavior Unit Tests
* **Suggestion:** Explicitly test the sequence of calls after a latching violation:
  1. `push` with chunk exceeding limit -> raises `FrameTooLongError`.
  2. Substantive subsequent `push` with valid small chunk -> must immediately raise `FrameTooLongError` without updating buffers.
  3. Subsequent `flush_frames()` -> must raise `FrameTooLongError` instead of returning a `FlushResult`.
