# connector-kit — transport & router design

**Date:** 2026-08-23
**Status:** approved, not yet implemented
**Predecessors:**
[the Python connector-kit design](./2026-08-17-python-connector-kit-design.md) and
[its review](./2026-08-18-python-connector-kit-design-review.md),
[the Go SDK design](./2026-08-19-go-sdk-design.md),
[`url-resolution.md`](../../spec/connector-kit/v1/url-resolution.md) §8

## What this is

`@nimbus-dev/sdk/connector-kit` publishes a transport, a tool router, and REST
factories. Neither `nimbus_sdk.connector_kit` nor `connectorkit` does: both stopped at
the same pure core, and both defer the same three pieces. This design closes that gap in
**both** bindings.

The Python half is not a new design. The Shipment 1 spec already carries an approved
`Shipment 2` section deciding the transport dataclasses, the `Transport` Protocol,
`UrllibTransport`'s traps, the `ToolRouter` API, the error taxonomy, `rest.py`, and the
template rewrite. This document restates only what changed, and spends its length on the
Go half, which had no design at all.

**The motivating evidence is in shipped code, not in a wish.** The generated Python
connector inlines `_json_result`, `_error_result`, `_on_list_tools`, `_on_call_tool` and
an `isinstance` check in its `main.py`, under a docstring paragraph that apologises for
the missing kit. Every Python connector re-derives those lines today.

### The security finding is already normative

Python's design turned up that `urllib.request` carries `Authorization` across a
cross-origin redirect where `fetch` strips it — the exact exfiltration
`resolve_url_with_base` exists to prevent, reintroduced one layer below where the corpus
can see it. That is already written down:
[`url-resolution.md`](../../spec/connector-kit/v1/url-resolution.md) **§8** states
*a binding MUST NOT carry credentials across an origin change*, and binds **every**
transport a binding accepts as a seam, not only its default.

So this design inherits a stated requirement rather than discovering one, and **no spec
change is in scope.**

## Naming: "Shipment 2" is already taken for Go

Go's Shipment 2 was 2a–2f — the handshake, diagnostics, the connector kit itself, the
version accessor, the parked `null` declaration case, and RFC-0013. All six merged; all
are in `sdks/go/CHANGELOG.md`. Calling the Go half of this work "Go Shipment 2" would
collide with a completed, released shipment.

**This work is named for its content.** The label "Shipment 2" is kept only where
Python's own docstrings already use it, because there it is accurate — this genuinely is
Python connector-kit Shipment 2.

## Decisions

| | Decision | Rationale |
|---|---|---|
| D1 | Both bindings, in the same design pass | The deferral is identical in both; the docs already claim parity between them |
| D2 | Four pull requests, Python-first | release-please assigns by paths touched, so one PR spanning components releases all of them under one subject line |
| D3 | Go's `Transport` is the kit's own interface, not a stdlib `Doer` | Only a kit-owned client can set `CheckRedirect`, which is what makes §8 *enforced* rather than documented |
| D4 | Go's `ToolRouter` is wire-shaped and ships with no in-repo caller | Keeps the kit dependency-free; matches Python, whose router is also wire-shaped with the pydantic adapters living in the template |
| D5 | Go's transport traps are proven by CI-run tests, never by a claim about stdlib defaults | The kit enforces §8 itself, so correctness does not depend on what `net/http` happens to do |
| D6 | No new corpus, no spec change | §8 needs a live server, not a fixture; `url-resolution` is already claimed by all three bindings |
| D7 | Each binding fixes its own forward-referencing docstrings | Those files live under a component path; editing them from a docs PR would drag the component into a release |
| D8 | Both bindings **export** the §8 origin-change predicate | §8 binds every transport a binding accepts as a seam; demanding compliance while withholding the primitive forces each custom transport to hand-roll §6 origin comparison |
| D9 | A validator signals failure by raising (Python) / returning an error (Go) | Real validators already raise; the router keeps one rule — anything raised below it becomes `error_result` — rather than two |
| D10 | `input_schema` is advertised, never enforced | The kit is dependency-free and cannot validate JSON Schema; saying so is the difference between a documented boundary and a surprise |

### D3 — why Go does not take a stdlib seam

