# Nimbus contract-version negotiation v1

**Status:** normative. **Contract version:** `v1`.

This document specifies how a Nimbus connector and the gateway that spawned it agree, at
connector start, on which major version of the contract they both speak — and what each peer
does when they do not.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is
[`sdks/typescript/src/contract-version.ts`](https://github.com/nimbus-agent/nimbus-sdk/blob/main/sdks/typescript/src/contract-version.ts)
(the algorithm) and
[`sdks/typescript/src/ipc/hello.ts`](https://github.com/nimbus-agent/nimbus-sdk/blob/main/sdks/typescript/src/ipc/hello.ts)
(the frame); the executable form of this document is the corpus at
[`../../conformance/v1/negotiation/`](../../conformance/v1/negotiation/). Where prose and
corpus appear to disagree, the corpus is the tiebreaker — it is what CI runs.

## 1. Scope

This document specifies:

- The **contract version** identifier itself (§3).
- The optional manifest field a connector uses to **declare** which contract versions it
  speaks (§4).
- The **handshake** — the one frame each peer writes to announce its own declared set, and
  the rule that nothing precedes it (§5).
- The **algorithm** both peers run, independently, to agree on a single version or refuse
  (§6).
- The single **refusal** path and its exit code (§7).

Out of scope, and specified nowhere in this package: message envelopes, correlation of a
request to a response, method names, error objects, liveness, and the transport itself —
whatever pipe, socket, or process-spawning mechanism carries the bytes.
[`wire/v1/framing.md`](../../wire/v1/framing.md) §1 defers "how peers agree on a contract
version" to this document; this document is that deferral's answer, and it goes no further
than answering it.

## 2. Terminology

- **Contract version** — a decimal major, as a string, identifying one iteration of this
  package's contract. Defined precisely in §3.
- **Major** — synonym for contract version, used when its numeric nature is the point.
- **Peer** — either side of the handshake: the connector process, or the gateway process
  that spawned it. This document is symmetric — the same rules bind both.
- **Declaration** — the set of contract versions a connector's manifest states it speaks
  (§4).
- **Hello** — the one frame this document specifies (§5): a peer's runtime announcement,
  sent unprompted, of the contract versions it speaks.
- **Agreed version** — the outcome of running the §6 algorithm over both peers' sets: either
  a single contract version, or a refusal (§7).

A contract version is **not** the package's own release version (the published version of
`@nimbus-dev/sdk`, or of any connector), **not** `manifest.version`, and **not**
`manifest.minNimbusVersion`. The last of these is a floor on the **gateway product**, not on
the contract, and the two vary independently: a gateway can raise its minimum product version
without changing which contract majors it speaks, and vice versa.

## 3. Version identity

A contract version is a string matching:

```
^[1-9][0-9]*$
```

ASCII digits, no leading zeros. `"1"`, `"2"`, and `"10"` match; `""`, `"0"`, `"01"`, `"1.0"`,
and `"١"` (U+0661 ARABIC-INDIC DIGIT ONE) do not.

The digit class is spelled `[0-9]`, never `\d`. JavaScript's `\d` is ASCII-only, but a binding
that transcribes `\d` into Python or Rust gets a Unicode-aware class instead, and silently
accepts `"١"` — a value this pattern rejects. Spelling the class out removes the one keystroke
a translator could get wrong without noticing, the same reasoning
[`docs/spec/rules/v1/`](../../rules/v1/) already applies to its own patterns.

Each contract version corresponds **one-to-one** with a published spec path segment: version
`"1"` names every `docs/spec/<area>/v1/` directory in this package, taken together. There is
no contract version that does not, somewhere, name a `v<major>/` segment, and no such segment
for a version this document does not also name.

## 4. Declaration

`ExtensionManifest` carries an **optional** field:

```json
{ "contractVersions": ["1"] }
```

- **Optional in contract `v1`.** A manifest MAY omit it entirely.
- **Absence means `["1"]`.** This default is itself normative: there is no manifest the §6
  algorithm cannot evaluate, and no binding has to invent a behavior for the missing-field
  case.
- **When present, it MUST be a non-empty array of unique strings, each matching the §3
  pattern.**
- **Order is not significant.** `["1", "2"]` and `["2", "1"]` declare the same set; no
  binding may treat the first member as "preferred."

Three rule ids in the [manifest rule registry](../../rules/v1/) enforce this shape:
`manifest.contractVersions.type`, `manifest.contractVersions.nonempty`, and
`manifest.contractVersions.entry`.

The field is optional only in contract `v1`; it becomes **required** at the next contract
major. That commitment is recorded once, in
[`../../../DEPRECATION-POLICY.md`](../../../DEPRECATION-POLICY.md), rather than restated here
where it could drift out of sync.

## 5. The handshake

Both peers announce **unprompted** — neither waits to be asked first.
[`framing.md`](../../wire/v1/framing.md) §2 defines a stream as one direction, so this rule is
stated per direction, never as "input" or "output": **the first frame each peer writes to its
own outgoing stream MUST be a hello**, and a peer **MUST NOT** write anything to that stream
before it.

The MUST NOT is the operationally important half. Where the outgoing stream is a process's
standard output, a dependency that prints an initialization banner — a version notice, a
telemetry prompt, anything at all — corrupts the handshake before the connector's own code
ever runs. The failure then surfaces as an unparseable first frame rather than as the banner
that actually caused it, and the connector author debugging it has no reason to suspect a
dependency they never call directly. A peer's diagnostics **MUST** travel somewhere other than
the frame stream — a separate file descriptor, a log file, anything but the stream the hello
owns. Which physical stream carries frames stays out of this document's scope, exactly as
[`framing.md`](../../wire/v1/framing.md) §1 leaves it: this rule binds whichever stream that
turns out to be.

The frame:

```json
{"nimbus":"hello","contractVersions":["1"]}
```

- `nimbus` **MUST** be the literal string `"hello"` — the discriminator that keeps a gateway
  envelope from ever being mistaken for one.
- `contractVersions` **MUST** be a non-empty array of unique strings, each matching the §3
  pattern: the sender's own declared set, from §4.

**The frame is JSON, not a byte pattern.** Whitespace and member order are not significant:
`{"nimbus": "hello", "contractVersions": ["1"]}` and a form with the two members reversed are
the same hello. A reader **MUST** parse the frame as JSON and compare its members; a reader
that compares bytes against one canonical rendering is non-conformant. Members this document
does not name **MUST** be ignored, not rejected.

There is no request, no response, and no correlation id. This is **the only message this
package specifies** — not one half of a request/response pair, and not a precedent for adding
one. Because the §6 algorithm is deterministic, neither peer transmits its result: both peers
compute the same answer from the same two sets, so no third frame is needed to carry it.

### Refusal reasons

Reading a hello can fail for one of seven reasons, and a reader **MUST** use these exact
tokens — they are not diagnostic color, they are data the corpus pins per case. A conformant
reader checks them in the order below: each row is reachable only once every row above it has
passed.

| Reason | Triggers when |
|---|---|
| `not-json` | The frame does not parse as JSON at all. |
| `not-object` | The frame parses as JSON but is not a JSON object — `null`, an array, a string, a number, or a boolean. |
| `wrong-message` | `nimbus` is absent, or present but not exactly the string `"hello"`. |
| `missing-versions` | `contractVersions` is absent, or present but not a JSON array. Both read the same way: there is no array to inspect. |
| `empty-versions` | `contractVersions` is a JSON array, but has no members. |
| `invalid-version` | Some member of `contractVersions` is not a string matching the §3 pattern. |
| `duplicate-version` | A member repeats one already seen earlier in the same array. |

A frame that reaches none of these is accepted as a hello, announcing exactly the set
`contractVersions` named — the §6 algorithm's remote input.

### The frame's shape is frozen

The hello is the one frame in this contract that can never itself be versioned. A `v1`-only
connector and a hypothetical `v2`-only gateway MUST still be able to read each other's hello,
because reading it is exactly how they discover that they share nothing — if the frame's
shape changed at a major, the two peers could not even reach a refusal; they would fail as
unparseable garbage instead, with no way to tell a version mismatch from any other kind of
corruption. So the hello frame's shape is **permanently frozen**: every future contract major
negotiates using this exact frame, and anything a later contract version needs to add belongs
in a different message, not this one.

That constraint is why [`hello.schema.json`](../hello.schema.json) is published **without a
`v1/` segment** — at `docs/spec/negotiation/hello.schema.json`, a sibling of this document's
own `v1/` directory rather than a child of it. Publishing it at
`negotiation/v1/hello.schema.json` would assert that the frame it describes belongs to `v1`,
which is the opposite of the rule this section states. The missing segment is the constraint,
encoded in the path rather than only asserted in prose — do not "fix" it by moving the file
under a version directory to match its siblings.

## 6. The algorithm

Both peers run this over the same two inputs: the local peer's own declared set, and the
remote peer's declared set as read from its hello.

**First, validate.** Every member of both sets **MUST** be checked against the §3 pattern
before anything else happens. A member that fails — `"01"`, `""`, `"1.0"`, a non-string, a
digit outside ASCII — makes the whole negotiation a refusal, `invalid-version` (§7), even if
the two sets would otherwise have intersected. Members are validated **before** intersection,
not after: an algorithm that trusts its caller's input is how two bindings diverge without
either one failing the corpus. One binding's hello parser might be the only gatekeeper in its
pipeline; another's gateway path might reach this algorithm with a set read straight out of a
manifest nobody validated. Making the algorithm total — it never assumes, it always checks —
closes that gap for the cost of one pass over each set.

**Then intersect.** The agreed version is the member both sets share that is **numerically the
largest**. If the intersection is empty, that is a refusal too, `no-common-version` (§7).

A repeated member of either set is not this algorithm's concern: nothing here re-checks
uniqueness, only that each member matches the §3 pattern above. `negotiateContractVersion(["1",
"1"], ["1"])` still agrees on `"1"`. That is deliberate, not an oversight — a declared set's
uniqueness is enforced one layer earlier, by §4's declaration rules and by §5's frame parsing,
before either set ever reaches this algorithm.

"Numerically largest" is defined as a comparison on the strings themselves, so that no binding
needs a numeric type to compare arbitrarily long majors:

> The longer string is greater; between two of equal length, the greater is the one that is
> greater as a plain character comparison.

Given §3 — no leading zeros — this comparison is **exactly numeric order**, for a major of any
length, in any language. Two shortcuts a binding might reach for instead are both wrong:

- **Plain lexicographic comparison, with no length check first, gets `"10"` versus `"9"`
  wrong** — as plain strings `"9" > "10"`, which is not numeric order.
- **Parsing to a number and comparing those loses precision on a long major**, in any language
  whose default numeric type is a float — JavaScript's `Number` included — so a
  twenty-plus-digit major compares incorrectly exactly when the comparison matters most.

The length-then-characters rule needs neither a numeric type nor a length limit, and is the
same few lines in every language.

## 7. Refusal

The handshake is refused when any of the following holds:

1. **The sets do not intersect** — `no-common-version`.
2. **A connector's running hello does not exactly equal the set its own manifest declared** —
   equal as sets, since §4 makes order insignificant: the same members, no more and no fewer.
   The gateway holds both documents — the manifest at load time, the hello at handshake time —
   so this check is the gateway's to make. The connector's own obligation is narrower: its
   hello MUST equal its own declaration. This cause's reason token is `declaration-mismatch` —
   distinct from the seven §5 names, since this check is not about whether a frame parses, only
   about whether two already-parsed sets agree.
3. **The hello is malformed or absent, or anything was written to the frame stream before it**
   (§5).

There are three ways in, and exactly one way out:

| Peer | Requirement |
|---|---|
| The connector | MUST emit no further frames, and MUST terminate with exit code **`20`**. |
| The gateway | MUST send no further frames, and MUST NOT load the connector. |

Exit code `20` is reserved for this refusal and this refusal only, clear of the sandbox probe
protocol's `0` / `2` / `10` / `11` family, so a nonzero connector exit is never ambiguous about
which contract produced it.

One refusal path, not three, is load-bearing. With a separate path for each of the three
causes above, a binding could handle an empty intersection correctly while quietly tolerating
a connector whose running hello lies about its own manifest. Collapsing all three into the
same exit code removes that gap: every one of them is, to an observer, the same failure.

## 8. What this specification does not give you

**No proof that any gateway enforces this.** This document specifies the frame and the
algorithm. It does not, and cannot, prove that a particular gateway implementation actually
refuses to load a connector whose handshake fails — that enforcement lives in the gateway,
not in this package.

**No proof that any process exits `20`.** This package performs no handshake of its own and
owns no process to exit. The conformance corpus publishes the exit code as **data** on every
refusal case instead, which is what holds a binding that *does* own a process to the correct
number, and `sdks/typescript/scripts/negotiation-guard.test.ts` pins the runtime constant
against drift.
Nothing in this package, or in its test suite, has ever actually exited with this code.

**No capability negotiation.** A contract version is a major, not a feature list. Negotiating
which individual capabilities a peer supports is out of scope here entirely — it is not a gap
this document forgot to fill.

**No timeout.** A peer waiting for a hello that never arrives is a liveness problem, and
[`framing.md`](../../wire/v1/framing.md) §1 puts liveness out of scope. A peer **SHOULD** bound
how long it waits for the other side's hello, but that bound belongs to whatever supervises
the process — a gateway, a process manager, an operator — and **no value is normative here**.

---

Changes here follow the [RFC process](../../../GOVERNANCE.md#the-rfc-process) — see
[RFC-0005](../../../rfcs/0005-contract-version-negotiation.md).
