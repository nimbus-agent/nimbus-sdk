# Battery Port — Shipment 4 (`jmap`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `docs/spec/batteries/v1/jmap.md` executable — a conformance corpus every binding runs — bind it in Python and Go, promote all three modules to `frozen`, and **close the battery port**: the deferred documentation Shipments 1–3 each pushed forward lands here, because there is no Shipment 5 to push it to.

**Architecture:** The shape Shipments 1–3 established, plus two things none of them had. It opens with an **unrelated flake fix**, because Shipment 4 will run the Windows Python matrix eight more times and that test fails intermittently on it. It closes with a **wrap-up pull request** that Shipments 1, 2 and 3 all deferred — `docs/modules/*.md` binding sections, `CLAUDE.md` and `ROADMAP.md` counts, and RFC-0015 §3's tier tables, which still list all four batteries as `stable` after three promotions.

**Tech Stack:** TypeScript (Bun test, Ajv, Biome), Python 3 (pytest, ruff, mypy strict), Go (stdlib `testing`, `go:embed`), JSON Schema draft-07.

**Spec:** [`docs/spec/batteries/v1/jmap.md`](../../spec/batteries/v1/jmap.md), merged in #188, and its preamble [`README.md`](../../spec/batteries/v1/README.md). Authorising RFC: [RFC-0017](../../rfcs/0017-battery-specifications.md). Precedent: [Shipment 3's plan](./2026-08-28-battery-port-shipment-3.md) and its [review](./2026-08-28-battery-port-shipment-3-review.md).

## Global Constraints

Unchanged from Shipments 1–3, and repeated because a plan that assumes you read the last one is a plan that gets half-followed:

- **Dependency-free at runtime, all three languages.**
- **No `any`; TypeScript strict.** Python is `mypy --strict` and `ruff` clean at line length 88.
- **Two roots.** Import `repoRoot` / `packageRoot` from `sdks/typescript/scripts/paths.ts`.
- **The `index.json` is the corpus.** Case file and index entry land in the same commit.
- **After editing ANYTHING under `docs/spec/`:** `go -C sdks/go generate ./spec` in the same commit, or `spec/drift_test.go` fails. **`docs/spec/README.md` counts too** — Shipment 3 missed exactly that and took all five `go` legs red while `conformance (go)` stayed green, because the drift guard is in the `spec` package and the conformance job runs `./conformance/` only.
- **Before pytest, after a `docs/spec/` edit:** `cd sdks/python && python -m pip install -e .`.
- **A new corpus guard goes in `ci.yml`'s TypeScript `bun test` list AND its Python pytest list.** `corpus-parity.test.ts` asserts both. Go needs nothing.
- **`conformance-coverage.json`: `unclaimed` is corpus → *reason string*; `deferred` is corpus → *list of case files*.** Not interchangeable.
- **Verify a CI run exists** after opening each PR: `gh api "repos/nimbus-agent/nimbus-sdk/actions/runs?head_sha=<sha>" --jq '.total_count'`.
- **`gh pr create --body-file`**, never inline `--body`.
- **Sequential pull requests against `main`, never stacked.**

### Verification commands must be able to fail

Shipment 3 lost a CI cycle to this three times, in three different disguises. All three had the same shape: a command that could not distinguish *passed* from *did not run*.

| Don't | Do |
|---|---|
| `go test ./... \| grep -c '^ok'` | run it, then `grep -q FAIL` and branch on that |
| `gh pr checks N \| awk '$2=="fail"'` | `gh pr checks N --json name,state` — check names contain spaces, so `$2` is not the state column |
| `cd sdks/python && …` in a long `&&` chain | absolute paths, or verify `pwd` first — a failed `cd` skipped the Python gates entirely |

**Before every push, run the full sequence** — `build-test` has seven steps and `bun run test` is one of them. Build `tools/create-connector` before `scaffold:test`, or three tests fail on a missing `dist/` for the wrong reason.

---

## Pull request map

**Eight PRs.** Seven is the Shipment 3 shape; PR 0 and PR G are the additions.

| PR | Type | Tasks | Releases |
|---|---|---|---|
| 0 | `fix(python):` | 0 | none (test-only) |
| A | `fix(typescript):` | 1, 2, 3, 4 | `@nimbus-dev/sdk` patch |
| B | `feat(python):` | 5, 6 | `nimbus-dev-sdk` minor |
| C | `feat(go):` | 7, 8 | `sdks/go` minor |
| D | `feat(typescript):` | 9a | `@nimbus-dev/sdk` minor |
| E | `feat(python):` | 9b | `nimbus-dev-sdk` minor |
| F | `feat(go):` | 9c | `sdks/go` minor |
| G | `docs:` | 10 | none |

