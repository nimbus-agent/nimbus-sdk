# RFC-0013 — Promote the Go SDK to official, and pin what "the full conformance suite" means

- **Status:** accepted
- **Opened:** 2026-08-22
- **Landed:** 2026-08-22 in [#153](https://github.com/nimbus-agent/nimbus-sdk/pull/153)
- **Affects:** [`GOVERNANCE.md`](../GOVERNANCE.md) (the named SDK owner, and the reading of
  criterion 1), the roadmap, the docs README, `sdks/go/README.md`. No code, no contract,
  no corpus
- **Roadmap:** [Phase 3](../ROADMAP.md#phase-3--scale-languages--batteries) — closes the
  promotion half of the "official Go SDK" box, whose conformance half closed with
  [#148](https://github.com/nimbus-agent/nimbus-sdk/pull/148)
- **Pillars:** 2 (polyglot SDKs), 5 (provenance), 9 (governance)
- **Builds on:** [RFC-0012](./0012-go-sdk-binding.md), which specified the binding, its tag
  format and its release model while deliberately claiming none of the four criteria;
  [RFC-0008](./0008-python-sdk-official.md), which is both the template for this document
  and the precedent its central normative act rests on

## Problem

[`GOVERNANCE.md`](../GOVERNANCE.md#how-a-language-becomes-official) promotes a language
binding from community to **official** when four things are true, the fourth being "an RFC
recording the above is accepted" — so promotion is not a status someone sets, it is a
document someone writes. This is that document, for Go.

It has a second job. Criterion 1 is five words long — *"It passes the full conformance
suite in CI"* — and **eight corpora are published**, of which the Go binding executes four.
Read literally, criterion 1 would block Go's promotion forever, on corpora whose surfaces
Go does not publish and has no plan to. Left unread, it says nothing at all. The same
document says the detailed criteria "will be refined as the second and third bindings
land"; Go is the third, so this is the moment that refinement was scheduled for.

## The four criteria

### 1. It passes the full conformance suite in CI

**"Full" means every published corpus whose surface the binding publishes.** That is the
normative act of this RFC, and it is a reading of existing practice rather than a new
standard — see the precedent below.

Under that reading Go passes, and the numbers are these. The tree publishes **eight**
corpora in two shapes: six carry their own `index.json` under
`docs/spec/conformance/v1/<corpus>/`, and two — `manifest` and `item` — are fixture sets
listed in the `fixtures` array of the *top-level*
[`conformance/v1/index.json`](../spec/conformance/v1/index.json), with their case files
sitting directly in the corpus directory and no `cases/` subdirectory.

| Corpus | Shape | Cases | Go | Python | TypeScript |
|---|---|---|---|---|---|
| `negotiation` | own index | 38 — 16 `negotiate`, 15 `hello`, 7 `declaration` | **all** | all | all |
| `framing` | own index | 25 | **all** | all | all |
| `diagnostics` | own index | 75 — 64 `encode`, 6 `parse`, 5 `level` | **all** | all | all |
| `url-resolution` | own index | 28 | **all** | all | all |
| `predicates` | own index | 33 | out of scope | out of scope | all |
| `sandbox` | own index | 31 | out of scope | out of scope | all |
| `manifest` | top-level `fixtures` | 31 | out of scope | out of scope | all |
| `item` | top-level `fixtures` | 6 | out of scope | out of scope | all |
| **Total** | | **267** | **166 in 4 corpora** | 166 in 4 | 267 in 8 |

Every count above was derived from the index files, not transcribed from prose. The four
Go executes are exactly the four Python executes, and nothing is deferred in any of them:
`DEFERRED_KINDS` is empty in Python, `deferredKinds` is empty in Go, and each Go runner
fails when a *kind* filter matches zero cases, so the coverage cannot silently narrow.

**Why the other four are out of scope, not missing.** `predicates` and `sandbox` bind
surfaces Go does not publish and that RFC-0012 did not propose. `manifest` and `item` need
JSON Schema validation, which under this repository's dependency-free rule means
hand-writing a validator — a separate project with its own justification, and one Python
has not taken either. `docs/spec/README.md` already states that `predicates` and `sandbox`
carry no language-neutrality evidence at all, because only the reference implementation
runs them.

**The precedent, which is what makes this a reading rather than an invention.**
[RFC-0008](./0008-python-sdk-official.md) promoted Python on a table of **two** corpora,
described in that document as "both published corpora". At its acceptance on 2026-07-31
the tree in fact published **six** — `predicates` and `sandbox` landed 2026-07-29 in
[#59](https://github.com/nimbus-agent/nimbus-sdk/pull/59) and
[#61](https://github.com/nimbus-agent/nimbus-sdk/pull/61), and the `manifest` / `item`
fixture index on 2026-07-28 in [#38](https://github.com/nimbus-agent/nimbus-sdk/pull/38).
So the operative reading of criterion 1 has been "every corpus whose surface the binding
publishes" since the first promotion; it was simply never written down. Applying the
literal reading now would not only block Go, it would retroactively unpromote Python.

**In CI**, on every pull request: `.github/workflows/ci.yml`'s `go` job runs `gofmt -l`,
`go vet`, `go build` and `go test ./...` across **Go 1.26 and 1.27** on **Linux, macOS and
Windows** — six legs — with `GOTOOLCHAIN=local` and `NIMBUS_SPEC_DRIFT=required`, the
latter turning the two guards that skip on a missing file into failures.

### 2. It publishes with the strongest provenance its ecosystem supports

Go's answer is **different in kind** from npm's and PyPI's, and
[`RELEASING.md`](../RELEASING.md#go--module-proxy-implemented-and-exercised) argues it out
rather than smoothing it over. In short:

- **There is no publish credential at all.** A Go module is published by *tagging a
  commit*; `proxy.golang.org` fetches it from the VCS on first request. There is no
  `GO_TOKEN` to leak, which is a stronger statement than "the token is short-lived".
- **The load-bearing guarantee is `sum.golang.org`** — a public append-only transparency
  log of module hashes that *every* `go` client verifies automatically, with no opt-in and
  no extra command. Broader in reach than npm provenance, which most installs never check;
  narrower in claim, since it attests that the bytes are unchanged rather than where they
  were built.
- **SLSA provenance is attached as a supplement**, to a `git archive` of `sdks/go` at the
  tag — deliberately *not* to the zip `go get` fetches, which `proxy.golang.org`
  synthesizes and which cannot be reproduced byte-for-byte without a dependency this
  module refuses to take. The attestation attests what was tagged, not what was served,
  and `RELEASING.md` says so.
- **Verified from outside any checkout.** The `verify` job runs `go mod init` in a fresh
  temporary directory, `go get`s the published version through the public proxy, and
  requires a `go.sum` entry for it.
- **No tag signing**, because conventional `git tag -s` would put a long-lived private key
  into the one language here that needs no publish credential — inverting the property Go
  demonstrates most cleanly. Keyless signing (Sigstore `gitsign`) remains open.

Demonstrated end to end on **`sdks/go/v0.1.0` through `v0.6.0`**, all released this way,
`release-go.yml` green on each: `proxy.golang.org` serves the module, `sum.golang.org`
records its hashes, and `pkg.go.dev` renders the docs. Measured on the newest of them
rather than inferred from the workflow — a consumer module outside any checkout resolves
`v0.6.0` through the public proxy and its `contract.SDKVersion()` reports `"v0.6.0"`,
under `go run`, from a built binary, and under `-mod=vendor`.

### 3. It has a named SDK owner

**Asaf Golombek** ([@AsafGolombek](https://github.com/AsafGolombek)) owns the Go SDK:
responsible for keeping it conformant across contract changes, and for its releases and
the provenance of those releases. The same owner `GOVERNANCE.md` records for Python.

As with RFC-0008, the name goes into
[`GOVERNANCE.md`'s **SDK owners** role](../GOVERNANCE.md#roles) and not only here, because
criterion 3 is worded to be checkable *from that document*. An owner named only inside an
RFC does not satisfy it.

### 4. An RFC recording the above is accepted

This one.

## What changes

Nothing in the contract, the corpora, the schemas, or any binding. Five documents:

| File | Change |
|---|---|
| `docs/GOVERNANCE.md` | names the Go SDK owner under **SDK owners**; records this RFC's reading of criterion 1 |
| `docs/rfcs/README.md` | the index row for this RFC |
| `docs/ROADMAP.md` | Phase 3's Go box becomes a record of promotion instead of a list of what is missing |
| `docs/README.md` | Go's status becomes **Official**, and its stale one-corpus description is corrected |
| `sdks/go/README.md` | the Status section stops saying officiality is still outstanding |

## What promotion does not claim

Recorded because an "official" label invites a stronger reading than the criteria support,
and because every item here is already documented elsewhere in this repository.

- **It does not claim Go behaves identically to the other bindings on every input.** Three
  differences are documented in `CLAUDE.md`: the number of U+FFFD an invalidated
  multi-octet UTF-8 prefix produces (Go emits one per leftover octet where the WHATWG
  maximal-subpart rule emits one in total, which can change whether a frame exceeds §6's
  limit); Go's answer to `diagnostics.md` §8's explicitly undefined `extensionId` case; and
  `encoding/json`'s sorting of map keys. **None is pinned by any corpus case**, and the
  first two sit on inputs the normative documents declare undefined. A future case that
  pinned a verdict would make whichever binding disagrees non-conformant — which is
  precisely why they are written down now, while they are still differences.
- **It does not claim surface parity.** Go publishes an emitter Python does not; Python
  publishes `format_timestamp` and `spec_root()` Go does not; Go's `IsContractVersion` is
  public where both others keep it private. `CLAUDE.md`'s Go section is the inventory.
- **It does not widen the contract, cut a release, or change any published surface.**

## Compatibility impact

None. No published surface, wire format, schema, or corpus case is touched, in any of the
three languages. This is a governance record, and no consumer of any package is affected.

## Migration

None.

## Alternatives rejected

**Read criterion 1 literally — all eight corpora.** Rejected. It would block Go
permanently on `predicates` and `sandbox`, which bind surfaces Go does not publish, and on
`manifest` and `item`, which need a hand-written JSON Schema validator under the
dependency-free rule. Worse, it is not the standard the project has actually applied: it
would retroactively unpromote Python, which was promoted on two corpora of six. A criterion
no binding has ever met is not a criterion.

**Amend criterion 1's wording instead of recording a reading.** Partly adopted, and this is
the one place this RFC departs from RFC-0008's shape. RFC-0008 left criterion 3
unverifiable from the governance document until it added the owner's name there; the same
argument applies to criterion 1's meaning, so this RFC writes the reading into
`GOVERNANCE.md` as well as recording it here. What it does *not* do is rewrite the
criterion itself — the five words stay, with the reading beneath them, so the promotion
standard is not silently redefined by a document promoting a binding under it.

**Wait until Go binds the remaining four corpora.** Rejected on the same grounds RFC-0008
rejected waiting for unrelated roadmap boxes: the criteria concern conformance,
provenance, ownership and process, not feature completeness. `manifest` and `item` in
particular are a validator project, and holding officiality behind it would apply a
standard Python was never held to.

**Promote at Shipment 1, or at 2a.** Rejected at the time and correctly: criterion 1 was
not true. Go executed one corpus at Shipment 1 and three after 2b. The promotion waited for
`url-resolution` in [#148](https://github.com/nimbus-agent/nimbus-sdk/pull/148), which is
what made the four complete.

**Fix the divergences first.** Rejected. The U+FFFD count is inherited from
`utf8.DecodeRune` and the §8 answer from `encoding/json`; neither is pinned by a corpus,
and both sit where the normative documents are silent or explicitly undefined. Closing
those holes is a contract change for all three bindings and belongs in an RFC of its own.
Blocking promotion on it would hold Go to a standard no binding is currently held to.

**Name a group rather than a person.** Rejected for the same reason as in RFC-0008:
criterion 3 says "a named SDK owner", singular and accountable. Today there is one
maintainer, and recording that honestly beats implying a bench that does not exist.

## How it is enforced

Weakly, and deliberately so — this is a governance record, not a mechanism. What *is*
enforced mechanically is criterion 1: the four corpora run on every pull request in all
three languages, from the same `index.json` files, and the anti-vacuity guards fail if a
kind ever goes unexecuted. Criterion 2 is enforced by `release-go.yml`'s `verify` job,
which resolves the published version through the public proxy and requires a `go.sum`
entry before the release is green.

Criteria 3 and 4 are social. If the named owner changes, that is an edit to
`GOVERNANCE.md`; if the binding stops passing the four corpora, criterion 1 fails in CI and
the promotion should be revisited by a further RFC rather than quietly ignored.

## Out of scope

- **TypeScript's own official status.** RFC-0008 recorded the asymmetry — the reference
  implementation has never been through this process — and left it open deliberately. This
  RFC does not resolve it either.
- **A Rust binding**, which Phase 3 lists beside Go and which nothing here anticipates.
- **The remaining Go gaps**: the connector kit's transport, tool router and REST factories,
  which are out of Python's shipped surface too.
- **Adding Go to Sonar**, still one decision for Python and Go together.
- **Any change to the contract, the corpora, or any published surface.**
