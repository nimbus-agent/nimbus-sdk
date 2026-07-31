<!-- covers: connector-kit/fetch-bearer-json, connector-kit/mcp-tool-kit, connector-kit/rest-tool-kit -->

# `connector-kit`

Dependency-free helpers for hand-rolled MCP connectors: registering a Zod-validated tool
against an MCP server, wrapping JSON fetch results into an MCP tool result, and a
Bearer-auth REST fetcher with origin-locked URL resolution. Its own entry point:
`import { makeRestFetcher } from "@nimbus-dev/sdk/connector-kit"`.

## When you reach for it

When you are writing an MCP connector by hand — not through a framework that already
wraps these concerns — against a Bearer-token REST API (GitHub, Gmail, Outlook, and
similar). It has no runtime dependencies (no `zod` import, no HTTP client), so it works
standalone outside the Nimbus monorepo: `ZodObjectSchema<T>` is a structural type any
Zod object schema already satisfies, not an import of `zod` itself.

## Constraints that are load-bearing

- **`resolveUrlWithBase` is the SSRF chokepoint.** A relative path is prefixed with the
  base URL. An absolute URL is only accepted when it shares the base's origin — this is
  what stops a caller-supplied pagination link (`@odata.nextLink` and similar) from
  redirecting a credential-bearing fetch at an attacker-controlled host. A cross-origin or
  malformed absolute URL throws and is never fetched. `makeRestFetcher`'s returned fetcher
  routes every call through it.
- **`ZodObjectSchema<T>` avoids importing `zod`.** It is a structural type — `{ shape,
  safeParse }` — matched by a real Zod object schema without this module depending on the
  `zod` package. `createZodToolRegistrar` / `registerZodTool` build the parse-or-throw
  wrapper `server.tool` expects on top of it.
- **`RegisterSimpleToolFn` is typed `unknown` on purpose.** Its `inputShape` parameter
  matches the shape MCP's `server.tool` takes for Zod raw fields, but is typed as
  `Record<string, unknown>` rather than importing an MCP SDK type, for the same
  dependency-free reason.
- **The `*IfOk` helpers throw with a status + body snippet, never a silent failure.**
  `mcpJsonResultIfOk` and `mcpJsonResultFromTextIfOk` both throw
  `` `${serviceLabel} ${status}: ${snippet}` `` on a non-`ok` response instead of returning
  something wrapped-but-empty. `parseJsonTextIfOk` is the same check without the MCP
  wrapping, for composing a multi-part tool result.
- **`fetchWithTimeout` composes signals instead of clobbering them.** A caller-supplied
  `init.signal` is combined with the timeout's own via `AbortSignal.any`, so a caller can
  still cancel independently of the timeout.
- **`encodeBasicAuthHeader` never logs the raw credential.** It returns the finished
  `Basic <base64>` header value; callers should treat the return value itself as
  sensitive.
- **`makeRestToolRegistrar` is a factory for the repeated tool body**, not a tool
  registrar itself: `requireProcessEnv(tokenEnv)` → `fetch(token, buildPath(args))` →
  `mcpJsonResultIfOk(serviceLabel, res)`. Tools with a non-standard tail — custom error
  text, 204-tolerance, a raw-text response — stay hand-written against the connector's own
  registrar rather than going through it.

## Example

```ts
import {
  createZodToolRegistrar,
  encodeBasicAuthHeader,
  makeRestFetcher,
  mcpJsonResultIfOk,
  type RegisterSimpleToolFn,
  requireProcessEnv,
  type ZodObjectSchema,
} from "@nimbus-dev/sdk/connector-kit";

type ListIssuesArgs = { project: string };

/** Stands in for a real `z.object({ project: z.string() })` — same shape, no zod import. */
const listIssuesSchema: ZodObjectSchema<ListIssuesArgs> = {
  shape: { project: {} },
  safeParse: (args) =>
    typeof args === "object" && args !== null && "project" in args
      ? { success: true, data: args as ListIssuesArgs }
      : { success: false, error: { message: "project is required" } },
};

export function registerTools(registerSimpleTool: RegisterSimpleToolFn): void {
  const reg = createZodToolRegistrar(registerSimpleTool);
  const fetchIssue = makeRestFetcher({
    apiBase: "https://api.example.com",
    token: requireProcessEnv("EXAMPLE_TOKEN"),
  });

  reg("list_issues", "List open issues for a project.", listIssuesSchema, async (args) => {
    const res = await fetchIssue(`/projects/${args.project}/issues`);
    return mcpJsonResultIfOk("example", res);
  });
}

/** For services (e.g. Atlassian) that take email:API-token Basic auth instead of Bearer. */
export const basicAuthHeader: string = encodeBasicAuthHeader("user@example.com", "token");
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.

- **`connector-kit/mcp-tool-kit`** — `mcpJsonResult`, `mcpJsonResultIfOk`,
  `mcpJsonResultFromTextIfOk`, `parseJsonTextIfOk` (wrapping a fetch result for MCP, or
  throwing on a non-`ok` response); `registerZodTool`, `createZodToolRegistrar`,
  `createRegisterSimpleTool` (the Zod-validated tool-registration path);
  `putOptionalNonEmptyString`, `putOptionalBoolean` (conditionally set a request-body
  field); `requireProcessEnv` (read an env var or throw); `fetchWithTimeout`
  (`AbortSignal`-composing fetch wrapper); `encodeBasicAuthHeader`. Types:
  `McpListResult`, `ZodObjectSchema`, `RegisterSimpleToolFn`, `HttpTextResponse`,
  `HttpJsonBodyResponse`.
- **`connector-kit/fetch-bearer-json`** — `fetchBearerAuthorizedJson` (Bearer-auth JSON
  fetch, merging caller headers over the `Authorization` default), `resolveUrlWithBase`
  (the origin-locked path/URL resolver). Type: `BearerJsonFetchResult`.
- **`connector-kit/rest-tool-kit`** — `makeRestFetcher` (binds a `RestFetcherConfig` into
  a `resolveUrlWithBase` + `fetchBearerAuthorizedJson` fetcher), `makeRestToolRegistrar`
  (the standard-tool-body factory described above). Types: `RestFetchResult`,
  `RestFetcherConfig`, `RestToolRegistrar`.
