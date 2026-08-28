# Battery Port — Shipment 3 (`icalendar`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle RFC-0018, make `docs/spec/batteries/v1/icalendar.md` executable — a conformance corpus every binding runs — then bind it in Python and Go, and promote all three modules to `frozen`.

**Architecture:** The shape Shipments 1 and 2 established, with two things neither exercised. First, this shipment opens with a **decision**: §7 pins the no-folding behaviour *provisionally* and defers to RFC-0018, so the RFC lands before any case that depends on it. Second, this is the largest battery (378 LOC, two functions, thirteen output members) and the only one whose corpus needs a **byte-exact builder** half under §R5 alongside a parser half.

**Tech Stack:** TypeScript (Bun test, Ajv, Biome), Python 3 (pytest, ruff, mypy strict), Go (stdlib `testing`, `go:embed`), JSON Schema draft-07.

**Spec:** [`docs/spec/batteries/v1/icalendar.md`](../../spec/batteries/v1/icalendar.md), merged in #188, and its preamble [`README.md`](../../spec/batteries/v1/README.md). Authorising RFC: [RFC-0017](../../rfcs/0017-battery-specifications.md). Precedent: [Shipment 1's plan](./2026-08-26-battery-port-shipment-1.md) and its [review](./2026-08-26-battery-port-shipment-1-review.md).

> **Note on the Shipment 2 plan.** It is *not* on `main` — it lives only on the unmerged
> `worktree-distribution-channel-plan` branch, where Shipment 1's plan was merged. This plan
> follows the Shipment 1 precedent and is committed in Task 0's pull request. If you want the
> Shipment 2 plan on `main` too, that is a separate one-commit PR and not this shipment's job.

## Global Constraints

Unchanged from Shipments 1 and 2, and repeated because a plan that assumes you read the last one is a plan that gets half-followed:

- **Dependency-free at runtime, all three languages.**
- **No `any`; TypeScript strict.** Python is `mypy --strict` and `ruff` clean at line length 88.
- **Two roots.** Import `repoRoot` / `packageRoot` from `sdks/typescript/scripts/paths.ts`.
- **The `index.json` is the corpus.** Case file and index entry land in the same commit.
- **After editing `docs/spec/`:** `go -C sdks/go generate ./spec` in the same commit, or `spec/drift_test.go` fails.
- **Before pytest, after a `docs/spec/` edit:** `cd sdks/python && python -m pip install -e .`. `test_spec_snapshot.py` catches a stale snapshot; if it is red, you skipped this.
- **A new corpus guard must be added to `ci.yml`'s lists** — both the TypeScript `bun test` list (line ~359) and the Python `pytest` list (line ~401). `corpus-parity.test.ts` asserts both. Go needs nothing: it runs `go test ./conformance/`, the whole package.
- **`conformance-coverage.json`: `unclaimed` is a corpus → *reason string* map; `deferred` is a corpus → *list of case files*.** They are not interchangeable and the generator throws on misuse.
- **Verify a CI run exists** after opening each PR: `gh api "repos/nimbus-agent/nimbus-sdk/actions/runs?head_sha=<sha>" --jq '.total_count'`. A short all-green `gh pr checks` list is what "CI never ran" looks like here. If it is missing, rebase onto `main` and push. Branch protection is the `General` ruleset with `strict_required_status_checks_policy: true` — arm `gh pr merge --auto` and GitHub does the updating.
- **`gh pr create --body-file`**, never an inline `--body`: backticks break argument parsing.
- **Sequential pull requests against `main`, never stacked.**

---

## Task 0 first: the decision this shipment cannot start without

§7 of `icalendar.md` pins "`buildVEvent` does not fold" **provisionally** and defers to
RFC-0018. Roughly a dozen corpus cases and the byte-exact `build` half depend on the answer,
so it is decided first, in its own pull request, before Task 1 writes anything.

### Recommendation: RFC-0018 resolves *no folding*, and §7 becomes settled

Four reasons, strongest first.

1. **RFC 5545 makes folding a SHOULD and unfolding a MUST.** §3.1 says a content line
   SHOULD NOT exceed 75 octets, but every conformant reader is required to unfold — and a
   reader that unfolds correctly reads an unfolded document correctly too, because there is
   nothing to unfold. The divergence is therefore **unobservable to any conformant
   consumer**, which is not true of §9's other correction candidate (item 1, the quoted-colon
   split, which produces a genuinely wrong property).

2. **§6 already declined this exact class of repair, and said so.** `buildVEvent`
   interpolates `uid`, `now`, `start` and `end` raw; §6 states that a caller supplying a
   `uid` containing a newline "produces an invalid document, and that is the caller's error,
   not this function's to repair." Folding is the same repair on the same values. Adding it
   for line length while declining it for embedded newlines is an inconsistency the document
   would then have to explain.

3. **Folding is the one place §7.1 itself says the three languages diverge by default.**
   RFC 5545 counts octets; JavaScript's `.length` counts UTF-16 code units, Python's `len()`
   counts code points, Go's `len()` counts bytes. So `slice(0, 75)` cuts in three different
   places on the same string, and the shipment would be taking on its hardest cross-language
   surface in the same change that first binds the battery in two new languages.

4. **Nothing is asking for it.** No caller has reported a rejection, and the battery is
   explicitly partial — §9 items 3, 4 and 5 are scope decisions of exactly this kind.

**§7.1 is kept, verbatim, as a standing constraint on any future v2.** It costs nothing, and
its argument — that a fold point must be code-point aligned — is correct whenever folding is
added, by whoever adds it.

> **One correction to make while writing the RFC.** §7.1's stated mechanism is that `ipc`'s
> NDJSON line reader "decodes line by line **before** any unfolding happens". That is true of
> the reader, but an ICS document travelling through this SDK is carried as a **JSON string
> value inside an NDJSON frame**, so its own CRLFs are escaped and the line reader never
> splits on them. The hazard is real for any consumer that streams raw ICS through a
> line-oriented decoder; it is not reachable through `ipc` as currently used. RFC-0018 should
> restate the constraint on the honest ground — RFC 5545 forbids splitting a multi-octet
> sequence outright — rather than on a mechanism that does not fire here. Do not silently drop
> §7.1's paragraph; correct it and say why.

**This is the one thing in this plan I want confirmed before execution.** If you want folding
instead, say so and Tasks 1, 3, 5 and 7 all change shape — it stops being a Shipment-1-shaped
port and becomes a behaviour change in three languages.

---

## What is already known before any code is written

Shipment 1 discovered its defect while writing the corpus; Shipment 2 knew its own in
advance. This one is known in advance too, and it is the best of the three: **the shipped
implementation is wrong, and the two obvious ports of it are wrong in two *different*
directions.**

### §5.3 is violated when the value contains U+0130

`extractMailto` searches a **lowercased copy** and then slices the **original** at the index
it found:

```ts
const lower = value.toLowerCase();
const idx = lower.indexOf("mailto:");
if (idx === -1) return null;
return trim(value.slice(idx + "mailto:".length));   // idx is an index into `lower`
```

The two strings are the same length for every input except one. Measured by sweeping all
0x110000 scalar values: **exactly one code point changes length under JavaScript's
`toLowerCase()` — U+0130 (`İ`, LATIN CAPITAL LETTER I WITH DOT ABOVE), which becomes two code
units, `i` + U+0307.** Any `İ` before the `mailto:` shifts every later index by one.

