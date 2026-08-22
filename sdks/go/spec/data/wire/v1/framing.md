# Nimbus wire protocol v1 — NDJSON framing

**Status:** normative. **Contract version:** `v1`.

This document specifies how a Nimbus connector and the gateway divide a byte stream into
**frames**. It is the transport floor of the contract: every binding, in every language,
MUST implement it identically for a connector written in one language to be interchangeable
with a connector written in another.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as
described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is
[`sdks/typescript/src/ipc/`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/sdks/typescript/src/ipc); the executable
form of this document is the fixture corpus at
[`../../conformance/v1/framing/`](../../conformance/v1/framing/). Where prose and corpus
appear to disagree, the corpus is the tiebreaker — it is what CI runs.

## 1. Scope

This document specifies **framing only**: how octets become frames, and nothing about what
a frame means.

Message envelopes, request and response shapes, method names, error objects, correlation of
requests to responses, and liveness are **out of scope**. Those belong to the gateway and
are not specified by this package. A binding that implements this document correctly can
carry any of them.

Also out of scope: how peers agree on a contract version, and any transport below the byte
stream (pipes, sockets, process spawning). This document assumes an ordered, reliable
stream of octets and says nothing about how it was opened.

## 2. Terminology

- **Octet** — an 8-bit byte.
- **Stream** — the ordered sequence of octets exchanged in one direction.
- **Chunk** — an arbitrary contiguous run of octets, as delivered by the underlying
  transport. Chunk boundaries carry no meaning.
- **Frame** — one unit of framing, defined in §3.
- **Reader** — an implementation that turns a stream into frames.
- **Sender** — an implementation that turns messages into a stream.

## 3. Frame syntax

A frame is a sequence of octets terminated by LF (`0x0A`).

The LF is a delimiter and is not part of the frame. A single CR (`0x0D`) immediately
preceding that LF is also not part of the frame, so a sender emitting CRLF and a sender
emitting LF produce identical frames. A CR anywhere else in a frame is ordinary content and
MUST be preserved.

A sender SHOULD emit LF alone. A reader MUST accept both.

Chunk boundaries are not frame boundaries. A reader MUST buffer a partial frame across
chunks and MUST NOT emit it until its terminating LF arrives (or the stream ends — see §8).
A single chunk MAY contain many frames, part of one frame, or no complete frame at all.

## 4. Character encoding

Frames are UTF-8.

Decoding MUST be **non-fatal**: an ill-formed sequence MUST be replaced with U+FFFD
REPLACEMENT CHARACTER, and MUST NOT raise an error or terminate the stream. A reader that
rejects malformed input is non-conformant. Framing is deliberately more tolerant than the
payload parser above it; a frame containing U+FFFD will simply fail to parse as JSON, which
is where the error belongs.

Decoding MUST be **stream-aware**. A multi-byte sequence divided by a chunk boundary MUST be
held until the remaining octets arrive, and MUST NOT be replaced with U+FFFD merely because
a chunk ended mid-sequence. A reader that decodes each chunk independently corrupts every
character straddling a boundary, and corrupts the following character too, because the
trailing continuation octets then decode alone.

At end-of-stream an incomplete sequence has no completion left to await, and MUST be
replaced with U+FFFD at that point (§8).

**How many.** Exactly one U+FFFD replaces each *maximal subpart* of an ill-formed sequence —
the longest prefix of the remaining octets that could still begin a well-formed sequence, or
a single octet when no such prefix exists. Decoding resumes at the octet after that subpart.
The count does not depend on how the octets were chunked, nor on whether the sequence was
invalidated by a following octet or by the end of the stream.

This is Unicode 3.9's recommended practice and the rule the
[WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) states, so a binding decoding
through `TextDecoder` or through Python's incremental UTF-8 decoder conforms without doing
anything. A binding that steps through an unfinishable prefix one octet at a time will not:
it reports one U+FFFD per leftover octet, which this rule forbids.

| Octets | Replacements | Why |
|---|---|---|
| `F0 9F 8D` | 1 | a valid prefix of one 4-octet sequence — a single subpart |
| `E0 80` | 2 | `E0` requires `A0..BF` next, so `E0` alone is the subpart; `80` then stands alone |
| `ED A0 80` | 3 | `ED` requires `80..9F` next; each of the three octets is its own subpart |
| `C0 AF` | 2 | `C0` can never lead a sequence; `AF` then stands alone |

The frame size limit in §6 counts **octets, not characters**.

## 5. Byte order mark

A sender MUST NOT emit a UTF-8 BOM (`EF BB BF`) anywhere in the stream.

