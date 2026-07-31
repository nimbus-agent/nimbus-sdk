# Python IPC Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Python SDK execute both conformance corpora it currently ignores — the 14 deferred `hello` cases and all 24 framing cases — so "passes the conformance suite" becomes a fact CI checks.

**Architecture:** A new `nimbus_sdk.ipc` subpackage with two independent modules: `hello.py` (pure functions over a decoded frame string) and `ndjson.py` (a stateful byte-stream reader). Neither imports the other. Two corpus runners drive them from the published case files.

**Tech Stack:** Python 3.11+, pytest, ruff, mypy strict, hatchling. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-python-ipc-binding-design.md`, already committed on this branch. Read it before starting.

## Global Constraints

- **Zero runtime dependencies.** `[project].dependencies` stays empty. Standard library only — `json`, `re`, `codecs`, `base64`, `dataclasses`.
- **The distribution is `nimbus-dev-sdk`; the import is `nimbus_sdk`.**
- **`re.fullmatch`, never `re.match`.** Python's `$` matches before a trailing newline where JavaScript's does not. Spell digit classes `[0-9]`, never `\d`, to avoid Unicode digits.
- **Read every file with `encoding="utf-8"`.** This repo is developed on Windows, where `open()` defaults to cp1252 and silently mojibakes corpus fixtures.
- **mypy `strict = true` covers `src`, `tests`, `scripts`, `hatch_build.py`.** Every new function needs full annotations.
- **ruff `line-length = 88`**, `select = ["E","F","I","N","UP","B","A","C4","PT","RUF"]`. `I` sorts imports: stdlib block, then third-party (`pytest`), then first-party (`nimbus_sdk`).
- **IPC names are NOT re-exported from `nimbus_sdk`.** `sdks/python/src/nimbus_sdk/__init__.py` is **not modified by this plan**. Imports read `from nimbus_sdk.ipc import ...`, preserving the `.` vs `./ipc` boundary TypeScript publishes.
- **No `pyproject.toml` change is needed.** `packages = ["src/nimbus_sdk"]` already includes subpackages, and `py.typed` at the package root already covers them.
- **Python reads `src/nimbus_sdk/_data/spec`, not `docs/spec`.** That copy is gitignored and regenerated at `pip install -e .` time. This plan does **not** modify `docs/spec`, so no regeneration is needed — but if you ever do touch it, re-run `python -m pip install -e .` before pytest or the suite passes while executing stale data.
- **Commit subjects:** Tasks 1 and 2 are `feat:` (new published surface). Task 3 is `test:`. A `feat:` here is correct and intended — it cuts Python 0.1.3.
- **Run all commands from `sdks/python/`** inside the worktree `C:\gitrep\nimbus-sdk\.claude\worktrees\python-ipc-binding`.

**Baselines measured on this branch at `ee7a6e3`:**

| Suite | Command | Now | After task 1 | After task 3 |
|---|---|---|---|---|
| negotiation corpus | `python -m pytest tests/test_negotiation_corpus.py -q` | 24 passed | **38 passed** | 38 passed |
| whole suite | `python -m pytest -q` | 72 passed, 6 skipped | 86 + new unit tests | + 24 framing |

The 24 = 16 `negotiate` + 6 `declaration` + 1 kind-accounting + 1 anti-binding. **After task 1 it must be 38.** If it is not, the hello cases are not executing.

---

### Task 1: `nimbus_sdk.ipc.hello` and the hello corpus runner

**Files:**
- Create: `sdks/python/src/nimbus_sdk/ipc/__init__.py`
- Create: `sdks/python/src/nimbus_sdk/ipc/hello.py`
- Create: `sdks/python/tests/test_hello.py`
- Modify: `sdks/python/tests/test_negotiation_corpus.py` (imports; the `IMPLEMENTED_KINDS`/`DEFERRED_KINDS` block at lines 23-27; append the runner)

**Interfaces:**
- Consumes: `CONTRACT_VERSION_PATTERN` and the module-private `_is_contract_version` from `nimbus_sdk.contract`; `CONTRACT_HANDSHAKE_EXIT` from `nimbus_sdk`.
- Produces, for Task 2's `__init__.py` edit and for later readers:
  - `HELLO_MESSAGE: str` — the literal `"hello"`
  - `encode_hello(versions: Sequence[str]) -> str`
  - `parse_hello(frame: str) -> HelloResult`
  - `HelloOk(contract_versions: tuple[str, ...])`, `HelloRefused(reason: str)`, `HelloResult = HelloOk | HelloRefused`

- [ ] **Step 1: Write the failing corpus runner**

Replace the `IMPLEMENTED_KINDS` / `DEFERRED_KINDS` block in `sdks/python/tests/test_negotiation_corpus.py` (currently lines 23-27, the comment beginning "# `hello` cases exercise hello-frame parsing") with:

```python
# Every kind in the corpus is now executed. DEFERRED_KINDS is kept, empty, rather
# than deleted: the assertion below is what fails when a *new* kind appears, and a
# future kind may legitimately land before its binding does. An empty set states
# "nothing is deferred" where no set at all would state nothing.
IMPLEMENTED_KINDS = {"negotiate", "declaration", "hello"}
DEFERRED_KINDS: set[str] = set()
```

Extend the import block at the top of the same file to add the IPC names — note `nimbus_sdk.ipc` is a separate first-party import line, after `from nimbus_sdk import (...)`:

```python
from nimbus_sdk.ipc import HelloOk, HelloRefused, parse_hello
```

Append the runner to the end of the file:

```python
@pytest.mark.parametrize(
    "case",
    [c for c in CASES if c["kind"] == "hello"],
    ids=lambda c: str(c["description"])[:60],
)
def test_hello_cases(case: dict[str, object]) -> None:
    expect = case["expect"]
    assert isinstance(expect, dict)
    result = parse_hello(str(case["frame"]))
    if expect["ok"]:
        declared = expect["contractVersions"]
        assert isinstance(declared, list)
        # Order is significant HERE and nowhere else: the frame's declared order is
        # what parse_hello reports, per case.schema.json ("in the order the frame
        # declared it"). The §6 algorithm treats the same values as an unordered set.
        assert result == HelloOk(contract_versions=tuple(str(v) for v in declared))
    else:
        assert result == HelloRefused(reason=str(expect["reason"]))
        assert expect["exit"] == CONTRACT_HANDSHAKE_EXIT
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd sdks/python && python -m pytest tests/test_negotiation_corpus.py -q
```

Expected: **collection error** — `ModuleNotFoundError: No module named 'nimbus_sdk.ipc'`. The whole file fails to import, so no tests run at all. That is the correct failure; it proves the runner is wired to the real module rather than to a stub.

- [ ] **Step 3: Create the subpackage `__init__.py`**

`sdks/python/src/nimbus_sdk/ipc/__init__.py`:

```python
"""The IPC surface — the NDJSON framing reader and the hello frame.

Mirrors the ``./ipc`` export of ``@nimbus-dev/sdk``. These names are deliberately not
re-exported from :mod:`nimbus_sdk`: the split between the authoring contract and the
IPC surface is part of what the package publishes, and collapsing it here would erase
a boundary the TypeScript binding maintains in its ``exports`` map.
"""

