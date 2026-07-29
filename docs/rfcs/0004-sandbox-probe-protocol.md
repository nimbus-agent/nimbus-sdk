# RFC-0004 — A protocol for the sandbox probe

- **Status:** accepted
- **Opened:** 2026-07-29
- **Landed:** 2026-07-29 in [#61](https://github.com/nimbus-agent/nimbus-sdk/pull/61)
- **Affects:** `docs/spec/`, `@nimbus-dev/sdk` (`testing/sandbox-probe`, `testing/sandbox-contract`)
- **Roadmap:** [Phase 1](../ROADMAP.md#phase-1--lift-the-contract-out-of-typescript), box 3 — *Extract the conformance suite as language-neutral fixtures* (third and last part)
- **Pillars:** 1 (the contract), 2 (polyglot SDKs), 5 (quality & release)
- **Builds on:** [RFC-0001](./0001-ipc-framing-spec.md) for the normative-document pattern, and [RFC-0003](./0003-pure-predicates.md), whose corpus shape this reuses

## Problem

`runSandboxContractTests` verifies that a connector's declared permissions match what the
sandbox actually enforces. It does this by forking a small probe binary and reading its exit
code. That makes the probe an **inter-process protocol**, not a function: a Python SDK ships
its *own* probe, in Python, and the two must agree on the command line and on the numbers.

Nothing writes that protocol down. It exists as a doc comment on
`src/testing/sandbox-probe.ts` and as literals in two files that no test compares.

This part is different from the first two. Boxes 1 and 2 were data-driven; this one is not.
There is no set of strings to publish. What there *is* is three separable things, and this
RFC's main work is telling them apart:

1. **A wire-level contract** — argument syntax and exit codes — which wants a spec like the
   framing spec, not a corpus.
2. **A harness decision table** — permissions and platform in, an ordered sequence of probe
   invocations out — which is genuinely fixture-able, because `runProbe` is already an
   injectable option.
3. **The errno classification** — which failures count as "the sandbox blocked me" — which
   is a pure function hiding inside an effectful one.

**The numbers are unguarded.** `sandbox-probe.ts` writes `return 10`; `sandbox-contract.ts`
writes `if (r3.status !== 10)`. Change one and nothing fails. Worse, the probe's meaning of
`2` — *unexpected outcome* — is load-bearing and appears five times as a bare literal.

**The one portable piece of the probe's logic is untested.** The probe decides that
`ECONNREFUSED`, `EPERM`, `EHOSTUNREACH`, and `ENETUNREACH` mean "blocked" and everything
else means "unexpected", and separately that `EACCES`, `EPERM`, and `EBUSY` mean "denied".
`EPERM` is in both sets and `EBUSY` is in neither of the obvious ones — a binding author
reading the source would plausibly get both wrong. None of it is exercised, because you
cannot force a real `ECONNREFUSED` in CI.

## Proposed change

### 1. A shared protocol table

`src/testing/sandbox-protocol.ts`, holding the probe names, the exit codes, and the two
errno sets, imported by both the probe and the harness so neither carries a literal.

```ts
export const SANDBOX_PROBE_EXIT = {
  pass: 0,
  unexpected: 2,
  fsDenied: 10,
  networkBlocked: 11,
} as const;

export const SANDBOX_PROBES = ["network-listed", "network-unlisted", "fs-denied"] as const;
```

Exported from its module and **not** re-exported by `src/index.ts` or
`src/testing/index.ts`, so it stays off the published surface while the drift guard imports
it directly. This is the `MANIFEST_RULES` arrangement from RFC-0002 §4.

**This gives `sandbox-probe.ts` its first import.** That file currently documents itself as
having "no imports/exports of its own", with `export {}` as the module marker its top-level
`await` requires. The import replaces that marker and resolves as a sibling in both trees the
probe ever runs from — `src/` under the `bun` condition, `dist/` from the published package.
It is a real change to a stated property of that file, so it is called out rather than
slipped in. A probe copied out of the package on its own would now need one more file; that
was never a supported way to use it.

### 2. The errno classification, extracted as pure functions

```ts
export function networkBlockedExit(code: string | undefined): 11 | 2;
export function fsDeniedExit(code: string | undefined): 10 | 2;
```

The probe keeps the effects — the `fetch`, the file read, the `process.exit` — and delegates
the decision. What is left is a total function from an optional error code to an exit code,
which is fixture-able in exactly the way §3 of RFC-0003's predicates were, and which a
Python probe author can be held to without anyone simulating a firewall.

This is the whole reason the classification is worth extracting: it converts the one part of
the probe that a binding must reproduce *exactly* from something only a real sandbox can
test into something a corpus can.

### 3. A normative document

`docs/spec/probe/v1/sandbox-probe.md`, in RFC-2119 language, a peer of `wire/v1/framing.md`
and modelled on it. It specifies:

- **Invocation.** `--probe=<name> --arg=<value>`, both as single arguments with the value
  after `=`. Where an argument repeats, the **first** occurrence wins — that is what
  `Array.prototype.find` does today, and leaving it unstated invites a binding to use its
  language's "last wins" argument parser.
- **Exit codes.** `0` expected pass, `2` unexpected outcome, `10` filesystem access denied
  as expected, `11` network blocked as expected. Every outcome not otherwise specified —
  including an unknown probe name, a missing `--probe`, and any unanticipated error — MUST
  be `2`. A probe MUST NOT use any other code to signal a contract outcome.
- **The three probes**, each with its argument, its success condition, and its failure
  mapping. `network-listed` succeeds on an HTTP status in **200–499**: it is a
  *reachability* probe, so a 401 or a 404 is a success, and only a 5xx or a transport
  failure is not.
- **The errno sets**, spelled out, with `EPERM`'s membership in both called out explicitly.
- **Where the error code is read from.** The network probes check the error's `code` and
  then its `cause.code`; a binding whose HTTP client nests transport errors MUST unwrap
  equivalently.

### 4. The protocol, published as data

`docs/spec/probe/v1/probe-protocol.json`, validated by its own schema, carrying the exit
codes, the probe names, and the two errno sets — the machine-readable half of §3, and the
thing §6's drift guard holds `src/testing/sandbox-protocol.ts` against.

### 5. The harness decision table, as a corpus

`docs/spec/conformance/v1/sandbox/`, following RFC-0003's layout: `index.json`,
`index.schema.json`, `case.schema.json`, and `cases/`.

A case is the harness's decision function written down — permissions and platform in, an
ordered sequence of invocations out:

```json
{
  "kind": "harness",
  "description": "Windows skips the unlisted-host probe",
  "platform": "win32",
  "permissions": { "network": ["api.example.com"] },
  "probeResults": { "network-listed": 0, "fs-denied": 10 },
  "expect": { "calls": [
    { "probe": "network-listed", "arg": "api.example.com" },
    { "probe": "fs-denied", "arg": "" }
  ], "outcome": "pass" }
}
```

`probeResults` is what the stubbed runner returns, so a case pins the failure paths as well
as the happy one. `runProbe` being an injectable option is what makes this executable at
all; no sandbox, no network, and no spawn is involved.

The table has four rules, and the corpus pins each:

| | Condition | Invocation |
|---|---|---|
| 1 | `permissions` is an object with a non-empty `network` | `network-listed` with the **first** host; MUST exit 0 |
| 2 | platform is not `win32` **and** a host was declared | `network-unlisted` with `""`; MUST exit 11 |
| 3 | always | `fs-denied` with `""`; MUST exit 10 |
| 4 | any of the above failing | throw immediately; later probes MUST NOT run |

Both skips are real behavior a binding must reproduce, and both are easy to get wrong:

- **The Windows skip** exists because AppContainer filters network at a layer where the
  probe sees a generic socket failure indistinguishable from the unsandboxed case.
- **The no-declared-hosts skip** applies on *every* platform, and skips rule 2 as well as
  rule 1 — because with no hosts the sandbox denies network entirely, and the unlisted
  probe's expectation collapses into "no network at all", which rule 1 never exercised.

`permissions` in the legacy `string[]` form, absent, or null all yield no hosts. Only the
first host is probed however many are declared. Each gets a case.

The second case kind, `"classify"`, drives §2's pure functions — one per errno, including
the ones that must *not* map (`ETIMEDOUT`, `ENOENT`, an absent code). One corpus with a
`kind` discriminator rather than two, per RFC-0003 §6: two indexes and two schemas for one
guard would be mechanism without benefit.

### 6. Guards

`scripts/sandbox-guard.test.ts`, with RFC-0003's three obligations:

- **Drift** — the published protocol and `src/testing/sandbox-protocol.ts` declare the same
  probe names, the same exit codes, and the same errno sets. None missing, none extra.
- **Coverage** — every published probe name appears in at least one harness case, and every
  published errno appears in at least one classify case.
- **Anti-vacuity** — the corpus is non-empty, every case on disk is indexed and every
  indexed case exists, and the harness cases include at least one of each outcome, so the
  table cannot pass by always answering "pass".

### 7. What this repository cannot verify, stated plainly

The spec will carry a section saying so, because the alternative is a document that reads
like a guarantee it does not make.

**The SDK harness does not sandbox-wrap the probe.** `__defaultRunProbe` spawns
`process.execPath` directly. Nothing in this package confines the child, so running
`runSandboxContractTests` outside a sandboxing harness on Linux or macOS gives you a probe
that reaches the network and reads `/etc/passwd` — and the harness correctly reports failure,
because the codes come back `2` instead of `11` and `10`. Real enforcement is only proven
when something else — in practice the gateway's `sandbox-harness.ts` — forks this inside an
already-wrapped process or substitutes a sandboxed `execPath`.

So this corpus proves the **harness's decision logic** and the **probe's classification
logic**. It does not, and cannot here, prove that any sandbox works. A binding that passes
every case still has to be run under a real sandbox by its gateway.

### 8. A finding: the reference probe does not satisfy its own spec under Node

Writing §3 surfaced a defect, and per RFC-0002's caveat it is reported and fixed rather than
quietly excluded from the corpus.

`probeFsDenied` reads its protected path with `Bun.file(path).text()`. The harness spawns
`process.execPath`, which is whatever runtime the *consumer* is using — and this package
ships a `dist/` that CI exercises on a Node LTS matrix. Under Node, `Bun` is not defined, so
the call throws `ReferenceError`, which the probe's own `catch` swallows; the error has no
`code`, so it falls through to `return 2`:

```
$ node dist/testing/sandbox-probe.js --probe=fs-denied      exit 2
$ bun  dist/testing/sandbox-probe.js --probe=fs-denied      exit 10
```

The failure is in the safe direction — the harness throws rather than passing — but it
reports "fs-denied probe should have returned EACCES (exit 10); got exit 2", which reads as
*your sandbox is not enforcing* when the truth is *this probe cannot run under Node at all*.
A connector author on Node would chase the wrong thing indefinitely.

The fix is to read the file with `node:fs/promises`, which behaves identically under both
runtimes. This is a `fix`, and it is in scope because publishing a spec the reference
implementation violates on half its supported runtimes would be worse than not publishing
one.

## Compatibility impact

| Change | Semver | Who is affected |
|---|---|---|
| `src/testing/sandbox-protocol.ts` added, not re-exported | none | Nobody. Off the published surface. |
| Probe and harness read the shared table | none | Nobody — same numbers, now in one place. |
| `networkBlockedExit` / `fsDeniedExit` extracted | none | Nobody. Internal; same mapping. |
| `sandbox-probe.ts` gains an import | none | Nobody using it through the package. A probe file copied out on its own now needs its sibling. |
| `probeFsDenied` uses `node:fs/promises` | patch (`fix`) | Anyone running contract tests under Node, for whom `fs-denied` currently cannot succeed. Under Bun, unchanged. |
| `docs/spec/probe/v1/` + a new corpus | none | New paths, separate index. |

No runtime dependency is added. `node:fs/promises` is a built-in, and the package already
imports `node:fs` in this same module.

## Migration

None. `runSandboxContractTests` keeps its signature, its options, and its throw behavior.

## Alternatives considered

**Specify the protocol in prose only, with no corpus.** Rejected. The harness decision table
is the part a binding is most likely to get subtly wrong — the two skips are conditional on
different things — and it is executable today at zero cost because `runProbe` is already
injectable. Leaving it to prose would be choosing not to test the one testable part.

**Leave the errno classification inside the probe and describe it in prose.** Rejected, per
§2. It is the only piece of probe logic that is both portable and reproducible in CI, and
`EPERM` appearing in both sets is exactly the detail prose loses.

**Publish the exit codes without a shared TypeScript table.** Rejected. The guard would then
compare the spec against nothing, and the probe's own `return 10` would stay a literal that
could drift from the document with no test noticing — the failure mode RFC-0002 and RFC-0003
both exist to close.

**Have the SDK harness sandbox-wrap the probe itself.** Rejected as out of scope, and
probably wrong here. Sandboxing is platform-specific privileged machinery that belongs to
the gateway; this package is dependency-free and does no privileged work. §7 states the
limitation instead of hiding it.

**Fold these cases into the predicates corpus.** Rejected. A predicate case is a value in and
a value out; a harness case is a *sequence of interactions* with a stub. Same reasoning that
kept the framing corpus separate in RFC-0001.

**Report the `Bun.file` defect and fix it separately.** Rejected. The spec asserts what the
probe does; landing a document the reference implementation contradicts under Node, and
fixing it later, would publish a known-false statement in the meantime.

## Out of scope

- **Proving any sandbox actually enforces anything.** §7.
- **The gateway's wrapping harness**, which lives in the Nimbus monorepo.
- **New probes.** The three existing ones are specified; adding a fourth is a later RFC, and
  the published probe list is the extension point.
- **Contract-version negotiation.** Still Phase 1, box 5.
