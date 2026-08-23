# Design Review: connector-kit — transport & router design

**Date:** 2026-08-23
**Status:** Review Comments
**Target Design:** [2026-08-23-connector-kit-transport-and-router-design.md](2026-08-23-connector-kit-transport-and-router-design.md)

---

## 1. Redirect Security & Transport Customization (D3, D5, §8)

### Open Questions & Suggestions
- **Helper for Custom Transports:** The design mandates that any custom `Transport` implementation must enforce §8 (dropping `Authorization` on cross-origin redirects). To lower the barrier to entry and reduce implementation bugs, should the SDK expose a helper function or utility?
  - **Go:** A helper function like `IsCrossOriginRedirect(req *http.Request, via []*http.Request) bool` or a pre-packaged `CheckRedirect` implementation that users can reuse in their own `http.Client`.
  - **Python:** A helper function `should_strip_auth(original_url: str, redirect_url: str) -> bool`.
- **`urllib` Redirect Interception:** In Python's `UrllibTransport`, redirect behavior is managed by `urllib.request.HTTPRedirectHandler`. To strip the header on cross-origin redirects, the transport will need to construct a custom `OpenerDirector` using a custom `HTTPRedirectHandler` subclass. It would be helpful to explicitly call out this implementation strategy in the design or implementation notes to avoid standard `urlopen` pitfalls.

---

## 2. Python `ToolRouter` and Validation

### Open Questions & Suggestions
- **`@router.tool` Decorator Signature:** Does the `@router.tool` decorator also support the `validate` parameter (e.g. `@router.tool(name, description, input_schema, validate=...)`)? It should support the same configuration options as `ToolRouter.add`.
- **Validation Contract:** How does the `validate` callable signal validation failure?
  - Does it return a boolean (`True`/`False`), or does it raise a specific exception (e.g. `ValidationError`)?
  - If it raises an exception, does it swallow the exception and wrap it in `error_result`, or is there a specific base class/sentinel it should raise?
- **Default Validation Behavior:** If `validate` is `None` (the default), is there any fallback validation performed (e.g. checking that arguments is a dictionary), or is validation completely bypassed?

---

## 3. Go `ToolRouter` Parity and Types

### Open Questions & Suggestions
- **Validation Seam in Go:** In Python, the router has a `validate` seam: `ToolRouter.add(..., validate=None)`. In Go, the proposed `ToolRouter.Add` takes only `MCPToolDescriptor` and `Handler`.
  - How is validation handled in Go? Is it expected to be implemented entirely inside the `Handler` callback?
  - If so, should we consider adding a validation hook to Go's `Add` as well to maintain parity (e.g., `func (r *ToolRouter) Add(d MCPToolDescriptor, h Handler, validate Validator) error`)?
- **Defining `MCPToolResult`:** Since the Go connector-kit "imports no MCP package", where is `MCPToolResult` defined? Is it a struct defined locally in `connectorkit/router.go` mirroring the MCP wire format, or is it a generic `map[string]any` / `any`? Clarifying the structure of `MCPToolResult` in the design would prevent ambiguity.

---

## 4. Error Taxonomy & Diagnostics (Follow-up 2/3)

### Suggestions
- **Transport Error Context:** When wrapping exceptions in `TransportError` and `TransportTimeoutError`, make sure to preserve the underlying error details (e.g., host, port, or DNS resolution failure messages) within the error message or as attached properties, so debugging connection issues remains straightforward.