`ipc.PerformHandshake` takes `io.Reader` / `io.Writer` rather than mirroring the
two-method object Python and TypeScript inject, on the stated grounds that Go has a
stdlib interface worth binding to and the others do not. A transport seam looks like the
same question, and `interface{ Do(*http.Request) (*http.Response, error) }` would let
`*http.Client` drop in with no adapter.

It is not the same question, because of §8. Redirect policy lives on
`http.Client.CheckRedirect`, which belongs to whichever client the caller passes. Under a
`Doer` seam the kit could only *document* the MUST; a caller handing it
`http.DefaultClient` would silently lose enforcement with no signal. Under a kit-owned
`Transport` the default constructor builds its own client and owns the policy, so the
guarantee holds for the default and is stated for substitutes — exactly Python's shape.

The cost is real and accepted: a caller who already has a configured `*http.Client`
writes a one-method adapter.

### D8 — the §8 predicate is exported, in both bindings

§8 binds **every** transport a binding accepts as a seam, not only its default. A design
that demands that and exports nothing leaves each custom transport to hand-roll §6 origin
comparison — which is precisely the bug class §6 exists to prevent. Divergent origin logic
inside a security check is a worse outcome than a slightly larger surface, and both
bindings need the function internally regardless; the only real question is whether it is
reachable.

```
should_strip_auth(from_url: str, to_url: str) -> bool      # Python
ShouldStripAuth(fromURL, toURL string) bool                # Go
```

It compares §6 origins and returns `True` when they differ — the same origin computation
`resolve_url_with_base` already performs, so the two cannot drift. The origin function
itself stays private in both bindings: exposing the decision does not require exposing
§6's internals.

**The review proposed a `net/http`-shaped Go signature** —
`IsCrossOriginRedirect(req *http.Request, via []*http.Request) bool`, or a pre-packaged
`CheckRedirect`. Declined, for two reasons. It couples the exported surface to
`net/http`, so a caller whose transport is built on anything else cannot use the helper
that §8 obliges them to honour; and it breaks the name-for-name symmetry with Python that
D4 of the Go design asks for. Two strings in, one bool out works for every client. The
`CheckRedirect` a `*http.Client` user wants is three lines built on top, and
`transport.go`'s doc comment shows them.

TypeScript gets no counterpart: `fetch` satisfies §8 by itself, so there is nothing for a
TypeScript caller to opt into. That is a new documented asymmetry, in the same category as
`format_timestamp`.

## The four pull requests

| PR | Touches | Releases | Gated on |
|---|---|---|---|
| **A** | `sdks/python/`, its own docstrings, and `docs/api-surface-python.md` | `nimbus-dev-sdk` minor | — |
| **B** | `sdks/go/`, its own doc comments, and `docs/api-surface-go.md` | an `sdks/go` tag — **permanent** | — |
| **C** | `tools/create-connector/`, `docs/quickstart-python.md` | `@nimbus-dev/create-connector` | **A published to PyPI** |
| **D** | `CLAUDE.md`, `docs/modules/connector-kit.md`, `docs/ROADMAP.md` | nothing | B and C merged |

A and B share no files and can run in parallel.

**C waits on A's *publish*, not its merge.** `templates/python/pyproject.toml` depends on
`nimbus-dev-sdk>=0.3.0` **from PyPI**, and the `scaffold-python` CI job installs real
dependencies into `$RUNNER_TEMP`. The template cannot import `ToolRouter` until the
release carrying it is on the index. Stacking C on A is not an option either: `ci.yml`
filters on `main`, so a stacked PR gets no CI.

**D releases nothing** because `docs/` sits outside all four component paths. It is kept
separate rather than folded into B or C so that no PR lands prose describing a binding
that has not merged.

**Merging B publishes a tag.** `proxy.golang.org` caches a version permanently within
minutes and a re-tag shows forever as a checksum mismatch, so B should be reviewed as if
the tag were part of the merge, because it is.

## PR A — the Python binding

Three new modules, two extended. Shipment 1 left forward-references naming every one of
these, so the names are already chosen rather than invented here.

### `transport.py`

`HttpRequest` and `HttpResponse` as frozen dataclasses:

