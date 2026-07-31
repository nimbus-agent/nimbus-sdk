# RFC-0007 Corpus Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two conformance cases RFC-0007 decided on, so a wrong binding that passes the corpus today starts failing it.

**Architecture:** Two independent cases in two different corpora. Each task adds one case file, one index entry, and one corpus-size assertion, then re-runs a wrong binding that must now be caught. No binding source changes — both bindings already answer correctly.

**Tech Stack:** JSON corpus fixtures; pytest (Python runners); Bun test (TypeScript guards).

**Spec:** `docs/rfcs/0007-corpus-gaps-from-the-python-binding.md`, already committed on this branch. Read it first.

## Global Constraints

- **The two corpora use DIFFERENT index conventions.** Negotiation writes `"section": "§5"` (with the section sign) and long sentence-case `reason` strings. Framing writes `"section": "5"` (bare number) and short lowercase `reason` phrases. Match the corpus you are editing — copy the shape of its neighbouring entries, never the other corpus's.
- **`index.json` is normative, not the directory.** Every case file needs an index entry and vice versa; `negotiation-guard.test.ts` asserts set equality both ways.
- **Read every file with `encoding="utf-8"`.** This repo is developed on Windows, where `open()` defaults to cp1252 and silently mojibakes fixtures.
- **Never write a literal U+FEFF into any file.** This has gone wrong five times here. In JSON use the `\uFEFF` escape; in Markdown write `U+FEFF` in words. A literal mark is invisible and makes surrounding text read as though it says the opposite.
- **Do NOT modify any binding source** (`sdks/typescript/src/`, `sdks/python/src/`). Both already answer both new cases correctly — that is the point, and why the cases alone prove nothing.
- **Do NOT modify `case.schema.json` or `index.schema.json`** in either corpus. No new node type, case kind, or refusal reason is needed.
- Commit subjects are `test:`-class. This adds fixtures, not behaviour, and must cut no release.
- **Run all commands from the worktree** `C:\gitrep\nimbus-sdk\.claude\worktrees\rfc-0007`.

**Baselines measured on this branch at `5e6501f`:**

| Suite | Now | After T1 | After T2 |
|---|---|---|---|
| `pytest tests/test_negotiation_corpus.py tests/test_framing_corpus.py -q` | 62 passed | 63 | 64 |
| `pytest -q` (whole Python suite) | 126 passed, 6 skipped | 127 | 128 |
| `bun test scripts/negotiation-guard.test.ts scripts/framing-guard.test.ts` | 85 pass, 0 fail | 85 | 85 |

**The TypeScript guard counts do not change.** Those guards aggregate all cases of a kind into a single assertion, so a new case folds into an existing `expect` rather than adding a test. Do not read an unchanged count as a failure — the Python parametrised counts are what prove the cases execute.

---

### Task 1: `hello-empty-object` — pin the discriminator's position

**Files:**
- Create: `docs/spec/conformance/v1/negotiation/cases/hello-empty-object.json`
- Modify: `docs/spec/conformance/v1/negotiation/index.json` — insert after the `cases/hello-leading-zero.json` entry, before `cases/declaration-match.json`
- Modify: `sdks/python/tests/test_spec.py:39` — `assert len(cases) == 36` becomes `== 37`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing. Task 2 is fully independent of this one.

- [ ] **Step 1: Add the index entry first, with no case file**

The failing-test step: it proves the index drives execution rather than the directory. In `docs/spec/conformance/v1/negotiation/index.json`, find the entry whose `file` is `cases/hello-leading-zero.json` and insert this immediately after it:

```json
    {
      "file": "cases/hello-empty-object.json",
      "section": "§5",
      "reason": "An object carrying neither member pins that the discriminator is checked before contractVersions, and that an absent nimbus is wrong-message — §5 says \"absent, or present but not exactly\", and no other case omits it."
    },
```

- [ ] **Step 2: Run the Python runner to verify it fails**

```bash
cd sdks/python && python -m pytest tests/test_negotiation_corpus.py -q
```

Expected: **collection error** — a `FileNotFoundError` naming `cases/hello-empty-object.json`, raised by `load_corpus` while building `CASES` at import time, so no tests run at all.

If it passes instead, stop and diagnose: the index is not being read, and the rest of this task rests on a false premise.

- [ ] **Step 3: Create the case file**

`docs/spec/conformance/v1/negotiation/cases/hello-empty-object.json`:

```json
{
  "description": "An object carrying neither member. §5 checks the discriminator before contractVersions, and an absent nimbus is wrong-message, so a reader that inspects the array first and answers missing-versions is refused here.",
  "kind": "hello",
  "frame": "{}",
  "expect": { "ok": false, "reason": "wrong-message", "exit": 20 }
}
```

- [ ] **Step 4: Run both runners to verify they pass**

```bash
cd sdks/python && python -m pytest tests/test_negotiation_corpus.py -q
```

Expected: **39 passed** (was 38 — one new hello case).

```bash
cd sdks/typescript && bun run build && bun test scripts/negotiation-guard.test.ts
```

Expected: **31 pass, 0 fail** — count unchanged, per the note above. The reference implementation is driven through the new case inside the aggregated `hello` assertion, so a wrong answer there would still fail it.

- [ ] **Step 5: Prove the case discriminates, by mutation**

Write the wrong binding to a scratch file — **not** into the package:

```bash
cd sdks/python && cat > /tmp/rfc7_probe_hello.py <<'PROBE'
import json
from nimbus_sdk import load_corpus
from nimbus_sdk.ipc import HelloOk, HelloRefused
from nimbus_sdk.contract import _is_contract_version


def wrong_parse_hello(frame: str):
    """Inspects contractVersions BEFORE the nimbus discriminator — the reverse of §5."""
    try:
        decoded = json.loads(frame)
    except ValueError:
        return HelloRefused(reason="not-json")
    if not isinstance(decoded, dict):
        return HelloRefused(reason="not-object")
    declared = decoded.get("contractVersions")
    if not isinstance(declared, list):
        return HelloRefused(reason="missing-versions")
    if decoded.get("nimbus") != "hello":
        return HelloRefused(reason="wrong-message")
    if not declared:
        return HelloRefused(reason="empty-versions")
    seen = []
    for member in declared:
        if not _is_contract_version(member):
            return HelloRefused(reason="invalid-version")
        if member in seen:
            return HelloRefused(reason="duplicate-version")
        seen.append(member)
    return HelloOk(contract_versions=tuple(seen))


hello = [c for c in load_corpus("negotiation") if c["kind"] == "hello"]
caught = []
for case in hello:
    expect = case["expect"]
    want = (
        HelloOk(contract_versions=tuple(expect.get("contractVersions", [])))
        if expect["ok"]
        else HelloRefused(reason=expect["reason"])
    )
    if wrong_parse_hello(case["frame"]) != want:
        caught.append(case["description"][:50])
print(f"caught by {len(caught)} of {len(hello)} hello cases")
for c in caught:
    print("   -", c)
PROBE
python /tmp/rfc7_probe_hello.py
```

Expected: **`caught by 1 of 15 hello cases`**, and the listed case is the new one — its description begins `An object carrying neither member`.

Before this task it was `caught by 0 of 14`. That difference is the whole deliverable: the case turns a wrong reading from passing into failing.

- [ ] **Step 6: Update the corpus-size assertion**

`sdks/python/tests/test_spec.py` line 39 currently reads `assert len(cases) == 36`. Change it to:

```python
    assert len(cases) == 37
```

Leave the neighbouring `assert {case["kind"] for case in cases} == {...}` line untouched — the new case is an existing kind, so the kind set is unchanged.

- [ ] **Step 7: Run the full gate**

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

Expected: all clean; **127 passed, 6 skipped**.

- [ ] **Step 8: Commit**

```bash
git add docs/spec/conformance/v1/negotiation/ sdks/python/tests/test_spec.py
git commit -m "test(negotiation): pin the hello discriminator's position

RFC-0007. Every hello case that malforms contractVersions supplied a
correct nimbus, and every case with a wrong nimbus supplied a well-formed
contractVersions, so nothing held a reader to the section 5 order. A
reader inspecting the array first answered missing-versions where the spec
requires wrong-message, and passed all 14 cases.

The frame {} also closes the quieter half: section 5 says wrong-message
triggers when nimbus is absent OR wrong, and no case omitted it.

Proved by mutation: a parse_hello with those two checks transposed goes
from caught by 0 of 14 to caught by 1 of 15.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `bom-split-across-chunks` — pin the mark across chunk boundaries

**Files:**
- Create: `docs/spec/conformance/v1/framing/cases/bom-split-across-chunks.json`
- Modify: `docs/spec/conformance/v1/framing/index.json` — insert after the `cases/bom-at-stream-start-ignored.json` entry, before `cases/frame-exactly-at-limit.json`
- Modify: `sdks/python/tests/test_spec.py:45` — `assert len(cases) == 24` becomes `== 25`

**Interfaces:**
- Consumes: nothing from Task 1. Different corpus, different index, different runner.
- Produces: nothing.

- [ ] **Step 1: Add the index entry first, with no case file**

In `docs/spec/conformance/v1/framing/index.json`, find the entry whose `file` is `cases/bom-at-stream-start-ignored.json` and insert this immediately after it. Note the framing conventions: bare `"5"`, and a short lowercase reason.

```json
    {
      "file": "cases/bom-split-across-chunks.json",
      "section": "5",
      "reason": "a mark split across chunks is still at the start of the stream"
    },
