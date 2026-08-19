# RFC-0001 — A normative wire spec for NDJSON framing

- **Status:** accepted
- **Opened:** 2026-07-28
- **Landed:** 2026-07-29 in [#56](https://github.com/nimbus-agent/nimbus-sdk/pull/56)
- **Affects:** `docs/spec/`, `@nimbus-dev/sdk/ipc`
- **Roadmap:** [Phase 1](../ROADMAP.md#phase-1--lift-the-contract-out-of-typescript), box 2 — *Write the IPC wire-protocol spec for the NDJSON framing in `src/ipc/`*
- **Pillars:** 1 (the contract), 2 (polyglot SDKs), 5 (quality & release)

This is the first RFC under the process in [GOVERNANCE.md](../GOVERNANCE.md#the-rfc-process).
It opens `docs/rfcs/`.

## Problem

`src/ipc/` is the transport floor of the contract: every connector, in every language,
reaches the gateway as newline-delimited JSON over stdio. Today that framing exists only
as TypeScript. [`docs/modules/ipc.md`](../modules/ipc.md) describes it well, but it
describes it *to a TypeScript caller* — it is a usage guide, not a specification. Nothing
in the repository states, in language-neutral terms, what a conformant reader must do.

That matters now rather than later for three reasons.

**A second implementation is imminent.** Phase 2 puts a Python SDK against the same
contract. Whoever writes it will reimplement this reader from the TypeScript source, and
the properties hardest to reproduce are the ones least visible there: that the 1 MiB cap is
enforced against the *unterminated* buffer and not only against complete frames, that
decoding is deliberately non-fatal, that the limit counts octets rather than characters.
A reimplementation that misses any of these looks correct and fails under load or under a
hostile peer.

**The spec corpus has no behavioral half.** `docs/spec/conformance/v1/` proves document
shapes against JSON Schema. Framing is not a document — it is a stream, and the interesting
assertions are about what a reader emits after each chunk. The corpus has no vocabulary for
that, so Phase 1 box 3 (extracting `runContractTests` and the sandbox probe as
language-neutral fixtures) has no pattern to follow. Framing is the smallest useful place
to establish one.

**Several behaviors are undecided rather than decided.** Writing the spec surfaced three
points where the implementation does something specific that no document claims is
intentional — how `flush()` treats an empty remainder, what a truncated final frame is, and
what happens after a size-limit violation. The third turned out to be a defect rather than
an ambiguity. They are decisions (a), (b), and (c) below; the important part is that a spec
cannot be silent on them, and whichever way they resolve, every future binding is bound by
the answer.

## Proposed change

### 1. `docs/spec/wire/v1/framing.md`

A normative document in RFC-2119 language, giving `docs/spec/` three peers: `schemas/`
(shapes), `wire/` (transport), `conformance/` (fixtures). It specifies:

- **Scope.** Frames only. Message envelopes, request/response shapes, and method semantics
  belong to the gateway and are explicitly out of scope — the position
  [`docs/spec/README.md`](../spec/README.md) already takes, now stated in the spec itself
  rather than as a note about a gap.
- **Frame syntax.** A frame is a sequence of octets terminated by LF (`0x0A`). A CR
  (`0x0D`) immediately preceding that LF is not part of the frame, so a CRLF peer and an LF
  peer produce identical frames. A CR anywhere else is ordinary content.
- **Character encoding.** UTF-8, decoded **non-fatally**: ill-formed sequences MUST be
  replaced with U+FFFD, and MUST NOT terminate the stream. This is
  `TextDecoder("utf-8", { fatal: false })` in the reference implementation, and it is a
  choice, not an accident — a binding that raises on malformed input is non-conformant.
- **Stream-aware decoding.** Decoding MUST be stream-aware: a multi-byte sequence divided
  by a chunk boundary MUST be buffered until it completes, and MUST NOT be replaced with
  U+FFFD merely because a chunk ended mid-sequence. A reader that decodes each chunk
  independently corrupts every character that straddles a boundary, and corrupts the
  *following* character too, since the trailing continuation bytes then decode alone. At
  end-of-stream an incomplete sequence has no completion left to wait for and is replaced.
  This is the property `{ stream: true }` provides in the reference implementation; it is
  invisible in the source and is exactly what a reimplementation drops.
- **Byte order mark.** A sender MUST NOT emit a UTF-8 BOM (`EF BB BF`) anywhere in the
  stream. A reader MUST ignore one appearing at the start of the stream — the reference
  implementation already strips it, since `TextDecoder` defaults to `ignoreBOM: false`, and
  no document has said so until now. A BOM appearing anywhere else is a sender violation
  and this specification does not define reader behavior for it; see *Known runtime
  divergence* below for why that silence is deliberate.
- **Payload encoding.** The octets of a frame carry a payload in a named encoding. For v1
  the sole conformant value is JSON. Naming it makes a future encoding an additive,
  negotiated change rather than a revision of the framing itself; no negotiation mechanism
  is defined here (that is box 5).
- **Size limit.** 1 MiB — 1048576 octets — of UTF-8, measured after CR stripping. A reader
  MUST reject an oversized frame rather than buffer it, and MUST apply the same limit to
  the unterminated pending buffer, so that a peer cannot exhaust memory by never sending a
  newline. The limit counts octets, not characters.
- **Exceeding the limit is fatal.** A reader that has rejected an oversized frame MUST NOT
  resume framing: the violation is terminal for that stream, and every subsequent read MUST
  fail the same way. Discarding to the next LF and resuming is explicitly non-conformant —
  it hands a hostile peer a resynchronization primitive, and it silently changes which
  frames the consumer sees. See decision (c) below; the reference implementation does not
  currently satisfy this.
- **End of stream.** Behavior at EOF, per decision (b) below.

### 2. Decision (a) — empty frames are ignored everywhere

Today `push()` drops a frame that is empty after CR stripping, and `flush()` does not: a
stream ending in a bare `"\r"` yields `[""]`. `docs/modules/ipc.md` documents this as a
wart callers must filter around.

The spec states one rule — an empty frame carries no message and MUST be ignored — and
`NdjsonLineReader.flush()` changes to match. A binding should not have to reproduce a
positional exception, and callers should not have to filter. This is a `fix(ipc)` commit.

Two clarifications the rule needs, because both invite a wrong reading:

- **Ignored means discarded, not rejected.** An empty frame MUST NOT raise an error or
  terminate the stream. A peer is therefore free to send bare newlines — as a keep-alive,
  or as padding — without a conformant reader objecting. That is a consequence of the rule,
  not an endorsement: this specification defines no liveness mechanism, and a discarded
  frame is by construction invisible to the reader's consumer, so nothing at the framing
  layer can drive a timeout from it. Liveness belongs with the envelope, which is out of
  scope.
- **Empty means zero-length, not blank.** The test is applied after CR stripping and
  nothing else. A frame of spaces or tabs is ordinary content and MUST be delivered:
  `push("   \n")` returns `["   "]` today, and that is correct.

The alternative, writing the current asymmetry into the contract as normative, was
rejected: it binds every future language to a quirk of one implementation, in a document
meant to outlive that implementation.

### 3. Decision (b) — a truncated frame is delivered, and is distinguishable

Today `flush()` emits an unterminated remainder as an ordinary frame. A peer killed
mid-write therefore produces a frame indistinguishable from a complete one; the truncation
surfaces later as a JSON parse failure, with no framing-level signal and nothing pointing
at the real cause.

The spec states that a frame not terminated by LF is **truncated**, that a reader MUST
still deliver it, and that a reader MUST make it distinguishable from a complete frame.
Delivering rather than rejecting keeps the gateway and CLI working as they do today;
distinguishability gives a binding something to log or surface.

That requires an affordance in the reference implementation. It is additive:

```ts
flushFrames(): { frames: string[]; truncated: boolean }
flush(): string[]   // thin wrapper: this.flushFrames().frames
```

`truncated` is true exactly when `flushFrames()` delivers a frame that had no LF
terminator. A remainder that normalizes to empty — a bare `"\r"` — delivers no frame under
decision (a) and so flags nothing: there is no message to be suspicious of. This is a
`feat(ipc)` commit.

Rejecting the remainder outright is stricter and arguably more correct for a wire protocol,
but it is a breaking change to behavior the gateway and CLI rely on today, and this
repository holds no evidence about whether those peers always terminate their final frame.
That question can be revisited under its own RFC with that evidence in hand.

The spec states the requirement and stops there: *a reader MUST make a truncated frame
distinguishable from a complete one*. How is a binding's business. Non-normatively, a
returned result type, an out-parameter, and a reader-state flag are all reasonable; raising
an exception is not, since the frame must still be delivered.

### 4. Decision (c) — a limit violation latches

The size limit is the only anti-DoS property in the framing layer, and the reference
implementation currently enforces it inconsistently. Both paths deserve to be stated,
because a reimplementation copying either one inherits the flaw:

```
push("good1\ngood2\n" + <1 MiB + 1 octets> + "\ntail\n")   throws
push("after\n")                                            → ["tail", "after"]
```

`good1` and `good2` were framed and then **lost**: `ndjson-line-reader.ts:43` advances
`pending` past a frame before the limit check at `:48`, so the throw discards the return
array along with every frame already accumulated in it. The reader then resumes at the next
frame as though nothing happened. The other path — an oversized *unterminated* buffer —
behaves oppositely, re-throwing on every subsequent `push()` forever.

So today the same violation is silently recoverable with data loss in one case and
permanently fatal in the other. The spec mandates the latter for both, and
`NdjsonLineReader` gains an error latch so a reader that has raised once raises on every
later call. This is a `fix(ipc)` commit: it closes a silent frame-loss path, and it removes
the resynchronization primitive a hostile peer would otherwise get from a deliberate
oversized frame.

### 5. A behavioral conformance corpus

`docs/spec/conformance/v1/framing/`, with its own `index.json`, `index.schema.json`, and
`case.schema.json`, and one case per file under `cases/`.

It is deliberately *not* an extension of the existing `conformance/v1/index.json`. That
index is a document-validation corpus — a JSON document, a schema, a verdict — and framing
is a behavioral one, needing a different runner entirely. Widening the published
`index.schema.json`'s `file` pattern and `shape` enum would also make an older validator
reject entries it has no way to understand, which the corpus's own additive-only rule
forbids.

A case names its chunks and the frames each `push()` must emit:

```json
{
  "description": "a frame split across two pushes emits nothing until the LF arrives",
  "chunks": [{ "utf8": "{\"a\":1" }, { "utf8": "}\n" }],
  "expect": {
    "push": [[], ["{\"a\":1}"]],
    "flush": { "frames": [], "truncated": false }
  }
}
```

`expect.push` is positionally parallel to `chunks`, so "a chunk is not a line" is encoded
structurally rather than asserted in prose. Each element is either the frames that push
emitted or `{ "error": "frame-too-long" }`. Errors are named symbolically so a binding maps
them onto its own error type, mirroring the `lineLimitError` injectability the TypeScript
reader already offers.

A chunk is one of three forms, because framing is byte-level and a JSON string cannot
express all of it:

- `{ "utf8": "a\nb" }` — the readable common case.
- `{ "base64": "..." }` — exact octets, for invalid UTF-8 and for multi-byte sequences
  split across a chunk boundary.
- `{ "repeat": { "byte": 97, "count": 1048577 } }` — generated content, so the limit cases
  do not commit multi-megabyte blobs to git. A literal 1 MiB fixture is roughly 1.4 MB of
  base64, and several are needed.

Coverage, roughly twenty cases: LF, CRLF, and a bare CR inside a frame; frames split across
two and three chunks; several frames in one chunk; a two-byte sequence split across the
boundary and a four-byte emoji split 1/3, 2/2, and 3/1; invalid UTF-8 and a lone
continuation byte resolving to U+FFFD; a whitespace-only frame delivered rather than
dropped; blank frames dropped by both `push` and `flush`; a start-of-stream BOM ignored;
exactly 1048576 octets accepted, 1048577 rejected, and 1048577 pending without an LF
rejected on push; a limit violation latching, with the frames buffered ahead of it not
resurfacing on a later push; multi-byte content proving the limit counts octets, not
characters; the empty stream; and terminated versus unterminated end-of-stream.

### 6. `scripts/framing-guard.test.ts`, run under both runtimes

Patterned on `scripts/schema-guard.test.ts`: validate the index with `ajv`, then drive every
case through `NdjsonLineReader`, asserting push by push and then flush. It carries the two
anti-vacuity checks this repository already uses elsewhere — the corpus must be non-empty,
and every case file on disk must be listed in the index, so a fixture cannot be silently
orphaned.

The guard runs under **Node as well as Bun**. Every other `scripts/` test runs under Bun
alone, but framing expectations bottom out in `TextDecoder`, whose edge behavior is not
identical across runtimes — see below — and a corpus other languages are told to trust must
not encode one runtime's quirk. This extends the pattern Phase 0 established with the Node
ESM smoke across Node LTS, and needs the guard to have a Node-runnable entry point rather
than only a `bun test` one.

A spec with no executable check drifts. This is what keeps the document true, and it is the
same mechanism the schemas already rely on.

## Known runtime divergence

`TextDecoder` removes a BOM only at the start of a decoder's stream. Node implements that
faithfully; Bun does not:

```
node → [ 65279, 98, 10 ]   # U+FEFF preserved mid-stream, per WHATWG Encoding
bun  → [ 98, 10 ]          # U+FEFF stripped mid-stream
```

The reference implementation therefore has an observable behavior that depends on which
supported runtime executes it. Both agree on a BOM at the start of the stream, which is why
the spec pins that case and only that case: a fixture asserting the WHATWG-correct
mid-stream result would fail under Bun, and one asserting Bun's result would write a bug
into the contract. Forbidding senders from emitting a BOM at all makes mid-stream BOM a
sender violation, so leaving reader behavior undefined there costs nothing real.

This is recorded rather than resolved. If Bun's behavior converges, the spec can define the
mid-stream case additively.

## Compatibility impact

| Change | Semver | Who is affected |
|--------|--------|-----------------|
| `flushFrames()` added | minor (`feat`) | Nobody. Purely additive. |
| `flush()` drops an empty remainder | patch (`fix`) | A caller relying on `[""]` from a stream ending in a bare `"\r"`. `docs/modules/ipc.md` currently tells callers to filter that out, so the fix removes work rather than creating it. |
| A limit violation latches | patch (`fix`) | A caller that catches the overflow and keeps pushing. Today it silently resumes at the next frame, having dropped any frames buffered ahead of the oversized one; afterwards it raises again. The behavior it loses is the one that loses data, but it is a change on a live error path and the gateway and CLI should be checked for a `catch` around `push()` before this lands. |
| `docs/spec/wire/v1/` added | none | New path. No existing consumer reads it. |
| `conformance/v1/framing/` added | none | New index, separate from the existing one. An older runner reading `conformance/v1/index.json` is unaffected. |

No runtime dependency is added; the corpus is data, and `ajv` is already a dev dependency
used by the schema guard.

## Migration

None required for the normal path. The `flush()` change removes the need for a workaround
rather than introducing one; `CHANGELOG.md` records it, and `docs/modules/ipc.md` loses the
paragraph describing the asymmetry and gains `flushFrames`.

The latch in decision (c) is the one change with a consumer to check: any caller that
catches the overflow from `push()` and continues will now see it raise on every later call.
The gateway's JSON-RPC transport and the CLI's IPC client should be inspected for such a
`catch` before this lands. Both live in the [Nimbus](https://github.com/nimbus-agent/Nimbus)
monorepo, so that check happens there, not here.

## Alternatives considered

**A binary framing — protobuf or similar.** Rejected. Nimbus connectors are MCP connectors,
and MCP is JSON-RPC 2.0 over newline-delimited JSON on stdio; a binary wire would make a
Nimbus connector undrivable by any other MCP host and would cost Phase 2 the per-language
MCP SDKs that make a Python binding cheap. It also needs a runtime dependency in
TypeScript, which [CONTRIBUTING.md](../CONTRIBUTING.md) forbids, and a `protoc`
toolchain in every binding's build — the opposite of the draft-07 choice made deliberately
for the widest validator support. It would add a second normative shape alongside the JSON
Schemas, doubling the drift surface `schema-guard.test.ts` exists to catch. And a binary
frame is unreadable in a log, which Pillar 8's diagnostics story depends on.

Naming the payload encoding in the spec (§1) captures what is useful in the idea: a future
binary encoding becomes an additive, negotiated change rather than a rewrite.

**Specifying the message envelope too.** Rejected for now. The envelope belongs to the
gateway, and this repository holds no gateway source to check a specification against —
defining one here would be inventing a contract the gateway must then be made to match,
unverifiable from this side.

**Discard-to-next-LF recovery after a limit violation.** Rejected in favor of latching
(decision c). Resuming is what the implementation accidentally does today, and it is the
weaker choice on both counts that matter: it lets a peer that deliberately oversends
resynchronize the reader at a frame boundary of its choosing, and it hides the fact that
frames were dropped. A framing violation means the peer is broken or hostile; neither
warrants continuing.

**Leaving the edge behaviors unspecified.** Rejected. An unspecified edge cannot be covered
by a fixture, and undocumented edges are exactly where reimplementations diverge. The one
exception is mid-stream BOM, left undefined deliberately and for a stated reason.

## Out of scope

- Contract-version negotiation, including how peers would agree on a payload encoding —
  Phase 1, box 5.
- Extracting `runContractTests` and the sandbox probe as fixtures — Phase 1, box 3. This
  RFC establishes the behavioral-corpus pattern that work should reuse.
- Whether an unterminated final frame should eventually be an error rather than a delivered
  truncated frame — revisitable under its own RFC, with evidence from the gateway and CLI.
- Reader behavior for a BOM appearing anywhere but the start of the stream — undefined
  while the supported runtimes disagree, and a sender violation regardless.

## Review

Comments on the first draft, and what changed in response, are in
[`0001-ipc-framing-spec-review.md`](./0001-ipc-framing-spec-review.md). Four of its five
points are folded into the sections above; the fifth (per-language guidance for surfacing
truncation) is reflected as a single non-normative sentence in decision (b) rather than a
section, since the specification states requirements and leaves API ergonomics to each
binding.
