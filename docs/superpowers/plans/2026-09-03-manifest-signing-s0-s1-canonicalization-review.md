# Review & Feedback: Manifest Signing S0–S1 Implementation Plan

**Date:** 2026-09-03
**Plan reference:** [2026-09-03-manifest-signing-s0-s1-canonicalization.md](./2026-09-03-manifest-signing-s0-s1-canonicalization.md)
**Design reference:** [2026-09-02-manifest-signing-design.md](../specs/2026-09-02-manifest-signing-design.md)
**Reviewer disposition:** three blocking, two significant, two deferred.

The three blocking findings are all the same species as the bug this whole shipment
exists to fix — a rule that reads unambiguously in one language and means something
different in another. Two of them are in the plan's own reference implementations, which
is the more useful place to catch them than in CI.

---

## 0. What this review measured

| Input | TypeScript | Python | Go |
|---|---|---|---|
| `JSON` escape `"\ud800"` | 1 unit, U+D800 | 1 char, U+D800 | **3 bytes, `ef bf bd`** (U+FFFD), no error |
| `JSON` literal `1.0` | `1`, `Number.isInteger` → `true` | `float 1.0` | `json.Number("1.0")` under `UseNumber` |

Measured on Node 22, CPython 3.14, Go 1.27.

---

## 1. Blocking findings

### P1: The corpus cannot express a lone surrogate, so `string-lone-surrogate-rejected` would fail Go for the wrong reason

The plan's Task 5 lists a corpus case pinning `lone-surrogate`, with the input written as
the JSON escape `"\ud800"`. Every runner loads its cases through its own JSON decoder
first — and **Go's silently substitutes U+FFFD and returns no error**, as measured above.

So the case would behave like this:

| Binding | What the binding receives | Verdict |
|---|---|---|
| TypeScript | a string holding U+D800 | rejects `lone-surrogate` ✓ |
| Python | a string holding U+D800 | rejects `lone-surrogate` ✓ |
| Go | a string holding U+FFFD | canonicalizes it successfully ✗ |

Go's binding is not wrong. Its *decoder* mangles the input before the binding is reached,
so the case tests something different in Go than in the other two — which is precisely
what a language-neutral corpus may not do. This is the same root cause CLAUDE.md already
records for diagnostics: Go's standard library counts and substitutes where the web
platform preserves.

**Recommendation.** Remove the case from the corpus and pin `lone-surrogate` in each
binding's **unit** tests, where each can construct the input natively — a JS string
literal, a Python `str`, and a Go `[]byte{0xED, 0xA0, 0x80}`. Then:

- Drop the guard's blanket *"every published rejection token is asserted by at least one
  case"* to *"every token except `lone-surrogate`"*, with a comment stating why, so the
  exemption is visible rather than an apparent oversight.
- Record the same fact in `canonical-json.md` §6, so the next person to notice the
  missing case finds the reason in the normative document rather than rediscovering it.
- Lower the case-count floors from 22 to 21 in all three runners.

### P2: The three bindings disagree on an integral float, and the spec sentence cannot be satisfied by TypeScript

`canonical-json.md` §5 as drafted says *"Integers only."* That is ambiguous between the
JSON **literal** (`1` vs `1.0`) and the **value** — and the ambiguity is not academic,
because the plan's own three implementations resolve it three different ways:

| Binding | Plan's implementation on `1.0` | Result |
|---|---|---|
| TypeScript | `Number.isInteger(1)` → true | emits `1` |
| Python | `isinstance(value, float)` → raise | `non-integer-number` |
| Go | `ParseInt` fails, integral-float branch | `number-out-of-range` |

Three bindings, three answers, on an input any manifest may legitimately contain.

**The rule must be value-integral, because TypeScript cannot implement anything else.**
`JSON.parse("1.0")` returns `1`; the literal is destroyed before any binding code runs,
so no TypeScript implementation can distinguish `1` from `1.0` at any price. A
literal-based rule would be unimplementable in the reference binding — the same shape as
the NFC constraint, where Go's limitation forced the rule.

**Recommendation.**

- §5 states explicitly: a number is an integer if its **value** is integral; the literal
  form is not observable and MUST NOT be consulted. `1.0`, `1e2` and `1` are the same
  number and canonicalize identically, to `1`, `100` and `1`.
- Python: test `float.is_integer()` before rejecting, then range-check, then emit
  `str(int(value))`.
- Go: parse the literal to a float and apply the same value test.
- Add a corpus case `number-integral-float-accepted` (input `1.0`, expecting `31` — the
  hex of `"1"`) so the agreement is pinned rather than assumed. Without it, this
  divergence returns the first time someone touches a number branch.

### P3: Go's float range check runs after an `int64` conversion that is undefined for its own test input

Task 7's implementation reads:

```go
case float64:
    if v != float64(int64(v)) {
        return &Error{Reason: "non-integer-number"}
    }
    if v > maxMagnitude || v < -maxMagnitude {
```

`int64(v)` where `v` is `1e21` is **undefined behavior in Go** — 1e21 exceeds
`math.MaxInt64` (~9.22e18), and the spec leaves an out-of-range float-to-integer
conversion implementation-defined. The plan's own test case
`{"out-of-range", float64(1e21), "number-out-of-range"}` drives exactly that path, so the
test may report `non-integer-number`, `number-out-of-range`, or vary by architecture.

