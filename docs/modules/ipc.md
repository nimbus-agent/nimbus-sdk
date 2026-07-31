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

```ts
import { performHandshake } from "@nimbus-dev/sdk/ipc";

declare function readChunk(): Promise<Uint8Array | null>;
declare function writeChunk(chunk: Uint8Array): Promise<void>;

const result = await performHandshake({ read: readChunk, write: writeChunk });
if (!result.ok) {
  // result.reason is one of the seven HelloRefusalReason values, or "no-common-version"
  throw new Error(`handshake refused: ${result.reason}`);
}
result.version; // the agreed contract major, e.g. "1"
```

### If you read again after the handshake, pass your own reader

`performHandshake` reads through an `NdjsonLineReader` to assemble the peer's hello, since a
chunk boundary is not a frame boundary any more here than anywhere else this package reads a
stream. If you don't supply one, it makes its own — and drops it when it returns.

That's invisible right up until it isn't: §5 has both peers announce *unprompted*, so a gateway
that writes its hello and immediately follows with its first request will very often land both
in the same read. If `performHandshake` owns the reader, that request is inside it when the
function returns — and is gone. Not delayed, not re-deliverable: a `NdjsonLineReader` with no
handle to it is unreachable. Your own read loop starts from an empty buffer and never sees the
first message of the session. Nothing in the return value indicates this happened; `{ ok: true,
version }` looks identical either way.

Pass a reader you kept a reference to via `HandshakeOptions.reader`, and it survives:

```ts
import { NdjsonLineReader, performHandshake } from "@nimbus-dev/sdk/ipc";

declare function readChunk(): Promise<Uint8Array | null>;
declare function writeChunk(chunk: Uint8Array): Promise<void>;
declare function handle(message: unknown): void;

const reader = new NdjsonLineReader();
const result = await performHandshake({ read: readChunk, write: writeChunk }, { reader });
if (result.ok) {
  // Whatever the peer sent along with (or right after) its hello is still buffered here.
  for (const line of reader.flush()) {
    handle(JSON.parse(line));
  }
}
```

Omitting `reader` is fine when nothing follows the handshake on that stream — a one-shot check,
or a test — but any caller that keeps reading afterward needs to supply one.

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
