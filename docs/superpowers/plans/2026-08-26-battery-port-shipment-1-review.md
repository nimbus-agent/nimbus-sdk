# Review & Feedback: Battery Port — Shipment 1 (`data-profile`) Implementation Plan

**Date:** 2026-08-26  
**Plan Reference:** [2026-08-26-battery-port-shipment-1.md](./2026-08-26-battery-port-shipment-1.md)

---

## 1. Open Questions

### Q1.1: Go JSON Decoder implementation for Object Key Order
* **Context:** Task 7 notes that Go's standard `encoding/json` into `map[string]any` randomizes key order, which violates the document order requirements in §4 and §5. The plan recommends: "Decode with `json.Decoder` and read the object's keys in document order via `Token()`, or carry an ordered slice of pairs."
* **Question:** Since `Token()` iterates over JSON tokens flatly, decoding nested arrays/objects or handling escaping correctly via manual token parsing can be complex and error-prone. Is there a simple, standardized helper we should write under `sdks/go/internal` or similar, or is the expected `Token()` parsing logic simple enough to keep inline within `dataprofile`?
* **Recommendation:** Provide a minimal example or outline the structure of the token parsing loop in the plan to guide the developer, ensuring they correctly handle token structures (like skipping nested maps/lists when parsing JSON values) without introducing regression bugs.

---

## 2. Technical Suggestions & Improvements

### S2.1: Python Type Hints for Row Count Estimates
* **Context:** In Task 5 Step 1, the plan specifies: "§6.1's `num_rows` becomes a **float**, not an `int`, so that Python agrees with the double every other binding returns."
* **Suggestion:** We should explicitly note that the type annotations for `rowCountEstimate` across Python functions (`parse_json_columns`, `parquet_columns_from_metadata`, and `first_line_and_rows`) should be `float | None` (or `int | float | None` if both can be returned) to avoid strict `mypy` failures.

### S2.2: Go Type for `rowCountEstimate`
* **Context:** Task 7 Step 1 mentions: "Row count is a `float64` per §6.1, not an `int64`."
* **Suggestion:** Since `rowCountEstimate` can be `null`, in Go it should be typed as `*float64` (a pointer to `float64`), allowing `nil` to represent the absence of a value. We should document this explicitly in Task 7's interface description to avoid ambiguity.

### S2.3: Clarify `js-kind` expectation schema
* **Context:** In Task 1 Step 2, the schema lists `{ "expect": {} }` and then maps `js-kind` expectations to `{ "kind": "<one of the ten §2 strings>" }`.
* **Suggestion:** Clarify in the test runners' description how this expectation is evaluated, confirming that the test runner compares `{ "kind": jsKind(val) }` to the expectation object rather than asserting the return value of `jsKind` directly equals `expect`.

---

## 3. Disposition — resolved

All four accepted; none deferred. Recorded after verifying each against the code and, for
the two that produce code, executing it.

| # | Verdict | Where it landed |
|---|---|---|
| Q1.1 | **Accepted** — loop written out and executed | Task 7 Step 1a |
| S2.1 | **Accepted, and sharpened** | Task 5 Step 1 |
| S2.2 | **Accepted — and it is required, not stylistic** | Task 7 Step 1 |
| S2.3 | **Accepted, resolved the other way** | Task 1 Step 2 |

### Q1.1 — the Go ordered-object decode

Right that "or carry an ordered slice of pairs" was hand-waving, and right that flat
`Token()` iteration is where this goes wrong. The plan now carries the loop in full —
`objectKinds`, `kindOfToken`, `skipComposite` — rather than describing it.

The simplification that makes it tractable, and that the plan now states: **this battery
never needs a nested value, only its kind.** A composite is identified by its opening
delimiter and then skipped wholesale by depth counting, so there is no recursive decode to
get wrong.

It was compiled and run before being committed, against a deliberately adversarial object:
keys out of alphabetical order, a nested object containing a nested array, an array of
objects, and the value `"}{"`. Document order held across all six keys. That last value is
also the answer to "why not count braces by hand" — a manual scanner walks into a brace
inside a string literal; `Token()` is a real tokenizer and does not.

On the `sdks/go/internal` question: no. One package needs this today, `connectorkit`
already carries its own fold helper rather than sharing one, and adding an internal package
is a layout decision this shipment has no mandate to make. The plan says to lift it when a
second caller exists.

### S2.1 — Python row-count annotations

Accepted, with the reasoning made explicit rather than left as a `mypy` workaround.
`float | None` is not a compromise between `int` and `float` — it is the only annotation
that covers both, because PEP 484's numeric tower makes `int` acceptable where `float` is
declared, and not the reverse. Python genuinely returns an `int` from §5's `len(value)` and
§7's line count, and a genuine `float` from §6.1's conversion.

One consequence the suggestion did not draw, now in the plan: this makes the runner's
comparison load-bearing. It MUST compare **numerically**, never by type — `3 == 3.0` is
`True`, but a runner asserting `type(actual) is type(expected)` would fail every §5 and §7
case against a corpus that spells its counts as JSON integers.

### S2.2 — Go `*float64`

Accepted, and the reason is stronger than the suggestion states. This is not a matter of
representing `null` tidily: preamble §R6 tells a Go binding that absence is *the zero
value*, and **that guidance is actively wrong for this field**, because §7.1 makes `0` a
real, reachable answer — `FirstLineAndRows("", false)` returns a row count of zero, which a
zero-value convention cannot distinguish from `null`. A pointer is the only shape that
separates them.

The plan now says so at the point of use, so an implementer following §R6 literally does
not produce a binding that passes review and fails the corpus. §R6 itself is not amended:
it governs functions returning an absence for uninterpretable input, and a `null` row count
is "not applicable" rather than "could not interpret".

### S2.3 — how `js-kind` is compared

Accepted that it was ambiguous. **The resolution recorded here was wrong, and is corrected
below** — caught in review of PR #190, where the shipped guard did not match this record.

What was written: that the runners compare the member, `jsKind(value)` against
`expect.kind`, because comparing whole objects "starts silently ignoring members the moment
`expect` grows one".

That has it backwards. `expect(run(body)).toEqual(body.expect)` on `{kind}` against a
grown `{kind, …}` **fails loudly** — deep equality is not satisfied by a subset. It is the
*member* comparison that would silently ignore a new member, by never looking at it.

So the shipped form is the correct one, and the record is what moves: **all three runners
compare the whole result shape against the whole `expect` object**, with deep equality
(`toEqual` in TypeScript, a key-set assertion plus per-key comparison in Python, and the
same in Go). `run()` returning `{ kind: jsKind(value) }` for `js-kind` is what gives every
kind one comparison path, which was the other half of the original reasoning and remains
right.

The one refinement worth keeping from the original instinct: the runners compare the
**shape** first (`set(actual) == set(expect)`), so a new member in `expect` fails as a shape
mismatch naming the case, rather than as a value diff.

`expect` nonetheless stays an object for `js-kind` rather than becoming a bare string: every
other kind needs an object, and one uniform shape gives each of the three runners a single
comparison path instead of a special case that only `js-kind` exercises — which would be the
one most likely to rot. The plan now gives the assertion for all three languages explicitly.

Also corrected while here: the schema note said "one of the ten §2 strings" where a case may
only use the **six** §2.1 strings reachable from JSON. The other four are undefined for
non-JavaScript bindings under preamble §R3, and a case pinning one would violate the
preamble rather than add coverage.