from __future__ import annotations

from nimbus_sdk.ipc.hello import (
    HELLO_MESSAGE,
    HelloOk,
    HelloRefused,
    HelloResult,
    encode_hello,
    parse_hello,
)

__all__ = [
    "HELLO_MESSAGE",
    "HelloOk",
    "HelloRefused",
    "HelloResult",
    "encode_hello",
    "parse_hello",
]
```

- [ ] **Step 4: Write `hello.py`**

`sdks/python/src/nimbus_sdk/ipc/hello.py`:

```python
"""The hello frame — the one message this package specifies.

Normative document: ``docs/spec/negotiation/v1/contract-version.md`` (RFC-0005). The
frame's shape is **frozen across every future contract major**: a v1-only connector and
a v2-only gateway must still read each other's hello in order to discover they share
nothing, which is why its schema is published without a version segment.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass

from nimbus_sdk.contract import _is_contract_version

#: The frame's discriminator, so a gateway envelope can never be mistaken for a hello.
HELLO_MESSAGE = "hello"


@dataclass(frozen=True, slots=True)
class HelloOk:
    """A frame that parsed as a hello, announcing exactly these majors.

    ``contract_versions`` preserves the order the frame declared, which is what the
    corpus pins. That order carries no meaning to the negotiation algorithm — §4 makes
    a declared set unordered — but reporting it faithfully is a parser's job.
    """

    contract_versions: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class HelloRefused:
    """Why a frame is not a usable hello. One of the seven §5 reason tokens."""

    reason: str


HelloResult = HelloOk | HelloRefused


def encode_hello(versions: Sequence[str]) -> str:
    """The canonical hello frame for a set of majors, without its terminating LF.

    The LF belongs to the framing layer (``spec/wire/v1/framing.md`` §3), so a caller
    composes this with whatever writes frames rather than getting a half-framed string.

    ``separators`` is explicit because :func:`json.dumps` defaults to ``", "`` and
    ``": "`` — readable, but not the compact form the TypeScript encoder emits, and the
    two bindings should produce byte-identical canonical frames.
    """
    return json.dumps(
        {"nimbus": HELLO_MESSAGE, "contractVersions": list(versions)},
        separators=(",", ":"),
    )


def parse_hello(frame: str) -> HelloResult:
    """Read one decoded frame as a hello.

    Takes a string rather than bytes so it composes with :class:`NdjsonLineReader`
    without depending on it. Refuses as a value and never raises: a binding in another
    language has no exceptions to mirror, and the corpus compares outcomes.

    Whitespace and member order are insignificant — this parses JSON, and a reader that
    compares bytes against the canonical form is non-conformant. Unknown members are
    ignored. No stripping happens here: :func:`json.loads` tolerates surrounding
    whitespace exactly as ``JSON.parse`` does, and the reader already owns the LF.
    """
    try:
        decoded: object = json.loads(frame)
    except ValueError:
        # ValueError, not JSONDecodeError: the latter is a subclass, and catching the
        # base covers every way json can reject input.
        return HelloRefused(reason="not-json")

    # A JSON object is a dict and nothing else is. `null` decodes to None, an array to
    # list, a number to int/float — all correctly fall through to not-object.
    if not isinstance(decoded, dict):
        return HelloRefused(reason="not-object")

    if decoded.get("nimbus") != HELLO_MESSAGE:
        return HelloRefused(reason="wrong-message")

    declared: object = decoded.get("contractVersions")
    # An absent field and a present non-array read the same way: there is no array to
    # inspect. `isinstance(x, list)` and not `Sequence`, because a str is a Sequence.
    if not isinstance(declared, list):
        return HelloRefused(reason="missing-versions")
    if len(declared) == 0:
        return HelloRefused(reason="empty-versions")

    versions: list[str] = []
    for member in declared:
        # Validity is checked before duplication, per member, matching parseHello: a
        # frame declaring ["01", "01"] is invalid-version, not duplicate-version.
        if not _is_contract_version(member):
            return HelloRefused(reason="invalid-version")
        if member in versions:
            return HelloRefused(reason="duplicate-version")
        versions.append(member)

    return HelloOk(contract_versions=tuple(versions))
```

`_is_contract_version` is imported from `nimbus_sdk.contract` rather than re-derived. It is module-private, but it is the single place the `re.fullmatch` discipline is spelled; a second spelling here is exactly the one keystroke a translator gets wrong. Importing a private name across modules of the *same package* is not a lint violation under this project's ruff rules.

- [ ] **Step 5: Run the corpus runner to verify it passes**

```bash
cd sdks/python && python -m pytest tests/test_negotiation_corpus.py -q
```

Expected: **38 passed** (24 baseline + 14 hello). If it says 24, the parametrize filter is not selecting the hello cases.

- [ ] **Step 6: Add the unit tests the corpus does not cover**

The corpus has no case for `encode_hello`, and no case where the parser must survive a value type Python handles differently from JavaScript. Create `sdks/python/tests/test_hello.py`:

```python
"""Unit tests for the hello frame, covering what the corpus does not.

