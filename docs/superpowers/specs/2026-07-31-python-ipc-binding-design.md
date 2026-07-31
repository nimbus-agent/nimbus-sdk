# The Python IPC binding — design

**Status:** approved. **Date:** 2026-07-31. **Sub-project:** C of the Phase 2 decomposition
(A — release-pipeline loose ends, [#77](https://github.com/nimbus-agent/nimbus-sdk/pull/77);
B — RFC-0006, [#81](https://github.com/nimbus-agent/nimbus-sdk/pull/81); **C — this**;
D — `create-nimbus-connector` scaffolding and per-language quickstarts).

## Problem

[ROADMAP.md](../../ROADMAP.md) Phase 2 box 1 is "an official **Python SDK** that passes the
conformance suite." Python does not pass it. Two published corpora go unconsumed:

- **`docs/spec/conformance/v1/negotiation/`** — 14 of its 36 cases are `kind: "hello"`, and
  `sdks/python/tests/test_negotiation_corpus.py` skips every one of them. The skip is recorded
  rather than silent, and a test fails by design if a *new* kind appears, so the gap cannot
  widen — but it is still a gap, and the reason given for it ("hello-frame parsing lives with
  the IPC surface this package does not yet carry") is precisely what this sub-project removes.
- **`docs/spec/conformance/v1/framing/`** — 24 cases, consumed by no Python code at all. The
  TypeScript side drives them through `NdjsonLineReader`; Python has no equivalent.

Until both are executed, "passes the conformance suite" is an aspiration stated in a roadmap,
not a fact any CI job checks.

## What is being built

A `nimbus_sdk.ipc` subpackage binding the two halves of the IPC surface TypeScript publishes at
its `./ipc` export, plus the two corpus runners that hold them to the published cases.

```
sdks/python/src/nimbus_sdk/ipc/
  __init__.py   re-exports the public names
  hello.py      HELLO_MESSAGE, encode_hello, parse_hello, HelloOk, HelloRefused
  ndjson.py     IPC_MAX_LINE_BYTES, NdjsonLineReader, FlushResult, FrameTooLongError
```

The subpackage mirrors the TypeScript export boundary deliberately. Python has no bundling
concern that makes a separate entry point necessary, so the boundary is documentation: it states
that the IPC surface is a distinct contract from the `.` surface, the same claim
`sdks/typescript/package.json`'s `exports` map makes. The names are **not** re-exported from
`nimbus_sdk` itself; `from nimbus_sdk.ipc import parse_hello` keeps the split visible at every
call site.

The two modules do not depend on each other. `parse_hello` takes a `str`, exactly as its
TypeScript counterpart takes a string rather than bytes, so it composes with the reader without
coupling to it. `hello.py` imports `CONTRACT_VERSION_PATTERN` from `nimbus_sdk.contract` —
one spelling of the pattern per language, mirroring `hello.ts`'s import from
`contract-version.ts`.

### Result types

`hello.py` returns frozen dataclasses as values, following the precedent `contract.py` already
sets and for the reason its docstring already gives: a binding in another language has no
exceptions to mirror, and the corpus compares outcomes rather than error types.

```python
@dataclass(frozen=True, slots=True)
class HelloOk:
    contract_versions: tuple[str, ...]

@dataclass(frozen=True, slots=True)
class HelloRefused:
    reason: str

HelloResult = HelloOk | HelloRefused
```

`FrameTooLongError` is the one deliberate exception. It is genuinely exceptional — the stream is
unusable afterwards — and the TypeScript reader throws in the same place, so raising here is
parity rather than divergence. The framing corpus names the failure symbolically
(`{"error": "frame-too-long"}`) and its schema says outright that "how the failure is expressed
is a binding's business."

**The TypeScript `lineLimitError` option is not mirrored.** It exists so the Nimbus gateway can
inject its own error class; no Python consumer does, and the corpus requires only that the call
fail with something a runner can map. Adding an injection point with no caller is published
surface that rots — the narrow-waist posture [GOVERNANCE.md](../../GOVERNANCE.md) states.

## The reader

`NdjsonLineReader` mirrors its TypeScript counterpart's shape, because the corpus is expressed
as a sequence of pushes each with its own expected output plus a final drain:

```python
@dataclass(frozen=True, slots=True)
class FlushResult:
    frames: tuple[str, ...]   # 0 or 1 — the case schema caps it at maxItems 1
    truncated: bool           # True when a frame was delivered that no LF terminated

class NdjsonLineReader:
    def push(self, chunk: bytes) -> list[str]: ...
    def flush_frames(self) -> FlushResult: ...
```

`FlushResult` is `frozen=True, slots=True`, matching `contract.py`'s result types rather than
being a bare tuple or a `NamedTuple`. Its `frames` is a **tuple**, not a list: a frozen dataclass
holding a mutable list is a half-measure — it forbids rebinding the field while leaving the
contents editable. `push` still returns a plain `list[str]`, mirroring the TypeScript array
return; the difference is deliberate, since `push` returns a result while `FlushResult` is a value
object that outlives the call.

`FrameTooLongError` inherits from **`Exception` directly**. No SDK-wide base exception exists —
`nimbus_sdk` currently defines no exception classes at all — and inventing a `NimbusError`
hierarchy for a single member is speculative surface. `ValueError` was considered and rejected:
nothing about an argument is wrong, the *stream* has exceeded a protocol limit and is henceforth
unusable, which is a state violation rather than a value one.

A generator-based design was rejected: the corpus pins per-push outputs and a distinct
end-of-stream `truncated` flag, so a runner would need an adapter — and an adapter is where a
binding diverges without failing the corpus, the exact failure mode RFC-0006 was written about.

**Delimiting: LF splits, one trailing CR is stripped, zero-length results are dropped.** The
delimiter is `\n` alone. After splitting, exactly *one* trailing `\r` is removed, so a CRLF sender
and an LF sender produce identical frames. Three cases pin the boundaries of that rule and they
disagree with the three obvious shortcuts:

| Case | Input | Frame | Rules out |
|---|---|---|---|
| `single-frame-crlf` | `{"a":1}\r\n` | `{"a":1}` | not stripping CR |
| `cr-inside-frame-preserved` | `a\rb\n` | `a\rb` | stripping *all* CRs, or splitting on CR |
| `whitespace-only-frame-delivered` | `"   \n"` | `"   "` | `strip()`-ing the frame |
| `blank-remainder-dropped-at-eof` | `\r` then EOF | *(none)* | treating a bare CR as a frame |

"Empty" means **zero-length, not blank** — `whitespace-only-frame-delivered` exists specifically
to catch a binding that calls `.strip()` and drops a frame of spaces. A bare `\r` at end-of-stream
becomes zero-length only *after* the CR strip, and is then dropped like any empty frame, which is
why it reports no frame and `truncated: false`.

Three further behaviours the corpus pins that a careless implementation gets wrong:

**Latching.** A limit violation is terminal. It clears the buffer, and every later `push` **and**
`flush_frames` raises rather than resuming. `limit-violation-latches` pins that the frame parsed
ahead of the oversized one is not delivered either — a peer cannot resynchronise the reader by
following an oversized line with a newline.

**The limit counts octets, not characters.** `limit-counts-octets-not-characters` pushes 524 289
two-octet characters — 1 048 578 octets — to catch a binding measuring `len(str)`. The limit is
inclusive: `frame-exactly-at-limit` (1 048 576 octets) is conformant and
`frame-one-octet-over-limit` is not. The unterminated buffer is measured too, per
`pending-over-limit-without-newline`, so a peer cannot exhaust memory by never sending an LF.

**BOM stripping — the one measured divergence from Python's standard library.**
`TextDecoder("utf-8")` strips a leading byte-order mark; Python's `utf-8` codec does not.
Measured against `bom-at-stream-start-ignored`, Python's incremental decoder yields
`'﻿{"a":1}'` where the corpus requires `{"a":1}`. A binding written by transcribing the
TypeScript logic literally passes every other framing case and fails this one.

The rule is **strip `U+FEFF` only if it is the first character the decoder ever produces**, not
"strip it from the first chunk": a BOM split across a chunk boundary still emerges at stream
start, because nothing has been emitted before it. Mid-stream `U+FEFF` is not stripped, and no
case pins that — it follows from the rule rather than from a fixture.

Mechanically, the reader carries a `_stream_started: bool`, and **it flips on the first
*non-empty* decoded output, not on the first `push` call.** That precision is the whole point:
pushing `b"\xef"` alone decodes to `""` because the incremental decoder is still buffering, so a
flag keyed to "has push been called" would consider the stream started and let the BOM through
when its remaining octets arrive. Keyed to the first non-empty output, `push(b"\xef")`,
`push(b"\xbb")`, `push(b'\xbf{"a":1}\n')` still strips correctly.

Everything else agrees. Python's `codecs.getincrementaldecoder("utf-8")("replace")` was tested
against every malformed-sequence case in the corpus — a lead octet that cannot begin a sequence,
a lone continuation octet, two-, three- and four-octet sequences split at each interior boundary,
and an incomplete sequence at end-of-stream — and matches `TextDecoder` on all of them, including
how many `U+FFFD` each produces. That was the largest risk in this sub-project and it is retired
before any code is written.

## The corpus runners

**A shared chunk builder.** The framing case schema defines four node types — `{utf8}`,
`{base64}`, `{repeat: {byte|utf8, count}}`, and `{concat: [...]}` — and `repeat` descriptors
appear in *expected frames* as well as in chunks, so the builder is needed on both sides of every
comparison. It lives in the test module, not in the shipped package: it reads fixtures, which is
a test's business.

**`expect.push` is positionally parallel to `chunks`** — element *i* is what `push(chunks[i])`
must produce — and the schema requires equal lengths.

**Both `push` entries and `flush` are shape unions, and the flush union is the trap.** A `push`
entry is either a list of frames or `{"error": ...}`; `flush` is either
`{"frames": [...], "truncated": bool}` or `{"error": ...}`. Measured against the corpus as it
stands: 4 of the 24 cases carry an error in `push` — `frame-one-octet-over-limit`,
`pending-over-limit-without-newline`, `limit-counts-octets-not-characters`, and
`limit-violation-latches` — and **the same 4 carry an error in `flush` too**, because latching
makes the drain fail as well. A runner that reads `case["expect"]["flush"]["frames"]`
unconditionally raises `KeyError` on exactly those four.

The schema additionally *permits* `flush` to be omitted ("Omit when the case ends in an error and
flush is therefore unreachable"), but **no current case omits it** — all 24 are present. A runner
should still tolerate absence, since the schema allows a future case to do it; it must not be
written on the assumption that absence is how error cases are expressed today, because it is not.

**`{"error": "frame-too-long"}` maps to `FrameTooLongError`.** The runner asserts the exception
type, never a message string — the schema is explicit that the token is symbolic so a binding
maps it onto its own error type.

**The hello runner** drives the 14 cases already in the negotiation corpus. It needs no new
fixture data: the cases exist and are indexed, they are simply skipped today.

`parse_hello` does **no whitespace stripping of its own**. It hands the string to `json.loads`,
which tolerates surrounding whitespace exactly as `JSON.parse` does — verified: `json.loads`
accepts a trailing `\n`. Two layers already make stripping unnecessary: the reader owns the `\n`
as a delimiter, so a frame never carries one, and `hello-padded` exercises whitespace *inside* the
frame (`{"nimbus": "hello", "contractVersions": ["1"]}`) rather than around it, which is the
parser's business anyway. Adding a `.strip()` would be a second gatekeeper with no case behind it,
and would diverge from `parseHello`, which calls `JSON.parse` directly.

`IMPLEMENTED_KINDS` becomes `{"negotiate", "declaration", "hello"}` and `DEFERRED_KINDS` becomes
empty. `test_every_corpus_kind_is_accounted_for` keeps working unchanged — it asserts the corpus's
kinds equal the union of the two sets, so it still fails by design when a new kind appears, now
with nothing deferred.

## Testing

Corpus-driven for behaviour, plus unit tests for the three reader properties above, since a
corpus case that regresses tells you *that* something broke and a unit test tells you *what*.

**Guards are proved by mutation, not by passing** — the discipline that found the real gaps in
sub-projects A and B. Three deliberate wrong bindings must each be shown to fail:

| Wrong binding | Must be caught by |
|---|---|
| measures the limit in characters, not octets | `limit-counts-octets-not-characters` |
| does not latch — resumes after an oversized line | `limit-violation-latches` |
| omits BOM stripping (a literal transcription of the TS logic) | `bom-at-stream-start-ignored` |

Each is a small edit to the finished module, shown to redden a specific named case, then
reverted. A guard demonstrated only by passing is not demonstrated.

Two unit tests carry properties the corpus states less directly:

**A BOM split across three pushes** — `push(b"\xef")`, `push(b"\xbb")`, `push(b'\xbf{"a":1}\n')`
must yield `{"a":1}`. The corpus delivers its BOM in one chunk, so this is the only thing that
distinguishes "flag flips on first non-empty output" from "flag flips on first push." Both pass
`bom-at-stream-start-ignored`; only the correct one passes this.

**The post-latch sequence, all three steps** — an oversized `push` raises; a *subsequent, valid,
small* `push` raises again rather than resuming; and `flush_frames()` raises rather than returning
a `FlushResult`. `limit-violation-latches` covers this, but as one case with a compound
expectation; stated as three assertions it names which step regressed.

## Consequences

**This cuts Python 0.1.3.** It is a genuine `feat:` under `sdks/python/src/`, so release-please
will cut a release — the first to run through the `publish-python` job repaired in
[#83](https://github.com/nimbus-agent/nimbus-sdk/pull/83). It also carries the bundled spec data
stranded by the failed 0.1.2 publish, which is the agreed recovery path: 0.1.2 is skipped, its
GitHub release is annotated as never published, and its payload ships in 0.1.3.

**`sdks/python/tests/test_spec.py` must be in scope.** It hardcodes
`assert len(cases) == 36` for the negotiation corpus. Nothing here changes that number, but the
same file is the natural home for a framing-corpus count assertion, and it is the file the
RFC-0006 plan's file list missed — costing a task-review round to catch.

**No documentation gate applies.** `api-surface.md` and `docs/modules/*.md` are TypeScript CI
gates (`scripts/api-surface.test.ts`, `scripts/docs-coverage.test.ts`); neither reads Python.
`sdks/python/CHANGELOG.md` is maintained by release-please, not by hand.

## Out of scope

- **Transport.** Nothing here owns a pipe, a socket, or a process. The reader takes `bytes` a
  caller supplies, exactly as `NdjsonLineReader` does.
- **Performing a handshake.** This binds the frame and the algorithm; wiring them to a running
  peer belongs to the gateway, in the
  [Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo.
- **Liveness and timeouts.** Out of scope per `docs/spec/wire/v1/framing.md` §1, and restated in
  `docs/spec/negotiation/v1/contract-version.md` §8.
- **`create-nimbus-connector` scaffolding and quickstarts.** Sub-project D.