Measured on the input `ORGANIZER;CN=İstanbul:mailto:jane@example.com` — the parameter section
is already removed by §3.2, so the value reaching `extractMailto` is
`CN=İstanbul:mailto:jane@example.com`:

| Binding | Host operation | Result | Wrong by |
|---|---|---|---|
| TypeScript (shipped) | `toLowerCase()` — full mapping, **grows** by one UTF-16 unit | `"ane@example.com"` | drops a character |
| Python (naive port) | `.lower()` — full mapping, **grows** by one code point | `"ane@example.com"` | drops a character |
| Go (naive port) | `strings.ToLower` — **simple** mapping, `İ`→`i`, **shrinks** by one byte | `":jane@example.com"` | gains a character |

Three bindings, two different wrong answers, none correct. This is RFC-0017's Problem
section stated as a measurement rather than an argument, and it is the single best case in
the shipment.

**The repository already knows about this code point and already solved it twice**, which is
what makes the defect a slip rather than a research problem:

- `sdks/typescript/src/contract-tests.ts` has `foldAscii`, whose comment names U+0130 and
  U+212A as "exactly two code points whose lowercase mapping reaches ASCII".
- `sdks/go/connectorkit/searchfilter.go` carries `specialLower = strings.NewReplacer("İ", "i̇")`
  for the same divergence.

Neither reached `icalendar.ts`.

### The fix, and why it is exactly equivalent everywhere else

Fold **ASCII only**, then search the folded copy — an A–Z → a–z map is length-preserving in
UTF-16 code units, in code points *and* in bytes, so the index is valid in the original under
all three languages' indexing rules.

It cannot lose a match: a second sweep of U+0080–U+10FFFF found **no code point whose
lowercase mapping is any character of `mailto:`**, and the only multi-character lowercase
expansion in Unicode (U+0130 → `i` + U+0307) inserts a combining mark that breaks the needle
rather than completing it — `MAİLTO:`.toLowerCase() is `mai̇lto:`, which does not contain
`mailto:` under either rule. So the change is observable **only** on inputs where the old
index arithmetic was already wrong.

### §5.3 also needs a one-sentence spec amendment

"searched **case-insensitively**" defines the operation by reference to a host-language
primitive, which is the anti-pattern §R4 exists to forbid — and the table above is what
happens when three hosts answer it differently. §5.3 gains a sentence pinning the fold to
U+0041–U+005A. This is a clarification of intent, not a change of it: §5.3 already says the
address is "everything after it", and "it" is an occurrence in the value.

**Do not fix any of this before Task 2 Step 3 has watched the case fail.** The project's whole
claim is that a corpus catches what review does not; a fix taken ahead of the case that
exposes it is a correction no corpus ever caught.

---

## Pull request map

**Seven PRs, not six.** RFC-0018 is a decision the rest of the shipment consumes, and Shipment
0's precedent is that a decision lands on its own. It releases nothing, so the extra PR costs
one CI run, not a version.

| PR | Type | Tasks | Releases |
|---|---|---|---|
| 0 | `docs:` | 0 | none |
| A | `fix(typescript):` | 1, 2, 3, 4 | `@nimbus-dev/sdk` patch |
| B | `feat(python):` | 5, 6 | `nimbus-dev-sdk` minor |
| C | `feat(go):` | 7, 8 | `sdks/go` minor |
| D | `feat(typescript):` | 9a | `@nimbus-dev/sdk` minor |
| E | `feat(python):` | 9b | `nimbus-dev-sdk` minor |
| F | `feat(go):` | 9c | `sdks/go` minor |

A–F keep the shape both prior shipments used, for the same two reasons: the corpus and the
correction it exposes **cannot be split** (a corpus-only PR is red and cannot merge), and a
tier promotion edits all three goldens, so one promotion PR would release three components
under a single subject line — release-please assigns by **paths**, not by scope.

**A promotion is `feat:` with no RFC.** `diffSurfaces` records the *base* tier for a
`promoted` change, so `needsRfc` is never set on the way up. Confirmed on #198 and #214.

---

## Task 0: RFC-0018

**Files:**
- Create: `docs/rfcs/0018-icalendar-line-folding.md`
- Modify: `docs/rfcs/README.md` — the index table
- Modify: `docs/spec/batteries/v1/icalendar.md` — §7 and §7.1, §9 item 2
- Modify: `sdks/go/spec/data/batteries/v1/icalendar.md` (via `go generate`)
- Create: `docs/superpowers/plans/2026-08-28-battery-port-shipment-3.md` (this file)

- [ ] **Step 1: Write the RFC**

Model it on [RFC-0014](../../rfcs/0014-utf8-replacement-count.md), the other RFC that settles
one narrow behavioural question. Sections: Summary, Problem, Decision, Why not fold (the four
reasons above), What §7.1 constrains if this is ever revisited, and Consequences.

State the decision in the Summary as a sentence someone can quote: **`buildVEvent` does not
fold, in v1, in every binding; §7 is settled rather than provisional; §7.1 stands as a
constraint on any future change.**

Include the §7.1 mechanism correction described above, with its reasoning shown.

- [ ] **Step 2: Amend `icalendar.md` §7**

Three edits:

- §7's "It is pinned here **provisionally** … deferred to RFC-0018 rather than settled by an
  implementer" becomes a settled pin citing RFC-0018.
- §7.1's heading changes from "What RFC-0018 is constrained to, if folding is added" to a
  standing constraint on any future revision, and its `ipc` paragraph is corrected per Task 0
  Step 1.
- §7.1's closing "The fixture is therefore *reserved*, not present" paragraph is **kept but
  narrowed**: no case can pin fold *alignment*, which remains true. Cases pinning the
  *absence* of folding are added in Task 1 and are what make §7 executable — say so, so a
  reader does not conclude the section is untested.
- §9 item 2's "candidate for correction under §R2 … item 2 is RFC-0018's subject" becomes a
  settled divergence citing RFC-0018.

- [ ] **Step 3: Index the RFC and re-sync Go**

Add the row to `docs/rfcs/README.md`, then:

```bash
go -C sdks/go generate ./spec
NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./spec
```

