# Review & Feedback: Battery Port — Shipment 3 (`icalendar`) Implementation Plan

**Date:** 2026-08-28  
**Plan Reference:** [2026-08-28-battery-port-shipment-3.md](./2026-08-28-battery-port-shipment-3.md)

---

## 1. Open Questions

### Q1.1: Unfolding Line Endings (CRLF vs. LF vs. CR)
* **Context:** The plan notes in Task 1 Step 3 that §2 cases will include "an LF-only document" and a "lone `\r` followed by a space is **not** a fold".
* **Question:** Does the unfolding behavior only target `\r\n ` and `\r\n\t`, or should it also target `\n ` / `\n\t`? 
* **Recommendation:** Clarify in the plan if `\n ` / `\n\t` (without `\r`) are valid folds to be unfolded, or if the parser should first normalize all line endings (e.g. converting `\n` to `\r\n` or vice-versa) before unfolding, or if unfolding should match both CRLF and LF fold sequences directly.

### Q1.2: Exact Unescaping Spec and Single-Pass Processing
* **Context:** Task 5 Step 1 highlights that unescaping must be a single-pass implementation because sequential replaces (like `.replace("\\\\", "\\").replace("\\n", "\n")`) are incorrect and fail on `\\n` (which should yield `\n`).
* **Question:** What is the exhaustive mapping for any backslash escape sequence?
* **Recommendation:** Explicitly document the escape character mappings. For example:
  - `\\` $\rightarrow$ `\`
  - `\n` or `\N` $\rightarrow$ `\n` (newline)
  - `\,` $\rightarrow$ `,`
  - `\;` $\rightarrow$ `;`
  - `\<any other char>` (e.g. `\q`) $\rightarrow$ `<char>` (e.g. `q`)
  - Trailing `\` at the end of a string $\rightarrow$ `\`

---

## 2. Technical Suggestions & Improvements

### S2.1: Go and Python ASCII-Only Folding Implementation
* **Context:** Task 3 Step 3 and Task 7 specify that case folding for `mailto:` must map `A-Z` to `a-z` only, ensuring it is length-preserving in UTF-16, UTF-8, and bytes.
* **Suggestion:** To avoid any regex or complex locale issues, recommend clean, standard library implementations of `fold_ascii`/`foldASCII` for both Go and Python in the plan:
  - **Go:**
    ```go
    func foldASCII(s string) string {
        var sb strings.Builder
        sb.Grow(len(s))
        for i := 0; i < len(s); i++ {
            c := s[i]
            if c >= 'A' && c <= 'Z' {
                sb.WriteByte(c + 32)
            } else {
                sb.WriteByte(c)
            }
        }
        return sb.String()
    }
    ```
  - **Python:**
    ```python
    def fold_ascii(s: str) -> str:
        return "".join(chr(ord(c) + 32) if 'A' <= c <= 'Z' else c for c in s)
    ```

### S2.2: Use Standard Web APIs in the TypeScript Guard
* **Context:** Task 2 Step 1 contains a test assertion using `Buffer.byteLength(body.expect.ics, "utf8")`.
* **Suggestion:** Since we are executing tests in `bun`, we can use the standard Web API `new TextEncoder().encode(body.expect.ics).length` instead of the Node-specific `Buffer` API. This keeps the test guards aligned with standard Web platform interfaces where possible.

### S2.3: Go Struct Unmarshaling for Expected Values
* **Context:** Task 8 Step 2 notes that the Go runner needs to distinguish JSON `null` from `""` for the `*string` fields in `ParsedEvent`.
* **Suggestion:** Explicitly suggest decoding the case `expect` structure directly into a `ParsedEvent` struct (or a test-specific replica) using `json.Unmarshal`. Go's `json` decoder natively decodes JSON `null` to `nil` for pointers and a JSON string to a pointer to that string, making verification and `reflect.DeepEqual` comparison simple and robust.