The 14 corpus cases in tests/test_negotiation_corpus.py are the conformance bar. These
cover the encoder, which no case exercises, and two Python-specific hazards.
"""

from __future__ import annotations

from nimbus_sdk.ipc import HELLO_MESSAGE, HelloOk, HelloRefused, encode_hello, parse_hello


def test_encode_hello_is_compact_and_round_trips() -> None:
    frame = encode_hello(["1"])
    # Byte-identical to the TypeScript encoder's output, which is what the corpus's
    # hello-canonical case pins for the parser side.
    assert frame == '{"nimbus":"hello","contractVersions":["1"]}'
    assert parse_hello(frame) == HelloOk(contract_versions=("1",))


def test_encode_hello_accepts_any_sequence() -> None:
    assert encode_hello(("1", "2")) == '{"nimbus":"hello","contractVersions":["1","2"]}'


def test_a_json_bool_is_not_a_hello() -> None:
    # Python hazard: bool is a subclass of int, and `True` is truthy where a careless
    # `if not decoded` check would treat `false` as absent. Both must be not-object.
    assert parse_hello("true") == HelloRefused(reason="not-object")
    assert parse_hello("false") == HelloRefused(reason="not-object")


def test_a_number_frame_is_not_an_object() -> None:
    assert parse_hello("0") == HelloRefused(reason="not-object")


def test_versions_order_is_preserved_not_sorted() -> None:
    # The parser reports declared order; only the negotiation algorithm is order-blind.
    result = parse_hello('{"nimbus":"hello","contractVersions":["2","1"]}')
    assert result == HelloOk(contract_versions=("2", "1"))


def test_the_discriminator_is_the_exact_literal() -> None:
    assert HELLO_MESSAGE == "hello"
    assert parse_hello('{"nimbus":"Hello","contractVersions":["1"]}') == HelloRefused(
        reason="wrong-message"
    )
```

- [ ] **Step 7: Run the full Python gate**

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

Expected: ruff clean, format clean, `mypy` reports `Success: no issues found in N source files` (N rises from 11 as new modules land — do not pin the number, just require success), and pytest reports **92 passed, 6 skipped** (72 baseline + 14 hello corpus + 6 new unit tests).

Note on typing: `declared` narrows to `list[Any]` via `isinstance(declared, list)`, so `member` is `Any` and `versions.append(member)` type-checks without narrowing. **Do not add `assert isinstance(member, str)`** to help mypy — asserts are stripped under `python -O`, so a type-narrowing assert in shipped library code is a statement that silently vanishes in some deployments. If mypy does object here, import `CONTRACT_VERSION_PATTERN` as well and inline the check as `if not isinstance(member, str) or CONTRACT_VERSION_PATTERN.fullmatch(member) is None:`, which mirrors `hello.ts` exactly and keeps `fullmatch` — never `match`.

- [ ] **Step 8: Commit**

```bash
git add sdks/python/src/nimbus_sdk/ipc/ sdks/python/tests/test_hello.py sdks/python/tests/test_negotiation_corpus.py
git commit -m "feat(python): bind the hello frame and run its 14 corpus cases

Adds nimbus_sdk.ipc.hello with encode_hello and parse_hello, mirroring the
./ipc export of the TypeScript binding. The 14 hello cases in the
negotiation corpus were indexed and skipped; they now execute, taking that
file from 24 to 38 passing.

DEFERRED_KINDS is kept as an empty set rather than deleted: the assertion
it feeds is what fails when a new corpus kind appears, and stating
'nothing is deferred' is not the same as stating nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `nimbus_sdk.ipc.ndjson` — the line reader

**Files:**
- Create: `sdks/python/src/nimbus_sdk/ipc/ndjson.py`
- Create: `sdks/python/tests/test_ndjson.py`
- Modify: `sdks/python/src/nimbus_sdk/ipc/__init__.py` (extend the import and `__all__`)

**Interfaces:**
- Consumes: nothing from Task 1. The two modules are independent by design.
- Produces, for Task 3's runner:
  - `IPC_MAX_LINE_BYTES: int` — `1024 * 1024`
  - `FrameTooLongError(Exception)`
  - `FlushResult(frames: tuple[str, ...], truncated: bool)` — frozen, slots
  - `NdjsonLineReader()` with `push(chunk: bytes) -> list[str]` and `flush_frames() -> FlushResult`

- [ ] **Step 1: Write the failing unit tests**

Create `sdks/python/tests/test_ndjson.py`. These three cover properties the corpus states less directly; Task 3 adds the 24 conformance cases.

```python
"""Unit tests for the NDJSON line reader.

