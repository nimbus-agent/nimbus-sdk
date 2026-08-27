# Changelog

## [0.12.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.11.0...sdks/go/v0.12.0) (2026-08-27)


### Features

* **go:** promote dataprofile to frozen ([#201](https://github.com/nimbus-agent/nimbus-sdk/issues/201)) ([67c69ca](https://github.com/nimbus-agent/nimbus-sdk/commit/67c69ca16f09ea405035cbaee8a58e4e6af33772))

## [0.11.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.10.0...sdks/go/v0.11.0) (2026-08-27)


### Features

* **go:** the dataprofile package ([#195](https://github.com/nimbus-agent/nimbus-sdk/issues/195)) ([44dd002](https://github.com/nimbus-agent/nimbus-sdk/commit/44dd002c640ed4ab8fba06814928783cc9aa1c79))

## [0.10.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.9.0...sdks/go/v0.10.0) (2026-08-27)


### Features

* **python:** nimbus_sdk.data_profile ([#193](https://github.com/nimbus-agent/nimbus-sdk/issues/193)) ([986612e](https://github.com/nimbus-agent/nimbus-sdk/commit/986612ef1b3593714133dd9e51d0b67805ce7ae5))


### Bug Fixes

* **typescript:** firstLineAndRows returns 0 for empty input ([#190](https://github.com/nimbus-agent/nimbus-sdk/issues/190)) ([6e0dce2](https://github.com/nimbus-agent/nimbus-sdk/commit/6e0dce2cffa8d990ff9eae855b8394f825255e2d))

## [0.9.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.8.2...sdks/go/v0.9.0) (2026-08-25)


### Features

* tiered stability markers across all three bindings (RFC-0015) ([#175](https://github.com/nimbus-agent/nimbus-sdk/issues/175)) ([c85750a](https://github.com/nimbus-agent/nimbus-sdk/commit/c85750aa0b380a7b195c98a41727adfe3a82ccc7))

## [0.8.2](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.8.1...sdks/go/v0.8.2) (2026-08-25)


### Bug Fixes

* **diagnostics:** reject an own __proto__ member instead of silently dropping it ([#174](https://github.com/nimbus-agent/nimbus-sdk/issues/174)) ([a7e754b](https://github.com/nimbus-agent/nimbus-sdk/commit/a7e754b96d1a7e6251ffbb08baf127a6edb627ee))

## [0.8.1](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.8.0...sdks/go/v0.8.1) (2026-08-23)


### Bug Fixes

* **go:** redact the URL error fields, and reject a nil tool handler ([#169](https://github.com/nimbus-agent/nimbus-sdk/issues/169)) ([16563c8](https://github.com/nimbus-agent/nimbus-sdk/commit/16563c875fce38b40bd34991be22ef78c67cd80a))

## [0.8.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.7.0...sdks/go/v0.8.0) (2026-08-23)


### Features

* **go:** connector-kit transport, tool router and REST factories ([#166](https://github.com/nimbus-agent/nimbus-sdk/issues/166)) ([2517a98](https://github.com/nimbus-agent/nimbus-sdk/commit/2517a98ba3e880c56fb3bda5f3d43e6f2a74fd7b))

## [0.7.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.6.1...sdks/go/v0.7.0) (2026-08-23)


### Features

* **spec:** a cross-language conformance matrix that proves per-case coverage ([#159](https://github.com/nimbus-agent/nimbus-sdk/issues/159)) ([21c46a6](https://github.com/nimbus-agent/nimbus-sdk/commit/21c46a648c4221b23994d5ce7fb4e580ad2499b6))

## [0.6.1](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.6.0...sdks/go/v0.6.1) (2026-08-22)


### Bug Fixes

* **go:** replace an invalidated UTF-8 prefix with one U+FFFD, not one per octet ([#155](https://github.com/nimbus-agent/nimbus-sdk/issues/155)) ([a7ba675](https://github.com/nimbus-agent/nimbus-sdk/commit/a7ba675138d07df44656ecc25f85d2ff8812fbea))

## [0.6.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.5.0...sdks/go/v0.6.0) (2026-08-22)


### Features

* **go:** report the module's own version as contract.SDKVersion (Shipment 2d) ([#151](https://github.com/nimbus-agent/nimbus-sdk/issues/151)) ([e3e1a04](https://github.com/nimbus-agent/nimbus-sdk/commit/e3e1a04b3a66e340efb404ac590280c3928057bf))

## [0.5.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.4.0...sdks/go/v0.5.0) (2026-08-21)


### Features

* **go:** bind the connector kit and execute the url-resolution corpus (Shipment 2c) ([#148](https://github.com/nimbus-agent/nimbus-sdk/issues/148)) ([baaf365](https://github.com/nimbus-agent/nimbus-sdk/commit/baaf365b680b05a08f0d1f07cf70f7a98e1462be))

## [0.4.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.3.0...sdks/go/v0.4.0) (2026-08-20)


### Features

* **go:** bind the diagnostics contract and execute its corpus (Shipment 2b) ([#146](https://github.com/nimbus-agent/nimbus-sdk/issues/146)) ([3fb2fca](https://github.com/nimbus-agent/nimbus-sdk/commit/3fb2fca67c29fa15162c9a57de15ff21b447f0c1))

## [0.3.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.2.0...sdks/go/v0.3.0) (2026-08-20)


### Features

* **go:** perform the contract-version handshake (Shipment 2a) ([#144](https://github.com/nimbus-agent/nimbus-sdk/issues/144)) ([3deb666](https://github.com/nimbus-agent/nimbus-sdk/commit/3deb666ad28ec42174c7cef68948efe8feb8f046))

## [0.2.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdks/go/v0.1.0...sdks/go/v0.2.0) (2026-08-20)


### Features

* **go:** bind the NDJSON line reader and execute the framing corpus ([#141](https://github.com/nimbus-agent/nimbus-sdk/issues/141)) ([f4a6579](https://github.com/nimbus-agent/nimbus-sdk/commit/f4a65797e8fcc70a6947882a886d4aef25fa33fc))

## 0.1.0 (2026-08-20)


### Features

* **go:** add the Go SDK binding — Shipment 1 ([#135](https://github.com/nimbus-agent/nimbus-sdk/issues/135)) ([3848ad1](https://github.com/nimbus-agent/nimbus-sdk/commit/3848ad164024e117934249695c73d55cf30b68e5))
* **go:** gate the public API surface with a committed snapshot ([#140](https://github.com/nimbus-agent/nimbus-sdk/issues/140)) ([1ec933d](https://github.com/nimbus-agent/nimbus-sdk/commit/1ec933d030d76640eb9dfd78c9df8bee99d8d78b))

## Changelog
