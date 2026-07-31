import { describe, expect, test } from "bun:test";

import { CONTRACT_VERSIONS } from "../contract-version.js";
import { type HandshakeIo, type HandshakeRefusalReason, performHandshake } from "./handshake.js";

/** A scripted peer: hands back queued chunks, records everything written. */
function scriptedPeer(chunks: (string | null)[]): HandshakeIo & { written: string[] } {
  const queue = [...chunks];
  const written: string[] = [];
  return {
    written,
    read: async (): Promise<Uint8Array | null> => {
      if (queue.length === 0) {
        return null;
      }
      const next = queue.shift();
      return next === null || next === undefined ? null : new TextEncoder().encode(next);
    },
    write: async (chunk: Uint8Array): Promise<void> => {
      written.push(new TextDecoder().decode(chunk));
    },
  };
}

describe("performHandshake", () => {
  test("agrees when both peers declare the same major", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["1"]}\n']);
    expect(await performHandshake(io)).toEqual({ ok: true, version: "1", pending: [] });
  });

  test("writes our hello BEFORE reading anything", async () => {
    // §5: the first frame each peer writes MUST be a hello, and a peer MUST NOT write
    // anything before it. Both peers announce unprompted — a runtime that waited for the
    // peer before writing would deadlock against another runtime doing the same.
    const order: string[] = [];
    const io: HandshakeIo = {
      read: async () => {
        order.push("read");
        return new TextEncoder().encode('{"nimbus":"hello","contractVersions":["1"]}\n');
      },
      write: async () => {
        order.push("write");
      },
    };
    await performHandshake(io);
    expect(order[0]).toBe("write");
  });

  test("the frame it writes is a well-formed hello for our declared set", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["1"]}\n']);
    await performHandshake(io);
    expect(io.written.join("")).toBe(
      `{"nimbus":"hello","contractVersions":${JSON.stringify([...CONTRACT_VERSIONS])}}\n`,
    );
  });

  test("a frame split across reads is assembled before parsing", async () => {
    const io = scriptedPeer(['{"nimbus":"hello",', '"contractVersions":["1"]}\n']);
    expect(await performHandshake(io)).toEqual({ ok: true, version: "1", pending: [] });
  });

  test("surfaces the parseHello reason rather than collapsing it", async () => {
    // The whole reason HandshakeResult exists: ContractNegotiationResult could not
    // carry these, and flattening them would discard what §5 names.
    const cases: [string, HandshakeRefusalReason][] = [
      ["{oops\n", "not-json"],
      ["null\n", "not-object"],
      ['{"nimbus":"goodbye","contractVersions":["1"]}\n', "wrong-message"],
      ['{"nimbus":"hello"}\n', "missing-versions"],
      ['{"nimbus":"hello","contractVersions":[]}\n', "empty-versions"],
      ['{"nimbus":"hello","contractVersions":["01"]}\n', "invalid-version"],
      ['{"nimbus":"hello","contractVersions":["1","1"]}\n', "duplicate-version"],
    ];
    for (const [frame, reason] of cases) {
      expect(await performHandshake(scriptedPeer([frame]))).toEqual({
        ok: false,
        reason,
        pending: [],
      });
    }
  });

  test("refuses no-common-version when the sets are disjoint", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["2"]}\n']);
    expect(await performHandshake(io)).toEqual({
      ok: false,
      reason: "no-common-version",
      pending: [],
    });
  });

  test("refuses when the stream ends before any frame arrives", async () => {
    // §7.3 makes an absent hello a refusal. There is no reason token for "silence",
    // so it lands on no-common-version — we never learned a set to intersect with.
    expect(await performHandshake(scriptedPeer([]))).toEqual({
      ok: false,
      reason: "no-common-version",
      pending: [],
    });
  });

  test("accepts a final frame that end-of-stream delivered without its newline", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["1"]}']);
    expect(await performHandshake(io)).toEqual({ ok: true, version: "1", pending: [] });
  });

  test("honours an explicit localVersions over the SDK default", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["2","3"]}\n']);
    expect(await performHandshake(io, { localVersions: ["2", "3"] })).toEqual({
      ok: true,
      version: "3",
      pending: [],
    });
  });

  test("a frame read alongside the hello is returned in pending, not dropped", async () => {
    // §5 has both peers announce unprompted, so a peer's hello and its first request very
    // often land in the same chunk. NdjsonLineReader.push() extracts every complete frame a
    // chunk completes, not just the hello — so the second one must come back to the caller
    // rather than being discarded here.
    const io = scriptedPeer([
      '{"nimbus":"hello","contractVersions":["1"]}\n{"nimbus":"hello","contractVersions":["2"]}\n',
    ]);
    expect(await performHandshake(io)).toEqual({
      ok: true,
      version: "1",
      pending: ['{"nimbus":"hello","contractVersions":["2"]}'],
    });
  });

  test("three frames read alongside the hello all come back in pending, in order", async () => {
    // This is the case that proved re-buffering the extras through the reader wrong: push()
    // returns every complete frame in the chunk, and taking only frames[0] silently dropped
    // the rest. All of them must survive, in the order the peer sent them.
    const io = scriptedPeer([
      '{"nimbus":"hello","contractVersions":["1"]}\n{"a":1}\n{"b":2}\n{"c":3}\n',
    ]);
    expect(await performHandshake(io)).toEqual({
      ok: true,
      version: "1",
      pending: ['{"a":1}', '{"b":2}', '{"c":3}'],
    });
  });

  test("omitting reader still performs the handshake", async () => {
    // The option is genuinely optional: with nothing after the hello (as in every other
    // test here), performHandshake works exactly as it did before `reader` existed.
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["1"]}\n']);
    expect(await performHandshake(io)).toEqual({ ok: true, version: "1", pending: [] });
  });
});
