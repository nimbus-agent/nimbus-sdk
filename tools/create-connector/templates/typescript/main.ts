#!/usr/bin/env node

/**
 * Handshake first, then serve.
 *
 * `docs/spec/negotiation/v1/contract-version.md` §5 has both peers announce unprompted, so the
 * gateway's hello and its first request commonly arrive in one read. `performHandshake` hands
 * back the complete frames it read past the hello as `pending`; anything it left half-read stays
 * in the `NdjsonLineReader` we supply. Both have to reach the MCP transport, or the session
 * loses its first message with nothing to show for it.
 *
 * That is why the transport is *not* given `process.stdin`. It is given a stream we build:
 * `pending` first, then every frame the same reader completes from the rest of stdin.
 */

import { Readable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CONTRACT_HANDSHAKE_EXIT } from "@nimbus-dev/sdk";
import { createRegisterSimpleTool, mcpJsonResult } from "@nimbus-dev/sdk/connector-kit";
import { NdjsonLineReader, performHandshake } from "@nimbus-dev/sdk/ipc";
import { z } from "zod";

import { echo } from "./handlers.js";
import { manifest, TOOLS } from "./manifest.js";

/**
 * One iterator over stdin for the whole process. The handshake draws chunks from it and the
 * replay stream keeps drawing from the *same* one — a second iterator would race the first for
 * the same bytes.
 */
const stdinChunks: AsyncIterator<Uint8Array> = process.stdin[Symbol.asyncIterator]();

async function readChunk(): Promise<Uint8Array | null> {
  const next = await stdinChunks.next();
  return next.done === true ? null : new Uint8Array(next.value);
}

function frameOf(line: string): Uint8Array {
  return Buffer.from(`${line}\n`, "utf8");
}

/** The tool's input shape, as Zod schemas — what `McpServer.tool` recognises as a raw shape. */
const echoShape = { text: z.string() };
const echoSchema = z.object(echoShape);

function createMcpServer(): McpServer {
  const server = new McpServer({ name: manifest.id, version: manifest.version });
  const registerSimpleTool = createRegisterSimpleTool(server);
  registerSimpleTool(TOOLS[0].name, TOOLS[0].description, echoShape, async (args: unknown) =>
    mcpJsonResult(await echo(echoSchema.parse(args))),
  );
  return server;
}

async function connectTransport(server: McpServer, input: Readable): Promise<void> {
  await server.connect(new StdioServerTransport(input, process.stdout));
}

async function run(): Promise<void> {
  const reader = new NdjsonLineReader();
  const result = await performHandshake(
    {
      read: readChunk,
      write: async (chunk) => {
        process.stdout.write(chunk);
      },
    },
    { localVersions: manifest.contractVersions ?? ["1"], reader },
  );

  if (!result.ok) {
    process.stderr.write(`handshake refused: ${result.reason}\n`);
    process.exitCode = CONTRACT_HANDSHAKE_EXIT;
    // Release stdin so the process can exit on its own. `process.exit()` here would risk
    // truncating the hello we just wrote to a pipe.
    await stdinChunks.return?.(undefined);
    return;
  }

  /**
   * Replay what the handshake read past the hello, then keep feeding the *same* reader from the
   * rest of stdin. Two things would be lost by handing `process.stdin` straight to the transport:
   * the complete frames in `result.pending`, and the partial frame still buffered inside
   * `reader`. Draining the reader here (`flushFrames`) instead of pushing through it would lose
   * the second just as surely — a half-read frame is not a frame until the rest of it arrives.
   */
  const replay = Readable.from(
    (async function* stream(): AsyncGenerator<Uint8Array> {
      for (const frame of result.pending) {
        yield frameOf(frame);
      }
      for (;;) {
        const next = await stdinChunks.next();
        if (next.done === true) {
          break;
        }
        for (const frame of reader.push(new Uint8Array(next.value))) {
          yield frameOf(frame);
        }
      }
      for (const frame of reader.flushFrames().frames) {
        yield frameOf(frame);
      }
    })(),
    { objectMode: false },
  );

  await connectTransport(createMcpServer(), replay);
}

await run();