**Why PR 0 goes first.** It is unrelated to `jmap`, and it still goes first: the test it fixes flakes on `python (windows-2025, *)`, it already blocked release PR #223, and this shipment runs that matrix eight more times. Fixing it first removes eight chances to lose a cycle to a failure that is not yours.

**Why three promotion PRs.** A tier change edits all three goldens, and release-please assigns by **paths**. One promotion PR would release three components under one subject line.

**A note on the TypeScript changelog.** `sdks/typescript/scripts/stability-rules.test.ts` pins export counts for all three goldens, so PRs B and C *must* edit a TypeScript file, and release-please will therefore cut a TypeScript release carrying a `**python:**` or `**go:**` entry. That has happened once per binding shipment since #135 — seven entries so far. It is a known consequence, not a mistake to avoid; do not restructure the PRs to dodge it.

---

## Task 0: the Windows flake (PR 0)

**Files:** Modify `sdks/python/tests/test_connector_kit_urllib_transport.py`

`test_a_post_body_reaches_the_server` fails intermittently on `python (windows-2025, *)` with:

```
TransportError: POST http://127.0.0.1:PORT/plain failed:
  [WinError 10053] An established connection was aborted by the software in your host machine
```

**This is the second distinct cause in this test.** [#185](https://github.com/nimbus-agent/nimbus-sdk/pull/185) fixed a leaked listening socket (`shutdown()` without `server_close()`); that fix is intact and is not this.

### Diagnosis

`_Handler` sets `do_POST = do_GET`, and `do_GET` **never reads `self.rfile`**. So on a POST the server writes its response and closes the connection with the request body still unread in its receive buffer. On Windows, `closesocket()` with pending unread data forces an **abortive close (RST)** rather than a graceful FIN, and a client still reading the response gets `WSAECONNABORTED` = 10053. Whether the client finishes reading before the RST arrives is a race, which is why it is intermittent and Windows-only.

Evidence, all three consistent with that and with nothing else:

- **Exactly one test in the file sends a request body** (`grep -c 'body=b'` → 1), and it is the one that flakes.
- The failure is Windows-only across a matrix that also runs ubuntu and macOS.
- The handler has no `rfile` read anywhere (`grep -n 'rfile'` → no match).

### The test is also vacuous

It is named `test_a_post_body_reaches_the_server` and asserts only `res.ok is True`. It cannot check that the body reached the server, because the server never reads it. Fixing the flake and making the test do what its name says are the same change.

- [ ] **Step 1: Drain the request body in the handler**

Add a second recorder beside `SEEN`, and read `Content-Length` bytes at the top of `do_GET`:

```python
#: Set by the handler on each request so a test can assert what the server saw.
SEEN: dict[str, str | None] = {}
#: The request BODY the handler read, per path. Separate from SEEN because SEEN's value is
#: the Authorization header; widening it to a tuple would touch every existing assertion.
SEEN_BODY: dict[str, bytes] = {}
```

```python
    def do_GET(self) -> None:
        SEEN[self.path] = self.headers.get("Authorization")
        # Drain the request body BEFORE responding, even though only one route needs its
        # contents. On Windows, closing a socket with unread received data forces an
        # abortive close (RST) instead of a graceful FIN, and a client still reading the
        # response sees [WinError 10053]. That race is what made this file flaky.
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            SEEN_BODY[self.path] = self.rfile.read(length)
```

- [ ] **Step 2: Make the test assert its own name**

```python
def test_a_post_body_reaches_the_server(origin_a: str) -> None:
    res = UrllibTransport().send(
        HttpRequest(url=f"{origin_a}/plain", method="POST", body=b'{"a":1}')
    )
    assert res.ok is True
    # The half the name promises. Before the handler drained rfile this was unassertable,
    # which is why the test asserted only res.ok and why the flake had somewhere to hide.
    assert SEEN_BODY["/plain"] == b'{"a":1}'
```

- [ ] **Step 3: Clear the new dict in the autouse fixture**

`_clear_seen` must clear `SEEN_BODY` too, both before and after, or one test's body leaks into the next.

**Module-level dicts, deliberately — no lock, no per-server container.** Review raised
parallelism, on the grounds that `pytest-xdist` could be introduced later. Two reasons not to
pre-empt it, both worth writing down so it is not re-raised:

- **`pytest-xdist` parallelises across processes, not threads.** Each worker is a separate
  interpreter with its own module globals, so `SEEN` and `SEEN_BODY` cannot race under it.
  The stated trigger does not produce the stated hazard.
- **The one real cross-thread hand-off is already ordered.** `serve_forever` runs in a daemon
  thread and writes the dict; the test reads it only after `send()` returns, which is after
  the server wrote its response, which is after the handler wrote the dict. The socket round
  trip *is* the synchronisation.

If this suite ever runs tests concurrently **within** a process, revisit it — that is the
condition that would make a lock earn its place, and it is not today's.

- [ ] **Step 4: Prove the fix, and prove the assertion bites**

```bash
cd sdks/python
for i in 1 2 3 4 5; do python -m pytest -q tests/test_connector_kit_urllib_transport.py; done
```
Expected: green five times running. **This is weak evidence on Linux** — the race is Windows-only, and a local Linux/macOS run cannot reproduce it either way. Say so in the PR body rather than implying the repeat run proves the fix.

Then delete the `rfile.read` and confirm the new assertion fails (`SEEN_BODY` has no `/plain` key). That proves the assertion is real even where the flake is not reproducible.

- [ ] **Step 5: Full Python gates, then PR 0**

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

PR 0 title: **`fix(python): drain the request body in the transport test server`**.

`fix:` rather than `test:` deliberately — it changes runtime behaviour of the test server in a way that fixes an observed CI failure, and a reader scanning for why the flake stopped should find it under fixes. It touches only `tests/`, so it cuts no release.

---

## Task 1: The corpus

**Files:**
- Create: `docs/spec/conformance/v1/jmap/{index.schema.json,case.schema.json,index.json}`
- Create: `docs/spec/conformance/v1/jmap/cases/*.json` (~60 files)

**The corpus directory is `jmap`, not `jmap-fastmail`.** §1 and RFC-0017 §2 are explicit: the document and corpus are named for what they specify, the modules keep a vendor prefix for historical reasons. `conformance-coverage.json`, `corpusNames()` and `docs/spec/README.md` all use `jmap`.

- [ ] **Step 1: `index.schema.json`**

Copy `icalendar`'s, changing `$id`, `title`, and `spec`'s `const` to `"../../../batteries/v1/jmap.md"`. Keep the wider section pattern `^§[0-9]+(\.[0-9]+)*$` — this document has §1.1, §5.1, §5.2, §6.1–§6.4, §7.1–§7.3.

- [ ] **Step 2: `case.schema.json`**

**Eight kinds**, the most of any corpus so far, discriminated on `kind`, each `then` branch requiring its own inputs and forbidding the others':

| kind | input | expect |
|---|---|---|
| `session` | `parsed` | `{ session: {apiUrl, accountId} \| null }` |
| `validate-url` | `candidate`, `allowedBase` | `{ url }` **or** `{ raises: "<exact message>" }` |
| `view-email` | `raw` | `{ view: <JmapEmailView> \| null }` |
| `addresses` | `value` | `{ formatted: [string] }` |
| `attachments` | `value` | `{ attachments: [...] }` |
| `preview` | `raw` | `{ preview: string }` |
| `request` | `form` (`list`/`search`/`get`), `accountId`, and `limit` or `query` or `id` | `{ request: <parsed structure> }` |
| `extract` | `parsed`, and `methodName` for the args form | `{ args: … }` / `{ list: [...] }` |

**`validate-url` is the only kind whose expectation can be an error**, because §5.1 makes it the only function that raises. Its `expect` therefore has two branches — but **follow `url-resolution`'s shape, not a new one**:

```
{ "ok": true,  "url": "<the re-serialised candidate>" }
{ "ok": false, "message": "<the exact §5 message>" }
```

`url-resolution/case.schema.json` already models a throwing function this way (`resolveUrlWithBase` throws too), with `ok` as the discriminator and the exact message as contract text. Reuse the discriminator.

**Do not copy its `reason` member.** `url-resolution` has one because *its* §7 defines three named reason tokens (`malformed`, `invalid-base`, `cross-origin`). `jmap.md` §5.1 defines three **messages** and no names. Adding a `reason` here would mean inventing a vocabulary the specification does not have, which is exactly what preamble §R4 forbids.

Say in the schema's `description` that `ok: false` means the function **raised**, not that it returned an absence — §5.1 is the one place in this battery where those differ, and a reader coming from the other corpora will assume absence.

**§9 forbids comparing serialised bytes for `request` cases.** Go's `encoding/json` sorts map keys; the other two emit insertion order. `expect.request` is a parsed structure and every runner compares structurally.

- [ ] **Step 3: Write the cases**

Roughly **60**. Every case earns its place; the index `reason` states the section, and where it guards a specific wrong implementation it carries the measured *"caught by 0 of the N cases that existed before it."*

| Section | Cases | Notes |
|---|---|---|
| §2 | 3 | the five constants exact; `EMAIL_PROPERTIES` order verbatim; `SUBMISSION_CAPABILITY` published though unreferenced |
| §3 | 4 | as-record rejects an **array**; as-string rejects **`""`** — the rule §3 says will be missed; `null`; a number |
| §4 | 5 | both members present; `apiUrl` empty → absence; `primaryAccounts` not a record → absence; missing mail capability → absence; all-or-nothing (never partial) |
| §5 | 4 | accepted candidate returns the **re-serialised** URL, not the input; each of the three rejection messages, **verbatim**, in evaluation order |
| §5.1 | 1 | a rejection is a *raise*, not an absence — the kind's error branch |
| §5.2 | 5 | `http` base accepts an `https` candidate; a genuine port mismatch rejects; **and the three host-normalisation cases** — explicit `:443` against a portless base, mixed case, an IPv6 literal with a port. Each fails a different naive binding |
| §6 | 5 | `id` absent + `messageId` present → `id` is `""`; both absent → **absence**; `id` present + `messageId` absent → view; non-record → absence; every member populated |
| §6.1 | 5 | name + email; name only; email only; non-record → dropped; three malformed → **empty list, not three empty strings** |
| §6.2 | 4 | one entry per element **including non-records**; length equals input length; `mimeType` from **`type`**; `size` non-finite → absent, **not zero** |
| §6.3 | 5 | first usable `textBody` part wins; skips a part whose value is empty; falls back to `preview`; `bodyValues` not a record → fallback; nothing available → `""` |
| §6.4 | 6 | the five normalisation steps in order; **the truncation case** (below) |
| §7.1 | 2 | the shared args exactly, including `bodyProperties` order |
| §7.2 | 4 | list **omits `filter` entirely**; search includes it; the `"q"` client id appears in both places and agrees; two method calls, not one |
| §7.3 | 2 | `ids: [<id>]`; client id `"e"` |
| §8 | 5 | first match in order wins; no match → absence; second item not a record → absence; an `error` response matches nothing; `extractEmailList` on a non-array → `[]` |

**The case to write with most care — §6.4's truncation.** See the next section: it fails the shipped TypeScript, and it is the reason PR A is a `fix:`.

- [ ] **Step 4: `index.json`**, one entry per case — `file`, `section`, `reason`.

- [ ] **Step 5: Verify index and directory agree** — the one-process Python check from Shipment 3's plan.

- [ ] **Step 6: `go -C sdks/go generate ./spec`, then commit.**

---

## What is already known before any code is written

### §6.4's truncation splits a code point, and all three languages split differently

§6.4 step 5 says the result is truncated to `PREVIEW_MAX_CHARS`, and that **truncation MUST NOT split a code point**. `capPreview` does:

```ts
return normalized.length > PREVIEW_MAX_CHARS
  ? normalized.slice(0, PREVIEW_MAX_CHARS)
  : normalized;
```

`String.prototype.slice` cuts at a UTF-16 **code unit**. Measured, on 1999 ASCII characters followed by U+1F600 (which occupies units 1999 and 2000):

```
output units : 2000
last unit    : 0xd83d   <- LONE HIGH SURROGATE
well-formed? : false
```

The returned preview is **ill-formed UTF-16**. That is not cosmetic: this view is documented as JSON-safe and is meant to cross a process boundary, and a lone surrogate cannot be encoded as UTF-8 at all. Per the divergence already recorded in `CLAUDE.md`, a Python consumer doing `.encode("utf-8")` on it **raises `UnicodeEncodeError`**.

And the three languages fail differently on the same input:

| Binding | naive truncation at 2000 | result |
|---|---|---|
| TypeScript (shipped) | `.slice` — UTF-16 units | lone high surrogate, **ill-formed** |
| Python | `[:2000]` — code points | whole character kept, **correct** |
| Go | `[:2000]` — bytes | truncated 4-byte lead, **invalid UTF-8** |

Two different broken outputs and one correct one, from the same expression — the same shape as Shipment 3's U+0130 finding, and the reason §6.4 spells out "measured in the same units the binding's string type counts… A binding whose string is a byte sequence measures code points here, not bytes."

**Caught by 0 of the 69 existing jmap unit tests**, which are green while the defect is present — measured, not assumed.

### §5.2's `host` is three different things, and two of them change the verdict

§5.2 says the comparison uses "the URL's authority… as the URL's `host` accessor carries
it", and that a binding "MUST use a parser that normalises them the same way". **The three
parsers do not.** Measured:

| Input | JS `URL.host` | Python `.hostname` + `.port` | Go `URL.Host` |
|---|---|---|---|
| `https://x/` | `x` | `x` | `x` |
| **`https://x:443/`** | **`x`** | `x:443` | `x:443` |
| **`http://x:80/`** | **`x`** | `x:80` | `x:80` |
| `https://x:8443/` | `x:8443` | `x:8443` | `x:8443` |
| `https://user:pw@x/` | `x` | `x` | `x` |
| **`https://API.Example.COM/`** | `api.example.com` | `api.example.com` | **`API.Example.COM`** |
| **`https://[2001:db8::1]:8443/`** | `[2001:db8::1]:8443` | **`2001:db8::1:8443`** | `[2001:db8::1]:8443` |

Three separate divergences, and **a different pair agrees each time** — so there is no
"follow the majority" shortcut:

1. **Default ports.** JavaScript drops `:443` on `https` and `:80` on `http`; the other two
   keep them. This **changes the verdict**: candidate `https://x:443/` against base
   `https://x/` is *accepted* by TypeScript and *rejected* by a naive Python or Go.
2. **Case.** JavaScript and Python lowercase; **Go does not**. Candidate
   `https://API.example.com/` against base `https://api.example.com/` is accepted by two
   bindings and rejected by Go.
3. **IPv6 brackets.** Python's `.hostname` strips them, so the naive composition yields
   `2001:db8::1:8443` — not merely different but *ambiguous*, since nothing marks where the
   address ends.

Only the first two change an accept/reject verdict; the third is a correctness hazard in its
own right.

**This is the same shape as `icalendar` §5.3, and gets the same treatment.** Each binding
implements a small `host_key` helper rather than reaching for its parser's accessor:

- **TypeScript** — `new URL(u).host` is already correct. It is the reference (§R2); the other
  two move to match it.
- **Python** — lowercase `.hostname`; re-bracket it if it contains `:` (IPv6); append
  `:{port}` **only when `.port` is not the scheme's default**. Do not use `.netloc` (carries
  userinfo) and do not use bare `.hostname` + `.port`.
