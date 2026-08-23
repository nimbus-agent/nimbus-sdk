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
`connector-kit/search-filter` above). Shipment 2 added the rest — `transport.py`
(`HttpRequest` / `HttpResponse`, the `Transport` Protocol, `UrllibTransport`),
`router.py` (`ToolRouter`) and `rest.py` (`make_rest_fetcher`, `make_rest_tool`) —
so the binding now covers this module's `mcp-tool-kit` registration path and its
`rest-tool-kit`, at **42** exported names.

### Three exports with no Python counterpart

Stated so they read as decisions, not gaps:

- **`createRegisterSimpleTool` / `registerZodTool` / `ZodObjectSchema`** — superseded by
  `ToolRouter`. Python's `mcp.Server` exposes no `.tool` method, so a duck-typed
  registrar built on top of it would match nothing that exists; the router registers
  tools itself and hands back wire shapes, and the generated connector adapts those into
  pydantic in two generic functions.
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
  turns a thrown error into the `{ content, isError }` shape itself. `ToolRouter` needs
  the builder directly — it is what the unknown-tool, failed-validation and
  handler-exception paths return rather than letting any of them escape.

### Divergences

- **Non-finite numbers: TypeScript is the outlier, not Python.** `json.dumps(...,
  allow_nan=False)` raises `ValueError` on `NaN` / `Infinity` / `-Infinity`, where
  `JSON.stringify` silently emits `null` for all three. This was recorded here as
  *Python's* divergence, which quietly treated TypeScript as the norm — and the third
  binding shows that reading was wrong. Go's `encoding/json` also errors on a non-finite
  float (`json: unsupported value: NaN`), and now does so through the Go kit's own
  `JSONResult`, which returns that error rather than a result — measured on Go 1.27
  against shipped code, no longer a prediction about a binding that did not exist. On
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
- **Case folding diverges, but not between these two.** `search_filter.py` uses
  `str.lower()`, never `.casefold()`, specifically because `casefold()` maps `ß` to `ss`
  where JavaScript's `toLowerCase()` leaves it alone — a real divergence trap the module's
  docstring documents and its test suite pins. `İ` (`U+0130`, dotted capital I) **is** a
  second one, and it belongs to Go: on CPython 3.14.6 / Unicode 16.0.0 and Node 24.18.1,
  `str.lower()`, `str.casefold()`, and `String.prototype.toLowerCase()` all fold it to the
  same two code points, `U+0069 U+0307`, but **Go 1.27's `strings.ToLower` folds it to a
  bare `U+0069`**, because it applies Unicode's *simple* case mapping where the other two
  apply the full one. The measured consequence is a search returning different rows: a
  query of `istanbul` matches a row reading `İstanbul Office` in a naive Go port and
  matches nothing in the other two. The Go kit corrects it with a one-rune replacer, and a
  test sweeps every scalar value to keep the correction complete — a sweep of all
  0x110000 found `U+0130` to be the only real disagreement, the other 28 being Go's Unicode
  17.0.0 against CPython's 16.0.0 on code points unassigned in 16. `ß` remains the only
  character on which `lower()` and `casefold()` themselves disagree.

## Go binding

`connectorkit` (`sdks/go/connectorkit/`) is the Go binding of this module — **one package
where Python has six modules**, because Python's own `__all__` already flattens that
boundary for a caller and Go prefers fewer, larger packages. The file names match Python's
module names one-for-one so the two read side by side. It ships Python's Shipment 1 core
and nothing beyond it: `ResolveURLWithBase` (binding
[`url-resolution.md`](../spec/connector-kit/v1/url-resolution.md), whose 28-case corpus all
three bindings now execute), `RequireEnv`, the `MCPTextContent` / `MCPToolResult` wire
shapes, the result builders, and the search filter. Shipment 2 added the transport
(`Transport`, `HTTPTransport`, `NewHTTPTransport`), `ToolRouter`, and the REST factories
(`MakeRESTFetcher`, `MakeRESTTool`), so the two bindings cover the same ground.

Python's **42** exported names map to **76** Go ones. Most of that gap is accounting
rather than surface: a Python class with methods is one name in `__all__` and several in
Go's walker, which lists each exported method separately. Three additions are real, and
every one exists because Go lacks something Python has.

