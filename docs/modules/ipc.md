<!-- covers: ipc/ndjson-line-reader -->

# `ipc`

NDJSON line reading and IPC framing. Its own entry point:
`import { NdjsonLineReader } from "@nimbus-dev/sdk/ipc"`.

## When you reach for it

When you read a stream of newline-delimited JSON from a pipe or a socket and must not
assume a chunk boundary is a line boundary. Shared by the gateway's JSON-RPC transport and
the CLI's IPC client, so both agree on framing and on the line limit.

## Constraints that are load-bearing

- **A chunk is not a line.** `push()` buffers partial input and returns only the complete
  lines it can. Call `flush()` at end-of-stream to get whatever is left.
- **The line limit is enforced, not advisory.** A line exceeding `IPC_MAX_LINE_BYTES` (1 MiB
  of UTF-8) throws rather than growing the buffer, so a peer cannot exhaust memory by never
  sending a newline.
- **The thrown error type is injectable.** `lineLimitError` lets a caller map the overflow
  onto its own protocol error class without string-matching a message.
- **A trailing `\r` is always stripped**, so a CRLF peer and an LF peer produce identical
  output. **Blank lines are dropped by `push()` only.** `flush()` returns whatever remains
  as a single element with no such filter, so a stream ending in a bare `"\r"` yields
  `[""]` — filter the result before parsing it.
- **No I/O.** The reader takes bytes you already have; opening the pipe is yours.

## Example

```ts
import {
  IPC_MAX_LINE_BYTES,
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

/** Anything still buffered when the peer closes — flush() does not drop a blank remainder. */
export function onEnd(): unknown[] {
  return reader
    .flush()
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

export const maxFrameBytes: number = IPC_MAX_LINE_BYTES;
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
