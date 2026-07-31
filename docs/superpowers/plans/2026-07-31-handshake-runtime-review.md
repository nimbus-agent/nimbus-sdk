# Review of Handshake Runtime Implementation Plan

This document compiles reviews, improvements, suggestions, and open questions regarding the proposed Handshake Runtime implementation plan.

---

## 1. Python API Design & Consistency

### Attribute-Based Success Check (`ok` property)
* **Observation:** TypeScript's `HandshakeResult` is a discriminated union using `{ ok: true, version }` and `{ ok: false, reason }`. Python's `HandshakeResult` uses dataclasses `HandshakeOk` and `HandshakeRefused`.
* **Details:** In Python, checking the status of the result requires type checking (`isinstance(result, HandshakeOk)`), which differs from the TypeScript pattern (`result.ok`).
* **Suggestion:** Add an `ok` attribute or property to both dataclasses to allow callers to write code that behaves consistently across both environments:
  ```python
  @dataclass(frozen=True, slots=True)
  class HandshakeOk:
      version: str
      ok: bool = True

  @dataclass(frozen=True, slots=True)
  class HandshakeRefused:
      reason: str
      ok: bool = False
  ```
  This enables simple `if result.ok:` checks in Python as well.

---

## 2. Synchronous Python Handshake vs. Async Connectors

### Blocking I/O in Async Python Environments
* **Observation:** The plan deliberately specifies that `perform_handshake` in Python is synchronous, unlike TypeScript's asynchronous `performHandshake`.
* **Details:** Python's standard streams can block. If a Python connector is built using an asynchronous event loop (e.g., using `asyncio` for tool handling, gateway communication, or other background tasks), a synchronous handshake that blocks on I/O operations will block the entire event loop.
* **Question:** Will Python connectors only be supported in synchronous CLI/process contexts, or should the Python SDK also provide an asynchronous handshake sibling (e.g., `async_perform_handshake`) or make `perform_handshake` support both async and sync IO protocols?
* **Recommendation:** Consider exposing an async variant or specifying how an async connector is expected to run the synchronous handshake (e.g., executing it in a separate thread pool using `asyncio.to_thread`).

---

## 3. Trailing Carriage Returns (`\r`) Handling

### CRLF in Differential Test Fixtures
* **Observation:** Task 4, Step 1 introduces the `crlf-terminated` exchange fixture, which ends with `\r\n` and expects `ok:1`.
* **Details:** This assumes that the underlying `NdjsonLineReader` in both languages successfully strips the trailing carriage return (`\r`) along with the line feed (`\n`). If one of the bindings fails to strip `\r`, the parsed hello frame will contain a trailing `\r` character, which might cause parsing or validation failures.
* **Suggestion:** Verify that the `NdjsonLineReader` tests for both Python and TypeScript already cover CRLF line endings, or add explicit tests for trailing carriage returns to both suites to guarantee correct behavior prior to implementing the handshake runtime.
