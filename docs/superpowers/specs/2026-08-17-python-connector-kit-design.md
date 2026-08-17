# Python `connector-kit` — design

**Date:** 2026-08-17
**Roadmap:** Phase 3, "A Python `connector-kit`" (Pillar 3)
**Status:** approved design; implementation split into two shipments

## Problem

TypeScript publishes `@nimbus-dev/sdk/connector-kit`. `nimbus-dev-sdk` publishes no
equivalent, so every Python connector re-derives the same glue. The generated Python
connector says so in its own words — `tools/create-connector/templates/python/src/nimbus_quickstart_connector/main.py`
carries a docstring paragraph explaining that `_on_list_tools`, `_on_call_tool` and
`_json_result` sit inline because "a scaffold is not where a new published surface gets
designed."

This design is where that surface gets designed.

## Goal and non-goals

**Goal:** a `nimbus_sdk.connector_kit` import root at full parity with the TypeScript
kit — the pure helpers, an MCP dispatch router, and a working Bearer-auth REST fetcher —
so a Python connector author reaches for the same capabilities a TypeScript author does.

**Non-goals:**

- A Python surface-snapshot CI gate. The four gates named in `CLAUDE.md` read TypeScript
  only, and this kit roughly doubles Python's public surface with nothing gating it
  beyond `__all__` and `mypy --strict`. That is a real gap and it is recorded in
  [Follow-ups](#follow-ups), not closed here.
- Porting the batteries (`crypto`, `icalendar`, `data-profile`, …). Separate roadmap box.
- A Python diagnostics emitter. Separate, already-tracked asymmetry.

## The kit does not port uniformly

The TypeScript kit's four modules divide by what Python inherits for free from its
runtime, and that division — not TypeScript's file layout — is what this design follows.

| TS module | Python story |
| --- | --- |
| `search-filter` | Pure. No I/O, no MCP, no `zod`. Ports 1:1. |
| `fetch-bearer-json` | `resolveUrlWithBase` is pure and ports. `fetchBearerAuthorizedJson` needs an HTTP client; JS has a global `fetch`, Python's dependency-free option is `urllib.request`, which is synchronous. |
| `mcp-tool-kit` | Splits three ways: pure helpers, a fetch-bound helper, and the `zod` structural-typing trio. |
| `rest-tool-kit` | Composes the fetch-bound parts, so it inherits their problem. |

Two structural facts drive most decisions below:

1. **The structural-typing trick does not survive the port.** TypeScript avoids importing
   `zod` because `ZodObjectSchema` is `{ shape, safeParse }` and a real Zod schema
   satisfies it by shape. Python's `mcp` package uses **pydantic models**;
   `types.CallToolResult` cannot be duck-typed. A dependency-free helper must therefore
   return a plain `dict` and let the connector construct the model.
2. **Python's MCP server has no per-tool registrar.** TypeScript's MCP SDK exposes
   `server.tool(name, description, shape, handler)`, which is what `createRegisterSimpleTool`
   duck-types. The Python `mcp` package takes a single dispatcher pair —
   `Server(name=…, version=…, on_list_tools=…, on_call_tool=…)`. So the Python analogue of
   a registrar is a **router** that owns dispatch and hands back those two callables.

## Decisions

### D1 — A fourth import root

`nimbus_sdk.connector_kit`, not re-exported from `nimbus_sdk`, mirroring TypeScript's
fourth `exports` entry.

This widens a justification `CLAUDE.md` states deliberately. The current text explains the
three Python roots as mirroring the `.` / `./ipc` / `./diagnostics` boundary because "each
is a separate contract." `connector-kit` is batteries, not a contract — it has no spec and
no conformance corpus. The justification becomes "each is a separate **surface**," which
the TypeScript `exports` map already implies by giving `connector-kit` its own entry point
since 1.15.0. `CLAUDE.md` is updated to say this in shipment 1.

### D2 — No RFC for the kit; an RFC for the URL-resolution spec

`INCLUSION-POLICY.md` §3 requires a battery be used by at least two connectors, or one
plus a written case. There are no first-party Python connectors, so a literal reading
blocks this work.

The reading this design takes: **a binding of an already-admitted battery is not a new
battery.** The kit passed §3 on TypeScript's evidence; the polyglot promise in Pillar 2 is
that a binding follows. Under `GOVERNANCE.md`'s change classes that makes the kit
*additive* — PR plus review, minor bump.

This reasoning is written into the spec rather than assumed, because every future Go or
Rust battery port will cite it as precedent.

The **corpus** is a different matter. Every existing corpus pins a normative document
(`framing.md`, `diagnostics.md`, `contract-version.md`, the predicates README), and there
is none for URL resolution. Writing one adds a normative document under `docs/spec/`,
which is contract-affecting and therefore takes the RFC path: **RFC-0011**, following the
shape of RFC-0003 (pure predicates).

### D3 — Module layout

`src/nimbus_sdk/connector_kit/`, using the `__init__.py` re-export + `__all__` pattern
`ipc/` and `diagnostics/` already use.

| Module | Contents | Shipment |
| --- | --- | --- |
| `search_filter.py` | `filter_by_query`, `make_query_filter`, `matches_result`, `fields_from_keys`, `nested_string`, `string_field`, `tag_text`, `tag_names_from_objects`, `as_objectish`, `as_record` | 1 |
| `urls.py` | `resolve_url_with_base` | 1 |
| `env.py` | `require_env` | 1 |
| `results.py` | `json_result`, `error_result`, `json_result_if_ok`, `json_result_from_text_if_ok`, `parse_json_text_if_ok` | 1 |
| `transport.py` | `Transport`, `HttpRequest`, `HttpResponse`, `UrllibTransport`, `fetch_bearer_json`, `encode_basic_auth_header` | 2 |
| `router.py` | `ToolRouter`, `ToolSpec` | 2 |
| `rest.py` | `make_rest_fetcher`, `make_rest_tool`, `put_optional_non_empty_string`, `put_optional_boolean` | 2 |

`urls.py` and `env.py` hold one function each, deliberately. `urls.py` is the SSRF
chokepoint and the only corpus-gated module in the kit; `env.py` is the single place
ambient state enters. Neither should be findable only by reading a 170-line grab-bag, which
is what `mcp-tool-kit.ts` is.

### D4 — Three TypeScript exports get no Python counterpart

Stated explicitly so they do not read as oversights.

- **`createRegisterSimpleTool` / `registerZodTool` / `ZodObjectSchema`** — superseded by
  `ToolRouter`. Python's `mcp.Server` exposes no `.tool` method, so a duck-typed registrar
  would match nothing that exists.
- **`fetchWithTimeout`** — `AbortSignal.any` composition has no Python analogue.
  `HttpRequest` carries `timeout_s` instead; a caller needing cancellation composes it at
  their own layer.
- **`McpListResult` as a type** — the Python return is a plain `dict[str, Any]`, declared
  as a `TypedDict` for the reader but structurally a dict, because `types.CallToolResult`
  is a pydantic model.

### D5 — `require_env` takes an `env` seam

TypeScript's `requireProcessEnv` reads `process.env` directly with no seam.
`INCLUSION-POLICY.md` §2 names that exact pattern as a failure: *"a helper that reads
`process.env.API_ENDPOINT` with no way to override it still fails criterion 2."*

The Python signature is therefore `require_env(name: str, env: Mapping[str, str] = os.environ) -> str`
— a real default, a replaceable seam. The Python binding is stricter than the TypeScript
original here. That is recorded as a TypeScript bug in [Follow-ups](#follow-ups) rather
than replicated for symmetry.

### D6 — Sync transport with a `urllib` default, behind a Protocol seam

`INCLUSION-POLICY.md` §2 requires substitutable effects — naming the network — to be
reachable through a caller-replaceable parameter, with a real default permitted.
TypeScript's `service-account-token` sets the precedent by injecting `fetchFn`.

`Transport` is a `Protocol` with one `send` method. The default is `UrllibTransport`,
over stdlib `urllib.request` — dependency-free, and a real default so the live path is one
call. This aligns with the repo's already-documented stance that Python is synchronous
where TypeScript is asynchronous (`perform_handshake` vs `performHandshake`), adding no new
axis of divergence.

An async tool handler wraps a fetch in `anyio.to_thread.run_sync`. That is not a new
pattern for the template — `main.py`'s `_ReplayStdin.readline` already does exactly this.

### D7 — `ToolRouter` owns dispatch; validation is a seam

The kit ships no validator of its own. A hand-rolled JSON Schema subset validator would be
a new maintenance and semver surface whose boundary would be argued about indefinitely.
`ToolSpec.validate` is an optional callable the author supplies (their own check, or
pydantic if they have taken that dependency).

### D8 — Router output is wire-shaped

`list_tools()` and `call_tool()` return dicts keyed as the MCP wire keys them —
`inputSchema`, `isError` — not snake_case. The kit's job is producing the MCP contract
shape, and a consumer that is not the `mcp` package should get something usable. The
template carries a small explicit adapter into the pydantic models; that adapter is the
only place pydantic appears.

## Shipment 1 — the pure core

**Scope:** `search_filter.py`, `urls.py`, `env.py`, `results.py`. Every function pure and
stdlib-only. This is translation; the value is that the traps were found first.

All of `results.py` is pure: `json_result_if_ok` takes a structural
`{ok, status, json, text}` response and has no coupling to the fetcher, exactly as
`mcpJsonResultIfOk` does in TypeScript. `matches_result` depends on `json_result`, which is
why the two ship together.

### Divergence traps and their resolutions

**Case folding.** `str.lower()`, never `.casefold()`. `casefold` maps `ß` → `ss` where JS
`toLowerCase()` leaves it alone, so `casefold` would match a query of `strasse` against a
row reading `straße` in Python and not in TypeScript. Pinned by tests on `ß` (U+00DF) and
`İ` (U+0130) rather than left to a comment.

**`normalize_cap`.** The three documented TypeScript edge cases port directly:
`math.isfinite` for the `NaN` / `Infinity` guard, `max(0, math.floor(n))` for the rest.
Each gets its own test.

The TypeScript docstring claims no generated connector can observe this divergence because
`searchToolInputSchema` constrains `limit` before the handler runs. **That claim is weaker
in Python:** per D7 the router's validation is an optional seam, so a connector that omits
`validate` passes a raw `limit` straight through. The edge cases are more reachable in
Python, not less, and the tests say so.

**Origin comparison.** `_origin(url)` returns `(scheme, hostname, effective_port)` with the
default port resolved (80 for `http`, 443 for `https`), reading `urlsplit().hostname` —
which lowercases — rather than `.netloc`, which does not. Without both, `https://x.com:443`
and `https://x.com` compare unequal in Python and equal in JS, and the Python binding
rejects a legitimate pagination link that TypeScript accepts.

### The `startsWith("http")` wart is fixed, not ratified

TypeScript decides absoluteness with `pathOrUrl.startsWith("http")`. That is safe but wrong
at both edges:

- **Over-matches:** a legitimate relative path such as `httpbin/status` is read as absolute
  and throws.
- **Under-matches benignly:** `ftp://evil.com` is read as relative and concatenated onto the
  base, producing a weird path segment rather than a fetch to another host.

The security posture is sound; the ergonomics are not. RFC-0011 defines absoluteness
properly — a leading RFC 3986 scheme, `^[A-Za-z][A-Za-z0-9+.-]*:` — and **TypeScript
changes to match**, so the corpus pins one correct rule rather than enshrining a heuristic
in a second language. This is a behavior change to a published export: it needs a
`CHANGELOG.md` entry and a deliberate semver call in the RFC.

### The corpus

`docs/spec/connector-kit/v1/url-resolution.md` — roughly two pages: the resolution
algorithm, origin equality including default-port normalization, the reject conditions, and
the credential-redirect rule described under shipment 2 below.

That last clause lands in the document in **shipment 1**, ahead of the Python code that
needs it. This is deliberate and not a gap: TypeScript already satisfies it through its
runtime, and Python satisfies it vacuously until shipment 2 gives it a fetcher at all. The
rule belongs with the rest of the resolution contract rather than in a later amendment.

Cases land under
`docs/spec/conformance/v1/`, registered in its single `index.json` with per-case `reason`
text, and both bindings execute them.

Mechanical costs, to be confirmed against the `nimbus-sdk-conformance-corpus` skill at plan
time rather than rediscovered: case files and their `index.json` entries must land
together; `sdks/python/tests/test_spec.py` pins corpus sizes by literal (currently `== 37`
and `== 25`), so a third corpus adds a third pin.

### Early template win

`main.py`'s `_json_result` and `_error_result` are pure dict builders and adopt `results.py`
in shipment 1 — two functions leave the template before the router exists.

## Shipment 2 — transport, router, template

### The credential-redirect finding

TypeScript's chokepoint guards only the *initial* URL, and gets away with it because
`fetch` strips the `Authorization` header on a cross-origin redirect, per the Fetch
standard. `urllib.request` does not — its redirect handler carries headers to the new host.
A literal port would resolve a same-origin URL, receive a `302` to `evil.com`, and send the
bearer token there: the exact exfiltration the chokepoint exists to prevent, reintroduced
one layer below where the corpus can see it.

`UrllibTransport` therefore installs a redirect handler that drops `Authorization` on any
origin change, matching `fetch`.

Because this is a property of the contract rather than of Python, `url-resolution.md`
states it normatively: **a binding MUST NOT carry credentials across an origin change.**
TypeScript satisfies it via its runtime; Python satisfies it via that handler; a future Go
or Rust binding inherits a stated requirement instead of rediscovering it.

### Transport

Frozen dataclasses:

- `HttpRequest`: `url`, `method` (default `"GET"`), `headers`, `body: bytes | None`,
  `timeout_s: float = 15.0`
- `HttpResponse`: `ok`, `status`, `text`, `json` — with `ok = 200 <= status < 300` and
  `json = None` on parse failure, matching TypeScript's `BearerJsonFetchResult`

`Transport` is a `Protocol` with `send(request: HttpRequest) -> HttpResponse`.

`UrllibTransport`'s second trap: `urlopen` **raises** `HTTPError` on 4xx/5xx where `fetch`
resolves. The transport catches it and converts it to a normal `HttpResponse`, because a
non-2xx must reach `json_result_if_ok` as data, not as an exception. `URLError` propagates,
since `fetch` rejects on network failure too.

### Router

```
ToolRouter.add(name, description, input_schema, handler, validate=None)
@router.tool(name, description, input_schema)      # decorator over the same registration
router.list_tools() -> list[dict]                  # wire-shaped: name, description, inputSchema
await router.call_tool(name, arguments) -> dict    # wire-shaped: content, isError
```

`call_tool` is `async` while the rest of the kit is synchronous, because its only consumer
is an async `on_call_tool`. Handlers may be sync or async, resolved with
`inspect.isawaitable`.

Unknown tool, validation failure, and handler exceptions all become `error_result` rather
than propagating: a bad tool call must not kill the session. That swallowing is deliberate
and carries a docstring saying the detail belongs in a diagnostics event — the seam Pillar 8
will eventually fill.

### Errors

One base `ConnectorKitError(Exception)` with three subclasses — `UrlResolutionError`,
`HttpStatusError`, `MissingEnvError` — whose `str()` is byte-identical to the corresponding
TypeScript message, so error text stays comparable across bindings.

`HttpStatusError` additionally carries `.status`, `.service` and `.snippet` as attributes,
which TypeScript's bare `Error` does not. This is a surface asymmetry in Python's favor,
documented alongside `format_timestamp`.

### `rest.py`

`make_rest_fetcher(config, transport: Transport | None = None)` binds base URL, token and
transport, routing every call through `resolve_url_with_base`. The default is resolved to
`UrllibTransport()` inside the body, not in the signature: ruff's `B` ruleset is enabled in
`pyproject.toml`, and B008 rejects a function call in a default argument. Every seam in the
kit follows this form.

`make_rest_tool` is the
standard-tool-body factory — `require_env(token_env)` → fetch `build_path(args)` →
`json_result_if_ok(service_label, res)` — returning a handler suitable for `router.add`.

### Template rewrite

`_json_result`, `_error_result`, `_on_list_tools`, `_on_call_tool` and the inline
`isinstance` check — roughly 35 lines — collapse to a router registration plus two adapters
that construct `types.Tool` and `types.CallToolResult` explicitly. Those adapters are the
only place pydantic appears. `main.py`'s docstring loses the paragraph apologizing for the
missing kit.

## Testing

- **Shipment 1** ports the TypeScript tests one-for-one, plus dedicated tests for each
  divergence trap above. Both bindings execute the URL-resolution corpus.
- **Shipment 2** tests the router and `make_rest_fetcher` against a fake `Transport` —
  that is what the seam is for.
- **`UrllibTransport` needs a real `http.server` on a localhost port in a thread.** The two
  traps that matter — `HTTPError`-as-response and redirect header stripping — are invisible
  to a fake transport, so a fake cannot be the only coverage.
- **End-to-end** is the existing `scaffold-python` CI job, which already generates,
  installs, builds, tests and drives the generated project. That job passing against the
  rewritten template is the proof the gap closed.
- `docs-excerpts.test.ts` pins the quickstarts and READMEs to the template files; the
  template rewrite requires updating whatever it quotes, verified by
  `bun run scaffold:test`.
- After editing anything under `docs/spec/`, run `python -m pip install -e .` from
  `sdks/python/` before `pytest`, or the suite reads the previous bundled `_data/spec`
  snapshot and passes while executing none of the new cases.

## Documentation

- `docs/modules/connector-kit.md` gains a section on the Python binding and the D4
  asymmetries. Its `<!-- covers: -->` comment resolves the TypeScript surface only, so no
  new entry is needed there.
- `sdks/python/README.md` documents the new import root, following how it documents
  `nimbus_sdk.diagnostics`.
- `CLAUDE.md`: the "three import roots" section becomes four, with the D1 justification.
- `docs/ROADMAP.md`: tick the Phase 3 "Python `connector-kit`" box; remove the paragraph
  describing the scaffold workaround.
- `docs/quickstart-python.md`: update whatever the template rewrite changes.

## Follow-ups

Recorded, not done here:

1. **`requireProcessEnv` fails `INCLUSION-POLICY.md` §2** in TypeScript — no `env` seam.
   Fix to match D5.
2. **No Python surface-snapshot gate.** This kit roughly doubles Python's public surface
   with nothing equivalent to `api-surface.md` guarding it.
3. **No Python diagnostics emitter**, so the router's swallowed-exception detail has
   nowhere structured to go. Already-tracked asymmetry; this design adds a consumer for it.

## Semver call on the TypeScript fix

The `startsWith("http")` correction (shipment 1) lands as `fix:` — a patch.

The argument for minor is that it changes observable behavior of a published export. The
argument for patch, which wins, needs both halves of the change stated honestly:

- **Previously threw, now succeeds.** `resolveUrlWithBase("https://api.example.com", "httpbin/status")`
  raised `Invalid URL` on a legitimate relative path. No caller can have depended on that
  except by catching an error it should never have produced.
- **Previously succeeded, now throws.** A non-`http` scheme such as `ftp://evil.com` did not
  match `startsWith("http")`, so it was concatenated into
  `https://api.example.comftp://evil.com` — a malformed string that fails at the fetch. It
  now matches the scheme rule, mismatches the origin, and is rejected properly.

So the second case is a success in name only: it returned a value no caller could use. No
input that previously produced a *working* URL changes.

RFC-0011 may overrule this, since that is where the rule is defined; absent an argument
there, the plan proceeds on `fix:`.
