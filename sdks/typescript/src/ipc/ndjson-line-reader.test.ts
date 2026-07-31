import { describe, expect, test } from "bun:test";

import { IPC_MAX_LINE_BYTES, NdjsonLineReader } from "./ndjson-line-reader.js";

describe("NdjsonLineReader — the byte-order mark", () => {
  const BODY = '{"a":1}\n';
  const bom = (...bytes: number[]): Uint8Array => new Uint8Array(bytes);
  const body = (): Uint8Array => new TextEncoder().encode(BODY);
  const both = (head: number[]): Uint8Array =>
    new Uint8Array([...head, ...new TextEncoder().encode(BODY)]);

  test("strips a BOM delivered whole in the first chunk", () => {
    const r = new NdjsonLineReader();
    expect(r.push(both([0xef, 0xbb, 0xbf]))).toEqual(['{"a":1}']);
  });

  test("strips a BOM split across chunks", () => {
    // `framing.md` §5 makes ignoring a start-of-stream BOM a MUST, and the mark is
    // still at the very start of the stream when its octets arrive separately —
    // nothing has been emitted before them.
    //
    // This is not hypothetical. Bun's TextDecoder re-checks for a BOM at the start of
    // every streaming `decode()` call rather than once per stream, so before the
    // accompanying fix this reader returned '\uFEFF{"a":1}' under `bun test` — the
    // runtime this repo's suite actually runs on — while behaving correctly under
    // Node. The corpus cannot catch it: `bom-at-stream-start-ignored` delivers its
    // BOM in a single chunk, which both runtimes handle.
    const r = new NdjsonLineReader();
    expect(r.push(bom(0xef))).toEqual([]);
    expect(r.push(bom(0xbb))).toEqual([]);
    expect(r.push(both([0xbf]))).toEqual(['{"a":1}']);
  });

  test("strips a BOM split two-and-two", () => {
    const r = new NdjsonLineReader();
    expect(r.push(bom(0xef, 0xbb))).toEqual([]);
    expect(r.push(both([0xbf]))).toEqual(['{"a":1}']);
  });

  test("does not strip a BOM that arrives mid-stream", () => {
    // §5 leaves mid-stream behaviour undefined and permits either answer; this pins
    // the one this binding chose, so the two runtimes cannot disagree about it.
    const r = new NdjsonLineReader();
    expect(r.push(body())).toEqual(['{"a":1}']);
    expect(r.push(new TextEncoder().encode("\uFEFFsecond\n"))).toEqual(["\uFEFFsecond"]);
  });

  test("leaves a stream without a BOM untouched", () => {
    const r = new NdjsonLineReader();
    expect(r.push(body())).toEqual(['{"a":1}']);
  });
});

