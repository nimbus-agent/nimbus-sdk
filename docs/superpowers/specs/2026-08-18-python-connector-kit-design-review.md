# Review & Feedback: Python `connector-kit` Design

**Date:** 2026-08-18  
**Design Reference:** [2026-08-17-python-connector-kit-design.md](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/python-connector-kit/docs/superpowers/specs/2026-08-17-python-connector-kit-design.md)

---

## 1. Open Questions

### Q1.1: Async vs. Sync Network Transports
*   **Context:** The design adopts `UrllibTransport` as the default sync transport. It mentions that async handlers will wrap sync fetches using `anyio.to_thread.run_sync`.
*   **Question:** Python's MCP server package (`mcp`) is heavily async-native. If a connector author wants to use a modern, fully asynchronous HTTP client (e.g. `httpx` or `aiohttp`), does the `Transport` protocol support `async def send(...)`?
*   **Recommendation:** Clarify if `Transport` is strictly synchronous or if we should define an `AsyncTransport` protocol (or allow the single `Transport` to return an `Awaitable[HttpResponse]` / support both signatures using `inspect.iscoroutinefunction`). Having a clear async transport story avoids forcing threads for network I/O in highly concurrent connector environments.

### Q1.2: TypedDict vs. Pydantic Handlers
*   **Context:** D8 states that the router's output is wire-shaped (dicts matching MCP JSON keys), and the template handles the conversion to `types.Tool` and `types.CallToolResult`.
*   **Question:** While dependency-free SDK core is highly desirable, will returning untyped `dict` values cause typing/IDE friction for Python developers?
*   **Recommendation:** We should define `TypedDict` specifications for the wire format in the SDK (e.g. `McpToolWireSpec` or similar) so connector authors get autocompletion and type-checking without needing to import `pydantic`.

### Q1.3: Timeout Exception Mapping
*   **Context:** TypeScript uses standard Abort signals, while Python uses `HttpRequest.timeout_s`.
*   **Question:** `urllib.request.urlopen` raises different exceptions under timeouts depending on the context (e.g. `socket.timeout` or `URLError` wrapping `TimeoutError`).
*   **Recommendation:** Explicitly specify what exception type `Transport.send()` should raise or return on timeout. If we raise a unified `ConnectorKitError` subclass (e.g., `TimeoutError`), we make client code much more robust.

---

## 2. Technical Suggestions & Improvements

### S2.1: Urllib Redirection Handler Implementation (Credential-Redirect Trap)
*   **Context:** Python's default `urllib` redirection handler preserves headers across domains, which leaks the `Authorization` header.
*   **Suggestion:** When implementing the custom redirect handler in `UrllibTransport`, override `redirect_request` of `urllib.request.HTTPRedirectHandler`:
    ```python
    class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            # Resolve original and redirect origins
            # If origin changes, strip the "Authorization" header
            ...
    ```
    We should include a reference code structure or test assertions in the spec/documentation to guarantee that downstream implementers of custom transports also follow this redirect hygiene.

### S2.2: Test Server Port Collision Avoidance
*   **Context:** Testing `UrllibTransport` with a real `http.server` in a thread.
*   **Suggestion:** Instead of pinning a localhost port (e.g., `8000`), the test fixture should bind to port `0` (`localhost:0`) to let the OS assign a free port dynamically. This prevents flaky tests in CI environments running parallel test suites.

### S2.3: `require_env` Type Annotation
*   **Context:** `require_env(name: str, env: Mapping[str, str] = os.environ) -> str`
*   **Suggestion:** Note that `os.environ` is technically typed as `os._Environ[str]` in Python, which implements `MutableMapping[str, str]`. `Mapping[str, str]` is perfect and type-compatible, but ensure it is imported from `typing` or `collections.abc` depending on Python version targets (Python 3.9+ supports `collections.abc.Mapping`).

---

## 3. Resolutions

Applied to [2026-08-17-python-connector-kit-design.md](./2026-08-17-python-connector-kit-design.md).
Six items: four accepted as written, one accepted with its premise corrected, one accepted
in substance with part of its recommendation declined. Nothing was dismissed.

| Item | Verdict | Landed in |
| --- | --- | --- |
| Q1.1 async transport | Answered + deferred | D6, Follow-up 4 |
| Q1.2 TypedDicts | Fixed | D8 |
| Q1.3 timeout mapping | Fixed, widened | Transport, Errors |
| S2.1 redirect hygiene | Fixed in substance | Transport, Follow-up 5 |
| S2.2 port 0 | Fixed | Testing |
| S2.3 `Mapping` import | Fixed, premise corrected | D5 |

### Q1.1 — async transports · answered, and the protocol deferred

