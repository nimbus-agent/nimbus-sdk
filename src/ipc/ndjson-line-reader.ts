/** Max bytes per NDJSON line (UTF-8), aligned with IPC protocol limits. */
export const IPC_MAX_LINE_BYTES = 1024 * 1024;

function byteLengthUtf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

const LINE_LIMIT_MESSAGE = "Message exceeds 1MB line limit";

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
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });
  private pending = "";
  private latched = false;

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

  push(chunk: Uint8Array): string[] {
    this.failIfLatched();
    this.pending += this.decoder.decode(chunk, { stream: true });
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
    const rest = this.pending + this.decoder.decode();
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
