# Nimbus sandbox probe protocol v1

**Status:** normative. **Contract version:** `v1`.

This document specifies the contract between a **contract-test harness** and the **probe
binary** it forks to check that a connector's declared sandbox permissions match what the
runtime actually enforces.

It is an inter-process protocol, not a function signature. A binding in another language
ships its *own* probe, written in that language, and the two only interoperate if they agree
on the command line and on the exit codes. Every binding MUST implement this document
identically.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is
[`sdks/typescript/src/testing/sandbox-probe.ts`](https://github.com/nimbus-agent/nimbus-sdk/blob/main/sdks/typescript/src/testing/sandbox-probe.ts)
and
[`sdks/typescript/src/testing/sandbox-contract.ts`](https://github.com/nimbus-agent/nimbus-sdk/blob/main/sdks/typescript/src/testing/sandbox-contract.ts);
the machine-readable form of §2–§4 is
[`probe-protocol.json`](./probe-protocol.json), and the executable form of §4–§5 is the
corpus at [`../../conformance/v1/sandbox/`](../../conformance/v1/sandbox/). Where prose and
corpus appear to disagree, the corpus is the tiebreaker — it is what CI runs.

## 1. Scope, and what this cannot prove

This document specifies the **probe protocol** and the **harness decision table**.

**It does not specify, and this package cannot verify, that any sandbox works.** Read §7
before relying on a passing run for anything.

Out of scope: how a sandbox is constructed, which syscalls it filters, the gateway's
wrapping harness, and any probe beyond the three named in §3.

## 2. Invocation

A harness MUST invoke a probe as:

```
<runtime> <probe-binary> --probe=<name> --arg=<value>
```

Both are single arguments carrying their value after the `=`. A harness MUST pass `--arg`
even for probes that take no value, using the empty string, and a probe MUST tolerate an
empty value rather than treating it as absent.

Where an argument appears more than once, the **first** occurrence MUST win. This is stated
because it is the opposite of what several languages' argument parsers do by default, and a
binding that takes the last occurrence is quietly incompatible rather than visibly broken.

A probe MUST NOT require any other argument, and MUST NOT read configuration from the
environment: everything it needs arrives on the command line.

## 3. Exit codes

A probe reports its outcome **only** through its exit status.

| Code | Name | Meaning |
|---|---|---|
| 0 | `pass` | The capability the manifest declared was reachable. |
| 2 | `unexpected` | Anything not otherwise named here. |
| 10 | `fsDenied` | A filesystem read failed the way a sandboxed read is supposed to fail. |
| 11 | `networkBlocked` | A connection failed the way a blocked connection is supposed to fail. |

A probe MUST NOT signal a contract outcome with any code outside this table. Every outcome
this document does not name MUST be reported as `unexpected` — including an unknown probe
name, a missing `--probe`, an operation that unexpectedly *succeeded*, and any error whose
code falls outside the relevant set in §4.

`unexpected` is the safe default and MUST be treated as one: a probe that reported success
when it did not recognize a failure would pass with no sandbox present at all.

A probe MUST NOT write anything it expects the harness to parse. Standard output and
standard error are for humans; the harness reads only the status, and quotes the stream back
in its message.

## 4. Classifying a failure

Two error-code sets decide whether a failure is the sandbox doing its job.

| Set | Codes |
|---|---|
| `networkBlocked` | `ECONNREFUSED`, `EPERM`, `EHOSTUNREACH`, `ENETUNREACH` |
| `fsDenied` | `EACCES`, `EPERM`, `EBUSY` |

Three properties of these sets are normative and easy to get wrong:

- **They are not disjoint.** `EPERM` is a member of both. A binding deriving one set from
  the other's shape, or assuming a code belongs to exactly one, is wrong.
- **`ETIMEDOUT` is deliberately absent from `networkBlocked`.** A timeout is precisely what
  an *unsandboxed* connection to an unroutable address produces, so accepting it would let
  the probe pass with no sandbox at all.
- **`EBUSY` is in `fsDenied` for Windows**, where a protected file the system already holds
  open reports busy rather than denied.

A failure whose code is **absent** MUST be `unexpected`. This is not a formality: an error
that is not an OS error at all — a missing global, a type error, a bug in the probe — carries
no code, and classifying it as a denial would report a broken probe as a working sandbox.

Where an error nests its cause, a probe MUST examine the error's own code and then its
cause's code. Several HTTP clients wrap transport errors, and a binding that inspects only
the outer error will see no code and report `unexpected` for a genuine block.

## 5. The harness decision table

Given a manifest and a platform, a harness MUST invoke probes according to the following,
**in this order**.

Let *hosts* be `permissions.network` when `permissions` is a JSON object that is not an
array and declares that member, and the empty sequence otherwise. A `permissions` member
that is absent, null, or the legacy array-of-strings form therefore yields no hosts, and
MUST NOT be an error.

| # | Condition | Invocation | Required |
|---|---|---|---|
| 1 | *hosts* is non-empty | `network-listed` with **the first host** | exit `pass` |
| 2 | platform is not `win32` **and** *hosts* is non-empty | `network-unlisted` with `""` | exit `networkBlocked` |
| 3 | always | `fs-denied` with `""` | exit `fsDenied` |

Only the first host is probed, however many are declared. A host that is the empty string is
still a declared host: presence decides, not truthiness.

When a probe does not return its required code, the harness MUST fail immediately and MUST
NOT invoke any later probe. The error MUST name the probe, the observed exit code, and the
probe's standard error.

### 5.1 The two skips

Both skips are real behavior a binding must reproduce, and they are conditional on different
things.

**Windows skips rule 2.** AppContainer filters network at a layer where the probe observes a
generic socket failure indistinguishable from the unsandboxed case, so the probe cannot
distinguish enforcement from its absence and the harness does not ask.

**No declared hosts skips rules 1 *and* 2**, on every platform. With no hosts the sandbox
denies network entirely, so the unlisted probe's expectation collapses into "there is no
network at all" — which rule 1 never established, because rule 1 did not run either.

### 5.2 The three probes

| Probe | Argument | Succeeds when |
|---|---|---|
| `network-listed` | a host | A `HEAD` request to `https://<host>/` returns an HTTP status in **200–499** |
| `network-unlisted` | none | A connection to `192.0.2.1` fails with a `networkBlocked` code |
| `fs-denied` | none | Reading a platform-protected path fails with an `fsDenied` code |

`network-listed` is a **reachability** probe, not an authorization one: 401 and 404 both
prove the host was reached, so only 5xx and transport failures count against it. A binding
MUST NOT narrow this to 2xx.

`network-unlisted` targets `192.0.2.1` — [RFC 5737](https://www.rfc-editor.org/rfc/rfc5737)
TEST-NET-1, unroutable by definition — so the probe can never establish a connection to a
real service even if egress is wide open.

`fs-denied` reads `/etc/passwd` on POSIX and `C:\Windows\System32\config\SAM` on Windows. It
is never skipped.

The probe binary MUST work under whatever runtime the harness spawns. The harness passes the
consumer's own runtime, so a probe depending on a runtime-specific global fails everywhere
else — silently, because such a failure carries no error code and §4 classifies it as
`unexpected`, which is indistinguishable from a sandbox that is not enforcing.

## 6. Extending this

The probe list in [`probe-protocol.json`](./probe-protocol.json) is the extension point. A
new probe requires a new name, a new expected code or a reuse of an existing one, and an
RFC — a harness that invokes a probe an older binding does not implement gets `unexpected`
from it, which fails the contract test rather than passing it. That is the safe direction,
and it is why probe names are not negotiated.

## 7. What this specification does not give you

**The SDK harness does not sandbox-wrap the probe.** The reference implementation spawns the
probe with the current runtime directly. Nothing in this package confines the child process.

Run `runSandboxContractTests` outside a sandboxing harness on Linux or macOS and the probe
reaches the network and reads `/etc/passwd` successfully — and the harness correctly reports
failure, because the codes come back `unexpected` instead of `networkBlocked` and `fsDenied`.
That is the intended third-party experience: "your contract test failed because the sandbox
is not enforcing your manifest."

Real enforcement is demonstrated only when something else forks this inside a process that is
already sandbox-wrapped, or substitutes a sandboxed runtime. In the first-party system that
is the gateway's harness, which lives in the Nimbus monorepo, not here.

So: the conformance corpus proves the **harness's decision logic** (§5) and the **probe's
classification logic** (§4). It does not prove that any sandbox enforces anything, and no
amount of passing it should be read as evidence that one does. A binding that passes every
case still has to be run under a real sandbox by its gateway.

## 8. Conformance

The corpus at [`../../conformance/v1/sandbox/`](../../conformance/v1/sandbox/) is the
executable form of §4 and §5. Its
[`index.json`](../../conformance/v1/sandbox/index.json) names every case and the section it
pins.

A `harness` case gives permissions, a platform, and the exit code a stubbed probe runner
returns for each probe, and asserts the exact ordered sequence of invocations and the
outcome. A `classify` case gives an error code and asserts the exit code it maps to.

CI refuses to let the corpus pass vacuously: it must be non-empty, every case on disk must be
indexed and every indexed case must exist, every published probe must be invoked by some
case, every published error code must be exercised, and each classifier must have at least
one code that maps and one that must **not** — otherwise a binding that mapped everything
would pass.

Changes here follow the [RFC process](../../../GOVERNANCE.md#the-rfc-process) — see
[RFC-0004](../../../rfcs/0004-sandbox-probe-protocol.md).