The 24 framing corpus cases are the conformance bar (tests/test_framing_corpus.py).
These cover three properties where a wrong implementation still passes every corpus
case, or where naming the failing step matters more than one compound assertion.
"""

from __future__ import annotations

import pytest

from nimbus_sdk.ipc import FlushResult, FrameTooLongError, NdjsonLineReader


def test_a_bom_split_across_three_pushes_is_still_stripped() -> None:
    # The corpus delivers its BOM in one chunk, so bom-at-stream-start-ignored passes
    # for BOTH a flag that flips on the first non-empty decoded output and one that
    # flips on the first push() call. Only the former is correct, and only this test
    # tells them apart: pushing b"\xef" alone decodes to "" while the incremental
    # decoder buffers, so a push-keyed flag would consider the stream started and let
    # the BOM through when its remaining octets arrive.
    reader = NdjsonLineReader()
    assert reader.push(b"\xef") == []
    assert reader.push(b"\xbb") == []
    assert reader.push(b'\xbf{"a":1}\n') == ['{"a":1}']


def test_a_bom_arriving_mid_stream_is_not_stripped() -> None:
    # The rule is "first character of the stream", not "first character of a frame".
    reader = NdjsonLineReader()
    assert reader.push(b"first\n") == ["first"]
    assert reader.push("\ufeffsecond\n".encode()) == ["\ufeffsecond"]


def test_a_limit_violation_latches_across_every_later_call() -> None:
    reader = NdjsonLineReader()
    with pytest.raises(FrameTooLongError):
        reader.push(b"a" * (1024 * 1024 + 1) + b"\n")
    # A valid, small push must NOT resume the reader.
    with pytest.raises(FrameTooLongError):
        reader.push(b"small\n")
    # And the drain must fail too, rather than returning a FlushResult.
    with pytest.raises(FrameTooLongError):
        reader.flush_frames()


def test_the_limit_counts_octets_not_characters() -> None:
    # 524_289 two-octet characters are 1_048_578 octets. A reader measuring len(str)
    # sees 524_289, well under the limit, and wrongly accepts the frame.
    reader = NdjsonLineReader()
    with pytest.raises(FrameTooLongError):
        reader.push(("\u00e9" * 524_289).encode("utf-8") + b"\n")


def test_an_unterminated_final_frame_is_flagged_truncated() -> None:
    reader = NdjsonLineReader()
    assert reader.push(b"partial") == []
    assert reader.flush_frames() == FlushResult(frames=("partial",), truncated=True)


def test_a_clean_end_of_stream_is_not_truncated() -> None:
    reader = NdjsonLineReader()
    assert reader.push(b"whole\n") == ["whole"]
    assert reader.flush_frames() == FlushResult(frames=(), truncated=False)
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd sdks/python && python -m pytest tests/test_ndjson.py -q
```

Expected: **collection error** — `ImportError: cannot import name 'FlushResult' from 'nimbus_sdk.ipc'`.

- [ ] **Step 3: Write `ndjson.py`**

`sdks/python/src/nimbus_sdk/ipc/ndjson.py`:

```python
"""NDJSON framing — the reader half of the IPC surface.

