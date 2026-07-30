<!-- covers: ipc/ndjson-line-reader -->

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

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