- `HttpRequest`: `url`, `method = "GET"`, `headers`, `body: bytes | None`,
  `timeout_s: float = 15.0`
- `HttpResponse`: `ok`, `status`, `text`, `json` — `ok = 200 <= status < 300`,
  `json = None` on parse failure, matching TypeScript's `BearerJsonFetchResult`

`HttpResponse` satisfies the `JsonBodyResponse` Protocol `results.py` already defines, so
the `*_if_ok` builders consume it with no adapter. That seam exists and does not change.

`Transport` is a `Protocol` with one method, `send(request: HttpRequest) -> HttpResponse`.

`UrllibTransport` is the default and owns three behaviours that the `Transport` docstring
states as **obligations on every implementation**, not as its own implementation details:

1. **A non-2xx is a response, not an exception.** `urlopen` raises `HTTPError` on 4xx/5xx
   where `fetch` resolves; the transport catches and converts, because a non-2xx must
   reach `json_result_if_ok` as data.
2. **§8 enforcement.** A redirect handler drops `Authorization` on any origin change —
   see the measured note below, which rules out the obvious one-line alternative.
3. **A closed exception set.** Anything that is not an HTTP response surfaces as
   `TransportError`, or `TransportTimeoutError` for the timeout case, with the original
   attached via `raise ... from`. `socket.timeout` / `TimeoutError` (aliases since 3.10,
   reachable both bare and wrapped by `URLError`) map to the latter; other connection
   failures to the former. Without this, a caller catches a different exception set per
   transport, which defeats the seam. Both carry the method and the requested URL in the
   message and preserve the original as `__cause__` via `raise ... from`, so a DNS or
   connection-refused detail is not lost — **with userinfo stripped from the URL first**,
   since a credential must not reach a log line. That is the rule
   `encodeBasicAuthHeader` already states for its return value, applied at the other end
   of the same request.

#### How §8 is implemented, and the wrong fix that looks right

**Measured on CPython 3.14.6**, two loopback servers on different ports (different §6
origins) and one server redirecting to itself:

| how the header is set | same-origin redirect | cross-origin redirect |
|---|---|---|
| `Request(headers={"Authorization": ...})` | carries | **carries — leaks the credential** |
| `req.add_unredirected_header("Authorization", ...)` | **drops** | drops |

The first row is the §8 violation the spec was written for, now confirmed on a current
CPython rather than inferred from the docs.

The second row is the trap. `add_unredirected_header` looks like a one-line fix and is
genuinely safe, but it is **not §8**: §8 requires dropping the credential on an origin
change and says nothing about same-origin redirects, which are ordinary — `/api/x` →
`/api/x/` is a redirect a REST API issues all day. Over-stripping turns those into a
`401` that surfaces at runtime, in someone else's connector, not at review.

So `UrllibTransport` builds its opener with `urllib.request.build_opener(...)` around a
`HTTPRedirectHandler` subclass overriding
`redirect_request(self, req, fp, code, msg, headers, newurl)` — the hook that returns the
next `Request` — and strips `Authorization` there, and only when `should_strip_auth`
says the origin changed. Bare `urlopen` cannot express this, because it uses the default
opener.

### `router.py`

```
ToolRouter.add(name, description, input_schema, handler, validate=None)
@router.tool(name, description, input_schema, validate=None)   # same options as add
router.list_tools() -> list[McpToolDescriptor]     # wire-shaped: name, description, inputSchema
await router.call_tool(name, arguments) -> McpToolResult
```

The decorator takes **every** option `add` takes, `validate` included; it is a decorator
over the same registration, not a reduced form of it.

`call_tool` is `async` while the rest of the kit is synchronous, because its only
consumer is an async `on_call_tool`. Handlers may be sync or async, resolved with
`inspect.isawaitable`.

Unknown tool, validation failure, and handler exceptions all become `error_result`
rather than propagating: **a bad tool call must not kill the session.** That swallowing is
deliberate and carries a docstring saying the detail belongs in a diagnostics event —
the seam Pillar 8 will eventually fill, tracked as Follow-up 3 and still open.

#### The validation contract (D9, D10)

`validate` is `Callable[[Mapping[str, Any]], None]`. **It signals failure by raising**;
returning normally means valid. The router catches whatever it raises and turns it into
`error_result(str(exc))`.