A reader MUST ignore a BOM appearing at the very start of the stream: it is not part of the
first frame.

Reader behavior for a BOM appearing anywhere else is **undefined** by this version. It is
already a sender violation, and the runtimes the reference implementation supports do not
agree on it — see [RFC-0001](../../../rfcs/0001-ipc-framing-spec.md). A binding MAY treat a
mid-stream `U+FEFF` as ordinary content; conformance does not depend on it, and no fixture
asserts it.

## 6. Frame size limit

A frame MUST NOT exceed **1 MiB — 1048576 octets** — measured as UTF-8 after the CR and LF
of §3 are removed. A frame of exactly 1048576 octets is conformant; 1048577 is not.

The measurement is on the **decoded** text re-encoded as UTF-8, not on the raw input octets.
The two differ only for ill-formed input, where each U+FFFD of §4 occupies three octets and
can carry a frame past the limit that its raw octets did not reach. §4's replacement count
is therefore load-bearing here, and through §7 it decides whether a stream survives.

A reader MUST enforce the limit in both places it can be exceeded:

1. On a **complete** frame whose octets exceed the limit.
2. On the **unterminated buffer** — the octets accumulated since the last LF — as soon as it
   exceeds the limit, without waiting for an LF that may never arrive.

The second is the load-bearing one. Enforcing only the first lets a peer exhaust a reader's
memory simply by never sending a newline, and is the property most often missed when
reimplementing.

## 7. Exceeding the limit is terminal

A reader that has rejected a frame under §6 MUST NOT resume framing. The violation is
terminal for that stream: every subsequent read MUST fail in the same way, and the reader
MUST NOT emit further frames.

Discarding octets up to the next LF and resuming is explicitly **non-conformant**. It hands
a peer that oversends a way to resynchronize the reader at a boundary of the peer's
choosing, and it silently changes which frames the consumer sees — frames already parsed
ahead of the oversized one are lost without a signal.

A reader MUST NOT emit frames it parsed before detecting the violation. The stream is not
trustworthy after a framing error, and partial delivery is worse than none.

How the failure is surfaced is a binding's business — an exception, an error return, a
poisoned reader state. That it is permanent is not.

## 8. End of stream

When the stream ends, a reader MUST drain what it holds:

- Any octets buffered since the last LF form a final frame, subject to §4's replacement of
  an incomplete multi-byte sequence and to §6's size limit.
- That final frame is **truncated**: no LF terminated it, so the sender may have stopped
  mid-message.

A reader MUST deliver a truncated final frame rather than discard it, and MUST make it
**distinguishable** from a complete frame. A consumer that cannot tell the difference
diagnoses a truncated write as a malformed message, which points at the wrong cause.

How that distinction is expressed is a binding's business. Non-normatively: a result type
carrying a flag, an out-parameter, or a reader-state predicate all serve. Raising an error
does not, because the frame must still be delivered.

If nothing is buffered, or what is buffered is empty under §9, the reader delivers no final
frame and reports no truncation — there is no message to be suspicious of.

## 9. Empty frames

A frame that is zero-length after the CR handling of §3 carries no message. A reader MUST
ignore it: it MUST NOT be delivered, and it MUST NOT be treated as an error or terminate the
stream. This holds identically mid-stream and at end-of-stream.

A sender MAY therefore emit bare newlines — as padding, or as traffic — without a conformant
reader objecting. This specification defines no liveness or keep-alive mechanism, and none
can be built at this layer: an ignored frame is by construction invisible to the reader's
consumer.

**Empty means zero-length, not blank.** The test is applied after CR removal and after
nothing else. A frame of spaces or tabs is ordinary content and MUST be delivered.

## 10. Payload encoding

The octets of a frame carry a payload in a named encoding. For contract version `v1` the
only conformant value is **JSON** — each frame is exactly one JSON value, which is what makes
this NDJSON.

Naming the encoding rather than assuming it means a future encoding can be introduced as an
additive, negotiated change rather than a revision of this document. No negotiation
mechanism is defined here; until one exists, a reader MUST assume JSON.

Parsing the payload is out of scope. A reader delivers frames; whether a frame is valid JSON
is the layer above's concern (§4).

## 11. Conformance

An implementation is conformant when it satisfies every MUST above and reproduces every
fixture in [`../../conformance/v1/framing/`](../../conformance/v1/framing/). The corpus is
machine-readable and language-neutral: it names chunk sequences and the frames each push
must produce, so a binding proves itself without reading this prose.

Changes to this document follow the [RFC process](../../../GOVERNANCE.md#the-rfc-process).
Within `v1` only additive change is permitted; anything that would make a previously
conformant reader non-conformant requires a new version path.
