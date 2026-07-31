<!-- covers: ipc/ndjson-line-reader, ipc/handshake -->

# `ipc`

NDJSON line reading and IPC framing. Its own entry point:
`import { NdjsonLineReader } from "@nimbus-dev/sdk/ipc"`.

## When you reach for it

When you read a stream of newline-delimited JSON from a pipe or a socket and must not
assume a chunk boundary is a line boundary. Shared by the gateway's JSON-RPC transport and
the CLI's IPC client, so both agree on framing and on the line limit.

The behavior below is specified language-neutrally in
[`spec/wire/v1/framing.md`](../spec/wire/v1/framing.md), and the corpus at
[`spec/conformance/v1/framing/`](../spec/conformance/v1/framing/) holds this
implementation to it on every PR. This page is the TypeScript usage guide; the spec is the
contract.

This entry point also exports `encodeHello` / `parseHello`, the contract-version handshake frame.
The frame and the algorithm are documented together in
[`contract-version.md`](./contract-version.md).

## Constraints that are load-bearing

- **A chunk is not a line.** `push()` buffers partial input and returns only the complete
  lines it can. Call `flush()` at end-of-stream to get whatever is left.
- **The line limit is enforced, not advisory.** A line exceeding `IPC_MAX_LINE_BYTES` (1 MiB
  of UTF-8) throws rather than growing the buffer, so a peer cannot exhaust memory by never
  sending a newline. The limit applies to the *unterminated* buffer too, not only to
  complete lines.
- **Exceeding the limit is terminal.** The reader latches: every later `push()` and
  `flush()` throws the same way, and lines parsed before the violation are not delivered.
  A peer that oversends cannot resynchronize you by following it with a newline.
- **The thrown error type is injectable.** `lineLimitError` lets a caller map the overflow
  onto its own protocol error class without string-matching a message. The latch raises it
  too.
- **A trailing `\r` is always stripped**, so a CRLF peer and an LF peer produce identical
  output. **Blank lines are dropped everywhere** — by `push()` and by `flush()` alike, so a
  stream ending in a bare `"\r"` yields nothing rather than `[""]`.
- **Truncation is visible if you ask for it.** `flush()` returns just the lines;
  `flushFrames()` returns them alongside `truncated`, which is true when the stream ended
  mid-line. A truncated line is still delivered — otherwise a peer killed mid-write would
  surface as a JSON parse error pointing at the wrong cause.
- **No I/O.** The reader takes bytes you already have; opening the pipe is yours.

## Example

```ts
import {
  IPC_MAX_LINE_BYTES,
  type NdjsonFlushResult,
  NdjsonLineReader,
  type NdjsonLineReaderOptions,
} from "@nimbus-dev/sdk/ipc";

class FrameTooLong extends Error {}

const options: NdjsonLineReaderOptions = { lineLimitError: FrameTooLong };
const reader = new NdjsonLineReader(options);

/** Feed chunks as they arrive; only complete lines come back. */
export function onChunk(chunk: Uint8Array): unknown[] {
  return reader.push(chunk).map((line) => JSON.parse(line) as unknown);
}

/** Anything still buffered when the peer closes, and whether it was cut short. */
export function onEnd(): { messages: unknown[]; truncated: boolean } {
  const result: NdjsonFlushResult = reader.flushFrames();
  return {
    messages: result.frames.map((line) => JSON.parse(line) as unknown),
    truncated: result.truncated,
  };
}

export const maxFrameBytes: number = IPC_MAX_LINE_BYTES;
```

## The handshake

`performHandshake(io, options?)` is the one exchange this package can carry out end to end:
announce, listen, agree — or refuse. It is specified in
[`contract-version.md`](../spec/negotiation/v1/contract-version.md) §5 (the frame and the order
it is written in) and §6 (the algorithm), layered over `framing.md` §3.

- **The stream is injected, not opened.** `HandshakeIo` is two callbacks — `read` and `write` —
  and this package opens no pipe and no socket. That is what keeps the runtime testable without
  spawning a process, which §8 says this package cannot do.
- **Our hello is written first.** Per §5, both peers announce unprompted; a runtime that read
  before writing would deadlock against another runtime doing the same. `performHandshake` writes
  before its first `read()` call, and that ordering is asserted by a dedicated test, not left to
  incidental code shape.
