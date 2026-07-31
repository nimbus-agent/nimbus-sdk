/**
 * NimbusExtensionServer — base class for all Nimbus MCP extension servers
 *
 * Usage:
 *   const server = new NimbusExtensionServer({ manifest, onAuth });
 *   server.registerTool("search", { description, inputSchema, handler });
 *   server.start();
 */

import { type HandshakeIo, type HandshakeResult, performHandshake } from "./ipc/handshake.js";
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
   */
  handshake(io: HandshakeIo): Promise<HandshakeResult> {
    const { contractVersions } = this._options.manifest;
    return performHandshake(
      io,
      contractVersions === undefined ? {} : { localVersions: contractVersions },
    );
  }
}
