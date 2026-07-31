# Review of Handshake Runtime Design

This document compiles reviews, improvements, suggestions, and open questions regarding the proposed Handshake Runtime design.

---

## 1. API Consistency & Asynchrony in Python

### Asynchronous vs. Synchronous `perform_handshake` in Python
* **Observation:** The TypeScript entry point returns `Promise<ContractNegotiationResult>`, indicating asynchronous execution. The Python entry point is documented as returning `NegotiationResult` (synchronously or asynchronously).
* **Question:** Is Python's `perform_handshake` intended to be `async`? Given that it performs I/O on the injected `io` object (which typically involves waiting for streams), it likely needs to be asynchronous:
  ```python
  async def perform_handshake(io: HandshakeIO, *, local_versions = ...) -> NegotiationResult:
  ```
* **Suggestion:** Explicitly define the Python `HandshakeIO` protocol/interface (using `typing.Protocol` or `typing.Awaitable` return types for `read`/`write` methods) to match the asynchronous nature of TypeScript's `HandshakeIo`.

### Naming Consistency for Result Types
* **Observation:** The TypeScript return type is `ContractNegotiationResult`, whereas Python's is listed as `NegotiationResult`.
* **Suggestion:** Align the names across both languages to reduce friction for developers moving between the two SDKs. Recommend using `ContractNegotiationResult` (or `NegotiationResult`) consistently for both.

---

## 2. Handshake I/O Protocols

### Python Protocol Definition
* **Suggestion:** Define the structural typing expectation for Python's `io` parameter using a `Protocol`:
  ```python
  from typing import Protocol, Optional

  class HandshakeIO(Protocol):
      async def read(self) -> Optional[bytes]: ...
      async def write(self, chunk: bytes) -> None: ...
  ```
  *(Note: Python typically handles binary I/O with `bytes` rather than `Uint8Array` equivalent, which should be explicitly documented).*

---

## 3. Liveness and Timeout Management

### Handshake Timeouts
* **Observation:** The design specifies writing a hello first, then reading until one frame completes.
* **Question:** What happens if the peer connects but never sends any bytes, or sends bytes extremely slowly? Since liveness is out of scope for the wire spec, does the SDK handshake runtime also treat timeouts as out of scope?
* **Suggestion:** Clarify whether the caller is expected to wrap the handshake promise/coroutine in their own timeout handler, or if the `performHandshake` API should accept an optional timeout parameter (e.g., `options?: { timeoutMs?: number }`).

---

## 4. Integration with `NimbusExtensionServer`

### Server Handshake Flow
* **Observation:** `NimbusExtensionServer` gains a delegating method `handshake(io)`.
* **Question:** After `handshake(io)` successfully negotiates a version, does the server store the negotiated version on itself for later use during message serialization/deserialization?
* **Suggestion:** Clarify the post-handshake state machine of `NimbusExtensionServer`. E.g., does it transition to a `CONNECTED` or `ACTIVE` state, and does it validate that a handshake has run before allowing other operations?