- **A refusal is a value, not an exit.** `performHandshake` returns `{ ok: false, reason }`
  rather than calling `process.exit` — this package owns no process to exit. The caller decides
  what to do with the refusal; `CONTRACT_HANDSHAKE_EXIT` (from `contract-version`) is exported for
  a caller that wants to terminate with it.
- **No timeout.** Neither `read` nor `write` is given one, and there is no timeout option to set.
  §8 puts that bound on whatever supervises the process, not on this call — a caller that wants
  one wraps its own `HandshakeIo`.
- **The refusal reason is wider than `ContractNegotiationResult`'s.** `HandshakeRefusalReason` is
  `HelloRefusalReason | "no-common-version"`, because the exchange can fail at the frame layer —
  malformed JSON, the wrong message, a duplicate version — before negotiation is ever reached.
- **`pending` carries whatever else the same read completed.** §5 has both peers announce
  *unprompted*, so a peer's hello and its first request very often arrive in one read, and
  `NdjsonLineReader.push()` returns every complete frame that read completed — not just the
  hello. `HandshakeResult.pending` is those extra frames, in order, on every return path
  (success or refusal), so `performHandshake` never has to choose between the hello and what
  came after it.

```ts
import { performHandshake } from "@nimbus-dev/sdk/ipc";

declare function readChunk(): Promise<Uint8Array | null>;
declare function writeChunk(chunk: Uint8Array): Promise<void>;
declare function handle(message: unknown): void;

const result = await performHandshake({ read: readChunk, write: writeChunk });
if (!result.ok) {
  // result.reason is one of the seven HelloRefusalReason values, or "no-common-version"
  throw new Error(`handshake refused: ${result.reason}`);
}
result.version; // the agreed contract major, e.g. "1"
// Complete frames the peer sent right after its hello — process these before your own next
// read(), in order, or you'll process a later message before an earlier one.
for (const line of result.pending) {
  handle(JSON.parse(line));
}
```

### Two ways a single read can carry more than the hello — and why one recovery isn't enough

`performHandshake` reads through an `NdjsonLineReader` to assemble the peer's hello, since a
chunk boundary is not a frame boundary here any more than anywhere else this package reads a
stream. A single `read()` can return the hello *and* whatever the peer sent immediately after
it — and what that "whatever" contains splits into two cases that need two different fixes:

- **Complete frames** — full lines the same chunk terminated. `push()` extracts these as part
  of finding the hello, so they can't be left sitting in the reader; they come back as
  `result.pending` (see above). Drop them and you've dropped the peer's first message(s) with no
  sign of it.
- **A trailing, not-yet-complete frame** — bytes buffered because no terminating newline had
  arrived yet. These were never a complete line, so `pending` can't hold them; `push()` leaves
  them in the reader's own internal buffer instead. If `performHandshake` created that reader
  itself, that buffer — and the partial frame inside it — is discarded the moment the function
  returns: not delayed, not re-deliverable, just gone. Nothing in the return value indicates
  this happened; `{ ok: true, ... }` looks identical either way.

`pending` alone only fixes the first case. The second needs the *same reader instance* to
survive past the call, which is what `HandshakeOptions.reader` is for: supply one, keep reading
through it after the handshake, and the partial frame is exactly where you'd expect — sitting in
`pending` for the reader's *own* next `push()` or `flush()` call, waiting for the rest of itself
to arrive.

```ts
import { NdjsonLineReader, performHandshake } from "@nimbus-dev/sdk/ipc";

declare function readChunk(): Promise<Uint8Array | null>;
declare function writeChunk(chunk: Uint8Array): Promise<void>;
declare function handle(message: unknown): void;

const reader = new NdjsonLineReader();
const result = await performHandshake({ read: readChunk, write: writeChunk }, { reader });
if (result.ok) {
  // Complete frames read alongside the hello: come back on the result, in order.
  for (const line of result.pending) {
    handle(JSON.parse(line));
  }
  // A trailing, not-yet-complete frame read alongside the hello: still buffered in the
  // reader you supplied, because it's the same instance performHandshake read through.
  const nextChunk = await readChunk();
  if (nextChunk !== null) {
    for (const line of reader.push(nextChunk)) {
      handle(JSON.parse(line));
    }
  }
}
```

Omitting `reader` is fine when nothing follows the handshake on that stream — a one-shot check,
or a test — but any caller that keeps reading afterward needs to supply one, in addition to
draining `pending`. Each recovers a different half of what a single read can carry; neither
substitutes for the other.

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