The gap was real but it was a **documentation** gap, not a design one. `Transport` is
synchronous only, and D6 now says so outright instead of leaving it inferable.

What the design was missing is that the async story already exists: `resolve_url_with_base`,
`HttpResponse` and the `*_if_ok` family are all pure and transport-agnostic, so an author
using `httpx` composes them directly and skips `Transport` entirely. D6 now carries that
three-line example, and names the one thing such an author loses — `make_rest_tool`, the
standard-body factory, which is the only helper that assumes a synchronous fetch.

`AsyncTransport` itself is **deferred**, because adding it is precisely the "dual sync +
async surfaces" option that was weighed and rejected during brainstorming: two surfaces to
keep in step forever, a doubled test matrix, two entries in every doc. The deferral carries
an explicit trigger so it can be revisited on evidence rather than vibes — a real connector
whose throughput is measurably hurt by the `to_thread` hop. "`mcp` is async" is not the
trigger; that was already true when D6 was decided and is already handled.

### Q1.2 — TypedDicts · fixed

Accepted without reservation, and it exposed an inconsistency worth naming: D4 already
committed to a `TypedDict` for the result shape, so the design was applying the idea to
half its own surface. D8 now declares `McpTextContent`, `McpToolResult` (with `isError` as
`NotRequired[bool]`) and `McpToolDescriptor`. Both `TypedDict` and `NotRequired` are stdlib
and available at the package's `requires-python = ">=3.11"` floor, so this costs no
dependency and no version guard.

### Q1.3 — timeout exceptions · fixed, and widened past the ask

Correct, and the underlying problem is broader than timeouts: the design said "`URLError`
propagates", which quietly made *every* failure mode transport-specific. A caller swapping
transports would have had to swap its `except` clauses too, which defeats the seam.

So the raise contract is now part of the `Protocol` rather than an implementation detail:
anything that is not an HTTP response surfaces as `TransportError`, with
`TransportTimeoutError` for the timeout case. `UrllibTransport` maps `socket.timeout` /
`TimeoutError` — aliases since 3.10, reachable both bare and wrapped by `URLError` — into
the latter, and other connection failures into the former, preserving the original via
`raise ... from`.

One amendment to the recommendation: **not** named `TimeoutError`. That is a builtin
`OSError` subclass, and shadowing it inside the package would be a readability trap in
exactly the code most likely to be read under pressure.

### S2.1 — redirect hygiene · fixed in substance, reference code declined

The important half is accepted, and it is the half the sentence *"downstream implementers
of custom transports also follow this"* was pointing at: the credential-redirect rule binds
**every** `Transport`, not just `UrllibTransport`. A custom transport inherits its client's
redirect behavior, and clients differ. The design now puts that obligation in the
`Transport` Protocol docstring and in `url-resolution.md` as a MUST.

Two amendments:

1. **No reference implementation in the spec.** A design document that carries a
   `redirect_request` override becomes a document that goes stale the first time the
   implementation improves. The normative MUST belongs in `url-resolution.md`; the code
   belongs in `transport.py` with tests behind it.
2. **No claim about which clients strip by default.** Whether `httpx`, `requests` or
   `aiohttp` drop `Authorization` on a cross-host redirect is a security claim about
   third-party code, and it has changed across releases. The design deliberately asserts
   nothing; the plan verifies it against current versions before any documentation names a
   library.

A shared conformance harness that a third-party transport could run to prove it honors the
rule is **deferred** — today it would have exactly one caller.

### S2.2 — port 0 · fixed

Straightforwardly right and now specified. The fixture binds port 0 and reads the assigned
port back off the socket. The design never named port 8000, but leaving the port
unspecified is how a fixed one gets written.

It also surfaced a second requirement: the redirect test needs **two** origins, which on a
single host means two listeners on two OS-assigned ports. `127.0.0.1:a` → `127.0.0.1:b` is
an origin change by the port component alone — which is exactly the case shipment 1's
default-port normalization work makes well-defined, so the two pieces test each other.

### S2.3 — the `Mapping` import · fixed, premise corrected

The conclusion is right and now stated in D5, but it is not a choice to be made: ruff's `UP`
ruleset is enabled in `sdks/python/pyproject.toml`, and UP035 rejects the `typing` spelling
outright. The "Python 3.9+" framing is also moot here — `requires-python = ">=3.11"` puts
the subscriptable `collections.abc` form well inside support, with no version guard needed.

The `os._Environ[str]` observation is correct and worth keeping for a different reason than
compatibility: the parameter is annotated as the read-only `Mapping`, not `MutableMapping`,
so the seam cannot invite writing to the environment through a helper whose job is reading
it.
