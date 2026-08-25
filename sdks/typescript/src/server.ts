/**
 * NimbusExtensionServer — base class for all Nimbus MCP extension servers
 *
 * @moduleStability stable
 *
 * Usage:
 *   const server = new NimbusExtensionServer({ manifest, onAuth });
 *   server.registerTool("search", { description, inputSchema, handler });
 *   server.start();
 */

import { V1_ABSENCE_DEFAULT } from "./contract-version.js";
import {
  type HandshakeIo,
  type HandshakeOptions,
  type HandshakeResult,
  performHandshake,
} from "./ipc/handshake.js";
import type { ExtensionManifest } from "./types.js";

export interface ExtensionServerOptions<TClient> {
  manifest: ExtensionManifest;
  onAuth?: (ctx: { accessToken: string }) => TClient;
}

export interface ToolDefinition<TInput, TClient> {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: TInput, ctx: { client: TClient }) => Promise<unknown>;
}

export class NimbusExtensionServer<TClient = unknown> {
  private readonly _options: ExtensionServerOptions<TClient>;

  constructor(options: ExtensionServerOptions<TClient>) {
    this._options = options;
  }

  registerTool<TInput>(_name: string, _definition: ToolDefinition<TInput, TClient>): void {
    // Roadmap Q3: register tool with MCP server
  }

  start(): void {
    if (this._options.manifest.id.length === 0) {
      throw new Error("NimbusExtensionServer: manifest.id is required");
    }
  }

  /**
   * Perform the contract-version handshake over a caller-supplied stream.
   *
   * A thin delegate to {@link performHandshake}: the logic lives in a free function so both
   * language bindings can be held to it identically, and so this class does not become the
   * only way to reach it.
   *
   * Deliberately **not** part of {@link start}. `start()` is called with no arguments in the
   * published examples and in `docs/modules/server.md`; giving it a required parameter would
   * be a breaking change to a package whose value is being stable.
   *
   * Stores nothing. There is no other operation to gate — `registerTool` is still a stub —
   * and the caller holds the result, which is the only thing that needs it.
   *
   * Announces the manifest's declared set, and {@link V1_ABSENCE_DEFAULT} — not
   * {@link CONTRACT_VERSIONS} — when the manifest is silent. §7's second refusal cause obliges
   * a connector's hello to equal its own declaration, and §4 fixes what a silent manifest
   * declares at `["1"]` forever. Letting `performHandshake`'s own default apply instead would
   * announce whatever this SDK happens to speak, so the day a second major ships every manifest
   * predating the field would announce a set it never declared — a `declaration-mismatch`
   * compiled into published surface rather than a bug anyone introduced.
   *
   * `options.reader` is forwarded to {@link performHandshake} and exists for the same reason
   * it does there: a peer announces unprompted (§5), so its hello and its first request often
   * arrive in one read, and a frame the peer left *incomplete* in that chunk is recoverable
   * only from the reader that buffered it. `pending` returns the complete frames, but a reader
   * this method created and dropped would take the partial one with it silently. Without this
   * parameter a connector reaching the handshake through this class had no way to keep it —
   * the recovery `docs/modules/ipc.md` tells callers to use was structurally unreachable here.
   *
   * Only `reader` is accepted. `localVersions` is the manifest's to declare, and letting a
   * caller pass it here would let the running hello contradict the manifest — the §7
   * `declaration-mismatch` this method exists to make impossible.
   */
  handshake(io: HandshakeIo, options?: Pick<HandshakeOptions, "reader">): Promise<HandshakeResult> {
    const localVersions = this._options.manifest.contractVersions ?? V1_ABSENCE_DEFAULT;
    const reader = options?.reader;
    // Built by branch rather than spread: `exactOptionalPropertyTypes` is on, so
    // `{ reader: undefined }` is not assignable to `reader?: NdjsonLineReader` — the key
    // must be absent, not present and undefined.
    return performHandshake(
      io,
      reader === undefined ? { localVersions } : { localVersions, reader },
    );
  }
}