- **Go** — `u.Host` already strips userinfo and keeps brackets, so it needs exactly one
  correction: **lowercase it**. `strings.ToLower` is safe here — unlike `icalendar` §5.3 no
  index is derived from the folded value — but drop the default port too.

**§5.2 needs a clarifying amendment**, in PR A alongside the corpus, for the same reason
§5.3 got one in Shipment 3: the sentence "as the URL's authority carries them" reads as
*keep whatever was written*, and the reference implementation does the opposite for a
default port. Say explicitly that the default port is dropped, the host is lowercased, and
an IPv6 literal keeps its brackets — that is what `URL.host` does, and §R2 makes the
reference the thing bindings must match.

**Four §5.2 cases**, not the two the table below originally allowed: an explicit `:443`
candidate against a portless base (accept), a mixed-case candidate (accept), an IPv6
candidate with a port (accept), and a genuine port mismatch (reject). Each fails a different
naive binding, which is the point.

**The fix, per binding:**

- **TypeScript** — truncate to `PREVIEW_MAX_CHARS` units, then back off one if that would strand a high surrogate:
  ```ts
  if (normalized.length <= PREVIEW_MAX_CHARS) return normalized;
  const end = PREVIEW_MAX_CHARS;
  const last = normalized.charCodeAt(end - 1);
  // A high surrogate at the boundary means its pair straddles it. Keep 1999 units rather
  // than emitting a lone surrogate: §6.4 forbids splitting a code point, and an ill-formed
  // string cannot be encoded as UTF-8 by a consumer.
  const safe = last >= 0xd800 && last <= 0xdbff ? end - 1 : end;
  return normalized.slice(0, safe);
  ```
