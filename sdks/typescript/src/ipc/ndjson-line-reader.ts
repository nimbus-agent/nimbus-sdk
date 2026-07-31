/** Max bytes per NDJSON line (UTF-8), aligned with IPC protocol limits. */
export const IPC_MAX_LINE_BYTES = 1024 * 1024;

function byteLengthUtf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

const LINE_LIMIT_MESSAGE = "Message exceeds 1MB line limit";

/**
 * U+FEFF, written as an escape so it is visible in source. Stripped only when it opens
 * the stream (`framing.md` §5); a mark appearing later is ordinary content, which §5
 * leaves to the binding.
 */
const BYTE_ORDER_MARK = "\uFEFF";

export type NdjsonLineReaderOptions = {
  /** When set, oversized lines throw this type instead of `Error`. */
  lineLimitError?: new (
    message: string,
  ) => Error;
};

/** What remained at end-of-stream, and whether the last frame lacked its newline. */
export type NdjsonFlushResult = {
  frames: string[];
  /** True when a frame was delivered that no newline terminated — the peer stopped mid-frame. */
  truncated: boolean;
};

/**
 * Buffers UTF-8 chunks and emits complete non-empty lines (trailing `\r` stripped).
 * Shared by Gateway JSON-RPC and the CLI IPC client.
 *
 * Exceeding the line limit is terminal: the reader latches and every later call throws,
 * so a peer cannot resynchronize it by following an oversized line with a newline.
 */
export class NdjsonLineReader {
  private readonly lineLimitCtor: new (
    message: string,
  ) => Error;
  /**
   * `ignoreBOM: true` means "do not strip the mark for us" — the stripping below is
   * ours. That is deliberate, not a way of keeping the BOM.
   *
   * Left to itself, the runtimes disagree. `framing.md` §5 makes ignoring a
   * start-of-stream BOM a **MUST**, and WHATWG scopes the BOM-seen flag to the
   * *stream*, so a mark split across chunks is still at the start. Node implements
   * that; Bun re-checks at the start of every streaming `decode()` call, so it kept
   * the mark when its octets arrived separately and stripped one arriving mid-stream.
   * `bun test` is what this repo runs, so the published binding was non-conformant on
   * the runtime that gates it, and the corpus could not see it —
   * `bom-at-stream-start-ignored` delivers its BOM in one chunk, which both runtimes
   * handle.
   *
   * Opting out of the runtime's own handling makes the behavior ours in every
   * environment, and matches `sdks/python/src/nimbus_sdk/ipc/ndjson.py`, whose codec
   * never stripped it in the first place.
   */
  private readonly decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
  private pending = "";
  private latched = false;
  /** Set by the first *non-empty* decoded output — see {@link decode}. */
  private streamStarted = false;

  constructor(opts: NdjsonLineReaderOptions = {}) {
    this.lineLimitCtor = opts.lineLimitError ?? Error;
  }

  private throwLineTooLong(message: string): never {
    this.latched = true;
    this.pending = "";
    throw new this.lineLimitCtor(message);
  }

  private failIfLatched(): void {
    if (this.latched) {
      throw new this.lineLimitCtor(LINE_LIMIT_MESSAGE);
    }
  }

  /**
   * Decode, stripping a byte-order mark only when it opens the stream.
   *
   * Keyed to the first **non-empty** output rather than the first call: decoding the
   * first octet of a mark yields `""` while the decoder buffers the rest, so a
   * call-keyed flag would consider the stream started and let the mark through once
   * its remaining octets arrived. That is exactly the case Bun got wrong.
   */
  private decode(chunk: Uint8Array, stream: boolean): string {
    let text = this.decoder.decode(chunk, { stream });
    if (text.length > 0 && !this.streamStarted) {
      this.streamStarted = true;
      if (text.startsWith(BYTE_ORDER_MARK)) {
        text = text.slice(1);
      }
    }
    return text;
  }

  push(chunk: Uint8Array): string[] {
    this.failIfLatched();
    this.pending += this.decode(chunk, true);
    const out: string[] = [];
    while (true) {
      const nl = this.pending.indexOf("\n");
      if (nl < 0) {
        break;
      }
      const line = this.pending.slice(0, nl);
      this.pending = this.pending.slice(nl + 1);
      const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (trimmed.length === 0) {
        continue;
      }
      if (byteLengthUtf8(trimmed) > IPC_MAX_LINE_BYTES) {
        this.throwLineTooLong(LINE_LIMIT_MESSAGE);
      }
      out.push(trimmed);
    }
    if (byteLengthUtf8(this.pending) > IPC_MAX_LINE_BYTES) {
      this.throwLineTooLong(LINE_LIMIT_MESSAGE);
    }
    return out;
  }

  /**
   * Drain what is buffered at end-of-stream. An empty remainder yields no frame, so a
   * stream ending in a bare `\r` reports nothing rather than an empty string.
   */
  flushFrames(): NdjsonFlushResult {
    this.failIfLatched();
    // Through `decode` too: a stream carrying nothing but an incomplete sequence
    // reaches its first non-empty output here, at the final flush, not in any push.
    const rest = this.pending + this.decode(new Uint8Array(0), false);
    this.pending = "";
    if (byteLengthUtf8(rest) > IPC_MAX_LINE_BYTES) {
      this.throwLineTooLong(LINE_LIMIT_MESSAGE);
    }
    const frame = rest.endsWith("\r") ? rest.slice(0, -1) : rest;
    if (frame.length === 0) {
      return { frames: [], truncated: false };
    }
    return { frames: [frame], truncated: true };
  }

  flush(): string[] {
    return this.flushFrames().frames;
  }
}