- [ ] **Step 4: Verify and open PR 0**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run build && bun run test
cd sdks/python && python -m pip install -e . && python -m pytest -q
```
`docs/rfcs/` fences are not compiled by `docs-snippets` — check any code sample by hand.

PR 0 title: **`docs: RFC-0018 — buildVEvent does not fold`**.

---

## Task 1: The corpus

**Files:**
- Create: `docs/spec/conformance/v1/icalendar/{index.schema.json,case.schema.json,index.json}`
- Create: `docs/spec/conformance/v1/icalendar/cases/*.json` (~56 files)

**Interfaces:**
- Consumes: `docs/spec/batteries/v1/icalendar.md` §§1–9.
- Produces: a corpus loadable by `load_corpus("icalendar")`, `spec.LoadCorpus`, and `readJson`. Two kinds: `parse` and `build`.

- [ ] **Step 1: `index.schema.json`**

Copy `distribution-channel`'s, changing `$id`, `title`, and `spec`'s `const` to
`"../../../batteries/v1/icalendar.md"`. Keep the **wider** section pattern
`^§[0-9]+(\.[0-9]+)*$` — this document has §3.1–§3.3, §4.1, §4.2, §5.1–§5.5 and §7.1, and a
chapter-only pattern could not name any of them. (`negotiation` uses `^§[0-9]+$` and
`framing` uses a bare `^[0-9]+$`; copying an index entry across corpora is how this bites.)

- [ ] **Step 2: `case.schema.json`**

Two kinds discriminated on `kind`, each `then` branch **requiring its own inputs and
forbidding the other kind's** — Shipment 1 shipped a schema that permitted foreign members
and had to correct it in review.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/conformance/v1/icalendar/case.schema.json",
  "title": "icalendar conformance case",
  "type": "object",
  "required": ["description", "kind", "expect"],
  "additionalProperties": false,
  "properties": {
    "description": { "type": "string", "pattern": "\\S" },
    "kind": { "enum": ["parse", "build"] },
    "ics": { "type": "string", "description": "parse: the document, verbatim." },
    "input": { "type": "object", "description": "build: the BuildEventInput." },
    "now": { "type": "string", "description": "build: the injected DTSTAMP value." },
    "expect": {}
  }
}
```

Then, in `allOf`:

- `kind: "parse"` → `required: ["ics"]`, `not: {required:["input"]}`, `not: {required:["now"]}`,
  and `expect` is `{ "events": [ <ParsedEvent> ] }` where `<ParsedEvent>` requires **all
  thirteen members** with `additionalProperties: false`. The nine optional-string members are
  `{"type":["string","null"]}`, `allDay` is `boolean`, `attendees` is an array of strings,
  `uid` is a plain `string`.
- `kind: "build"` → `required: ["input","now"]`, `not: {required:["ics"]}`, and `expect` is
  `{ "ics": <string> }`.

**Require all thirteen members on every expected event, with no defaulting.** §1 says every
member is present on every returned event; a schema that let a case omit `allDay` would let a
case silently stop asserting it, and `allDay` is the member most likely to regress (§3.3's
whole-element matching).

- [ ] **Step 3: Write the cases**

Roughly **56** — the per-section table below sums to exactly that; this is the largest battery and it has two functions. Every case must earn
its place; the index `reason` states the section it pins, and where a case guards a specific
wrong implementation it carries the measured form *"caught by 0 of the N cases that existed
before it."*

Minimum coverage, by section:

| Section | Cases | Notes |
|---|---|---|
| §2 | 6 | CRLF+SPACE removes **all three** characters (`SUMMARY:Hello\r\n World` → `HelloWorld`, not `Hello World`); a CRLF+HTAB fold; **an LF+SPACE fold, which unfolds** (see below); a lone `\r` followed by a space, which does **not**; an LF-only document with no fold at all; two consecutive folds |
| §3.1 | 3 | a lowercase property name is uppercased; a line with **no colon at all** (name is the whole line, value empty); a `;` appearing *after* the first `:` does not shorten the name |
| §3.2 | 2 | value begins after the first colon (`SUMMARY:http://x`); **divergence #1** — `ATTENDEE;CN="Doe: Jane":mailto:…` splits inside the quotes |
| §3.3 | 3 | `VALUE=DATE` sets `allDay`; **`VALUE=DATE-TIME` does not** — the whole-element match, and the case that fails a substring test; a `;` after the `:` is not a parameter |
| §4.1 | 4 | `build` kind — backslash escaped first; `;` and `,`; CRLF **and** bare LF both become `\n`; a colon is **not** escaped |
| §4.2 | 4 | the wire value `\\n` yields the two characters `\` and `n` — **the single-pass proof**; `\N` is a newline; `\q` yields `q`; a trailing lone `\` is emitted as itself. Exhaustive mapping below |
| §5.1 | 5 | lines outside a block discarded (VCALENDAR header + VTIMEZONE); an **unterminated** final block discarded; two events; a second `BEGIN:VEVENT` discards what was accumulated; lowercase `begin:vevent` markers |
| §5.2 | 8 | one rich event exercising all thirteen members; an unknown property ignored; `SUMMARY` **not** trimmed; `UID` **is** trimmed; repeat `SUMMARY` — last wins; repeat `DTSTART` recomputes `allDay`; §R7 both ways (below); `SUMMARY:` with an empty value yields `""`, **not** an absence |
| §5.3 | 8 | organizer from `mailto:`; uppercase `MAILTO:`; no `mailto:` → absence; an `ATTENDEE` with no `mailto:` contributes nothing; `ATTENDEE:mailto:` (empty) contributes nothing; `ORGANIZER:mailto:` (empty) is `""` and **not** an absence; attendees in document order; **the U+0130 case** |
| §5.4 | 2 | a block with no `UID` is dropped; a block whose `UID` is whitespace-only is dropped **and a following valid block is still returned** |
| §5.5 | 2 | a garbage document returns `[]`; a malformed block between two valid ones is skipped, not fatal |
| §6 | 7 | `build` kind, byte-exact — the minimal document; with `description` and `location`; **a supplied-but-empty `description` still emits `DESCRIPTION:`**; an empty `attendees` list emits no lines; attendee order; `uid` interpolated **raw**, not escaped; the trailing CRLF after `END:VCALENDAR` |
| §7 | 2 | a `SUMMARY` well over 75 octets emitted as **one line**; the same with multi-octet characters straddling octet 75 — settled by RFC-0018, and what makes §7 executable |

**§4.2's unescape mapping, written out.** §4.2 is already exhaustive in prose, but it is
stated as a scanning *procedure* and every binding author will want it as a table. This is
that table, and it introduces nothing the document does not already say:

| Wire input | Yields | Rule |
|---|---|---|
| `\\` | one `\` | escaped char emitted literally |
| `\n`, `\N` | one newline, U+000A | the only two sequences that produce a newline |
| `\,` | `,` | escaped char emitted literally |
| `\;` | `;` | escaped char emitted literally |
| `\q`, and every other `\X` | `X` | **lenient** — unescaping accepts escapes escaping does not produce |
| a trailing `\` (last character of the value) | one `\` | nothing follows it to consume |
| any character not preceded by an unconsumed `\` | itself | — |

**Read the third row of the case list carefully: the wire value `\` `\` `n` — three
characters — yields the two characters `\` and `n`, NOT a newline.** The first `\` consumes
the second and emits a literal `\`; the `n` is then an ordinary character with no `\` before
it. A `\\` → `\` pass followed by a `\n` → newline pass produces a newline instead, and that
is exactly the bug §4.2 forbids. Spell this out in the case's `description` — writing it as
"yields `\n`" is ambiguous between the two-character sequence and the newline, and a reader
who resolves the ambiguity the wrong way writes the wrong case.

**§2 is a composition of two steps, and the cases must pin the composition, not each step.**
§2 is already exhaustive and needs no amendment, but it is easy to read as one rule and get
wrong. Normalisation runs **first** — every `\r\n` *or bare* `\n` becomes `\r\n`, and a lone
`\r` is left alone — and unfolding runs **second**, on `\r\n` followed by SPACE or HTAB.

The consequences, which the six cases pin between them:

| Input sequence | Folds? | Why |
|---|---|---|
| `\r\n` + SPACE / HTAB | **yes** | matches step 2 directly |
| `\n` + SPACE / HTAB | **yes** | step 1 rewrites it to `\r\n` + whitespace *before* step 2 looks |
| `\r` + SPACE / HTAB | **no** | a lone `\r` is not a line ending, so step 1 leaves it and step 2 never matches |

So a binding that unfolds on `\r\n` only, without normalising first, passes every CRLF case
and silently fails every LF-only document — which is what real calendar servers emit. That
binding is the reason the LF+SPACE case exists as its own case rather than being folded into
"an LF-only document".

**Three cases to write with particular care.**

1. **The U+0130 case** (§5.3). `ics` carries
   `ORGANIZER;CN=İstanbul:mailto:jane@example.com`, and `expect.events[0].organizer` is
   `"jane@example.com"`. Write the `İ` as the literal character, not as `İ` — every
   corpus file in this tree is UTF-8 and both other bindings read it as such. This case
   **fails the shipped implementation** and is the reason Task 2 Step 3 exists.

2. **The §R7 pair** (§5.2). A whitespace-only-line case is *not* observable — an unstripped
   line falls through to the unknown-property branch and is ignored either way — so pin §R7
   on a **value** instead, where it is observable in both directions:
   - `UID:﻿abc` → `uid` is `"abc"`. §R7 includes U+FEFF; Python's `str.strip()` and Go's
     `strings.TrimSpace` do not, so a delegating binding returns `"﻿abc"`.
   - `UID:abc` → `uid` is `"abc"`. §R7 **excludes** U+001C; Python's
     `str.strip()` strips it, so a delegating Python binding returns `"abc"`.

   One case catches a delegating Python **and** Go; the other catches a delegating Python
   only. Both are needed — they fail in opposite directions and neither implies the other.

3. **The empty-versus-absent pair** (§1, §5.2, §5.3). `SUMMARY:` yields `""` and a block with
   no `SUMMARY` yields an absence; `ORGANIZER:mailto:` yields `""` and `ORGANIZER:tel:123`
   yields an absence. These four are what force Go's `ParsedEvent` to use `*string` rather
   than §R6's zero value — see Task 7 — and without them Go's obvious shape passes.

- [ ] **Step 4: `index.json`**

`spec` is `"../../../batteries/v1/icalendar.md"`. One entry per case file — `file`,
`section`, `reason`, and nothing else (`additionalProperties` is `false`).

- [ ] **Step 5: Verify the index and the directory agree**

```bash
cd "$(git rev-parse --show-toplevel)"
python -c "
import json, os
d = json.load(open('docs/spec/conformance/v1/icalendar/index.json', encoding='utf-8'))
indexed = sorted(c['file'].replace('cases/', '') for c in d['cases'])
on_disk = sorted(os.listdir('docs/spec/conformance/v1/icalendar/cases'))
print('indexed:', len(indexed), 'on disk:', len(on_disk))
print('only in index:', set(indexed) - set(on_disk))
print('only on disk:', set(on_disk) - set(indexed))
print('AGREE' if indexed == on_disk else 'DISAGREE')
"
```
Expected: equal counts, two empty sets, `AGREE`. One process, no temp files — `/tmp` does not
exist on a Windows developer machine and the two-redirect-and-`diff` shape fails on a missing
file rather than reporting drift.

- [ ] **Step 6: Re-sync the Go mirror and commit**

```bash
go -C sdks/go generate ./spec
git add docs/spec/conformance/v1/icalendar/ sdks/go/spec/data/
git commit -m "test(spec): the icalendar conformance corpus"
```

---

## Task 2: The TypeScript guard

**Files:**
- Create: `sdks/typescript/scripts/icalendar-guard.test.ts`
- Modify: `.github/workflows/ci.yml` — the conformance job's `bun test` list

- [ ] **Step 1: Write the guard**

Model it on `sdks/typescript/scripts/distribution-channel-guard.test.ts` — same four
`describe` blocks, same order: published artifacts, cannot-pass-vacuously, the reference
binding, and the recorder. Reuse its `readJson` / `readText` helpers and its
`afterAll(() => recorder.flush())`.

The `parse` comparison must build the **whole thirteen-member object** and `toEqual` it
against `expect.events[i]`, not compare member by member: deep equality on an object that
later grows a member fails and names the case, where a per-member loop never looks at the new
member and passes. Shipment 1's review recorded this the wrong way round once; it is right
here.

The anti-vacuity block must assert, at minimum:

```ts
const KINDS = ["parse", "build"] as const;

/** §1, §8 and §9 are prose. Every other section is pinned by at least one case. */
const PINNED_SECTIONS = [
  "§2", "§3.1", "§3.2", "§3.3", "§4.1", "§4.2",
  "§5.1", "§5.2", "§5.3", "§5.4", "§5.5", "§6", "§7",
] as const;