```

- [ ] **Step 2: Run the Python runner to verify it fails**

```bash
cd sdks/python && python -m pytest tests/test_framing_corpus.py -q
```

Expected: **collection error** — `FileNotFoundError` naming `cases/bom-split-across-chunks.json`.

- [ ] **Step 3: Create the case file**

The three chunks are the mark one octet per chunk, with the frame body riding on the third. Base64 values computed from the octets: `EF` → `7w==`, `BB` → `uw==`, `BF` + `{"a":1}\n` → `v3siYSI6MX0K`.

`docs/spec/conformance/v1/framing/cases/bom-split-across-chunks.json`:

```json
{
  "description": "the mark's three octets arrive in separate pushes and are still stripped — nothing has been emitted before them, so it is at the very start of the stream",
  "chunks": [
    { "base64": "7w==" },
    { "base64": "uw==" },
    { "base64": "v3siYSI6MX0K" }
  ],
  "expect": {
    "push": [[], [], ["{\"a\":1}"]],
    "flush": { "frames": [], "truncated": false }
  }
}
```

The first two pushes emit nothing: the decoder is buffering an incomplete sequence, so there is no output and no newline yet.

- [ ] **Step 4: Run both runners to verify they pass**

```bash
cd sdks/python && python -m pytest tests/test_framing_corpus.py -q
```

Expected: **25 passed** (was 24).

```bash
cd sdks/typescript && bun test scripts/framing-guard.test.ts
```

Expected: **54 pass, 0 fail** — count unchanged, per the note in Global Constraints.

- [ ] **Step 5: Prove the case discriminates, by mutation**

The wrong binding sniffs each chunk's **raw octet prefix** for `EF BB BF` instead of tracking the stream — faithful to what Bun's `TextDecoder` did before #85. It must be a standalone reader, not a subclass: subclassing leaves the real strip running underneath and the probe passes for the wrong reason.

```bash
cd sdks/python && cat > /tmp/rfc7_probe_bom.py <<'PROBE'
import base64
import codecs
from nimbus_sdk import load_corpus

LIMIT = 1024 * 1024


class TooLong(Exception):
    pass


class RawPrefixSniffReader:
    """Sniffs each chunk's raw octet prefix for EF BB BF, with no stream-level flag."""

    def __init__(self):
        self._dec = codecs.getincrementaldecoder("utf-8")("replace")
        self._pending = ""
        self._latched = False

    def push(self, chunk):
        if self._latched:
            raise TooLong()
        if chunk[:3] == b"\xef\xbb\xbf":
            chunk = chunk[3:]
        self._pending += self._dec.decode(chunk, False)
        out = []
        while True:
            i = self._pending.find("\n")
            if i < 0:
                break
            line, self._pending = self._pending[:i], self._pending[i + 1 :]
            t = line[:-1] if line.endswith("\r") else line
            if not t:
                continue
            if len(t.encode()) > LIMIT:
                self._latched = True
                self._pending = ""
                raise TooLong()
            out.append(t)
        if len(self._pending.encode()) > LIMIT:
            self._latched = True
            self._pending = ""
            raise TooLong()
        return out

    def flush_frames(self):
        if self._latched:
            raise TooLong()
        rest = self._pending + self._dec.decode(b"", True)
        self._pending = ""
        if len(rest.encode()) > LIMIT:
            self._latched = True
            raise TooLong()
        f = rest[:-1] if rest.endswith("\r") else rest
        return ((), False) if not f else ((f,), True)


def octets(n):
    if "utf8" in n:
        return n["utf8"].encode("utf-8")
    if "base64" in n:
        return base64.b64decode(n["base64"])
    if "concat" in n:
        return b"".join(octets(p) for p in n["concat"])
    r = n["repeat"]
    unit = bytes([r["byte"]]) if "byte" in r else r["utf8"].encode()
    return unit * r["count"]


