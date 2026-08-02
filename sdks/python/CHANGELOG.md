# Changelog

## [Unreleased]

### Features

* **diagnostics:** add `nimbus_sdk.diagnostics`, a third import root binding the diagnostics / telemetry contract v0 — `encode_diagnostic`, `parse_diagnostic`, `meets_level`, `DIAGNOSTIC_KINDS`, `DIAGNOSTIC_LEVELS`, and the `EncodeOk` / `EncodeRejected` / `ParseOk` / `ParseRejected` result types, plus a Python-only `format_timestamp` helper (Python has no built-in `Date#toISOString()` equivalent). Like `nimbus_sdk.ipc`, it is deliberately **not** re-exported from `nimbus_sdk` — the diagnostics surface is its own contract. The envelope is closed and validated: unknown members are rejected and `fields` only ever holds numbers and booleans, so redaction is structural rather than a rule an author has to remember. This binding executes the same 72-case corpus as the TypeScript reference, byte-identically; this package ships no emitter — only the encode/parse/level surface — so writing an encoded line to a sink is left to the caller. (The free-form audit-logger payload this supersedes was a TypeScript-only export; Python never had one to deprecate.)

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
