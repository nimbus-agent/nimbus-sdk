# nimbus-dev-sdk

The MIT-licensed, dependency-free authoring contract for
[Nimbus](https://github.com/nimbus-agent/Nimbus) connectors and extensions — Python binding.

```bash
pip install nimbus-dev-sdk    # note: nimbus-dev-sdk, NOT nimbus-sdk
```
```python
import nimbus_sdk  # the import name differs from the distribution name
```

PyPI has a flat namespace and `nimbus-sdk` belongs to an unrelated project, so the
distribution is published as `nimbus-dev-sdk`.

## Quickstart

To go from nothing to a connector that performs the contract-version handshake and then
serves MCP tools over the same two streams, follow
[quickstart-python.md](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/quickstart-python.md).
It scaffolds a project whose `manifest.py` declares `"runtime": "python"` — legal only
since RFC-0009 widened the enum — and whose tests spawn the connector as a real process.
The scaffolder is a TypeScript program run from a checkout; there is no `pip`-installable
front end for it yet, and the quickstart documents the copy-the-template fallback.

## What this is

The contract is defined once, language-neutrally, in
[`docs/spec/`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/docs/spec). This
package carries that specification data and binds it to Python. The
[TypeScript SDK](https://www.npmjs.com/package/@nimbus-dev/sdk) is the reference
implementation; both are held to the same conformance corpus.

The specification data is bundled into the distribution, so it is available
without a network call or a checkout:

```python
from nimbus_sdk import load_schema, negotiate_contract_version

schema = load_schema("nimbus-item.schema.json")
result = negotiate_contract_version(["1"], ["1"])  # NegotiationOk(version="1")
```

## Status

Early. This release carries the contract-version constants, the negotiation algorithm,
and the published JSON Schemas. It also carries the IPC surface —
`from nimbus_sdk.ipc import NdjsonLineReader, parse_hello, perform_handshake` —
deliberately a separate import root from `nimbus_sdk`, mirroring the `.` vs `./ipc`
split the TypeScript package publishes. It is not yet the full connector-authoring
surface — see the
[roadmap](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/ROADMAP.md).

`perform_handshake` is the one exchange this package performs end to end: write our
hello, read the peer's, agree on a contract major or refuse. The stream is **injected**,
never opened — the package does no I/O of its own — and a refusal comes back as a value,
because nothing here owns a process to exit.

```python
from nimbus_sdk.ipc import HandshakeOk, NdjsonLineReader, perform_handshake

# `io` is any object with `read() -> bytes | None` and `write(bytes) -> None`. Return
# None at end of stream: sys.stdin.buffer.read() gives b"" there, which would loop.
reader = NdjsonLineReader()  # supply your own if the session keeps reading this stream
result = perform_handshake(io, reader=reader)
if isinstance(result, HandshakeOk):
    result.version  # the agreed contract major, e.g. "1"
    result.pending  # frames the peer sent right after its hello — process these first
```

It is **synchronous**, where the TypeScript binding is `async`. Python's standard streams
block and a startup handshake has nothing to overlap with, so `async def` would drag every
connector into an event loop for nothing; an asyncio caller wraps it with
`await asyncio.to_thread(perform_handshake, io)`.

## License

MIT — see [LICENSE](https://github.com/nimbus-agent/nimbus-sdk/blob/main/LICENSE).