**Recommendation.** Range-check before converting, and use `math.Trunc` for the
integrality test so no conversion is needed at all:

```go
if math.IsInf(f, 0) || math.IsNaN(f) { return &Error{Reason: "number-out-of-range"} }
if f != math.Trunc(f)                { return &Error{Reason: "non-integer-number"} }
if f > maxMagnitude || f < -maxMagnitude { return &Error{Reason: "number-out-of-range"} }
```

Order matters and is now deliberate: non-finite first (a `1e400` literal, which the
`diagnostics` corpus already contains, overflows to `+Inf`), then integrality, then range.

---

## 2. Significant findings

### P4: Go's lone-surrogate detection always decodes from the start of the string

```go
for _, r := range s {
    if r == utf8.RuneError {
        if _, size := utf8.DecodeRuneInString(s); size == 1 {
```

`utf8.DecodeRuneInString(s)` decodes the **first** rune of `s`, not the one at the current
position — the loop variable carrying the offset was discarded by `for _, r`. Every
detection after position 0 consults the wrong bytes, so an invalid sequence anywhere but
the start is misclassified in whichever direction the first rune happens to point.

**Recommendation.** Keep the index and slice from it:

```go
for i, r := range s {
    if r == utf8.RuneError {
        if _, size := utf8.DecodeRuneInString(s[i:]); size == 1 {
            return &Error{Reason: "lone-surrogate"}
        }
    }
}
```

The `size == 1` test is what separates an invalid byte from a genuine U+FFFD, which
decodes over three — worth keeping the comment that says so.

### P5: The plan embeds raw control and combining bytes in its own source

**Corrected during review.** This was first written up as a wrong test vector — an input
of five characters against an expectation of six escapes. That was a misreading: the
input already carries a sixth character, and the vectors are semantically correct.

What is actually wrong is narrower, and the misreading is itself the evidence for it. The
character is present as a **raw U+0001 byte embedded in the markdown**, which is exactly
why it read as absent — it is invisible. The same applies to the NFD vector, which carries
a raw combining acute (U+0301) rather than an escape. Eight such bytes were present
across the TypeScript and Python code blocks and the corpus case table.

A plan whose entire subject is byte-exactness must not carry invisible bytes in its own
source. Beyond legibility, a raw control byte in a `.ts` or `.py` snippet is at the mercy
of whatever formatter or clipboard the implementer passes it through, and a silent
mangling would produce a test that asserts the wrong thing while still looking right.

**Recommendation.** Write both as escapes — `\u0001` and `e\u0301` — in every code block,
and describe rather than embed them in the prose table. The bytes the tests assert are
unchanged; only their spelling inside the plan is.

---

## 3. Deferred

### P6: `bun -e` importing a relative TypeScript path
Task 5 Step 4 computes corpus hex via `bun -e 'import { canonicalize } from "./src/..."'`.
Whether `bun --eval` resolves a relative `.ts` specifier from the current directory is
unverified. **Deferred** — if it does not, the fallback is a two-line scratch file, and
the failure is immediate and obvious rather than silent.

### P7: The Go entry in `docs/modules/signing.md`'s `covers:` comment
The plan writes `go: signing/canonicaljson`, extrapolated from `docs/modules/diagnostics.md`'s
`go: diagnostics/emitter, diagnostics/encode, diagnostics/event`. The module-key convention
for a Go file is consistent with that reading, but was not confirmed against
`docs-modules.ts`'s resolver. **Deferred** — `docs-coverage.test.ts` fails loudly and names
the key it expected, so a wrong guess costs one run.

---

## 4. Disposition

| ID | Finding | Disposition |
|---|---|---|
| P1 | Lone surrogate inexpressible in the corpus; case would fail Go | **Fix** — drop the case, unit-test it per binding, exempt the token in the guard, record in §6 |
| P2 | Integral floats disagree three ways; §5 unsatisfiable by TypeScript | **Fix** — value-integral rule in §5, both implementations, plus a pinning case |
| P3 | Go range-checks after an undefined `int64` conversion | **Fix** — reorder, use `math.Trunc` |
| P4 | Go lone-surrogate detection decodes from index 0 | **Fix** — keep the loop index |
| P5 | Raw U+0001 / U+0301 bytes embedded in the plan's own code blocks | **Fix** — write them as escapes (first diagnosis was wrong; corrected in §2) |
| P6 | `bun -e` with a relative `.ts` specifier | **Defer** — obvious, immediate failure |
| P7 | Go `covers:` module key | **Defer** — gate names the expected key |

None of these changes the plan's task structure, its ordering, or its nine deliverables.
P1 removes one corpus case and adds three unit tests; P2 adds one corpus case and changes
two number branches; P3, P4 and P5 are corrections inside code the plan already contains.

**What this review does not cover.** The plan's remaining risk is unchanged and stated in
its own self-review: the corpus is computed from the TypeScript reference, so a
disagreement in Go or Python surfaces as a corpus failure during Tasks 6 and 7 rather
than as a silent divergence. P2 is an instance of exactly that risk being caught early —
by reading, before it cost a CI run.