def text(f):
    return f if isinstance(f, str) else octets(f).decode()


cases = load_corpus("framing")
caught = []
for c in cases:
    r = RawPrefixSniffReader()
    ok = True
    try:
        for ch, want in zip(c["chunks"], c["expect"]["push"], strict=True):
            if isinstance(want, dict):
                try:
                    r.push(octets(ch))
                    ok = False
                except TooLong:
                    pass
            elif r.push(octets(ch)) != [text(f) for f in want]:
                ok = False
                break
        fl = c["expect"].get("flush")
        if ok and fl:
            if "error" in fl:
                try:
                    r.flush_frames()
                    ok = False
                except TooLong:
                    pass
            else:
                fr, tr = r.flush_frames()
                if fr != tuple(text(f) for f in fl["frames"]) or tr != fl["truncated"]:
                    ok = False
    except TooLong:
        ok = False
    if not ok:
        caught.append(c["description"][:50])

print(f"caught by {len(caught)} of {len(cases)} framing cases")
for c in caught:
    print("   -", c)
PROBE
python /tmp/rfc7_probe_bom.py
```

Expected: **`caught by 1 of 25 framing cases`**, and the listed case is the new one — its description begins `the mark's three octets arrive in separate pushes`.

Before this task it was `caught by 0 of 24`.

- [ ] **Step 6: Update the corpus-size assertion**

`sdks/python/tests/test_spec.py` line 45 currently reads `assert len(cases) == 24`. Change it to:

```python
    assert len(cases) == 25
```

- [ ] **Step 7: Run both full suites**

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

Expected: all clean; **128 passed, 6 skipped**.

```bash
cd sdks/typescript && bun run build && bun run typecheck && bun run lint && bun run test
```

Expected: all clean; **1081 pass, 0 fail**.

- [ ] **Step 8: Commit**

```bash
git add docs/spec/conformance/v1/framing/ sdks/python/tests/test_spec.py
git commit -m "test(framing): pin a byte-order mark split across chunks

RFC-0007. framing.md section 5 makes ignoring a start-of-stream mark a
MUST, and a mark whose octets arrive separately is still at the start.
The only BOM case delivered all three octets in one chunk, which a
chunk-scoped reader also passes.

Not hypothetical: that is what the TypeScript binding did under Bun,
shipped, and had fixed in #85 while the conformance suite stayed green.

One octet per chunk rather than 2+1, because the first two pushes decode
to the empty string while the decoder buffers — so this also catches a
reader whose stream-start flag is keyed to whether a push happened rather
than whether anything was decoded.

Proved by mutation: a reader sniffing each chunk's raw octet prefix goes
from caught by 0 of 24 to caught by 1 of 25.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Final verification before the PR

- [ ] `git status --porcelain` is empty; no probe files under `sdks/` (they live in `/tmp`).
- [ ] Corpus counts agree between disk and index, both corpora:
  ```bash
  ls docs/spec/conformance/v1/negotiation/cases/*.json | wc -l   # 37
  grep -c '"file":' docs/spec/conformance/v1/negotiation/index.json  # 37
  ls docs/spec/conformance/v1/framing/cases/*.json | wc -l       # 25
  grep -c '"file":' docs/spec/conformance/v1/framing/index.json      # 25
  ```
- [ ] Both suites green: Python **128 passed, 6 skipped**; TypeScript **1081 pass, 0 fail**.
- [ ] No literal U+FEFF anywhere in the new files:
  ```bash
  python -c "import glob;[print(p) for p in glob.glob('docs/spec/conformance/v1/*/cases/*.json') if '\ufeff' in open(p,encoding='utf-8').read()]"
  ```
  Expected: no output.
- [ ] **Flip RFC-0007 to accepted.** Once the PR number is known, set the RFC header's `Status:` to `accepted` and `Landed:` to `<date> in [#NN](...)`, and update the `docs/rfcs/README.md` row from `draft | —` to `accepted | [#NN](...)`. The README defines *accepted* as landed-with-location, so leaving it `draft` after merge is as wrong as marking it accepted before.
- [ ] **PR title must be `docs:`- or `test:`-class** — e.g. `test: close the two corpus gaps RFC-0007 identified`. This repo squash-merges, so the title is the only subject release-please sees, and this must cut no release.
