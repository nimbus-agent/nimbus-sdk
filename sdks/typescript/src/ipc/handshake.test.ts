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
    expect(await performHandshake(io)).toEqual({ ok: true, version: "1" });
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
    expect(await performHandshake(io)).toEqual({ ok: true, version: "1" });
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
      expect(await performHandshake(scriptedPeer([frame]))).toEqual({ ok: false, reason });
    }
  });

  test("refuses no-common-version when the sets are disjoint", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["2"]}\n']);
    expect(await performHandshake(io)).toEqual({ ok: false, reason: "no-common-version" });
  });

  test("refuses when the stream ends before any frame arrives", async () => {
    // §7.3 makes an absent hello a refusal. There is no reason token for "silence",
    // so it lands on no-common-version — we never learned a set to intersect with.
    expect(await performHandshake(scriptedPeer([]))).toEqual({
      ok: false,
      reason: "no-common-version",
    });
  });

  test("accepts a final frame that end-of-stream delivered without its newline", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["1"]}']);
    expect(await performHandshake(io)).toEqual({ ok: true, version: "1" });
  });

  test("honours an explicit localVersions over the SDK default", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["2","3"]}\n']);
    expect(await performHandshake(io, { localVersions: ["2", "3"] })).toEqual({
      ok: true,
      version: "3",
    });
  });
});
