# Review & Feedback: Battery Port Design

**Date:** 2026-08-26  
**Design Reference:** [2026-08-26-battery-port-design.md](./2026-08-26-battery-port-design.md)

---

## 1. Open Questions

### Q1.1: Resolving the Python `spec_root` Local-Only Trap
* **Context:** The design notes a local-only trap where Python tests execute against a gitignored snapshot in `sdks/python/src/nimbus_sdk/_data/spec` if it exists, rather than the live `docs/spec/` directory. Currently, `spec_root()` in [`spec.py`](file:///C:/gitrep/nimbus-sdk/sdks/python/src/nimbus_sdk/spec.py#L31-L34) prioritizes the bundled `_data/spec` directory over the repo's `docs/spec`.
* **Question:** Why should the local development environment prefer the snapshot over the live repository spec path when both exist? If the repository layout is present (`docs/spec` is a directory), it indicates a development clone where the live files should always take precedence to prevent false greens and stale test runs.
* **Recommendation:** Modify the precedence order in `spec_root()` to check for the repository `_REPO_SPEC` first, or check if the repository is present on disk and prefer it during test runs. This makes local tests immediately reflect changes to `docs/spec/` without requiring a reinstall of the editable package or updating the gitignored snapshot.

### Q1.2: Normative Whitespace Set & U+FEFF (BOM)
* **Context:** The design highlights a whitespace divergence where TypeScript strips `U+FEFF` (BOM) because JavaScript's `String.prototype.trim()` includes it, whereas Python and Go do not. If TypeScript stops stripping it, `parseCsvHeader` will fail to parse Excel-exported CSV files correctly (resulting in column names like `\uFEFFid`).
* **Question:** To preserve existing TypeScript behavior and resolve this bug in Python and Go, should the normative whitespace set include `U+FEFF`?
* **Recommendation:** Yes, the normative whitespace set defined in RFC-0017 should explicitly include `U+FEFF`. Python and Go bindings should implement custom trimming helper functions that strip `U+FEFF` alongside standard whitespaces, rather than delegating directly to `str.strip()` and `strings.TrimSpace`.

### Q1.3: UTF-8 Split-Safety in `buildVEvent` Folding
* **Context:** RFC 5545 §3.1 requires content lines to be folded at 75 octets (bytes). The design mentions that a folding implementation must count octets across different runtimes (bytes in Go, UTF-16 code units in JS, code points in Python).
* **Question:** If folding is added, how will the builder prevent splitting a multi-byte UTF-8 character across a line fold? While unfolding removes the folding sequence (`CRLF` + space) to restore the original byte stream, splitting a UTF-8 character in the middle of its byte sequence results in invalid UTF-8 lines. This can cause decoders or intermediate line-readers that decode line-by-line (prior to unfolding) to corrupt the character or raise errors.
* **Recommendation:** Specify that if folding is implemented, the fold boundary must be code-point aligned. The line should be folded at the last code-point boundary that keeps the line length under 75 bytes, rather than splitting blindly at exactly 75 bytes.

### Q1.4: Automatic `frozen` Promotion and Maintenance Drag
* **Context:** The design proposes that once a battery's corpus passes in all three languages, the module is promoted to `frozen`. Under RFC-0015, any changes to a `frozen` module's surface (including additions) require an RFC.
* **Question:** Since batteries like `icalendar` and `jmap-fastmail` represent complex specs that developers may want to frequently enhance or adjust as they integrate with new clients/servers, will forcing them to be `frozen` introduce too much administrative overhead (RFCs, schema changes, and synchronized multi-language PRs for minor extensions)?
* **Recommendation:** Amend RFC-0015 via RFC-0017 to decouple "having a spec/conformance corpus" from "being frozen". Keep the batteries in the `stable` tier, which requires conformance matrix validation but permits adding features and enhancements without triggering the full RFC process. Promote to `frozen` only if the battery is structurally complete and unlikely to change.

---

## 2. Technical Suggestions & Improvements

### S2.1: Naming Consistency between Spec and Packages
* **Context:** The design refers to the JMAP battery spec and conformance corpus directories as `jmap` (e.g., `docs/spec/conformance/v1/jmap/`, `jmap.md`). However, the packages in the bindings are named `jmap-fastmail` (TypeScript), `nimbus_sdk.jmap_fastmail` (Python), and `jmapfastmail` (Go).
* **Suggestion:** To avoid confusion and simplify path mapping in conformance runners, rename the spec document to `jmap-fastmail.md` and the corpus directory to `jmap-fastmail` to align with the module names.

### S2.2: Go Package Flat Naming
* **Context:** The Go packages are named `dataprofile` and `distributionchannel`.
* **Suggestion:** While Go package names are conventionally single flat words, `distributionchannel` is quite long and prone to typos. Consider shortening the Go package name to `distchannel` or `distrochannel` if it maintains clarity, or ensure autocomplete mappings in IDE surfaces are documented.

---

## 3. Disposition

Written after verifying each item against the codebase. Four accepted — two of them with a
different remedy than the one proposed — and two rejected with reasoning. The design
document has been updated accordingly.

| # | Verdict | Where it landed in the design |
|---|---|---|
| Q1.1 | **Problem accepted, remedy rejected** | *The local-only trap* — a new drift test; precedence untouched |
| Q1.2 | **Accepted, and extended** | *The measured whitespace divergence* — set chosen, plus a Unicode-drift correction |
| Q1.3 | **Accepted** | *The second open behaviour question* — alignment rule plus a required corpus case |
| Q1.4 | **Problem accepted, remedy rejected** | *Stability tiers* — a narrow amendment instead of the wide one |
| S2.1 | **Rejected**; the mismatch is now explained | *The corpus layer* |
| S2.2 | **Rejected** | *Packaging* |

### Q1.1 — `spec_root()` precedence

The trap is real, and the design under-served it: it warned about the false green without
proposing any guard against it. But flipping the precedence breaks a packaging invariant.
`spec_root()`'s own docstring states it — preferring `_BUNDLED` is what makes *"a
distribution built without its data raises rather than silently reading from somewhere
else"* true, and `tests/test_spec.py`'s sdist→wheel→venv test is what holds that line.

The concrete failure the flip introduces: `_REPO_SPEC` is `parents[4] / "docs" / "spec"`.
For a Windows venv inside the checkout — `.venv/Lib/site-packages/nimbus_sdk/spec.py` —
`parents[4]` **is the repository root**. An installed wheel with no bundled data would then
read the neighbouring checkout and pass, which is exactly the silent fallback the ordering
exists to prevent. The POSIX layout has one more path segment and lands on `.venv/docs/spec`,
so the hazard is platform-dependent — which makes it worse, not better.

Remedy adopted instead: `sdks/python/tests/test_spec_snapshot.py`, comparing `_BUNDLED`
against `_REPO_SPEC` when both exist and skipping when the checkout is absent. It is the
direct counterpart of `sdks/go/spec/drift_test.go` — Go needs one because its copy is
committed, Python needs one because its copy is stale-able — and it turns the false green
red at the moment it matters while changing no precedence. Scheduled into Shipment 0.

### Q1.2 — U+FEFF in the normative set

Accepted: the set includes U+FEFF. The review understates its own best argument, though.
The decisive point is not preserving TypeScript's behaviour for its own sake — it is that
ECMA-262's set is the **only** choice under which no shipped module's behaviour changes at
all. That deletes the entire "behaviour change to a `stable` module with no automated gate"
problem across all 13 trim sites and shrinks RFC-0017 to writing something down.

One correction to the recommendation: it is not enough for Python and Go to get helpers
while TypeScript keeps delegating to `String.prototype.trim()`. ECMA-262 defines
`WhiteSpace` partly by **Unicode general category Zs**, which is version-dependent — a
future Unicode adding a Zs code point silently changes `.trim()` and drifts TypeScript away
from the document. So the specification enumerates the code points literally and
**TypeScript gets a helper too**. It is behaviour-identical today, so it ships as a
refactor. Rule 4 means a closed set is closed, not "whatever the host does this year".

The set also has to settle U+0085 and U+001C–U+001F, which the review does not mention.
Both are excluded, following ECMA-262.

### Q1.3 — fold alignment

Accepted as written, with the citation added. RFC 5545 §3.1 names the failure itself — *"It
is possible for very simple implementations to generate improperly folded lines in the
middle of a UTF-8 multi-octet sequence"* — and places the burden on the unfolder, which is
not sufficient here: this SDK ships an intermediary that decodes line-by-line before any
unfolding happens (`ipc`'s line reader), so individually-invalid lines are reachable in
practice. The design now requires the fold point to be the last code-point boundary at or
under 75 octets, and requires the corpus to carry at least one `build` case whose fold point
falls inside a multi-octet sequence — without that case the rule would be unenforced.

### Q1.4 — automatic `frozen` promotion

The drag is real and correctly identified. The proposed remedy is rejected on two grounds.

It undoes RFC-0015's central argument. That RFC makes the definition mechanical on purpose
— *"'Which things are core?' is a taste question that gets re-litigated at every proposal;
'which module does a corpus guard import?' has one answer, and it is greppable"* — and then
records the rule overruling its own authors, moving `contract-tests`, `hitl-request` and
`sandbox-contract` from an intuition-based `stable` to `frozen`. Exempting the first four
modules to reach the bar because freezing them is inconvenient is the re-litigation the rule
was written to stop.

More decisively, **it does not treat the disease.** The drag comes from having a normative
document and a corpus, not from the tier — and this design keeps both under either
amendment. `docs/GOVERNANCE.md` already makes a change to a conformance invariant
RFC-requiring regardless of tier. Staying `stable` buys back one row of the rule table and
leaves the rest of the cost exactly where it was.

A narrower amendment does treat it, and it is grounded in RFC-0015's own text. §2 opens
*"The tier governs **what it costs to break something, not what it costs to add**"* — and
then the `Export added` row charges an RFC at `frozen` anyway. That inconsistency is
precisely the cell the drag flows through, since adding an iCalendar property is an
addition, not a break. RFC-0017 should correct it: `Export added` becomes `feat:` at
`frozen`, and every breaking change stays RFC-gated. The recommendation is unchanged —
promote — with that amendment attached. Still the user's decision, and still due before
Shipment 0.

### S2.1 — `jmap` vs `jmap-fastmail`

Rejected, but it identified a real gap: the mismatch was unexplained, and the design now
explains it.

The mechanical argument does not hold — there is no path mapping to simplify. Every
conformance runner is hand-written per corpus and names its corpus directly, and the
existing `url-resolution` corpus already names a *document* rather than the
`connector-kit/fetch-bearer-json.js` module it executes, so corpus-name-matches-module-name
is not the established convention.

On the naming itself: nothing in the module is Fastmail-specific — `parseSession`,
`viewEmail` and `validateApiUrl` are RFC 8620 / RFC 8621 operations — and a normative
document should be named for what it specifies. Spec paths are also the expensive side to
rename later (referenced from `index.json`, mirrored into `sdks/go/spec/data/`, embedded in
Go) where a module rename is local. If `jmap-fastmail` ever sheds the vendor name, `jmap` is
already right.

### S2.2 — `distributionchannel` → `distchannel`

Rejected. RFC-0012's D4 makes Go's names follow Python's, trimming only what the package
qualifier already supplies, and there is nothing to trim here. An abbreviation would invent
a name appearing in no other binding and no document — the one outcome D4 exists to prevent.
Length at the call site is the accepted cost; typo risk is what autocomplete addresses.
