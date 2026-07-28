# Review of RFC-0001: A normative wire spec for NDJSON framing

This document captures review comments, open questions, improvements, and suggestions for [RFC-0001](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/phase1-contract-spec/docs/rfcs/0001-ipc-framing-spec.md).

---

## 1. Character Encoding & Stream Decoding Boundaries

### The Issue
UTF-8 characters can be up to 4 bytes long. When reading from a stream (like `stdio` or a TCP socket), a chunk boundary can cut directly through a multi-byte UTF-8 character sequence.

* **In JavaScript/TypeScript:** If bytes are decoded chunk-by-chunk using `TextDecoder.decode(chunk)` without passing `{ stream: true }`, the incomplete multi-byte sequence at the end of the chunk is eagerly replaced with `U+FFFD` (replacement character). When the next chunk arrives with the remaining bytes of the character, they will also be treated as invalid and replaced.
* **Propose Clarification:** The RFC mentions `TextDecoder("utf-8", { fatal: false })` in the reference implementation. It should explicitly state whether conformant readers MUST buffer incomplete UTF-8 byte sequences across chunk pushes, or if chunk-level decoding without stream buffering is acceptable.
* **Suggestion:** Specify that decoding must be stream-aware (i.e., buffering partial UTF-8 sequences at chunk boundaries until complete or EOF is reached).

---

## 2. Size Limit Enforcement Recovery

### The Issue
The RFC states:
> "A reader MUST reject an oversized frame rather than buffer it, and MUST apply the same limit to the unterminated pending buffer, so that a peer cannot exhaust memory by never sending a newline."

* **Question:** What is the recovery strategy after a frame size limit violation occurs?
  1. **Fatal Error:** The stream reader immediately enters an error state, stops reading, and closes the connection/process (standard behavior for framing errors).
  2. **Discard and Resume:** The reader discards all subsequent bytes until it encounters the next LF (`0x0A`), and then resumes normal framing.
* **Recommendation:** Since framing errors typically indicate a protocol violation or a compromised/malfunctioning peer, the specification should recommend or mandate that a size limit violation is a **fatal protocol error** that should terminate the reader session.

---

## 3. Byte Order Mark (BOM) Handling

### The Issue
If a peer starts the stream with a UTF-8 BOM (`0xEF, 0xBB, 0xBF`), does the specification require it to be stripped, or will it be treated as leading payload content (which would make the first frame's JSON payload invalid)?
* **Recommendation:** Explicitly state whether a UTF-8 BOM at the beginning of the stream is allowed/stripped, or if the stream MUST NOT contain a BOM. Standardizing on "BOM is forbidden / stream must not start with a BOM" matches modern RFC patterns.

---

## 4. API Design for Polyglot Bindings (Decision b)

### The Issue
To support distinguishing truncated frames on EOF, the TypeScript reference implementation proposes:
```ts
flushFrames(): { frames: string[]; truncated: boolean }
```

* **Observation:** In other languages (e.g. Python, Rust, Go), returning a structured dictionary or tuple from a flush/close method is common, but languages with strong typing or specific async stream conventions might handle this differently.
* **Suggestion:** Provide non-normative recommendations for how other languages should express the `truncated` state (e.g., throwing a `TruncatedStreamError`, returning a custom result type, or invoking a truncation callback).

---

## 5. Keep-Alive / Heartbeat Empty Frames

### The Issue
Under **Decision (a)**, empty frames are ignored.
* **Observation:** Using empty lines (e.g. just `\n`) is a common pattern for keep-alive/heartbeat signals in line-delimited streaming protocols.
* **Suggestion:** Explicitly mention in the spec that empty frames (lines containing only optional CR and LF) are valid for keep-alive purposes and MUST be silently discarded by conformant readers without triggering errors or output.
