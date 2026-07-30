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
and the published JSON Schemas. It is not yet the full connector-authoring surface —
see the [roadmap](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/ROADMAP.md).

## License

MIT — see [LICENSE](https://github.com/nimbus-agent/nimbus-sdk/blob/main/LICENSE).