test("every declared kind has at least one case", () => { /* set equality against KINDS */ });

test("every pinned section is cited by at least one index entry", () => { /* … */ });

// `TextEncoder`, not `Buffer.byteLength`. No package in this repository declares
// `@types/node`, and `Buffer` appears in exactly one file — `scripts/framing-corpus.mjs`,
// which is not typechecked. A `Buffer` reference in a `.test.ts` either fails `tsc` or
// passes locally by borrowing an ambient type from the parent checkout's `node_modules`,
// which is the failure mode CLAUDE.md records taking down `build-test` on all three OSes.
// Every other guard here already uses `TextEncoder`; follow them.
const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

test("both builder outcomes are exercised: a folded output would be a different string", () => {
  // §7 is executable only because a case supplies a value longer than 75 octets.
  const long = cases.filter(
    ({ body }) => body.kind === "build" && utf8Length(body.expect.ics) > 75,
  );
  expect(long.length, "no build case exceeds 75 octets, so §7 asserts nothing").toBeGreaterThanOrEqual(2);
  for (const { body } of long) {
    expect(body.expect.ics).not.toMatch(/\r\n[ \t]/); // no fold sequence anywhere
  }
});

test("a case distinguishes an empty value from an absence", () => {
  // Without this, Go's zero-value ParsedEvent passes the whole corpus. See Task 7.
  const events = cases.flatMap(({ body }) => (body.kind === "parse" ? body.expect.events : []));
  expect(events.some((e) => e.summary === "")).toBe(true);
  expect(events.some((e) => e.summary === null)).toBe(true);
  expect(events.some((e) => e.organizer === "")).toBe(true);
  expect(events.some((e) => e.organizer === null)).toBe(true);
});

test("a case pins §5.3 against host-language case folding", () => {
  const turkish = cases.filter(({ body }) => body.kind === "parse" && body.ics.includes("İ"));
  expect(turkish.length, "no case contains U+0130, so §5.3's fold is unpinned").toBeGreaterThan(0);
});
```

Plus the four the template already carries: the index validates against its schema, every
case validates against the case schema, index and directory hold each other, and every cited
section exists in the document.

**Section-existence check:** `icalendar.md` writes its subsections as `### §5.1 …` and its
chapters as `## §5 …`, so match on the section token following a `#`, not on a literal
`"## "` prefix.

- [ ] **Step 2: Add the guard to `ci.yml`**

Insert `scripts/icalendar-guard.test.ts` into the conformance job's `bun test` list, keeping
it alphabetical (between `framing-guard` and `negotiation-guard`). Without this the guard runs
under `bun run test` but not under `conformance-report` in CI; `corpus-parity.test.ts` asserts
it, and that guard exists because this was missed twice.

