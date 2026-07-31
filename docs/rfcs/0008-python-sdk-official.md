# RFC-0008 — Promote the Python SDK to official

- **Status:** draft — flips to **accepted** when this lands, per the
  [status definitions](./README.md#statuses), which reserve *accepted* for a change that
  has landed and require its landing location to be recorded
- **Opened:** 2026-07-31
- **Landed:** —
- **Affects:** [`GOVERNANCE.md`](../GOVERNANCE.md) (the named SDK owner), the roadmap, the
  repository README. No code, no contract, no corpus
- **Roadmap:** [Phase 2](../ROADMAP.md#phase-2--prove-polyglot-with-python) — completes the
  promotion half of box 1, whose conformance half closed with
  [#84](https://github.com/nimbus-agent/nimbus-sdk/pull/84)
- **Pillars:** 2 (polyglot SDKs), 5 (provenance), 9 (governance)
- **Builds on:** [RFC-0005](./0005-contract-version-negotiation.md) and
  [RFC-0006](./0006-empty-vs-invalid-negotiation.md), which specified and then pinned the
  contract the Python binding implements; [RFC-0007](./0007-corpus-gaps-from-the-python-binding.md),
  which closed the two corpus gaps that building that binding exposed

## Problem

[`GOVERNANCE.md`](../GOVERNANCE.md#how-a-language-becomes-official) says a language SDK is
promoted from community to **official** when four things are true. It also says the fourth
is "an RFC recording the above is accepted" — so the promotion is not a status someone
sets, it is a document someone writes. This is that document.

Python has met the first two criteria for some time without anything recording it. The
[roadmap](../ROADMAP.md#phase-2--prove-polyglot-with-python) currently carries a note
listing what officialdom still needs, which is the right place for a gap and the wrong
place for a decision.

## The four criteria

### 1. It passes the full conformance suite in CI

Both published corpora execute in Python, from the same `index.json` files the TypeScript
guards read:

| Corpus | Cases | Python coverage |
|---|---|---|
| `negotiation` | 37 — 16 `negotiate`, 15 `hello`, 6 `declaration` | all three kinds; `DEFERRED_KINDS` is empty |
| `framing` | 25 | all |

The `hello` kind was skipped until [#84](https://github.com/nimbus-agent/nimbus-sdk/pull/84),
and the framing corpus was consumed by no Python code at all. Both gaps are closed, and
`test_every_corpus_kind_is_accounted_for` fails by design if a new kind appears, so the
coverage cannot silently narrow again.

The suite runs on **Python 3.11, 3.12, 3.13 and 3.14**, each on **Linux, macOS and
Windows**, alongside `ruff`, `ruff format --check`, and `mypy --strict` over `src`, `tests`
and `scripts`.

### 2. It publishes with the strongest provenance its ecosystem supports

- **Trusted Publishers via GitHub OIDC. There is no `PYPI_TOKEN` secret** — the workflow's
  identity *is* the credential.
- **PEP 740 attestations** attached at publish, the closest PyPI equivalent to npm's
  `--provenance`.
- A **pre-publish dist gate** that asserts what is about to ship, and a **post-publish
  verification job** that installs the artifact from PyPI and checks its attestation
  against the Sigstore trust root before the release is green.

Demonstrated end to end on `nimbus-dev-sdk` **0.2.0**: release PR merged, published
tokenlessly, attestation verified after the fact.

That verification is deliberately more than a formality. The publish job failed on 0.1.2
and the release was never uploaded — caught by the gate rather than discovered later — and
[#83](https://github.com/nimbus-agent/nimbus-sdk/pull/83) fixed the cause. A provenance
story that has been observed failing safely is worth more than one that has never been
tested.

### 3. It has a named SDK owner

**Asaf Golombek** ([@AsafGolombek](https://github.com/AsafGolombek)) owns the Python SDK:
responsible for keeping it conformant across contract changes, and for its releases and
their provenance.

`GOVERNANCE.md`'s **SDK owners** role described the responsibility generically and named
nobody, which made criterion 3 unverifiable from the governance document itself. This RFC
adds the name there, so the criterion is satisfied by the document that defines it rather
than only by the RFC that cites it.

### 4. An RFC recording the above is accepted

This one.

## What changes

Nothing in the contract, the corpora, the schemas, or either binding. Three documents:

| File | Change |
|---|---|
| `docs/GOVERNANCE.md` | names the Python SDK owner under **SDK owners** |
| `docs/ROADMAP.md` | Phase 2's note becomes a record of promotion instead of a list of what is missing |
| `README.md` | Python's status becomes **Official** |

## Compatibility impact

None. No published surface, wire format, schema, or corpus case is touched, in either
language. This is a governance record; no consumer of either package is affected, and no
release is cut.

## Migration

None.

## Alternatives rejected

**Leave the promotion implicit.** Python already met criteria 1 and 2, and one could argue
the roadmap's checked box says enough. Rejected: `GOVERNANCE.md` defines *official* as
requiring a named owner and an accepted RFC, so "implicitly official" is not a state the
governance document admits. Worse, it would leave the README and the roadmap asserting
something the governance rules contradict — the same class of drift
[RFC-0007](./0007-corpus-gaps-from-the-python-binding.md) exists to prevent, one layer up.

**Promote TypeScript in the same document.** TypeScript is the reference implementation
and has never been through this process: there is no RFC declaring it official, and
`GOVERNANCE.md`'s criteria are written generally enough to apply to it. Rejected as
backwards — promoting the reference implementation as a side effect of promoting the
second binding inverts the relationship between them, and TypeScript's position deserves
its own record if one is wanted. **The asymmetry is real and is left open deliberately**,
not overlooked.

**Wait for the remaining Phase 2 boxes.** Scaffolding, quickstarts, and the diagnostics
contract are still open. Rejected: `GOVERNANCE.md`'s criteria concern conformance,
provenance, ownership and process — not feature completeness. Holding the promotion until
unrelated boxes close would apply a standard the governance document does not state.

**Name a group rather than a person.** Rejected for now: criterion 3 says "a named SDK
owner", singular and accountable. A group is the right answer when there is one; today
there is one maintainer, and recording that honestly is better than implying a bench that
does not exist. `GOVERNANCE.md` already anticipates this changing as the project moves
toward a multi-party body.

## How it is enforced

Weakly, and deliberately so — this is a governance record, not a mechanism.

What *is* enforced mechanically is criterion 1: the conformance suite runs on every pull
request in both languages, and `test_every_corpus_kind_is_accounted_for` fails if a corpus
kind ever goes unexecuted in Python. Criterion 2 is enforced by the release workflow's
pre-publish gate and post-publish verification, both of which have to pass before a release
is green.

Criteria 3 and 4 are social. If the named owner changes, that is an edit to
`GOVERNANCE.md`; if the binding stops passing the suite, criterion 1 fails in CI and the
promotion should be revisited by a further RFC rather than quietly ignored.

## Out of scope

- **TypeScript's own official status**, per the rejected alternative above.
- **The remaining Phase 2 boxes** — scaffolding, per-language quickstarts, and the
  diagnostics contract.
- **Any change to the contract, the corpora, or either published surface.**
- **The multi-party governance body**, which `GOVERNANCE.md` places in
  [Phase 3](../ROADMAP.md#phase-3--scale-languages--batteries).
