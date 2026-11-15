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

/**
 * Serves `server` until the input ends or `signal` aborts, then resolves. Calls still running at
 * that point are aborted and their results are not written.
 *
 * A line that is not JSON is answered with `-32700`. A line over the reader's limit is answered
 * with `-32600` and ends the connection: the reader cannot find the next message boundary after
 * one, so nothing later on the stream is trusted.
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

  const dispatch = (line: string): void => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: MCP_ERROR_CODES.parseError, message: "Parse error" },
      });
      return;
    }
    const done = connection.receive(message).finally(() => pending.delete(done));
    pending.add(done);
  };

  const iterator = input[Symbol.asyncIterator]();
  let stopped = false;
  const isStopped = (): boolean => stopped;
  const stop = (): void => {
    stopped = true;
    connection.close();
    void iterator.return?.();
  };
  if (options.signal?.aborted === true) {
    stop();
    return;
  }
  options.signal?.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done === true || isStopped()) break;
      let lines: string[];
      try {
        lines = reader.push(next.value);
      } catch {
        send({
          jsonrpc: "2.0",
          id: null,
          error: { code: MCP_ERROR_CODES.invalidRequest, message: "Message too large" },
        });
        break;
      }
      for (const line of lines) dispatch(line);
    }
    if (!isStopped()) {
      // The input ended: let the calls already accepted finish and answer.
      await Promise.allSettled([...pending]);
    }
  } finally {
    options.signal?.removeEventListener("abort", stop);
    connection.close();
  }
}
