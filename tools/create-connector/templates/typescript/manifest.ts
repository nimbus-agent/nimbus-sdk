import type { ExtensionManifest } from "@nimbus-dev/sdk";

export const manifest: ExtensionManifest = {
  id: "nimbus-quickstart-connector",
  displayName: "Nimbus Quickstart Connector",
  version: "0.1.0",
  description: "A Nimbus connector that echoes what it is given.",
  author: "you",
  entrypoint: "./dist/main.js",
  runtime: "node",
  permissions: ["read"],
  hitlRequired: [],
  /**
   * The contract majors this connector speaks. Optional in `ExtensionManifest` — absence means
   * `["1"]` — but declared here because `main.ts` reads it, and a field the code depends on
   * should be visible in the file an author edits rather than implied by a default.
   */
  contractVersions: ["1"],
  minNimbusVersion: "0.1.0",
};

/**
 * The tool surface, in the shape `assertNoRowDataTools` inspects.
 *
 * Keep names free of row-data segments — a connector indexes metadata; record bodies stay on
 * the system they came from.
 */
export const TOOLS = [{ name: "echo", description: "Echoes its input" }] as const;
