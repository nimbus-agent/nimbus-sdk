# Review of Diagnostics / Telemetry Contract v0 Design

This document compiles reviews, improvements, suggestions, and open questions regarding the proposed diagnostics and telemetry contract v0 design.

---

## 1. Ergonomics & API Design

### Emitter Method Signature and Asynchrony
* **Observation:** The usage example shows:
  ```ts
  await nimbus.info("sync.page", { ts, fields: { items: 42, ms: 118 } });
  ```
  And the emitter initialization takes a callback:
  ```ts
  const nimbus = createEmitter("acme-gcal", (line) => process.stderr.write(line + "\n"));
  ```
* **Questions:**
  * Why are the logging methods (`info`, `audit`, etc.) asynchronous (`await`ed)? If the underlying encoding is pure and synchronous, is the emitter returning a `Promise` because the `emit` callback is allowed to return one (e.g., for async streams)?
  * If the callback is synchronous (like `process.stderr.write`), does the emitter still return a `Promise`, or does it support both synchronous and asynchronous callbacks?
  * If the logging helper is async, it forces the user to write `await nimbus.info(...)` or float the promise. Clarifying the signature of the emitter helper would resolve this.

### Ergonomics of `ts` in the Emitter
* **Observation:** The contract requires `ts` (timestamp) to be provided in a strict ISO string format. In the example, the caller must manually supply `ts` in the payload: `{ ts, fields: ... }`.
* **Suggestion:** While the contract *encoder* must be pure and receive the timestamp from its caller, the high-level *emitter wrapper* (`createEmitter`) could make `ts` optional in its input type and automatically default it to `new Date().toISOString()` when omitted. This maintains validation purity in the SDK core while saving developers from writing boilerplates like `ts: new Date().toISOString()` on every log call.

---

## 2. Validation & Character Set Restrictions

### Exposing Only Alphanumeric Characters in Event Names, Errors, and Fields
* **Observation:** The regex rules are:
  * `event`: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`
  * `error.code`: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`
  * `fields` keys: `^[a-z][a-z0-9]*$`
* **Question:** Is the exclusion of hyphens (`-`) and underscores (`_`) from these fields fully deliberate? 
  * Developers commonly use snake_case (`sync_page`) or kebab-case (`sync-page`) for event names, fields, and error codes.
  * Hyphens and underscores are permitted in `correlationId` (`^[A-Za-z0-9_-]{1,64}$`) and hyphens appear in the `extensionId` example (`acme-gcal`).
  * If snake_case/kebab-case are disallowed, it should be highlighted as a strict design choice, or the regex should be updated to allow them (e.g., `^[a-z][a-z0-9_-]*...`).

### ISO Timestamp String Formatting in Python
* **Observation:** The `ts` field requires `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`.
* **Details:** In Python, calling `datetime.now(timezone.utc).isoformat()` typically produces a string with 6 fractional digits (microseconds) and a `+00:00` offset suffix instead of `Z` (e.g., `2026-08-01T20:30:00.123456+00:00`).
* **Suggestion:** Since Python does not ship an emitter wrapper in v0, the design should explicitly warn Python SDK consumers about this difference, or provide a helper function to correctly format standard Python datetimes into the strict contract-compliant string to avoid instant validation failures.

---

## 3. Error Handling and Emitter Behavior

### Emitter Behavior on Encoding Failures
* **Observation:** The SDK's encoder is total and never throws (`EncodeResult` returns `{ ok: false, reason, path }`).
* **Questions:**
  * When using the high-level emitter (`nimbus.info(...)`), what happens if validation fails (e.g., a field has a float value, or a key has invalid characters)?
  * Does the emitter silently drop the line, print a warning to console, or throw a runtime error? 
  * Throwing could prevent invalid code from reaching production, but throwing in production could cause critical connector crashes over minor diagnostic validation issues. A clear policy (e.g., crash in dev/test, warn/drop in production) should be outlined.
