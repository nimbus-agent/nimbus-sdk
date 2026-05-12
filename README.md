# @nimbus-dev/sdk

## What this is

MIT-licensed SDK for authoring Nimbus Model Context Protocol (MCP) connectors. This library provides TypeScript types, base classes, and request-routing primitives to build connectors that run on the Nimbus Gateway.

## Install

```bash
npm install @nimbus-dev/sdk
```

## Quickstart

```typescript
import { McpServer } from "@nimbus-dev/sdk";

const server = new McpServer("my-connector");

server.registerTool("echo", "Echoes input", async (input) => {
  return { result: input };
});

server.start();
```

## See also

- [Nimbus Developer Guide](https://nimbus-agent.dev/)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)

## License

MIT
