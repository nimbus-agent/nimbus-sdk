/**
 * The handshake — the one exchange this package can perform end to end.
 *
 * Normative documents: `docs/spec/negotiation/v1/contract-version.md` §5 (the frame and the
 * order it is written in) and §6 (the algorithm), over `docs/spec/wire/v1/framing.md` §3.
 *
 * Streams are **injected**, never opened. This package performs no I/O, and a runtime that
 * owned its own would be untestable without spawning a process — which §8 says it cannot do.
 */

import { CONTRACT_VERSIONS, negotiateContractVersion } from "../contract-version.js";
import { encodeHello, type HelloRefusalReason, parseHello } from "./hello.js";
import { NdjsonLineReader } from "./ndjson-line-reader.js";

/**
 * Why a handshake failed.
 *
 * Wider than `ContractNegotiationResult`'s reason, deliberately: the exchange can fail at the
 * frame layer for any of the seven §5 reasons before negotiation is ever reached, and
 * collapsing those into `no-common-version` would discard what §5 went to the trouble of
 * naming. `"invalid-version"` is already a `HelloRefusalReason`, so the union needs no special
 * case for the one reason both layers produce.
 */
export type HandshakeRefusalReason = HelloRefusalReason | "no-common-version";

export type HandshakeResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly reason: HandshakeRefusalReason };

/**
 * The byte stream, supplied by the caller.
 *
 * `read` resolves `null` at end of stream. Neither method is given a timeout: §8 puts that
 * bound on "whatever supervises the process" and makes no value normative, so a caller who
 * wants one wraps this call.
 */
export interface HandshakeIo {
  read(): Promise<Uint8Array | null>;
  write(chunk: Uint8Array): Promise<void>;
}

export interface HandshakeOptions {
  /** Defaults to {@link CONTRACT_VERSIONS} — what this SDK speaks. */
  readonly localVersions?: readonly string[];

  /**
   * The reader to draw frames through. **Supply one to keep the session's bytes.**
   *
   * A peer announces unprompted (§5), so its hello and its first request very often arrive
   * in a single read. A reader created here and dropped on return would destroy whatever
   * followed the hello — complete frames and a half-buffered one alike — and nothing would
   * indicate it had happened. Passing your own keeps both.
   *
   * Omitting it is fine when nothing follows the handshake, such as in a test.
   */
  readonly reader?: NdjsonLineReader;
}

/**
 * Announce, listen, agree — or refuse.
 *
 * Returns the refusal rather than exiting. The caller owns the process and the exit code;
 * `CONTRACT_HANDSHAKE_EXIT` is exported for it.
 */
export async function performHandshake(
  io: HandshakeIo,
  options: HandshakeOptions = {},
): Promise<HandshakeResult> {
  const local = options.localVersions ?? CONTRACT_VERSIONS;

  // §5, and the order is load-bearing: our hello goes out before we read a single byte.
  // Both peers announce unprompted, so waiting for theirs first would deadlock two runtimes
  // against each other.
  await io.write(new TextEncoder().encode(`${encodeHello(local)}\n`));

  const reader = options.reader ?? new NdjsonLineReader();
  let peerFrame: string | undefined;

  while (peerFrame === undefined) {
    const chunk = await io.read();
    if (chunk === null) {
      // End of stream. A peer that stopped mid-frame may still have left a complete hello
      // without its terminating newline, so drain before giving up.
      peerFrame = reader.flushFrames().frames[0];
      break;
    }

    const frames = reader.push(chunk);
    peerFrame = frames[0];

    // §5 has both peers announce unprompted, so a peer's hello and its first request very
    // often arrive in the same read — `frames` can hold more than the hello alone. `push`
    // already extracted them, so re-buffer them in the (possibly caller-supplied) reader
    // rather than let them vanish here: a caller that passed its own `reader` still finds
    // them afterward, via that same reader, instead of losing the first message of the
    // session to a handshake that only meant to read one frame.
    const extra = frames.slice(1);
    if (peerFrame !== undefined && extra.length > 0) {
      reader.push(new TextEncoder().encode(extra.join("\n")));
    }
  }

  if (peerFrame === undefined) {
    // §7.3: an absent hello is a refusal. There is no token for silence, and we never
    // learned a set to intersect with, so this is the empty intersection.
    return { ok: false, reason: "no-common-version" };
  }

  const parsed = parseHello(peerFrame);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }

  const negotiated = negotiateContractVersion(local, parsed.contractVersions);
  if (!negotiated.ok) {
    return { ok: false, reason: negotiated.reason };
  }
  return { ok: true, version: negotiated.version };
}