- [ ] **Step 3: Run the guard — it MUST fail on exactly one case**

```bash
cd sdks/typescript && bun test scripts/icalendar-guard.test.ts
```

Expected: **one failure** — the §5.3 U+0130 case, `organizer` reported as
`"ane@example.com"` where the corpus expects `"jane@example.com"`.

**Do not proceed if it fails on anything else, and do not proceed if it passes.** A pass here
means the corpus is not exercising §5.3's fold, and the spec-first claim of this shipment goes
untested. Fix the corpus until exactly this one case fails.

- [ ] **Step 4: Record the "caught by 0 of N" measurement**

Before the fix, run the **existing** unit suite and confirm it is green:

```bash
cd sdks/typescript && bun test src/icalendar.test.ts
```
Expected: all passing — 29 by a `grep` of `it(`/`test(`, eight source lines mentioning
`mailto`. **Read the real total off the run** rather than trusting either number here; that
total is the measurement the index `reason` carries: *caught by 0 of the N existing unit
tests.*

- [ ] **Step 5: Commit the guard**

```bash
git add sdks/typescript/scripts/icalendar-guard.test.ts .github/workflows/ci.yml
git commit -m "test(typescript): execute the icalendar corpus

Fails one case: extractMailto indexes a lowercased copy and slices the
original, so a U+0130 before the address shifts every later index.
Fixed in the next commit."
```

Committing a red guard is deliberate and confined to this branch — the fix is the next commit,
and the PR is what merges.

---

## Task 3: The §5.3 correction

**Files:**
- Modify: `sdks/typescript/src/icalendar.ts` — `extractMailto`
- Modify: `docs/spec/batteries/v1/icalendar.md` — §5.3's one-sentence amendment
- Modify: `docs/rfcs/0017-battery-specifications.md` — §6.1's register
- Modify: `sdks/typescript/src/icalendar.test.ts` — one regression test
- Modify: `sdks/go/spec/data/` (via `go generate`)

**Interfaces:** no signature change. Only the returned address moves, and only for inputs
containing U+0130 before the `mailto:`.

- [ ] **Step 1: Confirm the failing case still fails** — re-run Task 2 Step 3. This is the
  "watch it fail" step the shipment design's claim rests on.

- [ ] **Step 2: Amend §5.3**

After "searched **case-insensitively** for the first occurrence of `mailto:`", add:

> The fold is **ASCII only**: U+0041–U+005A map to U+0061–U+007A and every other code point is
> compared as written. A binding MUST NOT delegate to its host language's lowercase, for the
> reason §R7 gives for trimming — the three hosts disagree, and here they disagree about
> *length*, which corrupts the index the address is sliced at. No code point outside
> U+0041–U+005A has a lowercase mapping that reaches any character of `mailto:`, so the
> restriction never loses a match.

This is §R4 applied to a third JavaScript-derived operation, and it belongs in the document
for the same reason the whitespace set does.

- [ ] **Step 3: Make the change**

```ts
/**
 * Case folding for the `mailto:` search, spelled out in ASCII.
 *
 * `toLowerCase()` cannot be used to find an index into the ORIGINAL string: U+0130 is the
 * one code point in Unicode whose JavaScript lowercase is longer than itself (`i` + U+0307),
 * so every index after one is off by one — and the two obvious ports are wrong in opposite
 * directions, Python's `.lower()` growing it and Go's simple-mapping `strings.ToLower`
 * shrinking it. Mapping only U+0041–U+005A is length-preserving in UTF-16 units, in code
 * points and in bytes, so one implementation is correct in all three languages.
 *
 * It cannot lose a match either: no code point outside ASCII has a lowercase mapping that
 * reaches any character of `mailto:`. Specified by batteries/v1/icalendar.md §5.3 and
 * authorised by RFC-0017 §6.1; the corpus case is what found it.
 *
 * The same reasoning, and the same two code points, are written out at `foldAscii` in
 * `contract-tests.ts`. Kept local rather than shared: that module is `frozen`, and lifting a
 * helper out of it is a surface decision this shipment has no mandate to make.
 */
function foldAscii(value: string): string {
  return value.replace(/[A-Z]/g, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0) + 32));
}

function extractMailto(value: string): string | null {
  const idx = foldAscii(value).indexOf("mailto:");
  if (idx === -1) return null;
  return trim(value.slice(idx + "mailto:".length));
}
```

- [ ] **Step 4: Add the unit regression test**

One test in `src/icalendar.test.ts` alongside the existing eight `mailto` tests, so the defect
is caught by the fast suite too and not only by the corpus.

- [ ] **Step 5: Run the guard — it must now pass**

```bash
cd sdks/typescript && bun test scripts/icalendar-guard.test.ts src/icalendar.test.ts
```

- [ ] **Step 6: Register the correction**

Add an entry to RFC-0017 §6.1 in the established form — wrong behaviour, right behaviour, the
section that pins it, the shipment that carries the fix. Note while you are there that
**Shipment 2's §3.1 realpath correction was never registered**; add it too, in the same
commit, or the register silently means less than it says. That is one paragraph, not a
re-litigation.

- [ ] **Step 7: Full verification**

```bash
cd "$(git rev-parse --show-toplevel)"
go -C sdks/go generate ./spec
bun run build && bun run test
```
Expected: all pass. `docs/api-surface.md` must be **unchanged** — this is a behaviour change
behind an unchanged signature, so no golden moves. That is also why nothing in CI gates it,
and why RFC-0017 §6.1 is cited in the commit.

- [ ] **Step 8: Commit**

```bash
git add sdks/typescript/src/icalendar.ts sdks/typescript/src/icalendar.test.ts \
        docs/spec/batteries/v1/icalendar.md docs/rfcs/0017-battery-specifications.md \
        sdks/go/spec/data/
git commit -m "fix(typescript): extractMailto must not index a case-folded copy

extractMailto searched value.toLowerCase() and then sliced the ORIGINAL at
the index it found. U+0130 is the one code point whose JavaScript lowercase
is longer than itself, so any I-with-dot-above before the address shifted
every later index by one and dropped the first character of the address.

The two obvious ports are wrong in opposite directions: Python's .lower()
grows U+0130 as JavaScript does, and Go's simple-mapping strings.ToLower
shrinks it, so the same input yields three answers and no correct one.
Folding only U+0041-U+005A is length-preserving in UTF-16 units, code
points and bytes alike, and no non-ASCII code point lowercases into any
character of 'mailto:', so no match is lost.

Specified by docs/spec/batteries/v1/icalendar.md section 5.3 and authorised
by RFC-0017 section 6.1's register of corrections. Found by the corpus case
added in the previous commit; caught by 0 of the N existing unit tests."
#                                                  ^ substitute the real total from Task 2 Step 4
```

---

## Task 4: Coverage bookkeeping, and PR A

**Files:**
- Modify: `docs/conformance-coverage.json`, `docs/conformance-coverage.md` (generated)
- Modify: `docs/spec/README.md`

- [ ] **Step 1: Claim the corpus for TypeScript only, for now**

Add `"icalendar"` to `languages.typescript.claims` (keep sorted). For **python** and **go**,
record it under `unclaimed` with the reason string `"binding lands in this shipment's next
pull request"` — `unclaimed` is corpus → *reason string*; `deferred` is corpus → *list of case
files* and is the wrong key here. PRs B and C move each entry into `claims`.

