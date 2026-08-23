# Plan Review: Go connector-kit — transport & router

**Date:** 2026-08-23
**Status:** Review Comments
**Target Plan:** [2026-08-23-go-connector-kit-transport-and-router.md](2026-08-23-go-connector-kit-transport-and-router.md)

---

## Suggestions & Open Questions

- **Context Cancellation Handling (Task 3):**
  - In `HTTPTransport.Send()`, error handling maps `context.DeadlineExceeded` to `*TransportTimeoutError`.
  - What about `context.Canceled`? If the context passed in is canceled by the caller, this will also result in an error from `client.Do` or `io.ReadAll`.
  - Currently, it falls back to a generic `*TransportError`. This is safe, but it might be worth explicitly checking for `context.Canceled` if we want to distinguish caller cancellation from transport failures or timeouts.
- **Handling of zero-length body or `nil` body in `HTTPTransport.Send`:**
  - The plan sets `body = bytes.NewReader(request.Body)` when `request.Body != nil`. If `request.Body` is an empty slice `[]byte{}`, `body` is initialized with a zero-length reader, which is correct and matches Python/TS behavior.
- **Order Preservation in `ToolRouter.ListTools` (Task 4):**
  - Storing the list of tool names in a slice `order` to bypass Go's map iteration randomness is a very clean and simple way to preserve registration order. No improvements needed here.
