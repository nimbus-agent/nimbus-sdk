import { type ExtensionManifest, NimbusExtensionServer } from "@nimbus-dev/sdk";

export const manifest: ExtensionManifest = {
  id: "quickstart-connector",
  displayName: "Quickstart Connector",
  version: "0.1.0",
  description: "The smallest connector that satisfies the Nimbus contract.",
  author: "Nimbus Contributors",
  entrypoint: "./index.ts",
  runtime: "bun",
  permissions: ["read"],
  hitlRequired: [],
  minNimbusVersion: "0.1.0",
};

export const TOOLS = [{ name: "echo", description: "Echoes its input" }] as const;

export async function echoHandler(input: { text: string }): Promise<{ text: string }> {
  return input;
}

const server = new NimbusExtensionServer({ manifest });

server.registerTool("echo", {
  description: "Echoes its input",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  handler: echoHandler,
});

server.start();
