# Changelog

## Unreleased

### Features

* **connector-kit:** add the `nimbus_sdk.connector_kit` import root — the pure core of
  the Python binding of `@nimbus-dev/sdk/connector-kit`: `errors.py`, `urls.py`
  (`resolve_url_with_base`, the SSRF chokepoint), `env.py` (`require_env`), `types.py`,
  `results.py` (`json_result` and its `*_if_ok` variants), and `search_filter.py`. The
  transport, the tool router, and `rest.py` follow in a later release.

## [0.8.0](https://github.com/nimbus-agent/nimbus-sdk/compare/python-v0.7.0...python-v0.8.0) (2026-08-20)


### Features

* **go:** add the Go SDK binding — Shipment 1 ([#135](https://github.com/nimbus-agent/nimbus-sdk/issues/135)) ([3848ad1](https://github.com/nimbus-agent/nimbus-sdk/commit/3848ad164024e117934249695c73d55cf30b68e5))

## [0.7.0](https://github.com/nimbus-agent/nimbus-sdk/compare/python-v0.6.0...python-v0.7.0) (2026-08-18)


### Features

* **connector-kit:** add the nimbus_sdk.connector_kit import root and specify URL resolution ([#126](https://github.com/nimbus-agent/nimbus-sdk/issues/126)) ([755dc8e](https://github.com/nimbus-agent/nimbus-sdk/commit/755dc8ed439c1b370ec5d4bf94c1538f4ecc5ea6))

## [0.6.0](https://github.com/nimbus-agent/nimbus-sdk/compare/python-v0.5.0...python-v0.6.0) (2026-08-02)


### Features

* **diagnostics:** add the diagnostics / telemetry contract v0 ([#113](https://github.com/nimbus-agent/nimbus-sdk/issues/113)) ([86cec91](https://github.com/nimbus-agent/nimbus-sdk/commit/86cec914dd40866fad5adf200acb062c8e9d3489))

## [0.5.0](https://github.com/nimbus-agent/nimbus-sdk/compare/python-v0.4.0...python-v0.5.0) (2026-08-01)


### Features

* publish the connector scaffolder to npm ([#106](https://github.com/nimbus-agent/nimbus-sdk/issues/106)) ([8e609d6](https://github.com/nimbus-agent/nimbus-sdk/commit/8e609d62eb9879e1fec98405b3522cf0c1e279f0))

## [0.4.0](https://github.com/nimbus-agent/nimbus-sdk/compare/python-v0.3.0...python-v0.4.0) (2026-08-01)


### Features

* generate connectors that actually run, in TypeScript and Python ([#95](https://github.com/nimbus-agent/nimbus-sdk/issues/95)) ([288f81f](https://github.com/nimbus-agent/nimbus-sdk/commit/288f81f4933a9d34e262c6fec8cc841235e6f34c))

## [0.3.0](https://github.com/nimbus-agent/nimbus-sdk/compare/python-v0.2.0...python-v0.3.0) (2026-07-31)


### Features

* perform the contract-version handshake in both bindings ([#92](https://github.com/nimbus-agent/nimbus-sdk/issues/92)) ([5a95669](https://github.com/nimbus-agent/nimbus-sdk/commit/5a95669559a8b329d5494f9d20d59c2a60a5d24d))

## [0.2.0](https://github.com/nimbus-agent/nimbus-sdk/compare/python-v0.1.2...python-v0.2.0) (2026-07-31)


### Features

* **python:** bind the IPC surface and execute both conformance corpora ([#84](https://github.com/nimbus-agent/nimbus-sdk/issues/84)) ([0d93f3e](https://github.com/nimbus-agent/nimbus-sdk/commit/0d93f3e88f734bcc6ae4f04c646df9a5c3412de8))

## [0.1.2](https://github.com/nimbus-agent/nimbus-sdk/compare/python-v0.1.1...python-v0.1.2) (2026-07-31)


### Documentation

* pin empty-vs-invalid negotiation with RFC-0006 ([#81](https://github.com/nimbus-agent/nimbus-sdk/issues/81)) ([e147e08](https://github.com/nimbus-agent/nimbus-sdk/commit/e147e085ddd2b5b70dc6494586e846d86fdc20f6))

## [0.1.1](https://github.com/nimbus-agent/nimbus-sdk/compare/python-v0.1.0...python-v0.1.1) (2026-07-30)


### Documentation

* **python:** show how to load the bundled spec ([#75](https://github.com/nimbus-agent/nimbus-sdk/issues/75)) ([252ba15](https://github.com/nimbus-agent/nimbus-sdk/commit/252ba152b4011885fabd975b19e439b6b79c3bfc))

## 0.1.0 (2026-07-30)


### Features

* publish the Python SDK to PyPI tokenlessly ([#73](https://github.com/nimbus-agent/nimbus-sdk/issues/73)) ([1b4ddce](https://github.com/nimbus-agent/nimbus-sdk/commit/1b4ddcec13fbff788be6f917b34feb80aead78d6))

## nimbus-dev-sdk — Changelog
