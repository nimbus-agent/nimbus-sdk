# @nimbus-dev/sdk — Changelog

## [1.5.2](https://github.com/nimbus-agent/nimbus-sdk/compare/sdk-v1.5.1...sdk-v1.5.2) (2026-07-23)


### Bug Fixes

* **tsconfig:** put test files in the editor's project ([#26](https://github.com/nimbus-agent/nimbus-sdk/issues/26)) ([9cb3195](https://github.com/nimbus-agent/nimbus-sdk/commit/9cb31957bdb1c4d29db577945834970c50d3558e))

## [1.5.1](https://github.com/nimbus-agent/nimbus-sdk/compare/sdk-v1.5.0...sdk-v1.5.1) (2026-07-23)


### Bug Fixes

* **ci:** retry the signature audit, not just the install ([#22](https://github.com/nimbus-agent/nimbus-sdk/issues/22)) ([0ff49ec](https://github.com/nimbus-agent/nimbus-sdk/commit/0ff49eccf3db5b962c48bfc85e7f699fd5ba3efe))
* **testing:** resolve the sandbox probe path lazily ([#25](https://github.com/nimbus-agent/nimbus-sdk/issues/25)) ([a6604a6](https://github.com/nimbus-agent/nimbus-sdk/commit/a6604a65ef88a111d6e257080ee8c5a2ee52db07))
* **types:** typecheck the test files ([#24](https://github.com/nimbus-agent/nimbus-sdk/issues/24)) ([343eb11](https://github.com/nimbus-agent/nimbus-sdk/commit/343eb110932b29af4b9897e775b3987288feb4be))

## [1.5.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdk-v1.4.1...sdk-v1.5.0) (2026-07-23)


### Features

* **agents:** promote the composed brief types + guards; fix ESM entry points ([#20](https://github.com/nimbus-agent/nimbus-sdk/issues/20)) ([fecb0c2](https://github.com/nimbus-agent/nimbus-sdk/commit/fecb0c27f1189880f8f919632c58e03d577be243))

## [1.4.1](https://github.com/nimbus-agent/nimbus-sdk/compare/sdk-v1.4.0...sdk-v1.4.1) (2026-07-22)


### Bug Fixes

* **sonar:** clear the 3 open SonarCloud issues ([#18](https://github.com/nimbus-agent/nimbus-sdk/issues/18)) ([e168f33](https://github.com/nimbus-agent/nimbus-sdk/commit/e168f339937319b5f2c63458735e7ddbbb4bb5a7))

## [1.4.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdk-v1.3.0...sdk-v1.4.0) (2026-07-20)


### Features

* make NimbusItem.itemType the real, open item-type vocabulary ([#11](https://github.com/nimbus-agent/nimbus-sdk/issues/11)) ([679d84a](https://github.com/nimbus-agent/nimbus-sdk/commit/679d84aac094e29d5f3334f034303edc519f9bef))


### Bug Fixes

* correct the item-type vocabulary against the real gateway writers ([#13](https://github.com/nimbus-agent/nimbus-sdk/issues/13)) ([17081bf](https://github.com/nimbus-agent/nimbus-sdk/commit/17081bf20a032b22148f05294c9881488982263b))
* stop pinning package.json version to a literal in the identity check ([#15](https://github.com/nimbus-agent/nimbus-sdk/issues/15)) ([cd7ddad](https://github.com/nimbus-agent/nimbus-sdk/commit/cd7ddade964c89f8670c6faeb94554573882c509))

## [1.3.0](https://github.com/nimbus-agent/nimbus-sdk/compare/sdk-v1.3.0...sdk-v1.3.0) (2026-07-15)


### Features

* **apple:** iCloud Mail + Calendar connector (Phase 6 Slice 9-E) ([#711](https://github.com/nimbus-agent/nimbus-sdk/issues/711)) ([c32e67a](https://github.com/nimbus-agent/nimbus-sdk/commit/c32e67a0805bd38e27eb91422f2b84835e1ec6eb))
* **docs:** implement sub-project B docs publish design ([5bf532a](https://github.com/nimbus-agent/nimbus-sdk/commit/5bf532acdf27fc43c8f0e27732b3e3b6c3fbe10e))
* **docs:** Sub-project B - Docs Publish and Package READMEs ([178afc9](https://github.com/nimbus-agent/nimbus-sdk/commit/178afc97f7d646cef97bf5cd59a514f74ffaf151))
* implement CI pipeline infrastructure and initialize UI package scaffolding ([34faece](https://github.com/nimbus-agent/nimbus-sdk/commit/34faece32f92fc740b93a63bbdb8dcd0109b905b))
* **phase-4:** WS4 Release Infrastructure — signing, auto-update, Plugin API v1, LAN remote access ([6523a81](https://github.com/nimbus-agent/nimbus-sdk/commit/6523a811ab0fa91143a475e25f1ac8fc869e51cb))
* **sandbox:** T2 PR 1 — Sandbox PAL + 3-OS isolation + I15 ([e143401](https://github.com/nimbus-agent/nimbus-sdk/commit/e14340159622fcc26e290e5ed1ae813c08ee202b))
* **sdk:** freeze Plugin API v1 — CHANGELOG + contract tests + version 1.0.0 ([2cabfd0](https://github.com/nimbus-agent/nimbus-sdk/commit/2cabfd0822b7dccffc8bd14aeaa490007db884d2))
* **sdk:** Plugin API v1 — AuditLogger + HitlRequest ([84cf95b](https://github.com/nimbus-agent/nimbus-sdk/commit/84cf95baa15b65425c4794f1fa97a1bf0df568c8))
* **sdk:** runSandboxContractTests + probe (T2 PR 1) ([0751c22](https://github.com/nimbus-agent/nimbus-sdk/commit/0751c224941e245b80de39965105a366705e7b72))


### Bug Fixes

* add repository field to client, sdk, and root for npm provenance ([#633](https://github.com/nimbus-agent/nimbus-sdk/issues/633)) ([f0b1b23](https://github.com/nimbus-agent/nimbus-sdk/commit/f0b1b23bfb227ea0dd4921224226695dc09c5e32))
* **ci:** unblock cross-platform test suite + SonarCloud reliability gate ([70bb289](https://github.com/nimbus-agent/nimbus-sdk/commit/70bb289f04046e51b7043535aae32cf4d87ff16f))
* **coverage-floor:** Sonar new-code coverage — mirror local exemptions + lift sandbox-contract (PR [#329](https://github.com/nimbus-agent/nimbus-sdk/issues/329)) ([5a0857d](https://github.com/nimbus-agent/nimbus-sdk/commit/5a0857d159260c60f3ba4474c4fa722eb27f7eba))
* **docs:** fix README links and add lychee exclusion for nimbus-agent.dev ([ba62971](https://github.com/nimbus-agent/nimbus-sdk/commit/ba62971b0e1f036539b266aaab61ed71ab17f88a))
* **sdk:** drop .ts extension on testing/index re-export (T2 PR 1 CI) ([1f38c12](https://github.com/nimbus-agent/nimbus-sdk/commit/1f38c12c0415749955ea2851a7189175fd58ff32))
* **sdk:** make runContractTests async, use await form in contract tests ([11ca1e3](https://github.com/nimbus-agent/nimbus-sdk/commit/11ca1e37810b41a5b1164e5bef1f5c236c333bff))
* **sdk:** point published entry points at dist so the package is usable ([#637](https://github.com/nimbus-agent/nimbus-sdk/issues/637)) ([5ea6e2e](https://github.com/nimbus-agent/nimbus-sdk/commit/5ea6e2ecc7f700185c2e83c0620f6a2e0960f6a7))
* **sdk:** remove .ts extensions from audit-logger and hitl-request imports ([08a318c](https://github.com/nimbus-agent/nimbus-sdk/commit/08a318c3a2587b68c864c0277f6fe115cbe36952))
* **sonar:** clear the SonarCloud board — S5906 sweep + long-tail code smells ([#731](https://github.com/nimbus-agent/nimbus-sdk/issues/731)) ([7fcac9d](https://github.com/nimbus-agent/nimbus-sdk/commit/7fcac9d67b97cc9c56e68bdfbc869538c1114ce5))
* **ws4:** address second round of SonarCloud warnings ([e249585](https://github.com/nimbus-agent/nimbus-sdk/commit/e249585f191b09ede4d141df510460d71c3dedd5))


### Continuous Integration

* open release PR with RELEASE_PLEASE_PAT (org blocks GITHUB_TOKEN PRs) ([d0ef1bf](https://github.com/nimbus-agent/nimbus-sdk/commit/d0ef1bff8f823a89fb60e73ffd5811607cb2a8c7))

## [1.2.1](https://github.com/nimbus-agent/Nimbus/compare/sdk-v1.2.0...sdk-v1.2.1) (2026-06-23)


### Bug Fixes

* **sonar:** clear the SonarCloud board — S5906 sweep + long-tail code smells ([#731](https://github.com/nimbus-agent/Nimbus/issues/731)) ([3a87e54](https://github.com/nimbus-agent/Nimbus/commit/3a87e54a7335c1be87ecb582673183b242b97c88))

## [1.2.0](https://github.com/nimbus-agent/Nimbus/compare/sdk-v1.1.2...sdk-v1.2.0) (2026-06-22)


### Features

* **apple:** iCloud Mail + Calendar connector (Phase 6 Slice 9-E) ([#711](https://github.com/nimbus-agent/Nimbus/issues/711)) ([58c69e0](https://github.com/nimbus-agent/Nimbus/commit/58c69e09fba285b03b94eed60f69751103da1bf3))

## [1.1.2](https://github.com/nimbus-agent/Nimbus/compare/sdk-v1.1.1...sdk-v1.1.2) (2026-06-14)


### Bug Fixes

* add repository field to client, sdk, and root for npm provenance ([#633](https://github.com/nimbus-agent/Nimbus/issues/633)) ([f0e7f07](https://github.com/nimbus-agent/Nimbus/commit/f0e7f075d755c8b4a006911b513979f289fa192f))

## [1.1.1](https://github.com/nimbus-agent/Nimbus/compare/sdk-v1.1.0...sdk-v1.1.1) (2026-05-22)


### Bug Fixes

* **ci:** unblock cross-platform test suite + SonarCloud reliability gate ([c75dbab](https://github.com/nimbus-agent/Nimbus/commit/c75dbab037d98b9c51df38b0ea7769089c52418a))

## [1.1.0](https://github.com/nimbus-agent/Nimbus/compare/sdk-v1.0.0...sdk-v1.1.0) (2026-05-17)


### Features

* **sandbox:** T2 PR 1 — Sandbox PAL + 3-OS isolation + I15 ([e668244](https://github.com/nimbus-agent/Nimbus/commit/e668244a42858d810a4e82c777c5d9565ddc3a10))
* **sdk:** runSandboxContractTests + probe (T2 PR 1) ([633b464](https://github.com/nimbus-agent/Nimbus/commit/633b464336aa8196550d8db9748858317bb385dd))


### Bug Fixes

* **coverage-floor:** Sonar new-code coverage — mirror local exemptions + lift sandbox-contract (PR [#329](https://github.com/nimbus-agent/Nimbus/issues/329)) ([51b101e](https://github.com/nimbus-agent/Nimbus/commit/51b101e0c9c20462bbd7005bb863efe546647bb6))
* **sdk:** drop .ts extension on testing/index re-export (T2 PR 1 CI) ([51b218c](https://github.com/nimbus-agent/Nimbus/commit/51b218c981fec8189829fca29181c6fc0d729a30))

## 1.0.0 — 2026-04-19 — Plugin API v1 (stable)

First stable release. The following surface is frozen under semver — breaking changes require a major-version bump.

### Stable exports

| Export | Kind | Purpose |
|---|---|---|
| `ExtensionManifest` | type | Extension manifest shape |
| `NimbusItem` | type | Canonical item shape returned by connectors |
| `NimbusExtensionServer` | class | MCP server scaffolding for extensions |
| `MockGateway` | class | In-process Gateway stub for extension tests |
| `runContractTests` | function | Validates an extension against the v1 contract |
| `ExtensionContractError` | class | Thrown by `runContractTests` on violation |
| `AuditLogger` | type | Interface for scoped audit-log writes (new in v1) |
| `AuditEmit` | type | Function shape the Gateway injects (new in v1) |
| `createScopedAuditLogger` | function | Constructs a scoped logger (new in v1) |
| `HitlRequest` | type | Shape returned by a tool to request consent (new in v1) |
| `isHitlRequest` | function | Runtime type guard (new in v1) |

### Stability guarantee

- Removing any of the above exports requires a major version bump to v2.
- Adding a new required field to any v1 type requires a major version bump.
- Adding optional fields, new exports, or relaxing constraints is a minor bump.

### Out of scope for v1 (deferred)

- `NimbusTool`, `NimbusToolHandler`, `McpServerBuilder`, `ItemSchema`, `PersonSchema` — deferred until a real extension-author use case appears.