- **Python** — `[:PREVIEW_MAX_CHARS]` is already correct, because Python's unit *is* the code point. Say so in a comment; do not add machinery that does nothing.
- **Go** — must count **runes**, not bytes: `[]rune(s)[:2000]` re-joined, or an index walk. `s[:2000]` is wrong twice over — wrong unit and an invalid cut.

**Do not fix any of this before Task 2 Step 3 has watched the case fail.**

---

## Task 2: The TypeScript guard

**Files:** Create `sdks/typescript/scripts/jmap-guard.test.ts`; modify `.github/workflows/ci.yml`

- [ ] **Step 1: Write the guard**, modelled on `icalendar-guard.test.ts`. Anti-vacuity assertions, at minimum:
  - every declared kind has a case, and every pinned section is cited;
  - **a `validate-url` case exists for each of the three §5 messages**, compared verbatim;
  - **at least one `validate-url` case expects a raise** — otherwise §5.1's whole point is untested;
  - **a `preview` case exceeds `PREVIEW_MAX_CHARS` and contains an astral character**, and its expected output is well-formed: `expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false)`;
  - **an `attachments` case contains a non-record element**, and expected length equals input length;
  - **an `addresses` case yields fewer outputs than inputs** — that is §6.1's dropping rule;
  - `request` cases are compared with `toEqual` on the parsed structure, never on a serialised string (§9).
  - Use `TextEncoder`, never `Buffer` — no package here declares `@types/node`.

