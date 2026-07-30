# Review of Contract-Version Negotiation Design

This document compiles reviews, improvements, suggestions, and open questions regarding the proposed contract-version negotiation design.

---

## 1. Ambiguities & Potential Typos

### Stream Alignment ("Input" vs. "Output")
* **Observation:** In §3 (The Handshake), the text states:
  > The connector's first frame on its output stream, and the gateway's first frame on its input stream, MUST each be:
  > `{"nimbus":"hello","contractVersions":["1"]}`
* **Question:** Should "gateway's first frame on its input stream" be "gateway's first frame on its **output** stream"? 
* **Details:** As written, it could be interpreted as the gateway *receiving* the hello frame from the connector on its input stream, rather than the gateway *sending* its own hello frame to the connector. If both peers announce unprompted, both must write to their respective output streams (e.g., Connector stdout -> Gateway stdin; Gateway stdout -> Connector stdin).

### Whitespace and Framing Tolerance
* **Observation:** The handshake frame is defined as `{"nimbus":"hello","contractVersions":["1"]}`.
* **Suggestion:** Clarify if whitespace variation is tolerated (e.g., `{"nimbus": "hello", "contractVersions": ["1"]}`). Since it's framed via NDJSON, it must be a single line, but we should specify that parser implementations must tolerate standard JSON formatting variations (spaces, member ordering within the JSON object) rather than performing raw string/byte equality checks on the hello frame.

---

## 2. Protocol Robustness & Operational Safety

### Handshake Timeout
* **Observation:** Both peers announce unprompted. If one peer hangs, crashes, or fails to emit any frame, the other peer might wait indefinitely.
* **Suggestion:** Recommend or mandate a handshake timeout (e.g., 5 seconds). If a peer does not receive the hello frame within this window, it should refuse connection, clean up resources, and exit.

### Standard Output (stdout) Logging Hazards
* **Observation:** Connectors often communicate via stdin/stdout. If a connector or library prints debug logs, warnings, or initialization text to stdout *before* sending the hello frame, the gateway will fail to parse the hello frame (Refusal #3).
* **Recommendation:** Explicitly warn developers/binding authors that stdout must not be polluted before the handshake, and all diagnostic logging must go to stderr.

---

## 3. Algorithm & Negotiation Edge Cases

### Major Version Evolution
* **Observation:** The contract version is a string containing a major version decimal (e.g., `"1"`, `"2"`, `"10"`).
* **Question:** What happens to the negotiation handshake itself in `v2`?
  * If a gateway only supports `v2` and a connector only supports `v1`:
    * Connector sends `{"nimbus":"hello","contractVersions":["1"]}`.
    * Gateway sends `{"nimbus":"hello","contractVersions":["2"]}`.
    * Intersection is empty, both exit/refuse.
  * This implies the handshake message schema/format itself (`{"nimbus":"hello", "contractVersions": [...]}`) must remain backwards compatible across *all* future major versions.
  * **Suggestion:** Add a design constraint/note stating that the format of the hello handshake frame itself is permanently locked or must remain parseable by future versions of the contract.

### Empty String or Leading Zeros in Algorithm Comparison
* **Observation:** §4 specifies that comparison is numeric rather than lexicographical, and `"10"` is greater than `"9"`.
* **Question:** How should bindings handle malformed input in the algorithm? While §5 says malformed inputs cause refusal, it is important to specify if the comparison helper should reject inputs like `"01"` or empty strings prior to parsing, or if the hello-parsing step is the sole gatekeeper.
* **Suggestion:** Explicitly state that `negotiateContractVersion(local, remote)` should assume inputs have already passed the validation rules, or define behavior if they haven't.

---

## 4. Test Suite and Conformance Suggestions

### Intersecting Multiple Versions (Sorting check)
* **Suggestion:** Add a conformance test case where the sets intersect on multiple versions, e.g., local `["1", "3", "2"]` and remote `["2", "3"]`.
  * The algorithm must select `"3"` (numerically largest), validating both the intersection logic and the descending numeric sort order.

### Refusal Exit Code Assertions
* **Observation:** The connector exits with code `20` on refusal.
* **Suggestion:** Ensure the conformance test suite or local test suite verifies that the connector actually exits with `20` when subjected to mismatch/refusal inputs, ensuring bindings implement this exit code correctly.
