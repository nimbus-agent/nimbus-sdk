<!-- covers: connector-kit/fetch-bearer-json, connector-kit/mcp-tool-kit, connector-kit/rest-tool-kit, connector-kit/search-filter -->

# `connector-kit`

Dependency-free helpers for hand-rolled MCP connectors: registering a Zod-validated tool
against an MCP server, wrapping JSON fetch results into an MCP tool result, a
Bearer-auth REST fetcher with origin-locked URL resolution, and a case-insensitive
substring search filter for a "list" tool's `search`/`query` argument. Its own entry
point: `import { makeRestFetcher } from "@nimbus-dev/sdk/connector-kit"`.

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
- **`matchesResult` builds the `{ matches }` envelope search tools return**, and takes the
  unfiltered payload as `unknown`: a non-array `rows` (a fetch that failed shape, an API
  that paginates differently than expected) degrades to an empty match set rather than
  throwing. `makeQueryFilter` + `fieldsFromKeys` build the `SearchFilter` it takes as its
  second argument; `filterByQuery` is what actually walks the rows and caps the result at
  `limit` (default 50).
- **`searchToolInputSchema` deliberately is not here.** It would construct a Zod object
  schema for the `{ query, limit }` input, which needs a `zod` import — this module has
  none. Connectors that use `matchesResult` bring their own Zod schema for the tool's
  input shape.

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
- **`connector-kit/search-filter`** — `filterByQuery`, `makeQueryFilter` (build a
  `SearchFilter` from a `FieldExtractor`), `matchesResult` (wrap a filtered result into the
  `{ matches }` MCP envelope); field extractors `fieldsFromKeys`, `nestedString`,
  `stringField`, `tagText`, `tagNamesFromObjects`; row-shape guards `asObjectish`,
  `asRecord`. Types: `FilterByQueryOptions`, `FieldExtractor`, `SearchMatchOptions`,
  `SearchFilter`.

## Python binding

`nimbus_sdk.connector_kit` (`sdks/python/src/nimbus_sdk/connector_kit/`) is the Python
binding of this module — its own import root, deliberately not re-exported from
`nimbus_sdk`, mirroring the boundary this `./connector-kit` entry point has published
since `1.15.0`. Shipment 1 ships the pure core, six modules: `errors.py` (the
`ConnectorKitError` taxonomy), `urls.py` (`resolve_url_with_base`, binding
[`url-resolution.md`](../spec/connector-kit/v1/url-resolution.md) — the one corpus this
kit runs, executed by both bindings), `env.py` (`require_env`), `types.py`
(the `McpTextContent` / `McpToolResult` wire shapes), `results.py` (`json_result` and
its `*_if_ok` variants, plus `error_result`), and `search_filter.py` (the port of
`connector-kit/search-filter` above). The transport, the tool router, and `rest.py`'s
REST factories — this module's `mcp-tool-kit` registration path and `rest-tool-kit` —
are Shipment 2; see the Phase 3 box in [`ROADMAP.md`](../ROADMAP.md).

### Three exports with no Python counterpart

Stated so they read as decisions, not gaps:

- **`createRegisterSimpleTool` / `registerZodTool` / `ZodObjectSchema`** — superseded by
  the Shipment 2 router. Python's `mcp.Server` exposes no `.tool` method, so a
  duck-typed registrar built on top of it would match nothing that exists.
- **`fetchWithTimeout`** — `AbortSignal.any`'s signal-composition has no Python
  analogue; there is no stdlib or `asyncio` primitive that merges two cancellation
  sources into one the way `AbortSignal.any` does.
- **`McpListResult` as a type** — the Python return is a `TypedDict` (`McpToolResult`),
  not a class import, because `types.CallToolResult` is a pydantic model and this
  dependency-free package cannot duck-type a pydantic import the way a structural
  TypeScript type duck-types a Zod schema.

### Asymmetries in Python's favour

- **`require_env`'s `env` seam.** `require_env(name, env=os.environ)` takes the
  environment as a replaceable parameter; `requireProcessEnv` reads `process.env`
  directly with none. [`INCLUSION-POLICY.md`](../INCLUSION-POLICY.md) §2 requires a
  substitutable effect to be reachable through a caller-replaceable parameter — the
  Python binding meets that criterion where the TypeScript original does not. The
  TypeScript gap is recorded as a follow-up rather than replicated here for symmetry.
- **`HttpStatusError`'s `.status` / `.service` / `.snippet`.** TypeScript throws a bare
  `Error` on a non-2xx response, carrying only the formatted message. Python's
  `HttpStatusError` carries the three parts as attributes as well, so a caller can
  branch on `.status` without re-parsing the message string.
- **`error_result`.** TypeScript's kit has no counterpart, because its tool registrar
  turns a thrown error into the `{ content, isError }` shape itself. Python's
  Shipment 2 `ToolRouter` needs the builder directly, so it ships now with the rest of
  `results.py`.

### Divergences

- **Non-finite numbers: TypeScript is the outlier, not Python.** `json.dumps(...,
  allow_nan=False)` raises `ValueError` on `NaN` / `Infinity` / `-Infinity`, where
  `JSON.stringify` silently emits `null` for all three. This was recorded here as
  *Python's* divergence, which quietly treated TypeScript as the norm — and the third
  binding shows that reading was wrong. Go's `encoding/json` also errors on a non-finite
  float (`json: unsupported value: NaN`), and will do so through the Go kit's result
  builders when they land in its Shipment 2 — Go ships no `json_result` counterpart today,
  so this is a property of the stdlib the binding will use, not yet of shipped code. On
  that basis **two of the three bindings refuse and one substitutes**, and it is
  `JSON.stringify` that is the odd one out. Refusing is also the
  only behaviour that does not silently hand the other end a value it did not ask for: a
  connector that can produce a non-finite number in tool output should treat it as a bug
  in the tool, not paper over it with a decode-time `null`. Nothing about either
  binding's behaviour changes here; only which of them the sentence was framing as
  standard.
- **`as_objectish` diverges on a numeric-string key.** Its docstring states the fuller
  claim: normalising an array to `{}` is behaviourally identical to TypeScript's
  `asObjectish` for every *non-numeric* key — which is every field name this kit's own
  helpers ever read — but not for a numeric-string one. `asObjectish(["x", "y",
  "z"])["0"]` is `"x"` in JavaScript, because a numeric-string key indexes the array
  element; the Python equivalent, `{}.get("0")`, is always `None`. No extractor in
  `search_filter.py` reads a numeric-string key, so this divergence is never reached in
  practice, but it is a real one, not a hypothetical.
- **Case folding does *not* diverge.** `search_filter.py` uses `str.lower()`, never
  `.casefold()`, specifically because `casefold()` maps `ß` to `ss` where JavaScript's
  `toLowerCase()` leaves it alone — a real divergence trap the module's docstring
  documents and its test suite pins. `İ` (`U+0130`, dotted capital I) does **not** turn
  out to be a second one: measured on CPython 3.14.6 / Unicode 16.0.0 and Node 24.18.1,
  `str.lower()`, `str.casefold()`, and `String.prototype.toLowerCase()` all fold it to
  the same two code points, `U+0069 U+0307`. `ß` remains the only character on which
  `lower()` and `casefold()` themselves disagree.