- [ ] **Step 2: Regenerate** — `bun run conformance:coverage` from the repository root.

- [ ] **Step 3: `docs/spec/README.md` — four edits plus the disclosure**

1. **The kinds/directories counts** (~line 169): "Nine kinds of assertion, across **ten**
   corpus directories" → ten and eleven. The following sentence currently reads "The groups
   below are the eight kinds; `corpusNames()` … is what enumerates the nine" — **it is already
   internally inconsistent** (eight versus nine). Derive both numbers from
   `corpusNames()` and the directory listing rather than incrementing what is there, and fix
   the inconsistency in passing.
2. **A corpus entry** — a `### icalendar` block in the `conformance/v1/` list.
3. **The guard count** (~line 299): "**Ten** guards run on every pull request" → eleven.
4. **A guard paragraph** in *How this stays true* for `icalendar-guard.test.ts`, modelled on
   the `distribution-channel-guard.test.ts` one.
5. **The TypeScript-only disclosure** (~line 327): "Four corpora are executed by the
   **TypeScript** binding alone" → five, naming `icalendar`. `corpus-parity.test.ts` requires
   this while the corpus is single-run, and requires its **removal** in PR B/C when it is not.

- [ ] **Step 4: Full verification**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run build && bun run test
NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./...
cd sdks/python && python -m pip install -e . && python -m pytest -q
```

- [ ] **Step 5: Commit and open PR A**

```bash
git add docs/conformance-coverage.json docs/conformance-coverage.md docs/spec/README.md
git commit -m "docs: record the icalendar corpus in the coverage matrix"
```

PR A title: **`fix(typescript): extractMailto must not index a case-folded copy`**. The
carried-commits rule requires the subject to declare at least the strongest impact it
squashes, and `fix` is it — a `docs:` or `test:` title would understate a behaviour change and
release-please would cut no patch for a real fix.

---

## Task 5: The Python binding

**Files:**
- Create: `sdks/python/src/nimbus_sdk/icalendar/__init__.py`
- Create: `sdks/python/src/nimbus_sdk/icalendar/calendar.py`

**Interfaces:** produces `ParsedEvent`, `BuildEventInput`, `parse_icalendar`, `build_vevent`.

> **Module file name.** Not `icalendar.py` inside the package and not a top-level
> `icalendar.py`: PyPI has an unrelated, widely-installed `icalendar` distribution, and a
> module that shadows it on `sys.path` is the same class of trap as `nimbus-sdk` versus
> `nimbus-dev-sdk`. The package directory `nimbus_sdk/icalendar/` is namespaced by
> `nimbus_sdk` and is safe; the file inside it is `calendar.py`, matching
> `distribution_channel/channel.py`.

- [ ] **Step 1: Write `calendar.py`**

Requirements that will otherwise be got wrong, each traceable to a section:

- **`_fold_ascii` maps U+0041–U+005A only** (§5.3, as amended). MUST NOT call `.lower()` —
  Python grows U+0130 exactly as JavaScript does, which is the defect Task 3 just fixed.
  No regex, no locale, no case-mapping table:

  ```python
  def _fold_ascii(value: str) -> str:
      #: docs/spec/batteries/v1/icalendar.md §5.3. NOT str.lower(): Python's full case
      #: mapping turns U+0130 into two code points, so an index found in the folded copy
      #: no longer addresses the original. A-Z -> a-z preserves length exactly.
      return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in value)
  ```
- **Trimming reuses the §R7 set**, not `str.strip()`. Import or mirror
  `nimbus_sdk.data_profile`'s existing `_trim` rather than writing a third copy — check what
  Shipments 1 and 2 landed and follow it; if each package has its own private copy, add a
  fourth and do not refactor them in this shipment.
- **`ParsedEvent` is a frozen dataclass with all thirteen members**, the nine optional strings
  typed `str | None`, `all_day: bool`, `attendees: tuple[str, ...]`.
- **Member names are Python-cased**: `recurrence_id`, `all_day`. The runner maps them back to
  the corpus's camelCase keys — do **not** rename the corpus.
- **`unescape` is a single left-to-right pass** (§4.2). Sequential `str.replace` calls are
  wrong at every ordering; the corpus's `\\n` case proves it.
- **`escape` is four ordered replacements** (§4.1), backslash first.
- **Never raises** (§5.5), and returns `[]` for a whole-document failure.
- **`build_vevent` emits `DESCRIPTION:` when `description is not None`**, testing presence and
  not truthiness (§6) — the empty-string case is in the corpus.
- **`build_vevent` does not fold** (§7, settled by RFC-0018).

- [ ] **Step 2: Write `__init__.py`**

`__all__` naming the four public names, and a module docstring naming the specification and
the corpus. **`__stability__ = "experimental"`** goes on the **defining** module —
`calendar.py` — never on `__init__.py`; Task 9b promotes it there.

- [ ] **Step 3: Lint, typecheck**

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy
```

- [ ] **Step 4: Commit** — `feat(python): nimbus_sdk.icalendar`

---

## Task 6: The Python runner, root and surface

**Files:**
- Create: `sdks/python/tests/test_icalendar_corpus.py`
- Modify: `sdks/python/scripts/api_surface.py` — `IMPORT_ROOTS`
- Modify: `sdks/python/tests/test_api_surface.py` — the `minimums` map
- Modify: `.github/workflows/ci.yml` — the pytest list
- Modify: `docs/api-surface-python.md` (generated), `docs/conformance-coverage.json`, `docs/conformance-coverage.md`, `docs/spec/README.md`

- [ ] **Step 1: Add the import root**

`"nimbus_sdk.icalendar"` into `IMPORT_ROOTS` **and** into `test_api_surface.py`'s `minimums`
map — that map is keyed by root and raises `KeyError` on a new one, so omitting it is a red
suite, not a missing assertion. Use `4`.

- [ ] **Step 2: Write the runner**

Model on `tests/test_distribution_channel_corpus.py`: `load_corpus("icalendar")`,
`corpus_files("icalendar")`, the `recorder` from `_conformance_report`, the assertion that the
two agree on count, a floor (`>= 45`), and **every kind exercised**.

Convert the binding's `ParsedEvent` **to** the corpus's dict shape rather than the reverse, so
a case with a mistyped key fails rather than silently matching. Compare `attendees` as a list.

- [ ] **Step 3: Add it to `ci.yml`'s pytest list.** `corpus-parity.test.ts` asserts this.

- [ ] **Step 4: Reinstall and run**

```bash
cd sdks/python && python -m pip install -e . && python -m pytest -q
```
Check the executed count, not just the exit code.

- [ ] **Step 5: Regenerate the surface and claim the corpus**

`python scripts/api_surface.py`, move `icalendar` from `python.unclaimed` to `python.claims`,
re-run `bun run conformance:coverage`.

- [ ] **Step 6: `docs/spec/README.md` — the dual-run switch**

`icalendar` becomes dual-run, so it must be **named inside the language-neutrality paragraph**
and **removed from the TypeScript-only disclosure** (five → four). `corpus-parity.test.ts`
asserts both directions.

> **The neutrality paragraph is extracted up to the first BLANK LINE.** Add the sentence
> naming `icalendar` *inside* the existing block — splitting it into its own paragraph makes
> it invisible to the guard, which then reports the corpus as undeclared. Update "A case added
> to any of these **six**" to seven in the same edit.

