# connector-kit — template rewrite and prose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the workaround the scaffolder shipped while the kit was missing, and
correct every remaining document that says the transport, router and REST factories are
still to come.

**Architecture:** Two pull requests, PR C and PR D of the four the design decomposes.
C rewrites the generated Python connector to use `ToolRouter` and bumps its dependency
pin; D updates the three prose files that sit outside every release-please component.

**Tech Stack:** Python 3.11+ (template), Bun + TypeScript (scaffolder tests), Markdown.

**Spec:** [`docs/superpowers/specs/2026-08-23-connector-kit-transport-and-router-design.md`](../specs/2026-08-23-connector-kit-transport-and-router-design.md)

**Predecessor plans:** [Python](./2026-08-23-python-connector-kit-transport-and-router.md)
(merged as #165) and [Go](./2026-08-23-go-connector-kit-transport-and-router.md) (merged
as #166, hardened by #169).

## Global Constraints

- **PR C's gate is cleared.** `nimbus-dev-sdk` **0.11.0** is on PyPI, so the template can
  import `ToolRouter`. The pin bumps to `>=0.11.0`.
- **Two PRs, not one.** C touches `tools/create-connector/` and cuts a
  `@nimbus-dev/create-connector` release; D touches only `CLAUDE.md`, `docs/modules/` and
  `docs/ROADMAP.md`, which sit outside every component path and cut nothing.
- **Do not edit `sdks/python/` or `sdks/go/`** in either PR. Their forward-references were
  already retired in #165 and #166.
- **`docs/quickstart-python.md` is pinned to the template** by
  `tools/create-connector/src/docs-excerpts.test.ts`, so it moves with PR C, not PR D.
  That guard runs under `bun run scaffold:test`, **not** `bun run test`.
- The counts PR D must state, read from the generated surfaces rather than recalled:
  **Python `nimbus_sdk.connector_kit` exports 42**, **Go `connectorkit` exports 76**.

---

### Task 1 (PR C): rewrite the generated connector to use `ToolRouter`

**Files:**
- Modify: `tools/create-connector/templates/python/src/nimbus_quickstart_connector/main.py`
- Modify: `tools/create-connector/templates/python/pyproject.toml`

**Interfaces:**
- Consumes: `ToolRouter`, `json_result` from `nimbus_sdk.connector_kit` (0.11.0).
- Produces: a `main.py` whose only pydantic contact is two generic adapters.

- [ ] **Step 1: Bump the dependency pin**

In `templates/python/pyproject.toml`, change `"nimbus-dev-sdk>=0.3.0"` to
`"nimbus-dev-sdk>=0.11.0"`. Leave the comment above it — the flat-namespace warning is
still true — and leave the `mcp` ceiling alone.

- [ ] **Step 2: Replace the inlined dispatch with a router**

Delete `_json_result`, `_error_result`, `_on_list_tools`, `_on_call_tool` and the
`isinstance` check inside the latter. In their place:

```python
ROUTER = ToolRouter()


def _validate_echo(args: dict[str, Any]) -> None:
    """Reject anything the tool's schema advertises but the kit does not enforce.

    ``inputSchema`` is advertised to the client and never checked: a dependency-free
    SDK carries no JSON Schema implementation. This is the seam that closes the gap,
    and a real connector would either widen it or plug a validator in here.
    """
    if not isinstance(args.get("text"), str):
        raise ValueError("text must be a string")


ROUTER.add(
    TOOLS[0]["name"],
    TOOLS[0]["description"],
    ECHO_INPUT_SCHEMA,
    lambda args: json_result(echo(args["text"])),
    validate=_validate_echo,
)


async def _on_list_tools(
    _context: ServerRequestContext[dict[str, Any]],
    _params: types.PaginatedRequestParams | None,
) -> types.ListToolsResult:
    """Adapter: the router's wire shapes into pydantic. Generic — add a tool above and
    this does not change."""
    return types.ListToolsResult(
        tools=[
            types.Tool(
                name=tool["name"],
                description=tool["description"],
                input_schema=tool["inputSchema"],
            )
            for tool in ROUTER.list_tools()
        ]
    )


async def _on_call_tool(
    _context: ServerRequestContext[dict[str, Any]],
    params: types.CallToolRequestParams,
) -> types.CallToolResult:
    """The other adapter. `call_tool` never raises for a bad call, so there is no
    error handling here to get wrong."""
    result = await ROUTER.call_tool(params.name, params.arguments)
    return types.CallToolResult(
        content=[
            types.TextContent(type="text", text=block["text"])
            for block in result["content"]
        ],
        is_error=result.get("isError", False),
    )
```

Add `from nimbus_sdk.connector_kit import ToolRouter, json_result` to the imports, and
drop `import json` if nothing else in the file uses it.

- [ ] **Step 3: Retire the docstring apology**

`main.py`'s module docstring ends with a paragraph beginning "TypeScript wraps the tool
registration below in `connector-kit`'s `createRegisterSimpleTool`…". Replace it with a
sentence naming what the file now does: the handshake machinery below is the template's
own, the dispatch is `ToolRouter`'s, and the two adapters are the only place pydantic
appears.

- [ ] **Step 4: Verify the generated project builds, typechecks and passes**

The scaffolder's own suite does not install the template's dependencies; the
`scaffold-python` CI job does. Reproduce it locally:

```bash
bun run --cwd tools/create-connector build
node tools/create-connector/dist/index.js /tmp/ck-check --lang python
cd /tmp/ck-check && python -m pip install -e ".[dev]" && python -m pytest -q && python -m mypy
```

Expected: the generated project's own `tests/test_handshake.py` and
`tests/test_handlers.py` pass. If `mypy` objects to the `lambda` in `ROUTER.add`, give
the handler a named `def` rather than loosening a type.

- [ ] **Step 5: Commit**

```bash
git add tools/create-connector/templates/python/
git commit -m "feat(scaffolder): generate a Python connector that uses ToolRouter"
```

---

### Task 2 (PR C): update the quickstart the guard pins to the template

**Files:**
- Modify: `docs/quickstart-python.md`

- [ ] **Step 1: Rewrite the section that is now false**

`### There is no Python connector-kit` (around line 123) says `nimbus-dev-sdk` publishes
no equivalent and that the absorbed lines sit inline. Both halves are now wrong. Replace
the section with one that says the kit exists, names what the template takes from it
(`ToolRouter`, `json_result`), and keeps the one thing that is still true and still
worth saying: the two adapters are where pydantic lives, because the SDK is
dependency-free and cannot return `types.CallToolResult` itself.

- [ ] **Step 2: Fix step 4 of "What to edit first"**

It tells the reader to "dispatch to it in `_on_call_tool`". That is now the generic
adapter. It should say: register the tool on `ROUTER` next to the existing `add` call.

- [ ] **Step 3: Run the drift guard**

```bash
bun run scaffold:test
```

The excerpted fence is `_next_line`, inside `_ReplayStdin`, which this shipment does not
touch — so the guard should pass unchanged. If it fails, the excerpt has drifted for
some other reason; fix the quote rather than the marker.

- [ ] **Step 4: Commit and open PR C**

```bash
git add docs/quickstart-python.md
git commit -m "docs: the Python quickstart no longer describes a missing connector-kit"
```

Confirm scope before opening: `git diff --name-only <base>..HEAD` must show only
`tools/create-connector/` and `docs/quickstart-python.md` (plus anything under
`docs/superpowers/`, which is componentless).

---

### Task 3 (PR D): correct the three prose files

A separate branch off `main`. Cuts no release.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/modules/connector-kit.md`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: `CLAUDE.md`**

Two edits. The connector-kit paragraph (around line 77) says the transport, tool router
and REST factories "are Shipment 2" — they have landed. And around line 127, "Python's 27
exported names become 28" is stale twice over: the counts are now **42** and **76**, and
the `ConnectorKitError` split is no longer the only divergence, since `RedactedURL` and
the `Transport` context parameter are Go-only too.

- [ ] **Step 2: `docs/modules/connector-kit.md`**

Four edits:
- line ~145, the Python-binding deferral — the transport, router and REST factories are
  no longer Shipment 2.
- line ~152, `createRegisterSimpleTool` / `registerZodTool` / `ZodObjectSchema` are
  "superseded by the Shipment 2 router" — say superseded by `ToolRouter`, which exists.
- line ~176, `error_result` — its stated reason ("Python's Shipment 2 `ToolRouter` needs
  the builder directly") is now a present-tense fact.
- line ~233, "Python's **27** exported names map to **28** Go names" — recompute to
  **42** and **76**, and record the new asymmetries: `Send` takes a `context.Context`
  where Python's `send` does not, and `RedactedURL` is exported in Go because Go has no
  constructor to redact inside.

- [ ] **Step 3: `docs/ROADMAP.md`**

The Phase 3 box `A **Python `connector-kit`**` is `[~]`. Both bindings now carry the
transport, the router and the REST factories, so it becomes `[x]` and its text loses the
"Still missing" clause. Say what actually shipped, including that `UrllibTransport` and
`HTTPTransport` each enforce §8 and that the two runtimes needed different mechanisms to
do it.

Do **not** tick "The hottest batteries ported to the additional languages" — that box is
about the `crypto` / `icalendar` / `data-profile` families, which this shipment did not
touch.

- [ ] **Step 4: Check nothing else still says it is coming**

```bash
grep -rn -i "shipment 2" --include=*.md . | grep -v docs/superpowers | grep -v CHANGELOG | grep -v sdks/go/spec/data
```

Expected: only historical references — RFC-0012's decision table, and the Go design docs,
which describe Go's own completed Shipment 2 and are correct as written.

- [ ] **Step 5: Commit and open PR D**

```bash
git add CLAUDE.md docs/modules/connector-kit.md docs/ROADMAP.md
git commit -m "docs: the connector-kit transport, router and REST factories have landed"
```

Scope check: `git diff --name-only <base>..HEAD` must show **no** `sdks/` or `tools/`
path, or PR D stops being release-free.

---

## Definition of done

- The generated Python connector imports `ToolRouter` and contains no `_json_result`,
  `_error_result` or hand-rolled dispatch; its two adapters are generic.
- A generated project installs, typechecks and passes its own tests against
  `nimbus-dev-sdk>=0.11.0`.
- `bun run scaffold:test` passes, including the quickstart drift guard.
- `grep -rn -i "shipment 2"` over `*.md` returns only historical references.
- The export counts in `CLAUDE.md` and `docs/modules/connector-kit.md` match the
  generated surfaces: 42 Python, 76 Go.
- PR C touches `tools/create-connector/` + `docs/quickstart-python.md`; PR D touches no
  component path at all.