`ConnectorKitError` splits: Go has no exception hierarchy, so the `except` target becomes
the sentinel `ErrConnectorKit`, reachable with `errors.Is`, and the concrete carrier for
the one site that raises the base class directly becomes `connectorkit.Error` — the shape
`url.Error` and `net.Error` already have. `ErrTransport` is the same split a second time,
standing in for the subclassing that makes Python's `except TransportError` catch a
timeout too; both transport errors list it from a multi-error `Unwrap`, alongside the
cause, so `errors.Is` answers for the taxonomy and the original failure at once.

`RedactedURL` is exported for a blunter reason: Python redacts a credential inside
`TransportError.__init__`, where no raise site can forget, and Go has no constructor to
put that in. Exporting the helper makes it one call at each construction site instead of
a habit — and it is a call a custom transport needs too, since `TransportError.URL` is a
field a caller may well log.

Initialisms follow Go's convention: `ResolveURLWithBase`, `JSONResult`, `MCPToolResult`,
`HTTPStatusError`, `NewHTTPTransport`.

### Asymmetries in Go's favour

- **`RequireEnv`'s seam is a function, not a mapping.** `RequireEnv(name, env)` takes
  `func(string) string`, which is exactly `os.Getenv`'s signature — so the standard library
  supplies the default implementation and `nil` selects it, making the common call
  `RequireEnv("API_TOKEN", nil)`. It meets
  [`INCLUSION-POLICY.md`](../INCLUSION-POLICY.md) §2 the same way Python's `Mapping`
  parameter does, and a read-only function gives a caller no seam that invites writing to
  the environment.
- **Every kit error answers `errors.Is` and `errors.As`.** Python's taxonomy is catchable
  as a group, but its parts are reachable only on `HttpStatusError`; in Go all four types
  carry their parts as exported fields.
- **`Transport.Send` takes a `context.Context`**, where Python's `send` takes the request
  alone. `ToolRouter.CallTool` already takes one and hands it to the `Handler`, so without
  it the context would stop at the handler and a cancelled tool call could not cancel the
  HTTP request under it. Go has a cancellation primitive worth binding to and Python has
  none — the reasoning that put `io.Reader` in `ipc.PerformHandshake`. Two deadlines then
  exist, the caller's and `HTTPRequest.Timeout`, and the shorter wins. Cancellation and
  expiry stay distinct: `context.DeadlineExceeded` is a `*TransportTimeoutError`,
  `context.Canceled` a plain `*TransportError`, because a retry loop that read the second
  as the first would retry work the caller had just abandoned.

### Divergences

- **Object key order: Go is the outlier, and this one is *not* corrected.**
  `encoding/json` sorts a map's keys, so `JSONResult` of
  `{"zulu":1,"alpha":2,"mike":3}` emits `alpha`, `mike`, `zulu` where `json.dumps` and
  `JSON.stringify` both emit insertion order. Measured on Go 1.27, CPython 3.14.6 and Node
  v24.18.1. It is **not fixable** rather than merely unfixed: a Go map records no insertion
  order at all, so there is none to preserve, and matching the other two would mean putting
  an ordered-map type into a dependency-free package and threading it through every
  caller's payload — redesigning a published surface to change how a text block renders.
  The consequence is confined to reading: it is the same JSON object with the same members,
  and any consumer that parses it is unaffected. A caller who needs a specific order can
  pass a struct, whose fields marshal in declaration order.
- **The snippet caps count code points, matching Python.** Stated because the obvious Go
  spelling does not: a Go string index counts bytes, so `text[:300]` truncated a body of
  200 two-octet characters to 150 where Python's `text[:300]` returns it whole, and an odd
  offset splits a sequence so the message ends in U+FFFD. `snippet` slices `[]rune`.
  TypeScript's `.slice(0, n)` counts UTF-16 code units, so it agrees across the BMP and can
  still split a surrogate pair above it.
- **`normalizeCap` clamps before converting to `int`.** Converting an out-of-range
  `float64` to `int` is implementation-defined in Go and yields `math.MinInt64` on amd64,
  which is neither zero nor caught by a negative check made on the float — so `limit=1e19`
  over five matching rows returned **1** row where Python returns **5**, silently. Python
  has no equivalent edge, because `math.floor` returns an arbitrary-precision `int`.