Raising, rather than returning `bool` or `str | None`, for two reasons. Every validator an
author would actually plug in — pydantic, jsonschema, a hand-written check — already
raises, so a return-based contract would make each one need a wrapper. And it keeps the
router to **one** rule, "anything raised below this router becomes `error_result`", rather
than a second, different path for validators.

**`validate=None` performs no validation at all.** There is no fallback check, and in
particular **`input_schema` is never enforced** — it is advertised to the client in
`list_tools()` and nothing more. The kit is dependency-free and cannot validate JSON
Schema; pretending otherwise would be the worse failure, since an author would trust a
check that was not happening. `arguments=None` is coerced to `{}` before it reaches
either `validate` or the handler, so neither has to guard for it.

### `rest.py`

`make_rest_fetcher(config, transport=None)` binds base URL, token and transport, routing
every call through `resolve_url_with_base`. `make_rest_tool` is the standard-tool-body
factory — `require_env(token_env)` → fetch `build_path(args)` →
`json_result_if_ok(service_label, res)` — returning a handler suitable for `router.add`.

Both resolve `UrllibTransport()` **inside the body, not in the signature**: ruff's `B`
ruleset is selected in `pyproject.toml` and B008 rejects a call in a default argument.
Every seam in the kit follows this form.

### Extended modules

`errors.py` gains `TransportError(ConnectorKitError)` and
`TransportTimeoutError(TransportError)`. The name avoids the builtin: `TimeoutError` is a
builtin `OSError` subclass, so reusing it inside the package would be a readability trap
in exactly the code most likely to be read in a hurry.

`types.py` gains `McpToolDescriptor`, which its docstring already promises.

`urls.py` gains `should_strip_auth` (D8). It goes there rather than in `transport.py`
because it is origin comparison and reuses the private origin function `urls.py` already
has — putting it beside its own logic is what keeps the two from drifting, and it means a
custom transport can import the predicate without importing the default transport. Go
places `ShouldStripAuth` in `urls.go` for the same reason.