Normative document: ``docs/spec/wire/v1/framing.md``; the executable form is the corpus
at ``docs/spec/conformance/v1/framing/``. Buffers UTF-8 octets and emits complete,
non-empty lines.
"""

from __future__ import annotations

import codecs
from dataclasses import dataclass
from typing import NoReturn

#: Max octets per NDJSON line, aligned with IPC protocol limits. Inclusive: a frame of
#: exactly this many octets is conformant.
IPC_MAX_LINE_BYTES = 1024 * 1024

_LIMIT_MESSAGE = "Message exceeds 1MB line limit"

#: Stripped when it is the first character of the *stream*. Python's utf-8 codec keeps
#: a byte-order mark where JavaScript's TextDecoder drops it, so this is spelled out
#: rather than inherited from the decoder.
_BOM = "\ufeff"


class FrameTooLongError(Exception):
    """A line exceeded :data:`IPC_MAX_LINE_BYTES`.

    Inherits from ``Exception`` directly. There is no SDK-wide base to hang it from,
    and ``ValueError`` would misdescribe it: no argument is wrong, the *stream* has
    broken a protocol limit and is unusable from here on.
    """


@dataclass(frozen=True, slots=True)
class FlushResult:
    """What remained at end-of-stream, and whether the last frame lacked its newline."""

    #: At most one frame — whatever was buffered when the stream ended.
    frames: tuple[str, ...]
    #: True when a frame was delivered that no newline terminated: the peer stopped
    #: mid-frame, which is a different fact from "the stream ended".
    truncated: bool


class NdjsonLineReader:
    """Buffers UTF-8 chunks and emits complete non-empty lines.

    Exceeding the line limit is **terminal**: the reader latches and every later call
    raises, so a peer cannot resynchronize it by following an oversized line with a
    newline.
    """

    def __init__(self) -> None:
        # errors="replace" matches TextDecoder's non-fatal mode: a malformed sequence
        # becomes U+FFFD rather than raising. Verified to agree with TextDecoder on
        # every ill-formed case in the corpus, including how many U+FFFD each produces.
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self._pending = ""
        self._latched = False
        self._stream_started = False

    def _fail_if_latched(self) -> None:
        if self._latched:
            raise FrameTooLongError(_LIMIT_MESSAGE)

    def _too_long(self) -> NoReturn:
        self._latched = True
        self._pending = ""
        raise FrameTooLongError(_LIMIT_MESSAGE)

    def _decode(self, chunk: bytes, *, final: bool) -> str:
        text = self._decoder.decode(chunk, final)
        # Keyed to the first NON-EMPTY output, not the first call: pushing the first
        # octet of a BOM decodes to "" while the decoder buffers, and a call-keyed flag
        # would let the mark through once its remaining octets arrived.
        if text and not self._stream_started:
            self._stream_started = True
            if text.startswith(_BOM):
                text = text[1:]
        return text

    def push(self, chunk: bytes) -> list[str]:
        """Feed octets; return the frames they completed, in order."""
        self._fail_if_latched()
        self._pending += self._decode(chunk, final=False)
        out: list[str] = []
        while True:
            newline = self._pending.find("\n")
            if newline < 0:
                break
            line = self._pending[:newline]
            self._pending = self._pending[newline + 1 :]
            # Exactly one trailing CR, so a CRLF sender and an LF sender agree. A CR
            # anywhere else is frame content, not a delimiter.
            trimmed = line[:-1] if line.endswith("\r") else line
            # Empty means zero-length, not blank: a frame of spaces is delivered.
            if not trimmed:
                continue
            if len(trimmed.encode("utf-8")) > IPC_MAX_LINE_BYTES:
                self._too_long()
            out.append(trimmed)
        # The limit binds the unterminated buffer too, or a peer that never sends a
        # newline could exhaust memory while staying under the per-frame cap.
        if len(self._pending.encode("utf-8")) > IPC_MAX_LINE_BYTES:
            self._too_long()
        return out

    def flush_frames(self) -> FlushResult:
        """Drain what is buffered at end-of-stream.

        An empty remainder yields no frame, so a stream ending in a bare CR reports
        nothing rather than an empty string.
        """
        self._fail_if_latched()
        rest = self._pending + self._decode(b"", final=True)
        self._pending = ""
        if len(rest.encode("utf-8")) > IPC_MAX_LINE_BYTES:
            self._too_long()
        frame = rest[:-1] if rest.endswith("\r") else rest
        if not frame:
            return FlushResult(frames=(), truncated=False)
        return FlushResult(frames=(frame,), truncated=True)
```

- [ ] **Step 4: Extend the subpackage `__init__.py`**

Add the ndjson import and merge the names into `__all__`, keeping it sorted (ruff's `RUF022` checks `__all__` sorting):

```python
from nimbus_sdk.ipc.hello import (
    HELLO_MESSAGE,
    HelloOk,
    HelloRefused,
    HelloResult,
    encode_hello,
    parse_hello,
)
from nimbus_sdk.ipc.ndjson import (
    IPC_MAX_LINE_BYTES,
    FlushResult,
    FrameTooLongError,
    NdjsonLineReader,
)

__all__ = [
    "HELLO_MESSAGE",
    "IPC_MAX_LINE_BYTES",
    "FlushResult",
    "FrameTooLongError",
    "HelloOk",
    "HelloRefused",
    "HelloResult",
    "NdjsonLineReader",
    "encode_hello",
    "parse_hello",
]
```

If ruff disagrees with this ordering, run `python -m ruff check --fix .` and accept its sort rather than arguing with it.

- [ ] **Step 5: Run the unit tests to verify they pass**

```bash
cd sdks/python && python -m pytest tests/test_ndjson.py -q
```

Expected: **6 passed**.

- [ ] **Step 6: Prove the BOM flag is load-bearing, by mutation**

In `ndjson.py`, change `_decode`'s condition from the output-keyed form to the call-keyed form a careless implementation would write:

```python
        # MUTATION PROBE — revert after observing the failure
        if not self._stream_started:
            self._stream_started = True
            if text.startswith(_BOM):
                text = text[1:]
```

```bash
cd sdks/python && python -m pytest tests/test_ndjson.py -q
```

Expected: **1 failed, 5 passed** — `test_a_bom_split_across_three_pushes_is_still_stripped` fails, because the flag flips on the first `push` (which decoded to `""`) and the BOM survives into the frame.

Revert to `if text and not self._stream_started:` and re-run:

Expected: **6 passed**.

Then prove the *coarser* failure too — a reader that omits BOM handling entirely, which is what a literal transcription of the TypeScript logic produces, since `TextDecoder` strips the mark for free and Python's codec does not. Replace the whole `if` block in `_decode` with nothing:

```python
    def _decode(self, chunk: bytes, *, final: bool) -> str:
        return self._decoder.decode(chunk, final)   # MUTATION PROBE
```

```bash
cd sdks/python && python -m pytest tests/test_ndjson.py -q
```

Expected: **1 failed, 5 passed** — the three-push BOM test fails. (The conformance case that also catches this, `bom-at-stream-start-ignored`, arrives with the corpus runner in Task 3; run it there too if you want both.)

Restore `_decode` in full and re-run: **6 passed**. Confirm with `git diff` that no probe remains.

- [ ] **Step 7: Run the full Python gate**

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

Expected: all clean; pytest **98 passed, 6 skipped** (92 from Task 1 + 6 new).

- [ ] **Step 8: Commit**

```bash
git add sdks/python/src/nimbus_sdk/ipc/ sdks/python/tests/test_ndjson.py
git commit -m "feat(python): bind the NDJSON line reader

Adds nimbus_sdk.ipc.ndjson with NdjsonLineReader, FlushResult and
FrameTooLongError, mirroring the ./ipc export of the TypeScript binding.

Strips a byte-order mark only when it is the first character the decoder
produces, which Python's utf-8 codec does not do and TextDecoder does. The
flag is keyed to the first non-empty decoded output rather than the first
push, or a BOM arriving one octet per chunk slips through — proved by
mutation against a three-push unit test, since the corpus delivers its BOM
in a single chunk and passes either way.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: the framing corpus runner

**Files:**
- Create: `sdks/python/tests/test_framing_corpus.py`
- Modify: `sdks/python/tests/test_spec.py` (append a framing-corpus size assertion beside the existing `test_negotiation_corpus_loads` at lines 37-40)

**Interfaces:**
- Consumes from Task 2: `NdjsonLineReader`, `FlushResult`, `FrameTooLongError` from `nimbus_sdk.ipc`.
- Consumes from the package: `load_corpus` from `nimbus_sdk`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing runner**

Create `sdks/python/tests/test_framing_corpus.py`:

```python
"""Drive the NDJSON line reader from the published framing corpus.

