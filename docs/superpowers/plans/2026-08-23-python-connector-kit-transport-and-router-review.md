# Plan Review: Python connector-kit — transport & router

**Date:** 2026-08-23
**Status:** Review Comments
**Target Plan:** [2026-08-23-python-connector-kit-transport-and-router.md](2026-08-23-python-connector-kit-transport-and-router.md)

---

## Suggestions & Open Questions

- **Async Test Style Discrepancy (Task 5, Step 1):** 
  - The implementation plan lists the test cases with `async def` signatures (e.g., `async def test_call_tool_dispatches_to_a_sync_handler() -> None:`).
  - However, the note below Step 1 states: *"if no async plugin is configured, do not add a dependency — instead drive each coroutine with `asyncio.run(...)` inside a synchronous test [...] and drop the `async def` from the test signatures."*
  - **Suggestion:** It would be cleaner to rewrite the code blocks in Step 1 to show the synchronous test signatures with `asyncio.run` wrapping the async router calls, ensuring there is no confusion during execution.
- **Redaction Edge Cases (Task 2, Step 3):**
  - The helper `_redact_userinfo` handles URL parsing errors by returning `"<unparseable url>"`. If the URL is partially malformed but still contains sensitive userinfo (e.g., an unescaped `@` character inside path components that triggers a `ValueError` in `urlsplit`), returning the placeholder is a safe fallback. No change needed, but we should make sure this is verified by the unparseable URL test cases.