- [ ] **Step 7: Verify and open PR B**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run build && bun run test
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

PR B title: **`feat(python): nimbus_sdk.icalendar`**.

---

## Task 7: The Go package

**Files:**
- Create: `sdks/go/icalendar/icalendar.go`, `sdks/go/icalendar/doc.go`

**Interfaces:** produces `ParsedEvent`, `BuildEventInput`, `Parse`, `Build`.

> **Naming.** `Parse` and `Build`, not `ParseICalendar` and `BuildVEvent` — this is
> trim-what-the-package-says, the same rule that made `CONTRACT_HANDSHAKE_EXIT` into
> `HandshakeExit`: `icalendar.ParseICalendar` stutters where `icalendar.Parse` does not.
> `BuildVEvent` is the closer call, since `VEvent` is not the package's name — but the package
> builds exactly one thing and §6 pins it, so `Build` names it unambiguously. **Record both in
> `docs/modules/icalendar.md`'s divergence list when that page is written in Shipment 4's
> wrap-up**; they join `HandshakeExit` and `Negotiate` as the only spelling divergences.

The requirements Go alone faces:

- **`ParsedEvent`'s nine optional string members are `*string`, not `string`.** §R6 says a Go
  absence is the zero value, and that is **wrong here**: `SUMMARY:` with an empty value is a
  reachable, real answer that a zero-value convention cannot tell apart from no `SUMMARY` line
  at all. Same for `ORGANIZER:mailto:`. A pointer is the one shape that distinguishes them,
  exactly as `RowCountEstimate` is `*float64` in `dataprofile` for §7.1's reachable zero. The
  corpus's empty-versus-absent pair is what fails the obvious shape.
- **`Attendees` is `[]string`** — empty, never nil-versus-empty-significant; §1 says never
  absent.
- **`AllDay` is a plain `bool`** — §1 says never absent and `false` is its absence.
- **`foldASCII` maps 'A'–'Z' only** (§5.3). `strings.ToLower` is wrong twice over here: it
  applies **simple** case mapping, so `İ` becomes one byte where JavaScript and Python produce
  two, and Go indexes **bytes**, so the resulting index is short rather than long. An ASCII
  fold is byte-length-preserving and gives a valid index into the original.

  **Iterate bytes, not runes.** UTF-8 guarantees every byte of a multi-byte sequence is
  ≥ 0x80, so no continuation or lead byte can fall in 0x41–0x5A — a byte loop cannot corrupt
  a multi-byte character, and it is byte-length-preserving by construction rather than by
  argument, which is the property `strings.Index` needs:

  ```go
  // Stability note: see icalendar.md §5.3. NOT strings.ToLower — Go's simple case mapping
  // shrinks U+0130 from two bytes to one, so an index found in the folded copy is short.
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
- **Trimming uses §R7's set**, not `strings.TrimSpace` — which strips U+0085 and does not
  strip U+FEFF. Mirror `dataprofile`'s existing helper; do not lift it into `internal/`.
- **Unfolding operates on the string, not on a `bufio.Scanner`** — §2's rule is a textual
  substitution over the whole document, and a line-oriented scanner has already discarded the
  CRLF the rule matches on.
- **Never returns an `error`** (§R6, §5.5). `Parse` returns `[]ParsedEvent` alone; `Build`
  returns `string` alone.
- **`Build` does not fold** (§7, settled by RFC-0018).
- **Package doc carries `// Stability: experimental`** — exactly one file per package may
  declare it, and a package with none fails the surface walker.

- [ ] **Step 1: Write the package**
- [ ] **Step 2: Build, vet, format**

```bash
cd "$(git rev-parse --show-toplevel)"
go -C sdks/go build ./... && go -C sdks/go vet ./... && gofmt -l sdks/go
```
Expected: no output from any of them. (`gofmt -l` alone exits 0 — it can never fail a build;
that is why the CI recipe wraps it in `test -z`.)

- [ ] **Step 3: Commit** — `feat(go): the icalendar package`

---

## Task 8: The Go runner and surface

**Files:**
- Create: `sdks/go/conformance/icalendar_test.go`
- Modify: `sdks/go/internal/apisurface/cmd/main.go` — the `packages` list
- Modify: `docs/api-surface-go.md` (generated), `docs/conformance-coverage.json`, `docs/conformance-coverage.md`

- [ ] **Step 1: Add `"icalendar"` to the `packages` list** in `cmd/main.go`, keeping it
  alphabetical (between `distributionchannel` and `ipc`). `cmd/golden_test.go` asserts the
  list covers every non-internal package, so omitting it fails rather than silently shrinking
  the gate.

- [ ] **Step 2: Write the runner**

Model on `sdks/go/conformance/distributionchannel_test.go`: `corpusCases(t, "icalendar")`, a
floor (`len(cases) < 45` → `t.Fatalf`), the `executed` counter incremented **inside** the
subtest, `recordCase` in a `t.Cleanup`, and a `runKind` helper that fails when a kind filter
matches zero cases.

Two Go-specific hazards:

- **`spec.LoadCorpus` decodes with `UseNumber`**, so every corpus number is a `json.Number`.
  This corpus is all strings and booleans, so it should not bite — but a `.(float64)`
  assertion on case data is always wrong, so do not write one out of habit.
- **Decode `expect` into a struct rather than type-asserting nine members by hand — but only
  with `DisallowUnknownFields`.** Hand-rolled assertions are where the nine `*string` members
  go wrong: comma-ok'ing a `nil` interface yields `""`, which is exactly the bug the
  empty-versus-absent cases exist to catch, and it would make them pass. `encoding/json`
  already does this correctly and natively — JSON `null` decodes to a `nil` pointer, a JSON
  string to a pointer to it — and `reflect.DeepEqual` then compares the whole event at once,
  which is the whole-object comparison Task 2 argues for.

  Two things make the obvious version of this unsafe, and both must be handled:

  1. **`spec.LoadCorpus` returns `[]map[string]any`, not raw bytes** — it has already decoded
     with `UseNumber`. So there is a re-marshal hop; there is no `caseRaw` to reach for.
  2. **Plain `json.Unmarshal` silently ignores unknown fields and leaves missing ones at
     their zero value.** A case file with a typo'd `sumary` key would decode to
     `Summary == nil` and *pass* every absence expectation — reintroducing the vacuity this
     bullet exists to prevent, one level down. `DisallowUnknownFields` is what closes it, and
     it is not the default.

  ```go
  // want mirrors ParsedEvent's shape. Declared in the test, not imported, so a change to
  // the published struct cannot silently change what the corpus is compared against.
  type wantEvent struct {
      UID          string   `json:"uid"`
      RecurrenceID *string  `json:"recurrenceId"`
      Summary      *string  `json:"summary"`
      // … the remaining six optional strings …
      AllDay       bool     `json:"allDay"`
      Attendees    []string `json:"attendees"`
  }

  raw, err := json.Marshal(expect) // expect is the map LoadCorpus handed back
  if err != nil {
      t.Fatalf("%s: re-marshalling expect: %v", name, err)
  }
  dec := json.NewDecoder(bytes.NewReader(raw))
  dec.DisallowUnknownFields() // a typo'd key is an error, not a silent absence
  var want struct {
      Events []wantEvent `json:"events"`
  }
  if err := dec.Decode(&want); err != nil {
      t.Fatalf("%s: expect does not match the ParsedEvent shape: %v", name, err)
  }
  ```

  **A missing key is still not an error** — `DisallowUnknownFields` catches extra keys, not
  absent ones. That half is covered by `case.schema.json` requiring all thirteen members
  (Task 1 Step 2), which the TypeScript guard enforces with Ajv for every binding; Go relies
  on it rather than re-implementing it. Say so in a comment, so the next reader does not
  assume the struct alone is the guarantee.