describe("NdjsonLineReader", () => {
  test("emits non-empty lines and skips blanks", () => {
    const r = new NdjsonLineReader();
    const lines = r.push(new TextEncoder().encode('{"a":1}\n\n{"b":2}\n'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("throws when a line exceeds IPC_MAX_LINE_BYTES", () => {
    const r = new NdjsonLineReader();
    const huge = `${"x".repeat(IPC_MAX_LINE_BYTES + 1)}\n`;
    expect(() => r.push(new TextEncoder().encode(huge))).toThrow("Message exceeds 1MB line limit");
  });

  test("buffers a partial line across push() calls", () => {
    const r = new NdjsonLineReader();
    const enc = new TextEncoder();
    expect(r.push(enc.encode('{"a"'))).toEqual([]);
    expect(r.push(enc.encode(":1}\n"))).toEqual(['{"a":1}']);
  });
  test("strips a trailing carriage return", () => {
    const r = new NdjsonLineReader();
    expect(r.push(new TextEncoder().encode('{"a":1}\r\n'))).toEqual(['{"a":1}']);
  });
  test("decodes multi-byte UTF-8 split across chunk boundaries", () => {
    const r = new NdjsonLineReader();
    const full = new TextEncoder().encode('"é"\n');
    const cut = 2;
    expect(r.push(full.slice(0, cut))).toEqual([]);
    expect(r.push(full.slice(cut))).toEqual(['"é"']);
  });
  test("flush() returns a pending line with no trailing newline", () => {
    const r = new NdjsonLineReader();
    r.push(new TextEncoder().encode("partial"));
    expect(r.flush()).toEqual(["partial"]);
  });
  test("flush() strips a trailing carriage return", () => {
    const r = new NdjsonLineReader();
    r.push(new TextEncoder().encode("partial\r"));
    expect(r.flush()).toEqual(["partial"]);
  });
  test("flush() returns [] when nothing is pending", () => {
    expect(new NdjsonLineReader().flush()).toEqual([]);
  });
  test("throws when the pending buffer (no newline yet) exceeds the limit", () => {
    const r = new NdjsonLineReader();
    const huge = "x".repeat(IPC_MAX_LINE_BYTES + 1);
    expect(() => r.push(new TextEncoder().encode(huge))).toThrow("Message exceeds 1MB line limit");
  });
  test("uses the custom lineLimitError constructor", () => {
    class TooBig extends Error {}
    const r = new NdjsonLineReader({ lineLimitError: TooBig });
    const huge = `${"x".repeat(IPC_MAX_LINE_BYTES + 1)}\n`;
    expect(() => r.push(new TextEncoder().encode(huge))).toThrow(TooBig);
  });
  test("flush() drains a partial multi-byte codepoint held by the decoder", () => {
    const r = new NdjsonLineReader();
    expect(r.push(new Uint8Array([0xc3]))).toEqual([]);
    expect(r.flush()).toEqual(["�"]);
  });

  test("flush() drops a remainder that is empty after stripping the carriage return", () => {
    const r = new NdjsonLineReader();
    r.push(new TextEncoder().encode("\r"));
    expect(r.flush()).toEqual([]);
  });

  test("flushFrames() flags a final frame that had no newline", () => {
    const r = new NdjsonLineReader();
    r.push(new TextEncoder().encode("partial"));
    expect(r.flushFrames()).toEqual({ frames: ["partial"], truncated: true });
  });

  test("flushFrames() does not flag a stream that ended on a newline", () => {
    const r = new NdjsonLineReader();
    r.push(new TextEncoder().encode("whole\n"));
    expect(r.flushFrames()).toEqual({ frames: [], truncated: false });
  });

  test("flushFrames() does not flag a remainder that normalizes to empty", () => {
    const r = new NdjsonLineReader();
    r.push(new TextEncoder().encode("\r"));
    expect(r.flushFrames()).toEqual({ frames: [], truncated: false });
  });

  test("a line-limit violation latches — a later push throws rather than resuming", () => {
    const r = new NdjsonLineReader();
    const huge = "x".repeat(IPC_MAX_LINE_BYTES + 1);
    expect(() => r.push(new TextEncoder().encode(`good\n${huge}\ntail\n`))).toThrow(
      "Message exceeds 1MB line limit",
    );
    expect(() => r.push(new TextEncoder().encode("after\n"))).toThrow(
      "Message exceeds 1MB line limit",
    );
  });

  test("a latched reader throws from flush() too", () => {
    const r = new NdjsonLineReader();
    const huge = `${"x".repeat(IPC_MAX_LINE_BYTES + 1)}\n`;
    expect(() => r.push(new TextEncoder().encode(huge))).toThrow("Message exceeds 1MB line limit");
    expect(() => r.flush()).toThrow("Message exceeds 1MB line limit");
  });

  test("the latch raises the custom lineLimitError constructor", () => {
    class TooBig extends Error {}
    const r = new NdjsonLineReader({ lineLimitError: TooBig });
    const huge = `${"x".repeat(IPC_MAX_LINE_BYTES + 1)}\n`;
    expect(() => r.push(new TextEncoder().encode(huge))).toThrow(TooBig);
    expect(() => r.push(new TextEncoder().encode("after\n"))).toThrow(TooBig);
  });
});
