# Review & Feedback: Battery Port — Shipment 0 Implementation Plan

**Date:** 2026-08-26  
**Plan Reference:** [2026-08-26-battery-port-shipment-0.md](./2026-08-26-battery-port-shipment-0.md)

---

## 1. Open Questions

### Q1.1: Row Count Estimate for Empty Inputs in `firstLineAndRows`
* **Context:** In Task 5 (and the corresponding TS code in [`index.ts`](file:///C:/gitrep/nimbus-sdk/sdks/typescript/src/data-profile/index.ts#L153-L154)), `firstLineAndRows` estimates rows by counting `\n` and adding `1` if the text does not end with `\n`.
* **Question:** If the input `text` is completely empty (`""`), `text.endsWith("\n")` returns `false`, resulting in an estimate of `0 + 1 = 1` row. Should an empty file/input yield a `rowCountEstimate` of `0` instead of `1`?
* **Recommendation:** Update the specification and the TS implementation to return `0` if `text === ""`. The current plan reproduces this `1`-row behavior literally, which is likely an oversight in the original heuristic.

### Q1.2: Optimizing the Unicode-Drift Canary Test Range
* **Context:** In Task 9, the test `"agrees with String.prototype.trim on every code point today"` sweeps all Unicode code points from `0` to `0x10ffff` (1,114,112 iterations) to assert that our custom `trim()` matches `String.prototype.trim()`.
* **Question:** Since all ECMAScript whitespace and line terminator characters (including those in Unicode category Zs) are located in the Basic Multilingual Plane (BMP, i.e., `< 0x10000`), is it necessary to sweep the entire 21-bit space? High/low surrogate code points above `0xffff` cannot match any code points in `NORMATIVE_WHITESPACE` anyway.
* **Recommendation:** Cap the test loop at `0xffff` (65,536 iterations). This reduces execution time and CPU overhead by ~94% while retaining 100% of the correctness guarantees.

---

## 2. Technical Suggestions & Improvements

### S2.1: Python Snapshot Generation with Hatch
* **Context:** Python drift test (Task 1) requires running `python -m pip install -e .` to regenerate the gitignored `_data/spec` snapshot.
* **Suggestion:** On some development setups, a simple editable reinstall does not rerun Hatch's build hooks if the metadata/directory structure hasn't changed. If developers experience stale snapshots even after reinstalling, it would be helpful to include the explicit command to force-run Hatch's build/data-copy hooks or describe how the build hook is registered in `pyproject.toml` so developers can inspect it.

---

## 3. Disposition

| # | Verdict | Effect on the plan |
|---|---|---|
| Q1.1 | **Accepted as a defect, deferred as a fix** | `data-profile.md` §7 specifies `0`; RFC-0017 gains a register of corrections; the code change moves to Shipment 1's PR (b) |
| Q1.2 | **Rejected**, on a measurement | Task 9's canary keeps the full plane; the reasoning is now in the test's own comment |
| S2.1 | **Investigating it found a plan-breaking bug** | Task 1's test was wrong and is rewritten; Tasks 4 and 8 had false verification steps |

### Q1.1 — `firstLineAndRows("")` returns 1

Confirmed by reading `data-profile/index.ts:153-154`: `nl` is `0`, `"".endsWith("\n")` is
`false`, so the result is `0 + 1`, and the `Math.max(0, …)` floor cannot help because the
sum is never negative. An empty input has zero lines. The document specifies `0`.

The **code** fix is deferred to Shipment 1's PR (b) rather than taken here, and that is a
design decision rather than a scheduling one. The spec-first claim this whole project rests
on is that a corpus catches what review does not; taking the fix in Shipment 0 would make
the first correction the project ever ships one that no corpus ever caught, and would leave
nothing to demonstrate the machinery works. Recording it in RFC-0017's register also means
PR (b) cites an existing RFC instead of opening one for a one-line change.

Generalised beyond this instance: RFC-0017 §6 now holds a **register of corrections**, and
Tasks 5–8 append to it as each document is written. Every entry states the wrong behaviour,
the right one, the section that pins it, and the shipment that carries the fix — an entry
with no shipment named is a correction nobody has agreed to make.

### Q1.2 — cap the canary sweep at U+FFFF

The correctness argument holds: every member of the set is below U+10000, so the astral
half can only agree today. The rejection is on cost, and the cost was measured rather than
estimated. Under Bun on this machine: **122ms for the full sweep, 9ms for the BMP alone** —
so the astral half costs about 113ms, once, in a suite that builds `dist/` first. The
review's "~94%" is arithmetically right and immaterial in absolute terms.

Against that: a canary that assumes where the next disagreement will appear is not a canary.
The whole point of the test is to catch a runtime change nobody predicted, and pre-excluding
half the space on the grounds that nothing is there yet removes the only part of its value
that is not already covered by the explicit membership tests. `connector-kit`'s Go
case-folding sweep covers all 0x110000 for exactly this reason, at the same kind of cost, so
capping here would also make the two sweeps disagree about their own purpose.

The measurement and the reasoning are now in the test's doc comment, so the next reader does
not re-derive them.

### S2.1 — hatch build hooks on an editable reinstall

The premise does not hold as stated: the hook is registered under
`[tool.hatch.build.targets.wheel.hooks.custom]`, and hatchling builds a PEP 660 editable
wheel with the *wheel* builder, so the hook runs on every `pip install -e .`. pip does not
cache editable builds.

But investigating it surfaced something the review did not raise, and it broke the plan.
**`hatch_build.py:44` copies with `ignore_patterns("*.md")`.** The snapshot therefore holds
307 files and no normative document, where `sdks/go/spec/data/` holds all 315 including
every `.md`. Three things in the plan were wrong as a result:

1. **Task 1's test compared the trees directly**, so it would have failed on a clean tree
   with eight phantom `added` entries. `_files()` now takes `skip_markdown` and applies it
   to the upstream side, mirroring the hook.
2. **Task 1's "prove it can fail" step edited `docs/spec/README.md`** — a file the snapshot
   never contains, so the manufactured drift would have been invisible and the step would
   have "passed" while demonstrating nothing. It now uses a JSON probe file, and a *second*
   probe asserts the Markdown exclusion positively.
3. **Tasks 4 and 8 told the implementer to run the Python drift test as confirmation** after
   adding Markdown documents. It cannot see them. Everything Shipment 0 adds under
   `docs/spec/` is Markdown, so **Python's guard is blind to this entire shipment** and Go's
   is the only one that covers it. Both steps now say so.

A third test was added to pin the exclusion itself. Without it, a future hook that stops
ignoring `*.md` would surface as eight files of "deleted from the snapshot" drift rather
than as what it is.

The design document was corrected too — it described the drift test as comparing the two
trees for any difference, which is not implementable as written.