- [ ] **Step 2: Add it to `ci.yml`'s `bun test` list**, alphabetically (after `icalendar-guard`).

- [ ] **Step 3: Run it — it MUST fail on exactly the §6.4 truncation case.**

**Do not proceed if it fails on anything else, and do not proceed if it passes.** A pass means the corpus is not exercising §6.4 and this shipment's spec-first claim is untested. Shipment 3's first U+0130 case passed for exactly that reason — the input never reached the code under test.

- [ ] **Step 4: Record the measurement** — run `bun test src/jmap-fastmail/index.test.ts` and confirm it is green (69 at time of writing; read the real number off the run).

- [ ] **Step 5: Commit the red guard.**

---

## Task 3: The §6.4 correction

**Files:** Modify `sdks/typescript/src/jmap-fastmail/index.ts` (`capPreview`) and `index.test.ts`; modify `docs/rfcs/0017-battery-specifications.md` §6.1's register

- [ ] **Step 1: Confirm the case still fails.**
- [ ] **Step 2: Apply the TypeScript fix above**, with the comment explaining why the boundary check is needed and why Python needs none.
- [ ] **Step 3: Add a unit regression test** — an astral character straddling the cap, asserting the output is well-formed.
- [ ] **Step 4: Guard and unit suite both green.**
- [ ] **Step 5: Register the correction in RFC-0017 §6.1**, in the established form. This is the third entry; Shipment 3 added the first two (its own, and Shipment 2's, which had never been recorded).
- [ ] **Step 6: `docs/api-surface.md` must be UNCHANGED** — a behaviour change behind an unchanged signature.
- [ ] **Step 7: Commit as `fix(typescript): capPreview must not split a code point`.**

---

## Task 4: Coverage bookkeeping, and PR A

- [ ] **Step 1:** `docs/conformance-coverage.json` — claim `jmap` for typescript; `unclaimed` (not `deferred`) for python and go, reason `"binding lands in this shipment's next pull request"`.
- [ ] **Step 2:** `bun run conformance:coverage`.
- [ ] **Step 3: `docs/spec/README.md` — six edits.** Shipment 3 found the counts were **already wrong in both halves** before it touched them, so **derive every number**, do not increment:
  1. kinds/directories counts (currently ten kinds across eleven directories → eleven and twelve; confirm against `corpusNames()` and the directory listing);
  2. a `### jmap` corpus entry;
  3. the guard count (currently eleven → twelve);
  4. a guard paragraph in *How this stays true*;
  5. the TypeScript-only disclosure (four → five, naming `jmap`);
  6. **`go -C sdks/go generate ./spec`** — `docs/spec/README.md` is mirrored, and forgetting this is what took Shipment 3's Go legs red.
- [ ] **Step 4:** `conformance-corpora.test.ts` — the hard-coded corpus list **and** a per-corpus floor. This is the sixth surface gate, not one of CLAUDE.md's five; Shipment 3 discovered it the hard way.
- [ ] **Step 5: Full verification, then PR A**, titled `fix(typescript): capPreview must not split a code point`.

---

## Task 5: The Python binding

**Files:** Create `sdks/python/src/nimbus_sdk/jmap_fastmail/{__init__.py,jmap.py}`

**Package `jmap_fastmail`, module `jmap.py`.** The package keeps the vendor prefix (§1); the module inside it does not need it. Unlike `icalendar`, there is no stdlib collision to avoid here.

Requirements that will otherwise be got wrong:

- **`_as_string` returns `None` for `""`** (§3). The rule the specification predicts will be missed.
- **`_as_record` rejects a list** — `isinstance(v, dict)` does this for free, but say so.
- **`validate_api_url` RAISES** (§5.1), and is the only function here that does. Raise `ValueError` with the three messages **verbatim** (§R5), in §5's evaluation order.
- **`_host_key` implements §5.2's normalisation; do NOT use `.netloc` or a bare `.hostname` + `.port` compose.** See the measured table above. Lowercase `.hostname`, re-bracket it when it contains `:` (IPv6), and append `:{port}` **only when the port is not the scheme's default** (443 for `https`, 80 for `http`). A naive compose keeps `:443` and rejects a candidate the reference accepts.
- **Re-serialise on acceptance** (§5): return the parser's own output, not the input string.
- **`cap_preview` truncation is `[:PREVIEW_MAX_CHARS]`** and is correct as-is, because Python's unit is the code point. Comment saying why, and why TypeScript needed a fix.
- **`size` non-finite → absent** (§6.2). `bool` is a subclass of `int` and `math.isfinite(True)` is `True`, so the bool check comes **first** — otherwise a JSON `true` becomes `sizeBytes: 1`:

  ```python
  if (
      isinstance(size_val, bool)
      or not isinstance(size_val, (int, float))
      or not math.isfinite(size_val)
  ):
      size_bytes = None
  ```
- **Attachment entries are never dropped**; address entries with an empty result **are**.
- **Never raises except `validate_api_url`** (§R6).
- **`__stability__ = "experimental"`** on `jmap.py`, the defining module — never `__init__.py`.

---

## Task 6: The Python runner, root and surface

- [ ] **Step 1:** **eighth** import root in `IMPORT_ROOTS` (there are seven today) **and** in `test_api_surface.py`'s `minimums` map, which raises `KeyError` on a new root.
- [ ] **Step 2:** the runner, modelled on `test_icalendar_corpus.py`. Convert the binding's output into the corpus's shape, not the reverse. Use `pytest.raises` with an exact message match for the `validate-url` error branch.
- [ ] **Step 3:** `ci.yml`'s pytest list.
- [ ] **Step 4:** reinstall, run, **check the executed count**.
- [ ] **Step 5:** `python scripts/api_surface.py`; move `jmap` into python's `claims`; `bun run conformance:coverage`.
- [ ] **Step 6: `docs/spec/README.md` — the dual-run switch.** At **two** bindings, `corpus-parity.test.ts` requires `jmap` to be **named inside the language-neutrality paragraph** and **removed from the TypeScript-only disclosure**. Shipment 3's plan expected this at three bindings and was wrong; the guard's `dualRunCorpora()` triggers at two. The paragraph is extracted **up to the first blank line** — put the sentence inside it. Then `go generate ./spec` again.
- [ ] **Step 7:** update `stability-rules.test.ts`'s Python export count; verify and open PR B.

---

## Task 7: The Go package

**Files:** Create `sdks/go/jmapfastmail/{jmapfastmail.go,doc.go}`

- **Truncation counts runes, not bytes** (§6.4) — `s[:2000]` is wrong twice over. Find the byte index of the cap'th rune with a `range` loop rather than allocating a `[]rune`:

  ```go
  // `for i := range s` yields the byte index of each rune's FIRST byte, so when count
  // reaches the cap, i is exactly the end of the preceding runes. No []rune allocation,
  // and it cannot split a sequence.
  count := 0
  for i := range normalized {
      if count == PreviewMaxChars {
          return normalized[:i]
      }
      count++
  }
  return normalized
  ```
- **`ValidateAPIURL` returns an `error`**, not a panic — that is Go's spelling of §5.1's "raises", and the three messages are contract text. It is the one function in this package returning an error; everything else returns a zero value or an empty slice (§R6).
- **`URL.Host` excludes userinfo and keeps IPv6 brackets — but does NOT lowercase.** That is Go's one correction for §5.2 (measured above: `https://API.Example.COM/` yields `API.Example.COM`). Lowercase it, and drop the port when it is the scheme's default. `strings.ToLower` is safe here, unlike `icalendar` §5.3, because no index is derived from the folded value.
- **`methodCalls` entries are heterogeneous arrays** (§9) — `[]any{string, map, string}`, not a struct.
- **Key order is not comparable across bindings** (§9). Go sorts map keys on marshal. The runner compares structures, never bytes.
- **`size` non-finite → absent.** With `UseNumber` on the corpus side, take care that the *binding's* input is ordinary decoded JSON; a `json.Number` reaching `viewEmail` would be a runner bug, not a binding one.
- **Naming:** `ParseSession`, `ValidateAPIURL`, `ViewEmail`, `BuildListRequest` — the package name is `jmapfastmail`, which does not supply the `Session`/`Email` qualifier, so **nothing is trimmed here**. Unlike `icalendar.Parse`, these names keep their nouns. Record in the wrap-up that this is why.
- **`// Stability: experimental`** in `doc.go`, exactly one file.

---

## Task 8: The Go runner and surface

- [ ] **Step 1:** `"jmapfastmail"` into `cmd/main.go`'s `packages` list.
- [ ] **Step 2:** the runner, modelled on `icalendar_test.go`. Reuse the `decodeStrict` helper — **it already exists in the package** from Shipment 3, so do not redeclare it; the `conformance` package is one namespace and Shipment 3 hit a `runParseCase` collision there.
- [ ] **Step 3:** no `ci.yml` change.
- [ ] **Step 4:** run, verify the subtest count equals the case count, `go run ./internal/apisurface/cmd`, claim `jmap` for go, regenerate coverage, update the README's neutrality wording from two-of-three to all-three.
- [ ] **Step 5:** update `stability-rules.test.ts`'s Go export count; full verification; PR C.

---

## Task 9: Promotion to `frozen`

Only now is RFC-0015's bar met. Each promotion is `feat:` and needs **no RFC** — `diffSurfaces` records the *base* tier. Confirm with the guard's local recipe against the real PR, as Shipment 3 did.

- **9a TypeScript (PR D)** — `@moduleStability stable` → `frozen`. **It is already on the first export**; leave it there.
- **9b Python (PR E)** — `__stability__` on `jmap.py`.
- **9c Go (PR F)** — `// Stability:` in `doc.go`.

Each moves an export count in `stability-rules.test.ts`? **No** — a tier change moves no count. Tasks 5–8 move them; these three do not. Read the failing assertion rather than predicting.

---

## Task 10: Close the battery port (PR G)

Shipments 1, 2 and 3 each deferred this on the grounds that it is cheaper done once. This is once. **It is the last task of the last shipment, so there is nowhere left to defer it to.**

- [ ] **Step 1: `docs/modules/*.md` — the Python and Go binding sections for all four batteries.** Each needs: the exported names per binding, the asymmetries, and the divergences. Specifically record:
  - `icalendar`: Go's `Parse` / `Build` trim the package qualifier; the nine `*string` members and why §R6's zero value does not apply.
  - `jmap`: Go's names are **not** trimmed, and why (Task 7).
  - `data-profile`, `distribution-channel`: whatever Shipments 1 and 2 left unrecorded.
- [ ] **Step 2: RFC-0015 §3's tier tables.** They still list `data-profile/index.js`, `distribution-channel.js` and `icalendar.js` under `stable` after three promotions — drift that predates this shipment. Move all four batteries into the `frozen` row.
- [ ] **Step 3: `CLAUDE.md`.** Python's "four import roots" is now seven; Go's "five packages" is now eight; the `exports` map narrative; the corpora counts; the divergence inventory gains the two U+0130 findings and the code-point truncation.
- [ ] **Step 4: `docs/ROADMAP.md`.** Pillar 3's box closes — "the hottest batteries ported to the additional languages" is now true of all four.
- [ ] **Step 5: RFC-0017's Shipments section** — mark all five done.
- [ ] **Step 6:** `bun run test`, all three suites, `go generate ./spec` if any `docs/spec/` file moved.

PR G title: **`docs: close the battery port`**.

---

## Prove each load-bearing case bites

Before PR C merges, break the implementation, watch **exactly** the named case fail, restore. Run it in **all three** bindings — Shipment 3 found two rows where the same break bites a different number of cases per language, and both were the corpus earning its keep.

| Break | Expected sole failure |
|---|---|
| `capPreview` truncation → naive slice | the §6.4 astral case (TS and Go; **Python is correct by construction and will not fail** — that asymmetry is the finding) |
| `as_string` returns `""` instead of absence | the §3 empty-string case, and §4's `apiUrl: ""` case |
| `validate_api_url` returns an absence instead of raising | the §5.1 case |
| host comparison → origin comparison | the §5.2 `http`-base case |
| attachment entries dropped when not a record | the §6.2 length case |
| address entries kept when empty | the §6.1 three-malformed case |
| list request emits `filter: null` | the §7.2 list case |
| `size` coerced to 0 when non-finite | the §6.2 non-finite case |

A break that fails *nothing* means the case is vacuous; a break that fails *everything* means the case is not isolating what its `reason` claims.

---

## Definition of done

- [ ] The Windows flake is fixed, and its test asserts the body actually arrived.
- [ ] `docs/spec/conformance/v1/jmap/` holds an index, two schemas and ~60 cases; index and directory agree.
- [ ] The corpus was **observed failing** the shipped `capPreview` on the §6.4 case before the fix, with the jmap unit suite green at that moment.
- [ ] Three runners execute it; `conformance-report` records all three.
- [ ] `docs/conformance-coverage.json` claims `jmap` for all three bindings, nothing left `unclaimed` for it.
- [ ] `docs/spec/README.md`'s counts are **derived**, and `jmap` is in the neutrality paragraph, not the TypeScript-only disclosure.
- [ ] Python has **eight** import roots (seven today); Go has **nine** packages (eight today); all three goldens regenerated; `stability-rules.test.ts`'s three counts updated.
- [ ] All three `jmap-fastmail` modules are `frozen`.
- [ ] Every row of *Prove each load-bearing case bites* executed and restored, in all three bindings.
- [ ] **PR G merged**: `docs/modules/`, RFC-0015 §3, `CLAUDE.md`, `ROADMAP.md` and RFC-0017's Shipments section all true.
- [ ] All three suites green; `gofmt`/`vet` clean; ruff/format/mypy clean.
- [ ] Eight PRs merged, and the release PRs they generate drained by the `Release Drain` workflow — **which is the maintainer's call, not this plan's**.

## Deliberately not in this shipment

- **Decoupling `stability-rules.test.ts`'s export-count pins**, which force every Python or Go surface change to also cut a TypeScript release with a misattributed changelog entry. Real, systematic, seven occurrences — and a change to how the surface is gated, which wants its own RFC rather than a footnote in the last battery's shipment.
- **Renaming the `jmap-fastmail` modules to drop the vendor prefix.** RFC-0017 §2 settled that they keep it.
