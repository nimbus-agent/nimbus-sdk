# Nimbus Quickstart Connector

A Nimbus connector that echoes what it is given. It performs the contract-version handshake on
stdio, then serves MCP tools over the same two streams.

```bash
python -m venv .venv
.venv/bin/pip install -e ".[dev]"    # Windows: .venv\Scripts\pip
.venv/bin/python -m pytest           # unit + acceptance tests
.venv/bin/python -m nimbus_quickstart_connector.main   # runs the connector on stdio
```

The acceptance tests spawn `python -m nimbus_quickstart_connector.main` as a real process, so the
package has to be installed before `pytest` will pass. An editable install (`-e`) means you never
have to reinstall after an edit.

| Command | What it does |
| --- | --- |
| `python -m pytest` | Unit tests for your logic, acceptance tests for the wire. |
| `python -m mypy` | Strict typecheck over `src/` and `tests/`. |
| `python -m ruff check . && python -m ruff format --check .` | Lint and format. |

## What is contract, and what is yours

**Contract** — the manifest's shape, the handshake, and exit code `20` on refusal. The gateway
depends on these; changing them breaks your connector.

**Yours** — which MCP server you use, what your tools do, how you test them. The SDK has no
opinion.

## The files

| File | What it is |
| --- | --- |
| `src/nimbus_quickstart_connector/manifest.py` | The manifest the gateway reads, and the tool list. Contract. |
| `src/nimbus_quickstart_connector/handlers.py` | Your logic. Imports neither SDK, so you can test it without a wire protocol. |
| `src/nimbus_quickstart_connector/main.py` | The only file that knows a protocol exists: handshake, then MCP. |
| `tests/test_handlers.py` | Unit tests for your logic. |
| `tests/test_handshake.py` | Acceptance tests for the wire behaviour. Keep these. |

## There is no Python `connector-kit`

The TypeScript template imports `createRegisterSimpleTool` and `mcpJsonResult` from
`@nimbus-dev/sdk/connector-kit`. `nimbus-dev-sdk` publishes no equivalent, so the few lines that
kit would absorb — `_on_list_tools`, `_on_call_tool`, and the JSON result helper — sit inline in
`main.py`. That is deliberate: a scaffold is not where a new published surface gets designed.

## Read this before you restructure `main.py`

The gateway announces unprompted — [contract-version.md][spec] §5 has both peers write their
hello without waiting — so its hello and its **first MCP request very often arrive in the same
read**.

[spec]: https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/spec/negotiation/v1/contract-version.md

`perform_handshake` handles that, but only if you take back what it gives you:

- the complete frames it read past the hello come back as `result.pending`;
- a frame the gateway left half-written stays inside the `NdjsonLineReader` you passed in.

`main.py` therefore does **not** let the MCP transport read raw stdin. `stdio_server` accepts an
explicit `stdin`, and it is given `_ReplayStdin`: a line source that yields `result.pending`
first and then keeps pushing the rest of stdin through the *same* reader. Because `stdio_server`
parses one JSON-RPC message per line, replaying frames costs no protocol knowledge — the template
never constructs a JSON-RPC message by hand.

Serving on raw stdin after the handshake loses both — silently, with no error and no log line.
The session's first request is simply never answered.

`tests/test_handshake.py` guards each half with its own test, because a fix for one does not fix
the other:

- `test_answers_a_request_pipelined_into_the_hellos_chunk` — fails if you drop the `pending`
  replay;
- `test_completes_a_frame_the_hellos_chunk_left_half_written` — fails if you replay `pending` but
  then let the transport read raw stdin instead of pushing it through the reader.

Do not delete either.

## Adding a tool

1. Write the function in `handlers.py` and a test for it in `tests/test_handlers.py`.
2. Add its name and description to `TOOLS` in `manifest.py`.
3. Give it a JSON Schema next to `ECHO_INPUT_SCHEMA` and dispatch to it in `_on_call_tool`.

Keep tool names free of row-data segments. A connector indexes metadata; record bodies stay on
the system they came from.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Normal shutdown. |
| `20` | Handshake refused — no contract major in common. `CONTRACT_HANDSHAKE_EXIT`. |