The second corpus this package executes, after negotiation. Both bindings read the
identical case files: sdks/typescript/scripts/framing-guard.test.ts runs these same 24
cases against NdjsonLineReader.
"""

from __future__ import annotations

import base64
from typing import Any

import pytest

from nimbus_sdk import load_corpus
from nimbus_sdk.ipc import FrameTooLongError, NdjsonLineReader

CASES = load_corpus("framing")


def _octets(node: dict[str, Any]) -> bytes:
    """Build a chunk's exact octets from a case-schema descriptor.

    Four node types, per docs/spec/conformance/v1/framing/case.schema.json. Each is
    identified by its own distinctive key, so the checks are order-independent: a
    repeat node's top-level key is "repeat", never "utf8", even when the repeated
    unit is a string.
    """
    if "utf8" in node:
        text: str = node["utf8"]
        return text.encode("utf-8")
    if "base64" in node:
        encoded: str = node["base64"]
        return base64.b64decode(encoded)
    if "concat" in node:
        parts: list[dict[str, Any]] = node["concat"]
        return b"".join(_octets(part) for part in parts)
    if "repeat" in node:
        spec: dict[str, Any] = node["repeat"]
        unit = bytes([spec["byte"]]) if "byte" in spec else str(spec["utf8"]).encode()
        count: int = spec["count"]
        return unit * count
    raise ValueError(f"unrecognised chunk descriptor: {sorted(node)}")


def _frame_text(node: object) -> str:
    """An expected frame: a literal string, or a repeat descriptor decoded.

    Large frames are published as repeat descriptors so a case at the 1 MiB limit costs
    a few lines rather than megabytes of base64 — which means the builder is needed on
    the expectation side too, not only for chunks.
    """
    if isinstance(node, str):
        return node
    assert isinstance(node, dict)
    return _octets(node).decode("utf-8")


@pytest.mark.parametrize(
    "case",
    CASES,
    ids=lambda c: str(c["description"])[:60],
)
def test_framing_cases(case: dict[str, object]) -> None:
    expect = case["expect"]
    assert isinstance(expect, dict)
    chunks = case["chunks"]
    assert isinstance(chunks, list)
    pushes = expect["push"]
    assert isinstance(pushes, list)

    reader = NdjsonLineReader()

    # strict=True enforces the schema's own rule that expect.push is positionally
    # parallel to chunks. Without it a corpus that lost an expectation would silently
    # test fewer pushes than the case declares.
    for chunk, wanted in zip(chunks, pushes, strict=True):
        octets = _octets(chunk)
        if isinstance(wanted, dict) and "error" in wanted:
            assert wanted["error"] == "frame-too-long"
            with pytest.raises(FrameTooLongError):
                reader.push(octets)
        else:
            assert isinstance(wanted, list)
            assert reader.push(octets) == [_frame_text(f) for f in wanted]

    # `flush` is a SHAPE UNION, and absence is a third possibility the schema allows.
    # 4 of the 24 cases carry {"error": ...} here rather than {frames, truncated},
    # because latching makes the drain fail too; reading ["frames"] unconditionally
    # raises KeyError on exactly those. No current case omits `flush`, but the schema
    # permits it, so absence is tolerated rather than assumed.
    if "flush" not in expect:
        return
    wanted_flush = expect["flush"]
    assert isinstance(wanted_flush, dict)
    if "error" in wanted_flush:
        assert wanted_flush["error"] == "frame-too-long"
        with pytest.raises(FrameTooLongError):
            reader.flush_frames()
        return
    result = reader.flush_frames()
    expected_frames = wanted_flush["frames"]
    assert isinstance(expected_frames, list)
    assert result.frames == tuple(_frame_text(f) for f in expected_frames)
    assert result.truncated is wanted_flush["truncated"]
```

- [ ] **Step 2: Run it to verify it passes**

```bash
cd sdks/python && python -m pytest tests/test_framing_corpus.py -q
```

Expected: **24 passed**.

If instead you see `FileNotFoundError: no conformance corpus for 'framing'`, the bundled `_data/spec` predates the framing corpus — run `python -m pip install -e .` and retry.

- [ ] **Step 3: Prove the corpus discriminates, by mutation — the octet limit**

In `ndjson.py`, change both limit checks in `push` from octets to characters, the mistake a reader ported without care makes:

```python
            if len(trimmed) > IPC_MAX_LINE_BYTES:          # MUTATION PROBE
                self._too_long()
        ...
        if len(self._pending) > IPC_MAX_LINE_BYTES:        # MUTATION PROBE
            self._too_long()
```

```bash
cd sdks/python && python -m pytest tests/test_framing_corpus.py -q 2>&1 | tail -20
```

Expected: **1 failed, 23 passed** — the failing id begins `524289 two-octet characters are 1048578 octets`. Revert both lines to `len(...encode("utf-8"))` and re-run: **24 passed**.

- [ ] **Step 4: Prove the corpus discriminates, by mutation — latching**

In `ndjson.py`, neuter `_fail_if_latched` so the reader resumes after a violation:

```python
    def _fail_if_latched(self) -> None:
        return  # MUTATION PROBE
        if self._latched:
            raise FrameTooLongError(_LIMIT_MESSAGE)
```

```bash
cd sdks/python && python -m pytest tests/test_framing_corpus.py -q 2>&1 | tail -20
```

Expected: **1 failed, 23 passed** — the failing id begins `a violation is terminal`. Revert and re-run: **24 passed**.

Note ruff will flag the unreachable code if you lint while the probe is in place; that is expected and the probe is temporary. Confirm with `git diff` that neither probe survives.

- [ ] **Step 5: Add the corpus-size assertion**

`sdks/python/tests/test_spec.py` already pins the negotiation corpus's size (`assert len(cases) == 36`). Append the framing equivalent immediately after `test_negotiation_corpus_loads`:

```python
def test_framing_corpus_loads() -> None:
    cases = load_corpus("framing")
    assert len(cases) == 24
    # Unlike negotiation, framing cases carry no `kind` discriminator — every case is
    # a stream fed to one reader — so there is no kind set to account for here.
    assert all("chunks" in case and "expect" in case for case in cases)
```

An exact count, matching the neighbouring assertion's style: it is a drift detector, and a case added without a deliberate update to this number is a case nobody decided to add.

- [ ] **Step 6: Run the full Python gate**

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

Expected: all clean; pytest **123 passed, 6 skipped** (98 from Task 2 + 24 framing + 1 new spec test).

- [ ] **Step 7: Run the TypeScript suite too**

Nothing here touches TypeScript, but the corpora are shared and this confirms the shared data is untouched.

```bash
cd sdks/typescript && bun run build && bun run typecheck && bun run lint && bun run test
```

Expected: all clean, **1076 pass / 0 fail**. If `bun run test` fails on a missing `dist/`, that is the fresh-worktree build — `bun run build` above handles it.

- [ ] **Step 8: Commit**

```bash
git add sdks/python/tests/test_framing_corpus.py sdks/python/tests/test_spec.py
git commit -m "test(python): run the 24 framing corpus cases

The framing corpus was consumed by no Python code. It now drives
NdjsonLineReader through the same case files the TypeScript framing guard
reads, closing the second of the two corpora this package ignored.

Handles the flush expectation as the shape union it is: 4 of the 24 cases
carry an error there rather than a frames/truncated object, because
latching makes the drain fail too, and reading ['frames'] unconditionally
raises KeyError on exactly those.

Proved by mutation: measuring the limit in characters reddens the
524289-two-octet-characters case, and neutering the latch reddens the
terminal-violation case.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Final verification before the PR

- [ ] `git status --porcelain` is empty — in particular no `MUTATION PROBE` comment survives anywhere:
  ```bash
  grep -rn "MUTATION PROBE" sdks/ && echo "PROBE LEFT BEHIND" || echo "clean"
  ```
- [ ] Both suites green: Python **123 passed, 6 skipped**; TypeScript **1076 pass / 0 fail**.
- [ ] Every corpus kind is executed — this must print nothing:
  ```bash
  cd sdks/python && python -c "
  from nimbus_sdk import load_corpus
  kinds = {c['kind'] for c in load_corpus('negotiation')}
  assert kinds == {'negotiate', 'declaration', 'hello'}, kinds
  assert len(load_corpus('framing')) == 24
  print('all corpora accounted for')
  "
  ```
- [ ] `nimbus_sdk/__init__.py` is **unmodified** — `git diff origin/main -- sdks/python/src/nimbus_sdk/__init__.py` is empty. The IPC names stay off the top-level surface.
- [ ] **PR title is `feat:`-class** — e.g. `feat(python): bind the IPC surface and execute both conformance corpora`. This is deliberate: it cuts Python **0.1.3**, the first release through the `publish-python` job repaired in #83, carrying the spec data stranded by the failed 0.1.2 publish.
- [ ] Do **not** add a `Release-As:` trailer. The ordinary `feat:` bump from 0.1.2 to 0.1.3 is what is wanted.