`__init__.py`'s `__all__` grows, and `docs/api-surface-python.md` is regenerated with
`python scripts/api_surface.py`. **This is the first surface change that gate will
catch** — it landed in [#163](https://github.com/nimbus-agent/nimbus-sdk/pull/163), the
commit immediately before the release that precedes this design.

## PR B — the Go binding

Three new files, named for Python's modules as the existing six are: `transport.go`,
`router.go`, `rest.go`.

### The response type is constrained in a way Python's is not

`results.go` already defines `TextResponse` and `JSONBodyResponse` as **Go interfaces** —
method sets, `Ok() bool` / `Status() int` / `Text() string` / `JSON() any` — and its doc
comment already anticipates this shipment ("without adopting this kit's future
transport").

So Go's `HTTPResponse` is a struct with unexported fields and four accessor methods,
where Python's is a frozen dataclass with plain attributes satisfying an attribute
Protocol. **This is an asymmetry, not a divergence**: a Go interface is a method set and
a Python Protocol is not, and nothing observable differs between the bindings.

### `Transport`

`Transport` is the kit's own interface, `Send(context.Context, HTTPRequest)
(HTTPResponse, error)`, per D3. `HTTPRequest` mirrors Python's field for field, with
`Timeout time.Duration` where Python spells `timeout_s: float`.

**The `context.Context` is a fourth Go-shaped difference on this surface, and it is
load-bearing rather than decorative.** Python's `send` takes the request alone.
`ToolRouter.CallTool` takes a context and hands it to the `Handler`; without one on
`Send` the context would stop there, and a cancelled tool call could not cancel the HTTP
request it is blocked on. Go has a cancellation primitive worth binding to and Python
has none — the reasoning that put `io.Reader` in `ipc.PerformHandshake`. It also has to
be decided now: adding a parameter to an exported interface is breaking, and the tag is
permanent.

Two deadlines then exist — the caller's context and `HTTPRequest.Timeout` — and the
shorter wins, because `Send` applies the timeout *on top of* the supplied context rather
than replacing it. Cancellation and expiry are **not** the same outcome:
`context.DeadlineExceeded` is a `*TransportTimeoutError`, `context.Canceled` is a plain
`*TransportError`, and conflating them would let a retry loop retry work the caller had
just abandoned. Both keep the cause reachable through `Unwrap`, so
`errors.Is(err, context.Canceled)` still answers.

The default constructor is **`NewHTTPTransport(...)`**, not a name-for-name port of
`UrllibTransport`: that name identifies a library Go does not have, the same reason
`format_timestamp` has no Go counterpart. It builds its own `*http.Client` and sets
`CheckRedirect` to drop `Authorization` on any origin change — which is what makes §8
enforced here rather than merely documented. Its `CheckRedirect` is `ShouldStripAuth`
plus a header delete, so the default transport and any caller following D8 run the same
comparison. A caller substituting their own `Transport` inherits the obligation through
the interface doc comment, as in Python.

### The error taxonomy has to change shape

Python's `TransportTimeoutError` subclasses `TransportError`, so one `except` catches
both. Go has no subclassing, and `errors.go`'s existing pattern is a concrete struct per
error with `Unwrap() error { return ErrConnectorKit }`. Extending it needs a second
sentinel and multi-error unwrap:

```go
var ErrTransport = errors.New("connectorkit: transport")

type TransportError struct {
    Op  string // "GET", "POST", …
    URL string // userinfo redacted — see below
    Err error  // the underlying failure, preserved
}

func (e *TransportError) Unwrap() []error {
    if e.Err == nil {
        return []error{ErrConnectorKit, ErrTransport}
    }
    return []error{ErrConnectorKit, ErrTransport, e.Err}
}
```

`errors.Is(err, ErrTransport)` is then Python's `except TransportError`, and `errors.As`
distinguishes the timeout. This is the **same split `ConnectorKitError` already took** — a
base class becoming a sentinel — applied a second time, so it is precedent rather than
novelty. `go.mod` declares `go 1.26`; multi-error `Unwrap` needs 1.20.

**Multi-unwrap does double duty here**, which is the review's error-context point: listing
`e.Err` alongside the two sentinels means `errors.Is(err, ErrTransport)` and
`errors.Is(err, context.DeadlineExceeded)` both work on the same value, so wrapping costs
the caller no diagnostic detail. Python gets the same property for free from
`raise ... from`, which sets `__cause__`.

**The message carries the operation and URL, and never the credential.** That needs
saying because it is not automatic: a URL may carry userinfo (`https://user:pw@host/`),
so `URL` is stripped of userinfo before it is stored or formatted. This is the rule
`encodeBasicAuthHeader` already states for its return value — a credential must not reach
a log line — applied at the other end of the same request.

It does move a number the docs quote: Python's taxonomy grows by two names and Go's by
three, so `docs/modules/connector-kit.md`'s "Python's 27 exported names map to 28 Go
names" must be recomputed in PR D rather than adjusted by hand.

### `ToolRouter`

Named `ToolRouter`, not `Router`: D4 of the Go design says Go's names follow Python's
exactly, trimming only what the **package** already supplies, and `connectorkit` supplies
no "Tool". `connectorkit.ToolRouter` does not stutter the way `ConnectorKitError` did.

```go
type MCPToolDescriptor struct {
    Name        string         `json:"name"`
    Description string         `json:"description"`
    InputSchema map[string]any `json:"inputSchema"`
}

type Handler   func(context.Context, map[string]any) (MCPToolResult, error)
type Validator func(map[string]any) error

func (r *ToolRouter) Add(d MCPToolDescriptor, h Handler, validate Validator) error
func (r *ToolRouter) ListTools() []MCPToolDescriptor
func (r *ToolRouter) CallTool(ctx context.Context, name string, args map[string]any) MCPToolResult
```

**`MCPToolResult` and `MCPTextContent` are not new.** They are the Shipment 1 types in
`sdks/go/connectorkit/types.go`, and Python's `McpToolResult` / `McpTextContent` are the
matching `TypedDict`s already in `types.py`. Only `MCPToolDescriptor` is added here, which
`types.py`'s docstring has promised since Shipment 1. Nothing in either router is a
`map[string]any` stand-in for a result.

**Go gets the validation seam too**, per the review: `Add` takes a `Validator`, with
`nil` meaning none. A third parameter rather than a variadic option or a second
constructor, because `nil`-selects-the-default is already this package's established
convention — `RequireEnv(name, nil)` selects `os.Getenv`, `MakeRESTFetcher(cfg, nil)`
selects the default transport. A returned error becomes `ErrorResult(err.Error())`, which
is Python's raise-to-`error_result` in Go's spelling. D10 binds Go identically:
`InputSchema` is advertised, never enforced.

**`CallTool` is synchronous**, matching Go's stance everywhere else — `PerformHandshake`,
`diagnostics.Encode` — where Python's `call_tool` is async. A handler error, an unknown
tool, and a failed validation all become `ErrorResult`, as in Python.

It imports no MCP package and **has no in-repo caller.** That is stated in its doc
comment rather than hidden, together with the trigger for changing it: a Go connector
template, or a real Go connector. Python's router is wire-shaped for the same reason —
the pydantic adapters live in the template, not the kit.

### `rest.go`

`MakeRESTFetcher(cfg RESTFetcherConfig, t Transport) ...` and `MakeRESTTool(...)`,
binding Python's two factories. `nil` selects the default transport, the same way
`RequireEnv(name, nil)` selects `os.Getenv`.

`docs/api-surface-go.md` is regenerated with
`go -C sdks/go run ./internal/apisurface/cmd`; the golden test fails the PR until it is.

## PR C — the template

`_json_result`, `_error_result`, `_on_list_tools`, `_on_call_tool` and the inline
`isinstance` check collapse to a `ToolRouter` registration plus two adapters. The
adapters stay **generic** — they loop over `router.list_tools()` and `router.call_tool()`'s
wire shapes rather than knowing about `echo` — and remain the only place pydantic
appears, which is the property `types.py`'s docstring already promises. The template's
validation moves to the router's `validate=` seam.

`main.py`'s docstring loses the paragraph apologising for the missing kit. The
`nimbus-dev-sdk>=0.3.0` pin bumps to whatever A published.

`docs/quickstart-python.md` is pinned to the template by
`tools/create-connector/src/docs-excerpts.test.ts`, so it moves in the same PR or that
guard fails. It runs under `bun run scaffold:test`, **not** `bun run test`.

## PR D — the prose

Three files: `CLAUDE.md` (line 77's deferral sentence), `docs/modules/connector-kit.md`
(the Python-binding deferral at 145, the `createRegisterSimpleTool` entry at 152 that
calls the router "superseded by the Shipment 2 router", the `error_result` entry at 176,
and the recomputed name counts), and `docs/ROADMAP.md`'s Phase 3 box — where the Python
`connector-kit` item can finally go from `[~]` to `[x]`, since the Go half lands too.

Per D7 the shipped-code forward-references are **not** here. They live under component
paths and each binding fixes its own:

- **PR A:** `errors.py:9`, `results.py:4`, `results.py:57`, `search_filter.py:14`,
  `types.py:12`, `__init__.py:13`, `tests/test_connector_kit_results.py:28`
- **PR B:** `connectorkit/results.go:75`

### One reference is deliberately left alone

`sdks/typescript/scripts/url-resolution-guard.test.ts:31` reads "Shipment 2's transport
tests are what pin it." It is a comment, but it is the **fourth** component — touching it
cuts a TypeScript patch release for a comment. It becomes *true* rather than false once
the transports exist; only its numbering ages. Left unedited, deliberately.

## Testing

**Python.** Router and `make_rest_fetcher` go against a fake `Transport` — that is what
the seam is for. `UrllibTransport`'s two real traps are invisible to a fake, so it needs a
live `http.server` in a thread, bound to **port 0** with the assigned port read back off
the socket. A fixed port is a flake waiting for its first collision on a cross-OS matrix.

**Go.** Fake `Transport` for `ToolRouter` and `MakeRESTFetcher`. §8 gets a real
`httptest.Server` issuing a cross-origin 302, asserting `Authorization` is **absent** on
the second hop.

**§8 needs two tests in each binding, not one.** The cross-origin test proves the
credential is dropped; a **same-origin** redirect test proves it is *kept*. Only the pair
distinguishes §8 from the over-stripping `add_unredirected_header` behaviour measured
above, and a suite with only the first would pass against the wrong implementation — the
one whose failure mode is a `401` in someone else's connector. `should_strip_auth` /
`ShouldStripAuth` additionally get direct unit tests for scheme, host and port changes,
including the default-port equivalences §6 defines (`http://h:80` ≡ `http://h`).

**No claim about stdlib defaults is written anywhere.** Per D5 the kit enforces §8
itself, so the test proves the kit's behaviour rather than `net/http`'s. This matters
because Go is not installed on the machine this design was written on: every Go
measurement in this document would otherwise be a prediction, and this repository does
not accept those. The evidence is the CI job.

## What does not move

Verified, not assumed:

- **`docs/conformance-coverage.json`** — `url-resolution` is already claimed by
  `typescript`, `python` and `go`, with `deferred: {}` for all three.
- **No new corpus and no spec change.** §8 is already normative and is not
  corpus-testable: it needs a live server, not a fixture.
- **`sdks/go/spec/data/`** needs no regeneration, since nothing under `docs/spec/`
  changes.

## Out of scope

Recorded as follow-ups, deliberately not done here:

1. **`requireProcessEnv`'s missing `env` seam** (TypeScript, fails
   [`INCLUSION-POLICY.md`](../../INCLUSION-POLICY.md) §2). A fifth PR against a fifth
   component, unrelated to transport.
2. **A diagnostics sink for the router's swallowed exceptions.** Blocked on a Python
   emitter, which does not exist; this design adds the consumer that motivates one.
3. **`AsyncTransport`.** Its trigger is a real connector whose throughput is measurably
   hurt by the `to_thread` hop — not "`mcp` is async."
4. **A conformance harness for third-party transports**, proving a custom `Transport`
   honours §8. Still deferred, but D8 narrows what it would be for: with the predicate
   exported, an author no longer has to *derive* the rule, so the harness's remaining job
   is proving a transport actually *calls* it. Worth having once more than one transport
   exists; today it would have exactly one caller.
5. **A Go connector template**, which is what would give `ToolRouter` its first caller.

## Changes from review

[The review](./2026-08-23-connector-kit-transport-and-router-design-review.md) raised
seven items. Six are adopted; one is adopted with a different shape.

| # | Item | Outcome |
|---|---|---|
| 1 | A §8 helper for custom transports | **Adopted** as D8, both bindings |
| 1a | Go helper shaped `IsCrossOriginRedirect(req, via)` | **Adopted differently** — `ShouldStripAuth(from, to string) bool`; the proposed shape couples the exported surface to `net/http` and breaks symmetry with Python |
| 2 | Call out the `urllib` opener strategy | **Adopted**, and strengthened: measured on 3.14.6, including the `add_unredirected_header` trap the review did not name |
| 3 | `@router.tool` should take `validate` | **Adopted** — the decorator takes every option `add` does |
| 4 | How does `validate` signal failure? | **Adopted** as D9: it raises; the router turns it into `error_result` |
| 5 | Go needs the validation seam too | **Adopted** — `Add(d, h, validate)`, `nil` for none |
| 6 | Where is `MCPToolResult` defined? | **Adopted as a clarification** — it is the existing Shipment 1 type; only `MCPToolDescriptor` is new |
| 7 | Preserve underlying transport error detail | **Adopted**, plus a constraint the review did not raise: the URL is stripped of userinfo, because a credential must not reach a log line |

Item 4 also surfaced a gap neither the design nor the review stated: with no validator,
nothing validates, and **`input_schema` is advertised rather than enforced**. That is now
D10.

## Risks

- **B is irreversible on merge.** A wrong exported name in `connectorkit` is cached by
  the module proxy forever. The `docs/api-surface-go.md` golden diff is the last place to
  catch one, and it should be read as a review artifact rather than regenerated
  reflexively.
- **C's gate is a published artifact, not a merge.** If A's release PR sits unmerged, C
  cannot land, and a reviewer looking only at the branch will not see why.
- **The two bindings can drift during the window between A and B.** They are reviewed
  separately and released separately; the parity claims in PR D are what force a
  reconciliation, which is why D comes last rather than first.
