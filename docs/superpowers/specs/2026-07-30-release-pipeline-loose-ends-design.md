# Release-pipeline loose ends — cryptographic PyPI verification and a self-calibrating dist gate

**Status:** approved design, not yet implemented
**Date:** 2026-07-30
**Roadmap:** no box. [Phase 2](../../ROADMAP.md#phase-2--prove-polyglot-with-python) boxes 5–7
are closed; this pays down debt those boxes knowingly took on. It does not open or close a
checkbox.
**Governance:** not contract-affecting. Nothing here touches `docs/spec/`, the wire protocol,
or any published shape, so no RFC is required under the
[RFC process](../../GOVERNANCE.md#the-rfc-process).
**Semver:** every commit is `ci:` or `test:`. No release is cut by this work — which matters,
because the new files live under `sdks/python/`, a release-please package path (see
*Attribution hazard*).

---

## Goal

Make [`RELEASING.md`](../../RELEASING.md) guarantee #5 true for Python in the same sense it is
true for TypeScript. Today it says PyPI's post-publish check is a **claims check** and carries
an explicit "not yet cryptographic" caveat. Replace it with real Sigstore signature
verification, then delete the caveat because it is no longer accurate.

Alongside it, close two parked minors in the same workflow: strengthen the pre-publish dist
gate, and stop the publisher tuple from going stale after a rename.

## What this is not

- **Not a change to how anything is published.** `publish-python` still builds with
  `python -m build` and uploads with `pypa/gh-action-pypi-publish`. Only the *gate before* the
  upload and the *verification after* it change.
- **Not the Python IPC binding, the RFC on empty-vs-invalid negotiation cases, or
  scaffolding.** Those are sub-projects B, C, and D of the same brief and get their own specs.
- **Not a reusable release workflow.** Phase 3 box 5, untouched.
- **Not a new dependency-automation system.** `.github/dependabot.yml` already exists; this adds
  one `pip` ecosystem entry to it (Component 6). It does not introduce Renovate or restructure
  the existing npm and github-actions blocks.
- **Not a change to the npm pipeline.** `verify-npm-provenance` already verifies
  cryptographically; nothing about the TypeScript job moves.

## What was verified before designing, not assumed

Every claim below was executed against the live, published `nimbus-dev-sdk 0.1.0` and its real
PyPI provenance document. This is the same discipline the current inline check was built with
(it was validated against `pydantic 2.13.4` before landing).

| Claim | Result |
|---|---|
| `pypi-attestations` verifies this project's real attestation | **passes** — returns `https://docs.pypi.org/attestations/publish/v1` |
| A tampered artifact digest is rejected | rejected — *"subject does not match distribution digest"* |
| A wrong artifact filename is rejected | rejected — *"subject does not match distribution name"* |
| A wrong `repository` is rejected | rejected — *OIDCSourceRepositoryURI* mismatch |
| A wrong `workflow` is rejected | rejected — *Build Config URI* mismatch |
| **A wrong `environment` is rejected** | **NO — it passes.** `GitHubPublisher` does not enforce `environment` at all |
| The commit SHA is reachable as a parsed X.509 extension | yes — OID `1.3.6.1.4.1.57264.1.13` = `9d960d8a5cca31da8482192cc3010a29b0b8b81a` |
| The environment is reachable from the certificate | yes — OID `1.3.6.1.4.1.57264.1.23` = `pypi` |
| `predicate` is null, so `verify()` returns no claims | confirmed — `claims is None` |
| Wheel and sdist `_data/` **relative paths** are identical | yes — 181 each, zero on either side only |
| `tarfile.getnames()` inflates the sdist count with directories | **no** — hatchling emits no directory members; 181 either way |
| **Fulcio v2 extensions (`.1.8`+) wrap the value in an ASN.1 `UTF8String`** | **yes** — `.value.decode()` on `.1.23` yields `'\x0c\x04pypi'`, not `'pypi'`. Legacy `.1.1`–`.1.6` are raw |
| Sigstore ships policy classes covering these extensions | yes — `OIDCSourceRepositoryDigest`, `OIDCBuildConfigURI`, `OIDCSourceRepositoryURI`, `OIDCIssuerV2`, composable with `AllOf`, DER handled internally |
| A wrong commit SHA is rejected by the composed policy | rejected — *OIDCSourceRepositoryDigest does not match* |
| Sigstore has a policy class for the environment OID `.1.23` | **no** — exports stop at `.1.22` |
| `https://github.com/$GITHUB_WORKFLOW_REF` equals the Build Config URI | yes, verbatim including the `@refs/heads/main` suffix |

Four of these overturned a working assumption and changed the design. They are called out where
they bite. The DER one would have reddened every release.

## Decisions taken

| Question | Decision | Why |
|---|---|---|
| Replace or supplement the claims check? | **Replace.** Cryptographic `verify()` plus two certificate-derived assertions | Everything the claims reader asserted becomes signature-backed. Keeping both would mean two independent ways to redden one artifact, asserting the same facts. |
| Where do expected values come from? | **Our side** — `github.repository`, the derived workflow, our env constant | Passing PyPI's own `publisher` object into the policy asks PyPI to grade its own homework. This is the single most important line in the design. |
| How expectations are expressed | A composed `AllOf` **policy**, not `GitHubPublisher` + manual parsing | Sigstore ships tested policy classes covering repository, build config, issuer, and commit — including their ASN.1 handling. A superset of `GitHubPublisher`. |
| Commit SHA check | `OIDCSourceRepositoryDigest` (OID `…57264.1.13`) | Replaces bytes-containment against the base64-DER blob, with library code rather than ours. |
| Environment check | OID `…57264.1.23`, DER-decoded via `pyasn1` | **Required**, not belt-and-braces: `verify()` demonstrably passes a wrong environment. No sigstore policy class exists above `.1.22`. |
| Workflow in the policy | `https://github.com/$GITHUB_WORKFLOW_REF`, whole and unparsed | It *is* the Build Config URI verbatim. No basename extraction, no hardcoded ref. |
| Environment name in the tuple | One workflow-level `env.PYPI_ENVIRONMENT`, guarded by a PR-time test | `jobs.<id>.environment` cannot read the `env` context, so one literal is unavoidable. The guard makes drift fail on the PR that causes it, not after a publish. |
| Dependency pinning | Hash-locked `verify-requirements.txt`, `--require-hashes` | This tool decides whether a release is trustworthy. The repo pins every action to a SHA; this is the analogue. |
| Sigstore trust root | **Online** (the default), not `offline=True` | An offline root is the bundled one and goes stale exactly when a log key rotates. Rotation is live: the production root already carries both `rekor.sigstore.dev` and `log2025-1.rekor.sigstore.dev`. |
| Script placement | `sdks/python/scripts/verify_publish.py` | Inherits ruff, mypy, and pytest with one word of config. Accepts an attribution hazard, contained below. |
| Dist gate assertion | **Set equality of relative paths**, not count parity | Count parity passes if the wheel holds file A and the sdist holds file B. Measurement showed the path sets are already identical, so the stronger assertion costs nothing. |

---

## Component 1 — `sdks/python/scripts/verify_publish.py`

A pure core with a thin I/O shell. The split exists so every assertion is reachable from a
test that needs no network and no release.

| Layer | Contents |
|---|---|
| **Pure** | `build_config_uri(workflow_ref)`, `expected_policy(repo, workflow_ref, sha)`, `certificate_environment(cert)` and its comparison |
| **Shell** | read the provenance JSON, `Distribution.from_file`, `Attestation.verify(...)`, `__main__` and its exit code |

### Composing a policy, not parsing a certificate

`Attestation.verify()` accepts `VerificationPolicy | Publisher`. Passing a **composed policy**
is strictly better than passing `GitHubPublisher` and then parsing the certificate by hand:
`sigstore.verify.policy` already ships tested classes for these extensions, including the
ASN.1 handling (see *The DER trap*).

```python
AllOf([
    OIDCIssuerV2("https://token.actions.githubusercontent.com"),
    OIDCSourceRepositoryURI(f"https://github.com/{repo}"),
    OIDCBuildConfigURI(f"https://github.com/{workflow_ref}"),
    OIDCSourceRepositoryDigest(sha),          # the commit — OID .1.13
])
```

This is a **superset** of what `GitHubPublisher` enforces (which covers only repository and
build-config URI), adding the issuer and the commit. Mutation-verified against the live
artifact: a wrong SHA is rejected by `OIDCSourceRepositoryDigest`, a wrong workflow by
`OIDCBuildConfigURI`.

`GitHubPublisher` is therefore not used. Its one remaining attraction was convenience, and it
does not enforce `environment` anyway.

### The DER trap

Fulcio's **v2** extensions (OID `.1.8` and above) wrap their value in an ASN.1 `UTF8String`;
the **legacy** ones (`.1.1`–`.1.6`) store it raw. Both OIDs this design needs are v2:

```
cert.extensions.get_extension_for_oid(OID_1_23).value.value.decode()
  -> '\x0c\x04pypi'        # tag 0x0c, length 0x04 — NOT 'pypi'
```

A naive `.decode()` never equals the expected value, so the guard would fail **every** release —
fail-closed, so not dangerous, but broken. Slicing `[2:]` is not the fix either: DER length is
multi-byte above 127 octets, which `.1.9` and `.1.21` are close to today.

Sigstore's policy classes handle this internally, which is why the SHA check is expressed as
`OIDCSourceRepositoryDigest` rather than as certificate parsing.

**`.1.23` has no policy class** — sigstore's exports stop at `.1.22`
(`OIDCSourceRepositoryVisibility`). It is decoded with the same primitives sigstore uses
internally, `pyasn1`'s `der_decode` against a `UTF8String` spec, asserting zero trailing
octets. `pyasn1` is already in the locked closure as a sigstore dependency, so this adds
nothing.

Relying on an OID that sigstore does not name is a small, stated risk: it is unversioned and
could move. It is accepted because the alternative is not checking `environment` at all, and
the value was confirmed empirically (`pypi`) against the live certificate. `.1.24` carries the
same fact inside the OIDC subject (`repo:…:environment:pypi`) and is the fallback if `.1.23`
ever disappears.

### Error model

Each failure raises a distinct exception type naming the assertion that failed. A test then
asserts *which* guard fired, rather than matching a message substring — so a refactor that
accidentally makes a different guard catch the same mutation fails loudly instead of passing.

### Reading the provenance

The provenance JSON is read with an **explicit `encoding="utf-8"`**.

This is not incidental. While validating the design on Windows, reading it with Python's
default locale encoding decoded the UTF-8 em-dash of the Sigstore checkpoint as cp1252
mojibake (`0xe2, 0x20ac, 0x201d`). The checkpoint's signature line then failed the
`— (\S+) (\S+)\n` parse, producing zero parsed signatures and a **completely misleading**
`checkpoint: Signature not found for log ID c0d23d6a…` — which reads like a Sigstore trust
failure and is nothing of the kind.

CI runs on `ubuntu-24.04` where the default is UTF-8, so the existing inline
`json.load(open(...))` gets away with it. The extracted script will not depend on the runner's
locale for a security check.

### What `verify()` covers, and what it does not

```
Attestation.verify(expected_policy, Distribution.from_file(wheel))
    ├── subject digest matches the downloaded bytes   ✔ always enforced
    ├── subject name matches the wheel filename       ✔ always enforced
    ├── repository                                    ✔ OIDCSourceRepositoryURI
    ├── workflow                                      ✔ OIDCBuildConfigURI
    ├── issuer                                        ✔ OIDCIssuerV2
    ├── commit SHA                                    ✔ OIDCSourceRepositoryDigest
    └── environment                                   ✘ no policy class → OID .1.23, decoded
```

The single `✘` row is why this component is more than a one-line library call.

## Component 2 — workflow wiring

In `.github/workflows/release.yml`:

- A workflow-level `env: PYPI_ENVIRONMENT: pypi`, declared once.
- `publish-python` keeps `environment: pypi` as a literal — `jobs.<id>.environment` accepts
  only the `github`, `needs`, `vars`, and `inputs` contexts, not `env`. Component 4 guards it.
- **No basename extraction at all.** `https://github.com/$GITHUB_WORKFLOW_REF` *is* the Build
  Config URI verbatim — confirmed against the live certificate, where `.1.18` reads
  `https://github.com/nimbus-agent/nimbus-sdk/.github/workflows/release.yml@refs/heads/main`.
  The whole value is passed to `OIDCBuildConfigURI`, so nothing is parsed and nothing is
  hardcoded, including the ref. PyPI's basename form (`release.yml`) is only relevant to the
  integrity document's `publisher` object, which this design no longer reads.
- Dependencies install with
  `python -m pip install --require-hashes -r sdks/python/verify-requirements.txt`.
- The existing download-with-retry step is unchanged; propagation lag handling already works.

### "Self-healing" is bounded — it means no code change, not zero touch

Deriving from `GITHUB_WORKFLOW_REF` means renaming `release.yml` requires **no commit to the
verifier**. It does not make a rename free:

- **PyPI's Trusted Publisher binding names the workflow filename**, and it lives in PyPI
  project settings, not in this repo. A rename without updating it means the OIDC exchange
  finds no matching pending publisher and the **upload fails** — before publishing, which is
  the safe direction, but it is still a manual step an administrator must take.
- The npm side's `verify-npm-provenance` call still passes
  `expected-workflow: .github/workflows/release.yml` as a literal and would need editing too.

So the guarantee is narrower than "a rename self-heals": a rename no longer causes a *green
publish followed by a red verify*, which was the actual complaint. Any remaining friction fails
early and loudly instead.

### The mypy consequence — same shape as a gotcha already paid for

Adding `scripts` to `[tool.mypy] files` means `mypy --strict` type-checks a module importing
`pypi_attestations`, `sigstore`, and `cryptography`. **`pip install -e .` installs none of
them** — the package is dependency-free by policy.

This is structurally identical to the `hatch_build.py` / `hatchling` problem already documented
in `CLAUDE.md`: it reproduces nowhere locally and turns CI red. Both `ci.yml`'s `python` job and
the release job must install `-r verify-requirements.txt` **before** mypy runs.

The alternative — `ignore_missing_imports` overrides for those modules — is rejected. It would
hollow out strict mode over precisely the code that decides whether a release is trustworthy.

## Component 3 — the dist gate

In `publish-python`'s existing gate step, the `_data/` check becomes:

- Members filtered to **regular files** explicitly on both sides, with the two archive formats
  spelled out because they do not express it the same way:

  | Format | Test | Note |
  |---|---|---|
  | sdist (`tarfile`) | `m.isfile()` over `getmembers()` | Excludes directories, symlinks, and hardlinks. `getnames()` would include all of them. |
  | wheel (`zipfile`) | `not i.is_dir()` over `infolist()` | ZIP has no file-type flag; `is_dir()` is a trailing-`/` test, which is the only signal the format carries. |

  Not because either is wrong today — measurement says hatchling emits no tar directory members
  and both sides read 181 — but so a future hatchling that does emit them cannot redden a good
  release.
- **Set equality** of `_data/`-relative paths between wheel and sdist, replacing two
  independent presence checks. Reports the offending paths on either side when it fails.
- `FLOOR = 150` unchanged and **absolute**, still applied to both sides. The set-equality
  assertion is self-calibrating; the floor deliberately is not, because "both sides shrank
  together" is exactly the build-hook regression the floor exists to catch.
- The named-member check (`nimbus_sdk/_data/spec/conformance/v1/index.json`) and the
  pure-Python wheel-tag check are untouched.

## Component 4 — `sdks/typescript/scripts/release-workflow-guard.test.ts`

Parses `.github/workflows/release.yml` and asserts
`jobs["publish-python"].environment === env.PYPI_ENVIRONMENT`.

Placement and intent match `release-config-guard.test.ts`, which exists for the same reason:
assert a structural relationship at every commit, so drift fails on the PR that introduces it
rather than weeks later during a release. That guard's header states the principle directly —
*"`refactor:` commits cut no release, so the component migration is not exercised by CI until
the next `feat:` or `fix:`."*

Reading `release.yml` requires a YAML parser, and the repo has none today (`devDependencies`
are `@biomejs/biome`, `@types/bun`, `ajv`, `typescript`).

Adding one is consistent rather than novel: `ajv` is already a devDependency carried purely so
the schema guards can validate the published spec. A YAML parser is the same tier — a
guard-script tool, not a runtime dependency — so `dependencies` stays empty and the published
surface is untouched. The dependency-free rule governs what ships, and this ships nothing.

If adding one is nonetheless unwelcome, the fallback is a narrow line-anchored regex over the
two keys. That is weaker and should be a conscious downgrade recorded at plan time, not a
silent default.

### Considered and deferred: writing this guard in Python instead

The objection is a developer-experience one — a Python contributor running only `pytest` sees
this failure in CI rather than locally, coupling the two suites. Deferred, for three reasons:

1. **The precedent is explicit and recent.** `release-config-guard.test.ts` already guards
   Python release configuration from the TypeScript suite — its `VERSION_READERS` table reads
   `sdks/python/pyproject.toml`, added deliberately in `8da969f`. Moving this one guard to
   Python would make the treatment of release config inconsistent, not more consistent.
2. **`release.yml` belongs to neither SDK.** It is repository infrastructure. Placing its guard
   with the other repository-infrastructure guard is the coherent grouping; splitting by which
   job a given key happens to configure is not.
3. **The proposed alternative conflates two things.** "Write it in Python" and "avoid a YAML
   parser" are separable. Python has no stdlib YAML either, so a Python version either adds
   PyYAML to a deliberately dependency-free package's tooling — the same decision, relocated —
   or accepts the regex downgrade. The DX gain does not pay for that.

The DX cost is real but bounded: CI runs both suites on every PR, so the guard fires before
merge either way, which is the entire point of moving detection off the release path. Reversible
if the Python suite later grows its own workflow-config guards and this one is left stranded.

## Component 5 — `sdks/python/verify-requirements.txt`

Generated with hashes over the full transitive closure (34 packages as measured:
`pypi-attestations`, `sigstore`, `cryptography`, `pydantic`, `tuf`, and their dependencies).
Installed with `--require-hashes`, which makes pip refuse any unpinned or unhashed requirement
in the file — so the file cannot silently degrade to a partial pin.

It is **not** shipped: `[tool.hatch.build.targets.sdist] include` lists specific paths and
neither `scripts/` nor this file is among them, so the published sdist and wheel are byte-wise
unaffected. The dist gate's "exactly one wheel and one sdist" assertion is likewise unaffected.

## Component 6 — Dependabot coverage

`.github/dependabot.yml` already exists and covers `npm` and `github-actions`, both weekly and
grouped. The lockfile gets a third ecosystem rather than a comment deferring the problem:

```yaml
  - package-ecosystem: "pip"
    directory: "/sdks/python"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      verify-toolchain:
        patterns: ["*"]
```

Grouped for the same reason the `github-actions` block is: `pypi-attestations` and `sigstore`
are version-coupled, and a split bump would land a combination neither project tests. Dependabot
maintains `--hash=` lines in requirements files, so the pin does not degrade on update.

Two consequences to accept knowingly:

- The `pip` ecosystem also sees `pyproject.toml`. `[project] dependencies` is empty by policy so
  there is nothing to bump there, but `[build-system] requires = ["hatchling>=1.27"]` is in
  scope and may generate a PR. Harmless, and arguably wanted.
- A grouped bump changes the tool that decides whether releases are trustworthy. These PRs
  should be reviewed as release-infrastructure changes, not as routine dependency noise.

---

## Testing — proving guards by mutation, not by passing

`sdks/python/tests/test_verify_publish.py`, with the real `0.1.0` provenance document
committed as a fixture (~10 KB) alongside its expected digest. Every guard gets a case that
**fails when the guard is deleted**.

| Mutation | Guard that must reject it | Network |
|---|---|---|
| Tampered wheel digest | `verify()` subject digest | integration (opt-in) |
| Wrong artifact filename | `verify()` subject name | integration (opt-in) |
| Wrong repository | `OIDCSourceRepositoryURI` | integration (opt-in) |
| Wrong workflow | `OIDCBuildConfigURI` | integration (opt-in) |
| Wrong commit SHA | `OIDCSourceRepositoryDigest` | integration (opt-in) |
| **Wrong environment** | **OID `.1.23` comparison** | offline |
| **DER prefix left on the decoded value** | **decoder regression test** | offline |
| Extension absent from the certificate | decoder raises, not returns `None` | offline |
| Trailing octets after the `UTF8String` | decoder raises | offline |
| `workflow_ref` passed with a scheme already attached | `build_config_uri` | offline |
| `_data/` path in the wheel only | dist-gate set equality | offline |
| `_data/` path in the sdist only | dist-gate set equality | offline |
| Both sides below 150 files | absolute floor | offline |
| `environment:` renamed in `release.yml` | Component 4 guard test | offline |

The four integration rows already have **live evidence** from design validation — they were
executed against the real published artifact and behaved as tabulated.

### Keeping the default suite offline

The existing `slow` marker will **not** do this job. `pyproject.toml` declares no `addopts`, and
both CI and the release job run a plain `pytest -q`, so `slow` is purely documentary — the one
test carrying it runs everywhere. Reusing it would put a live network call to Sigstore's TUF
endpoints on every PR, and its description (*"builds a distribution and installs it into a
throwaway venv"*) does not describe these tests anyway.

Instead the integration tests carry an explicit
`@pytest.mark.skipif(not os.environ.get("NIMBUS_VERIFY_INTEGRATION"), …)` plus a new `network`
marker declared alongside `slow`. Opt-in by environment variable, not by marker, because a
marker without deselection is a comment. The default suite — local and CI — stays offline and
deterministic; the release job sets the variable, where a live network call is the point.

This leaves the existing `slow` test's behavior exactly as it is today. Changing it is out of
scope.

The offline rows are the load-bearing ones for CI, and the **wrong environment** row is the
reason this sub-project is worth doing beyond a docs edit: it is a real gap in the current
design that a naive library swap would have preserved.

## Documentation

`docs/RELEASING.md`:

- Guarantee #5 — remove the "PyPI's is currently a **claims check** … with cryptographic
  verification via `pypi-attestations` a tracked follow-up" clause. Replace with cryptographic
  Sigstore verification against a self-derived publisher, plus commit and environment bound by
  the signing certificate.
- At-a-glance table — the Python row's "not yet cryptographic" parenthetical goes.
- Python section step 3 — describe what is actually asserted, and note that `environment` is
  checked from the certificate because the publisher policy does not enforce it.

## Attribution hazard

`sdks/python/scripts/` and `sdks/python/tests/` are inside a release-please package path, so a
commit touching them is attributed to the `python` component. A future `fix:` on this script
would cut a Python SDK release containing no SDK change.

Contained by commit-type discipline: `ci:` and `test:` cut no release, and this repo already
practices it — `8da969f test: add the python version reader to the release-config guard`.
Accepted knowingly in exchange for inheriting ruff, mypy, and pytest coverage with one word of
config; `.github/scripts/` was the alternative and costs new lint, typecheck, and test wiring.

## Risks

- **The lockfile rots.** 34 pinned entries. Mitigated by Component 6 rather than deferred, so
  the residual risk is narrower: a grouped weekly PR that nobody merges. That is visible in the
  PR list, unlike silent rot.
- **A Sigstore trust-root rotation could redden a good release.** Accepted: online is the
  correct posture, and the alternative fails *more* often and more confusingly. The job is
  already split so a post-publish failure has a green re-run path, which is exactly the
  mitigation this needs.
- **`pypi-attestations` is pre-1.0** (`0.0.30`). Its API may move. The hash-locked pin means a
  break arrives when someone bumps the file, under review, rather than mid-release.
- **The committed provenance fixture ages.** It is a real transparency-log entry; verification
  is anchored to its integrated time, so it does not expire the way the Fulcio certificate's
  10-minute window would. Because the tests that verify it are opt-in, a far-future trust-root
  change degrades them to a known failure behind an environment variable rather than breaking
  the default suite.

## Design-review disposition

The design review that raised these points is no longer carried in-tree; its outcome is the
table below, which is the record.

| # | Point | Disposition |
|---|---|---|
| 1 | A workflow rename still needs PyPI's Trusted Publisher settings synced | **Fixed** — Component 2 now bounds the self-healing claim and names the two manual steps (PyPI settings, the npm job's literal). |
| 2 | Custom OIDs are ASN.1-wrapped; naive `.value` extraction returns DER bytes | **Fixed, and it was a real defect** — confirmed empirically. Resolved better than proposed: sigstore's own policy classes cover the SHA, so only `.1.23` is decoded by hand. See *The DER trap*. |
| 3 | Zip and tar express "regular file" differently | **Fixed** — Component 3 now tabulates `TarInfo.isfile()` vs `not ZipInfo.is_dir()` and why ZIP has no better signal. |
| 4 | Write the workflow guard in Python, not TypeScript | **Deferred, with reasoning** — see *Considered and deferred* under Component 4. The precedent already guards Python release config from the TS suite, and the proposed alternative trades down to regex. |
| 5 | Wire the lockfile into existing dependency automation | **Fixed** — `.github/dependabot.yml` exists; Component 6 adds a grouped `pip` ecosystem entry rather than a deferral comment. |

Point 2 is the one that mattered: the design as written would have failed **every** release,
fail-closed. Point 4 is the only one not adopted, and it is a placement preference rather than a
correctness issue — reversible at any time.

## Sequencing

Three commits, each independently revertible and none cutting a release:

1. `ci:` — the dist gate (Component 3) and its offline tests. Self-contained; touches no new
   dependency.
2. `ci:` — the extracted verifier, the lockfile, the Dependabot entry, the workflow wiring,
   mypy config, and the mutation tests (Components 1, 2, 5, 6).
3. `test:` — the PR-time workflow guard (Component 4), plus the `RELEASING.md` rewrite.

Ordering puts the change with no new dependency first, so if the hash-locked install misbehaves
in CI there is one candidate cause rather than two. The Dependabot entry rides with the lockfile
it manages, so the two never exist apart.