- [ ] **Step 3: No `ci.yml` change** — Go runs `go test ./conformance/`, the whole package.

- [ ] **Step 4: Run, regenerate, claim**

```bash
cd "$(git rev-parse --show-toplevel)"
NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./...
go -C sdks/go run ./internal/apisurface/cmd
```
Move `icalendar` from `go.unclaimed` to `go.claims`; re-run `bun run conformance:coverage`.
Check whether `docs/spec/README.md`'s neutrality wording needs a further edit — Task 6 already
made it dual-run, so usually not.

- [ ] **Step 5: Full three-language verification and PR C**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run build && bun run test
cd sdks/python && python -m pytest -q
cd "$(git rev-parse --show-toplevel)" && NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./...
```

PR C title: **`feat(go): the icalendar package`**.

**At this point `icalendar` is a three-language corpus** — seven of eleven corpus directories
run in all three bindings.

---

## Task 9: Promotion to `frozen`

Only now is RFC-0015's bar met: a normative document under `docs/spec/` **and** a
conformance-corpus guard that imports the module, in all three bindings.

Every one of these three PRs also moves `sdks/typescript/scripts/stability-rules.test.ts`'s
hard-coded export counts — currently **226** (TypeScript), **92** (Python), **145** (Go).
Tiers changing does not move a count, but Tasks 5–8 add exports and *do*: read the failing
assertion's actual number rather than predicting it.

### 9a — TypeScript (PR D)

- [ ] **Step 1:** In `sdks/typescript/src/icalendar.ts`, change `@moduleStability stable` to
  `frozen`. **It is already on the first export** — `ParsedEvent`'s JSDoc at line 29, not the
  module comment at line 3, and the comment at lines 6–8 says why. Leave it there; moving it
  up is how `tsc` elides it.
- [ ] **Step 2:** `bun run build && bun run --cwd sdks/typescript api:surface`; confirm
  `docs/api-surface.md` shows `**Stability:** frozen` for all four `icalendar` exports
  (`BuildEventInput`, `ParsedEvent`, `buildVEvent`, `parseICalendar`).
- [ ] **Step 3:** `bun run test`.
- [ ] **Step 4:** Commit as `feat(typescript): promote icalendar to frozen`. No RFC needed.
  Confirm before pushing:
  ```bash
  cd sdks/typescript && GITHUB_REPOSITORY=nimbus-agent/nimbus-sdk GH_TOKEN=$(gh auth token) \
    GITHUB_BASE_SHA=$(git rev-parse origin/main) bun run scripts/conventional-commit-guard.ts --pr <n>
  ```

### 9b — Python (PR E)

- [ ] **Step 1:** `__stability__ = "frozen"` in `calendar.py` — the **defining** module.
- [ ] **Step 2:** `python scripts/api_surface.py`; confirm each line ends `— **frozen**`.
- [ ] **Step 3:** `python -m pytest -q`, including `test_stability.py`.
- [ ] **Step 4:** Commit as `feat(python): promote nimbus_sdk.icalendar to frozen`.

### 9c — Go (PR F)

- [ ] **Step 1:** `// Stability: experimental` → `frozen` in `doc.go`'s package comment.
- [ ] **Step 2:** `go -C sdks/go run ./internal/apisurface/cmd`; confirm `— **frozen**`.
- [ ] **Step 3:** `NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./...`.
- [ ] **Step 4:** Commit as `feat(go): promote icalendar to frozen`.

---

## Prove each load-bearing case bites

Both prior shipments did this and it caught a vacuous assertion each time. Before PR C merges,
break the implementation, watch **exactly** the named case fail, restore. At minimum:

| Break | Expected sole failure |
|---|---|
| `foldAscii` → `toLowerCase()` (all three bindings) | the U+0130 case |
| §R7 trim → the host's `strip`/`TrimSpace` | the U+FEFF case, and in Python the U+001C case too |
| unescape → sequential global replaces | the `\\n` case |
| `hasParam` whole-element → substring test | the `VALUE=DATE-TIME` case |
| Go's `*string` → `string` | the empty-versus-absent cases |
| §4.1 escape order → `;` before `\` | the backslash-escaping build case |
| `Build` gains a 75-octet fold | both §7 cases |

A break that fails *nothing* means the case is vacuous; a break that fails *everything* means
the case is not isolating what its `reason` claims.

---

## Definition of done

- [ ] RFC-0018 is merged and indexed; `icalendar.md` §7 is settled, not provisional.
- [ ] `docs/spec/conformance/v1/icalendar/` holds an index, two schemas and ~56 cases; index and directory agree.
- [ ] The corpus was **observed failing** the shipped `extractMailto` on exactly one case before the fix, and the existing 29 unit tests were observed green at that moment.
- [ ] Three runners execute it — TypeScript, Python, Go — and `conformance-report` records all three.
- [ ] `docs/conformance-coverage.json` claims `icalendar` for all three bindings, with nothing left under `unclaimed` for it.
- [ ] `docs/spec/README.md` says eleven guards and eleven corpus directories, names `icalendar` inside the neutrality paragraph, and does **not** name it in the TypeScript-only disclosure.
- [ ] Python has six import roots with a `minimums` entry; Go has seven packages; both goldens regenerated; `stability-rules.test.ts`'s three counts updated.
- [ ] All three `icalendar` modules are `frozen` in their language's golden.
- [ ] Every row of *Prove each load-bearing case bites* was executed and restored.
- [ ] From the repository root after `bun run build`: `bun run test` passes.
- [ ] From `sdks/python/` after `pip install -e .`: `pytest -q`, `ruff check`, `ruff format --check`, `mypy` pass.
- [ ] `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...`, `go vet ./...`, `test -z "$(gofmt -l sdks/go)"` all clean.
- [ ] Seven PRs merged; releases cut: one TypeScript patch, one Python minor, one Go minor, then one promotion minor each.

## Deliberately not in this shipment

- **Shipment 4 — `jmap-fastmail`**, the last battery.
- **`docs/modules/icalendar.md`'s Python- and Go-binding sections**, including the
  `Parse`/`Build` naming divergence Task 7 records. Cheaper done once across four batteries
  than four times — same call Shipments 1 and 2 made.
- **`CLAUDE.md` and `docs/ROADMAP.md`.** The Pillar 3 box does not close until the fourth
  battery lands, and root/package-count claims are easier to correct once.
- **RFC-0015 §3's tier tables.** They still list `data-profile/index.js` and
  `distribution-channel.js` as `stable` after two promotions, so this is *existing* drift, not
  drift this shipment adds. RFC-0017 §6 asks for it "as each lands"; both prior shipments
  deferred it. Fix all four in Shipment 4's wrap-up, in one edit, rather than making this
  shipment the odd one out.
- **Folding.** Settled as out of scope for v1 by Task 0.
