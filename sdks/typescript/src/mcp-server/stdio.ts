/**
 * `serveStdio`: the stdio binding of the MCP server layer.
 *
 * One JSON-RPC message per line in, one per line out, UTF-8, no embedded newlines. Nothing but MCP
 * messages is written to the output; a server that wants to log uses stderr.
 */

import { NdjsonLineReader } from "../ipc/ndjson-line-reader.js";
import { MCP_ERROR_CODES, type McpOutgoingMessage } from "./protocol.js";
import type { McpConnectOptions, McpServer } from "./server.js";

/** @moduleStability experimental */

export interface ServeStdioOptions extends McpConnectOptions {
  /** Where messages come from. Default: this process's standard input. */
  input?: AsyncIterable<Uint8Array>;
  /** Writes one line (it already ends with a newline). Default: this process's standard output. */
  write?: (line: string) => void;
  /** Stops serving: running calls are aborted and the returned promise resolves. */
  signal?: AbortSignal;
}

function defaultWrite(line: string): void {
  process.stdout.write(line);
}

const NEWLINE = 0x0a;

/**
 * A chunk cut after each newline. The line reader refuses a whole `push` when it meets a line
 * over its limit, and the complete lines ahead of it in the same push are lost with it; fed one
 * line at a time, every complete line is returned before the oversized one is refused. So what
 * is served does not depend on where the reads happened to fall. (A newline byte never occurs
 * inside a multi-byte UTF-8 sequence, so the cut is safe.)
 */
function lineSegments(chunk: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  for (let at = chunk.indexOf(NEWLINE); at !== -1; at = chunk.indexOf(NEWLINE, start)) {
    out.push(chunk.subarray(start, at + 1));
    start = at + 1;
  }
  if (start < chunk.length) out.push(chunk.subarray(start));
  return out;
}

/**
 * Serves `server` until the input ends or `signal` aborts, then resolves. On abort, calls still
 * running are aborted, their results are not written, and the promise resolves at once: it does
 * not wait for a read that is still pending or for a handler that ignores its signal.
 *
 * A line that is not JSON is answered with `-32700`. A line over the reader's limit is answered
 * with `-32600` and ends the connection: the reader cannot find the next message boundary after
 * one, so nothing later on the stream is trusted.
 *
 * It REJECTS when `write` throws, or when the input itself fails: the connection is closed, and
 * the first such error is rethrown once serving has stopped.
 */
export async function serveStdio(
  server: McpServer,
  options: ServeStdioOptions = {},
): Promise<void> {
  const write = options.write ?? defaultWrite;
  const input: AsyncIterable<Uint8Array> = options.input ?? process.stdin;
  const send = (message: McpOutgoingMessage): void => {
    write(`${JSON.stringify(message)}\n`);
  };
  const connection = server.connect(
    send,
    options.legacy === undefined ? {} : { legacy: options.legacy },
  );
  const reader = new NdjsonLineReader();
  const pending = new Set<Promise<void>>();
  const iterator = input[Symbol.asyncIterator]();
  const failures: unknown[] = [];

  let stopped = false;
  const isStopped = (): boolean => stopped;
  let wake: () => void = () => undefined;
  const whenStopped = new Promise<void>((resolve) => {
    wake = resolve;
  });
  let released = false;
  /** Lets the input release what it holds. Never awaited: a slow cleanup must not delay us. */
  const release = (): void => {
    if (released) return;
    released = true;
    try {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    } catch {
      // An input that cannot be released is still finished with.
    }
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    connection.close();
    release();
    wake();
  };
  /** A writer that throws, or a handler path that rejects: stop, and rethrow when serving ends. */
  const fail = (error: unknown): void => {
    failures.push(error);
    stop();
  };
  const trySend = (message: McpOutgoingMessage): void => {
    try {
      send(message);
    } catch (error) {
      fail(error);
    }
  };

  const dispatch = (line: string): void => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      trySend({
        jsonrpc: "2.0",
        id: null,
        error: { code: MCP_ERROR_CODES.parseError, message: "Parse error" },
      });
      return;
    }
    const done = connection
      .receive(message)
      .catch(fail)
      .finally(() => pending.delete(done));
    pending.add(done);
  };

  /** Feeds one read to the line reader. False when a line was over the limit. */
  const feed = (chunk: Uint8Array): boolean => {
    for (const segment of lineSegments(chunk)) {
      let lines: string[];
      try {
        lines = reader.push(segment);
      } catch {
        trySend({
          jsonrpc: "2.0",
          id: null,
          error: { code: MCP_ERROR_CODES.invalidRequest, message: "Message too large" },
        });
        return false;
      }
      for (const line of lines) dispatch(line);
    }
    return true;
  };

  if (options.signal?.aborted === true) {
    stop();
    return;
  }
  options.signal?.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      // Raced against the stop: an input whose read never settles must not hold serving open.
      const next = await Promise.race([iterator.next(), whenStopped.then(() => undefined)]);
      if (next === undefined || next.done === true || isStopped()) break;
      if (!feed(next.value)) break;
    }
    if (!isStopped()) {
      // The input ended: let the calls already accepted finish and answer, unless serving is
      // stopped meanwhile (a handler that ignores its signal must not hold this open either).
      await Promise.race([Promise.allSettled([...pending]), whenStopped]);
    }
  } finally {
    options.signal?.removeEventListener("abort", stop);
    connection.close();
    release();
  }
  if (failures.length > 0) throw failures[0];
}
