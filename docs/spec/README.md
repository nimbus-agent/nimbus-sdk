# nimbus-sdk — Contract spec

The language-neutral contract every Nimbus binding implements. TypeScript in
`sdks/typescript/src/` is the reference implementation; this directory is what a binding in
another language reads.

## What is here today

### `schemas/v1/`

JSON Schemas, **draft-07**, for the three shapes the contract is built on:

| Schema | Shape |
|--------|-------|
| [`extension-manifest.schema.json`](./schemas/v1/extension-manifest.schema.json) | `ExtensionManifest` — what a connector ships |
| [`nimbus-item.schema.json`](./schemas/v1/nimbus-item.schema.json) | `NimbusItem` — one indexed item |
| [`hitl-request.schema.json`](./schemas/v1/hitl-request.schema.json) | `HitlRequest` — one approval request |

Reference the manifest schema from your own manifest for editor completion:

```json
{
  "$schema": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/schemas/v1/extension-manifest.schema.json",
  "id": "my-connector"
}
```

Draft-07 rather than 2020-12 deliberately: these schemas use only draft-07 vocabulary, and
draft-07 has the widest support across editors and across validators in the languages the
roadmap targets next.

### `rules/v1/`

The [manifest rule registry](./rules/v1/) — the sixteen semantic checks
`runContractTests` enforces, as data rather than as English strings inside five TypeScript
functions. Each rule has a stable id (`manifest.minNimbusVersion.semver`), and a violation
carries that id plus a JSON Pointer to the location that broke it.

The schemas describe the manifest's *shape*; these describe the *checks*. A binding MUST NOT
satisfy one by delegating to the other — the conformance corpus asserts the two agree, which
only means something if they are computed separately.

Two things the registry defines rather than leaving to a language's defaults, because both
diverge in practice: what counts as **blank** (JavaScript's `trim` removes U+FEFF and not
U+0085; Python's `strip` does the reverse) and the **semver pattern** (JavaScript's `\d` is
ASCII; Python's and Rust's are Unicode-aware, so a transcribed `\d` would accept `"١.٢.٣"`).

### `predicates/v1/`

The [contract predicates](./predicates/v1/) — the two checks that are pure functions of
their input: `isHitlRequest`, and the no-row-data tool check whose twenty-three
[segments](./predicates/v1/row-data-segments.json) every binding would otherwise hand-copy.

The segment set publishes its **tokenizer** alongside its data, because a binding that reads
the list and infers folding and splitting from its own language's defaults is the failure
mode. Case folding is defined as an ASCII range rather than as "lowercase": Java's
`toLowerCase` is locale-sensitive (under a Turkish locale `QUERIES` misses), and Go's uses
simple case mapping where JavaScript, Python, and Rust use full. Exactly two code points in
Unicode lower into ASCII, so the portable rule costs almost nothing.

The document also states one obligation it deliberately does **not** publish a fixture for —
that a connector's audit logger must be asynchronous — because "returns a Promise" asserts
JavaScript rather than the contract.

### `probe/v1/`

The [sandbox probe protocol](./probe/v1/sandbox-probe.md) — the exit-code contract between a
contract-test harness and the probe binary it forks, plus the harness decision table
(permissions and platform in, an ordered sequence of probe invocations out). A binding ships
its *own* probe, so this is an inter-process protocol rather than a function signature.

Read [§7](./probe/v1/sandbox-probe.md#7-what-this-specification-does-not-give-you) before
relying on a passing run: the SDK harness does **not** sandbox-wrap the probe, so the corpus
proves the harness's decision logic and the probe's error classification, never that any
sandbox enforces anything. That is the gateway's harness to demonstrate.

### `wire/v1/`

The [NDJSON framing specification](./wire/v1/framing.md) — how a byte stream divides into
frames, in RFC-2119 language: the LF delimiter and CR handling, UTF-8 decoding (non-fatal
and stream-aware), the BOM rule, the 1 MiB limit and what makes exceeding it terminal,
end-of-stream and truncation, empty frames, and the payload encoding.

Framing only. Message envelopes, request and response shapes, and liveness belong to the
gateway and are out of scope — a binding that implements this document can carry any of
them.

### `negotiation/`

The [contract-version negotiation specification](./negotiation/v1/contract-version.md) — how a
connector and the gateway that spawned it agree, at connector start, on which major version of
the contract they both speak: the optional `contractVersions` manifest field and its absence
default of `["1"]`, the one frame each peer writes unprompted, the deterministic algorithm both
peers run to agree on the largest common major, and the single refusal path and its reserved
exit code. See [RFC-0005](../rfcs/0005-contract-version-negotiation.md).

Its frame schema, [`hello.schema.json`](./negotiation/hello.schema.json), is published
**without a `v1/` segment** — a sibling of this document's own `v1/` directory, not a child of
it. The hello frame's shape is permanently frozen across every future contract major: a
`v1`-only connector and a hypothetical `v2`-only gateway must still be able to read each other's
hello in order to discover they share nothing, so publishing its schema under a version segment
would assert the opposite of the rule the document states.

Its corpus, [`conformance/v1/negotiation/`](./conformance/v1/negotiation/), has three case
kinds: `negotiate` (two sets in, an agreed version or a typed refusal out), `hello` (a frame in,
a parsed set or a refusal reason out), and `declaration` (a manifest set and a hello set in,
accept or the exact-match violation out).

### `diagnostics/v1/`

The [diagnostics / telemetry contract](./diagnostics/v1/diagnostics.md) — the one structured
envelope both SDKs encode for a connector to report a diagnostic or an audit record to the
gateway: the closed member set (`nimbus`, `ts`, `level`, `extensionId`, `event`, `kind`,
`correlationId`, `fields`, `error`), the four ordered levels published in
[`levels.json`](./diagnostics/v1/levels.json), the encoding rules that make two bindings
produce byte-identical lines, and the fourteen-reason rejection table checked in a fixed
order. Unlike the hello frame, the envelope is **closed** — an unknown member is rejected, not
ignored — which is the entire redaction guarantee: an open envelope has an unbounded number of
places to put a secret or a row of user data, and this one has none beyond the nine members it
names. That guarantee is about the *shape* of the envelope, not a proof that every member is
inert — `fields` is closed to free text by construction, but `extensionId`, `event`, and
`error.code` remain caller-controlled strings this document does not length-bound (§8). See
[RFC-0010](../rfcs/0010-diagnostics-contract-v0.md).

Its corpus, [`conformance/v1/diagnostics/`](./conformance/v1/diagnostics/), has three case
kinds: `encode` (a value in, a line or a typed rejection out), `parse` (a line in, an event or
a typed rejection out — the gateway's direction), and `level` (threshold comparison, pinning
the published order).

### `connector-kit/v1/`

The [URL resolution contract](./connector-kit/v1/url-resolution.md) — the rule behind
`resolveUrlWithBase` / `resolve_url_with_base`, the chokepoint that stops a caller-supplied
pagination link from redirecting a credential-bearing REST fetch at an attacker-controlled
host. It specifies: what makes an input absolute (a scheme followed by a colon, and nothing
else); that a relative input resolves against the base by string concatenation, never by RFC
3986 relative-reference resolution — the one branch where getting this wrong exfiltrates the
connector's bearer token silently; the two malformed conditions an absolute input is checked
against, in order; how an origin is built for the same-origin comparison; the three rejection
reasons, their evaluation order, and their exact messages; that credentials MUST NOT cross an
origin change, on any transport a binding accepts; and what is left undefined for a
non-ASCII or otherwise unusual host. See [RFC-0011](../rfcs/0011-url-resolution.md).

### `batteries/v1/`

A [preamble](./batteries/v1/README.md) and one document per battery —
[`data-profile`](./batteries/v1/data-profile.md),
[`distribution-channel`](./batteries/v1/distribution-channel.md),
[`icalendar`](./batteries/v1/icalendar.md) and [`jmap`](./batteries/v1/jmap.md).

Batteries are not the contract, and they are specified here for the same reason
`connector-kit/v1/` is: **a helper that exists in three languages needs one statement of
behaviour rather than three readings of one implementation.** The counter-example is the
rest of `connector-kit`, whose forty un-specified names produced four cross-language
divergences, every one found by hand and none by CI.

The preamble settles what the four documents would otherwise each answer differently: that
I/O is specified against injected inputs and never a real filesystem or clock; that where a
document and the implementation disagree the document wins and the implementation moves;
how an input is declared undefined; that a JavaScript-derived vocabulary must be enumerated
as a closed set rather than named by a host operation; that builders are pinned byte for
byte; that unparseable input yields an absence rather than an error; and the **normative
whitespace set**, enumerated, which exists because the three runtimes' own trims disagree on
U+FEFF, U+0085 and U+001C–U+001F. See
[RFC-0017](../rfcs/0017-battery-specifications.md).

### `conformance/v1/`

Eleven kinds of assertion, across **twelve** corpus directories — the two counts differ
because the document fixtures cover both `manifest` and `item` from one top-level index.
The groups below are the eleven kinds; `corpusNames()` in
`sdks/typescript/scripts/conformance-corpora.ts` is what enumerates the twelve.

**Document fixtures** — [`index.json`](./conformance/v1/index.json) is the machine-readable
manifest; every fixture carries a shape, an expected verdict, a class, and a reason, so a
runner in any language consumes the corpus without parsing prose. The index is itself
validated against [`index.schema.json`](./conformance/v1/index.schema.json).

Equivalence-class manifest fixtures additionally declare `violations` — every
[rule](./rules/v1/) the document breaks, with its JSON Pointer, sorted by rule and then by
path so a binding's evaluation order stays its own business. Agreeing on the verdict is not
agreeing on the contract: without this, a binding could reject `invalid-missing-id.json`
because it mistyped the `entrypoint` check and still pass the corpus.

**Framing cases** — [`framing/`](./conformance/v1/framing/) is the executable form of the
wire spec, with its own [`index.json`](./conformance/v1/framing/index.json) and
[`case.schema.json`](./conformance/v1/framing/case.schema.json). A case is a stream rather
than a value: it names a sequence of chunks and the frames each push must emit, so "a chunk
is not a frame" is encoded structurally. Chunks are written as readable `utf8`, exact
`base64` for ill-formed or deliberately split sequences, or a `repeat` descriptor so a case
at the 1 MiB limit costs a few lines rather than megabytes. Kept separate from the document
index deliberately: the two need different runners, and widening the published document
index would make an older validator reject entries it cannot interpret.

**Predicate cases** — [`predicates/`](./conformance/v1/predicates/) is the executable form of
the predicate spec, with its own [`index.json`](./conformance/v1/predicates/index.json) and
[`case.schema.json`](./conformance/v1/predicates/case.schema.json). A case names a predicate,
an input, and the required result — a verdict for `isHitlRequest`, and for the row-data check
a list of `{tool, segment}` pairs in **input order**, so a binding that flags the right tool
for the wrong reason still fails. Separate from the document index for the same reason the
framing cases are: admitting them would have to widen a published `enum` and a published
`pattern`, which an older validator rejects outright rather than ignoring.

**Sandbox cases** — [`sandbox/`](./conformance/v1/sandbox/) is the executable form of the
probe protocol. A `harness` case is the decision table written down: permissions and a
platform in, an ordered sequence of probe invocations out, driven through a stubbed probe
runner, so both skips — Windows, and no-declared-hosts — are pinned rather than described. A
`classify` case drives the errno-to-exit-code mapping, the one part of a probe's own logic
reproducible without a real sandbox. Neither proves a sandbox enforces anything; see the
spec's own §7.

**Negotiation cases** — [`negotiation/`](./conformance/v1/negotiation/) is the executable form
of the [contract-version negotiation specification](./negotiation/v1/contract-version.md)
above, with its own [`index.json`](./conformance/v1/negotiation/index.json) and
[`case.schema.json`](./conformance/v1/negotiation/case.schema.json). Three case kinds —
`negotiate`, `hello`, and `declaration` — cover the algorithm, the frame, and the exact-match
check respectively. Separate from the document index for the same reason the framing and
predicate corpora are: widening the published document index would make an older validator
reject entries it cannot interpret.

**Diagnostics cases** — [`diagnostics/`](./conformance/v1/diagnostics/) is the executable
form of the [diagnostics / telemetry contract](./diagnostics/v1/diagnostics.md) above, with
its own [`index.json`](./conformance/v1/diagnostics/index.json) and
[`case.schema.json`](./conformance/v1/diagnostics/case.schema.json). Three case kinds —
`encode` (a value in, a line or a typed rejection out), `parse` (a line in, an event or a
typed rejection out — the gateway's direction), and `level` (threshold comparison, pinning
the published order) — cover the encoder, the parser, and §6's ordering respectively.
Separate from the document index for the same reason the framing, predicate, and
negotiation corpora are: widening the published document index would make an older
validator reject entries it cannot interpret.

**URL-resolution cases** — [`url-resolution/`](./conformance/v1/url-resolution/) is the
executable form of the [URL resolution contract](./connector-kit/v1/url-resolution.md)
above, with its own [`index.json`](./conformance/v1/url-resolution/index.json) and
[`case.schema.json`](./conformance/v1/url-resolution/case.schema.json). A case is a base, an
input, and either the exact string returned or the exact refusal — reason and message
both — so two bindings are held to the same words and not merely to the same verdict: a
binding that refuses for the right reason with different wording still fails the case,
because the message is contract text.

**Data-profile cases** — [`data-profile/`](./conformance/v1/data-profile/) is the executable
form of [`batteries/v1/data-profile.md`](./batteries/v1/data-profile.md), with its own
[`index.json`](./conformance/v1/data-profile/index.json) and
[`case.schema.json`](./conformance/v1/data-profile/case.schema.json). It is the first corpus
whose cases are discriminated by a **`kind`** rather than by an outcome: the battery is six
functions rather than one predicate, so a case names which one it calls and carries only
that function's inputs. The schema enforces that pairing, so a case with a mistyped input
member fails validation rather than running vacuously against an absent argument.

**Distribution-channel cases** — [`distribution-channel/`](./conformance/v1/distribution-channel/)
is the executable form of
[`batteries/v1/distribution-channel.md`](./batteries/v1/distribution-channel.md). It is the
first corpus for a battery that reads the **outside world**: the environment, the running
executable's path, and the filesystem. The preamble's §R1 requires all three to be injected,
so a case supplies an environment map, an exec path, and a **realpath map** — and a key
mapping to `null` means the resolver *throws*, which is the only way "a failure yields the
input path unchanged" is pinnable at all. A map alone can express only a resolver that
succeeds.

Its schema also pins every path to printable ASCII. §3 lowercases the whole path, and Go's
`strings.ToLower` applies Unicode's simple case mapping where Python and JavaScript apply
the full one — so a case carrying `İ` would pin a value the three bindings do not share.

**Icalendar cases** — [`icalendar/`](./conformance/v1/icalendar/) is the executable form of
[`batteries/v1/icalendar.md`](./batteries/v1/icalendar.md). It is the first corpus for a
battery with **two** functions rather than one, so it carries two kinds: a `parse` case
supplies an ICS document and expects the events it yields, and a `build` case supplies a
`BuildEventInput` and an injected `now` and expects the produced document **byte for byte**,
which is what the preamble's §R5 requires of a builder. A `parse` case's expectation states
all thirteen `ParsedEvent` members with no defaulting, so a case cannot quietly stop
asserting one.

Where `distribution-channel` forbids `İ` in a case, this corpus **requires** one. §5.3
searches a value case-insensitively for `mailto:` and then slices at the index it finds, and
U+0130 is the single code point whose lowercase changes length — expanding in JavaScript and
Python, contracting under Go's simple mapping. Two cases carry it, reaching the search by
different routes: one through prefix text, which §5.3 tolerates outright, and one through a
colon inside a quoted parameter, which is §9's divergence 1 composing with §5.3. An ordinary
parameter cannot reach it at all, because §3.2 removes the parameter section along with the
first colon — a corpus built on one would pin nothing, which is a mistake this corpus's first
draft actually made.

**JMAP cases** — [`jmap/`](./conformance/v1/jmap/) is the executable form of
[`batteries/v1/jmap.md`](./batteries/v1/jmap.md). It carries **ten case kinds**, the most
of any corpus — not to be confused with the eleven *groups* counted above — because §1's
surface is ten operations rather than one or two, and
one of them is unlike anything else in the tree: `validateApiUrl` **raises** where every
other function in every battery returns an absence. §5.1 says why, and it is a control
rather than a style: an absence is a value a caller can ignore, and the one thing a
caller must not do with a rejected `apiUrl` is carry on. Its cases follow
`url-resolution`'s `{ ok, message }` shape, since that corpus already models a throwing
function — but without its `reason` token, which `jmap.md` does not define and a corpus
may not invent.

The corpus is named `jmap` where the modules are `jmap-fastmail`; RFC-0017 §2 settles
that a document is named for what it specifies, and nothing here is Fastmail-specific.

`request` cases compare a **parsed structure**, never serialised bytes. §9 records why:
Go's `encoding/json` sorts a map's keys on marshal where the other two emit insertion
order, so the same conforming request serialises differently in different bindings.

Two classes, because the schemas and the TypeScript runtime do not check identical things:

- **`equivalence`** — the schema and `runContractTests` both cover these fields and must
  reach the same verdict. CI asserts both directions.
- **`schema-only`** — either the field is one the TypeScript runtime never inspects (on
  `ExtensionManifest`, `oauth`, `syncInterval`, `tags`, `homepage`, and `icon` all fall
  outside `runContractTests`), or there is no runtime validator for the shape at all, as
  with every `NimbusItem` fixture — `runContractTests` only takes an `ExtensionManifest`.
  These fixtures record where the published contract is stricter than, or simply broader
  than, the reference implementation's runtime check.

## What versioning means here

`v1` is the **contract** version, not the package version. The package releases on its own
clock; a schema path changes only when the contract does. Within `v1` only additive change
is permitted — removing or narrowing a field requires a major. This spec's own convention
resolves that as a new path segment rather than an edit to this one; the [deprecation
policy](../DEPRECATION-POLICY.md) governs export deprecation windows, not this rule.

The four **contract-shape** schemas — the three under `schemas/v1/` and `negotiation/hello`
— are **open**: none sets `additionalProperties: false`, so an older consumer validating
against an older copy is unaffected by additions.

The diagnostics event schema is the deliberate exception: it is **closed**, for the
redaction reason given above — an open envelope has unlimited places to put a secret.

## What is not here yet

- **Message envelopes.** The wire spec above covers framing; the request/response shapes
  carried inside a frame belong to the gateway, not to this package, and are deliberately
  unspecified here.
- **Agent brief schemas.** The shapes above prove the mechanism; the brief shapes follow.

## How this stays true

Twelve guards run on every pull request as part of `bun run test` (see
`.github/workflows/ci.yml`).

The guards hold the *documents* to each other and to the TypeScript reference. What
holds the contract to being **language-neutral** is that other bindings execute the
same fixtures: `sdks/python/` and `sdks/go/` each run the `negotiation` corpus — all three
case kinds — the `framing` corpus, the `diagnostics` corpus, and the `url-resolution`
corpus, from the same `index.json` files the TypeScript guards read, with nothing deferred.
They also both run the `data-profile` corpus, which holds a third kind of claim again —
not a wire format and not a security chokepoint, but a *battery*: that three
implementations of an ordinary helper agree on every column name, every kind and every row
count, including the ones their host languages would each get differently.
They also both run the `distribution-channel` corpus, which adds a fourth kind of claim:
that three implementations agree about the *outside world* — the same environment map,
executable path and symlink resolver in, the same channel out — where each language's
obvious path and environment helpers would answer differently. `str.replace` against
`PurePath.as_posix`, and `strings.ReplaceAll` against `filepath.ToSlash`, are the same trap
twice: each pair agrees on Windows and diverges on Linux, so only a corpus that runs in
every language catches it.
A case added to any of these seven therefore runs in all three languages as soon
as it is indexed, and a claim only one binding can satisfy fails somewhere. The first three hold a wire-level claim — a byte
stream, a handshake frame, a diagnostic envelope decoded the same way by both peers;
`url-resolution` holds a narrower one — that `resolveUrlWithBase`,
`resolve_url_with_base` and `ResolveURLWithBase`, three separate implementations of the
same SSRF chokepoint rather than the two ends of a protocol, reach the same verdict and the
same words on every case.
They also all three run the `icalendar` corpus, the seventh, which holds a fifth kind of
claim — that three implementations of an ordinary text format agree on the exact bytes,
both the thirteen members parsed out of a document and the document built back, which §R5
pins byte for byte. It is the corpus where the three languages' defaults disagree most: a
naive `mailto:` search is wrong in opposite directions in Go and in the other two, a naive
trim is wrong differently again, and a naive fold at "75" cuts in three different places
because `len` counts bytes, code points and UTF-16 units respectively.

That parity is stated per corpus rather than for the tree, because it does not hold for the
whole tree. Five corpora are executed by the **TypeScript** binding alone.
`jmap` is executed by the **TypeScript** binding only, for now — its Python and Go bindings land in the next two pull requests of this shipment, and this sentence goes with them.
`predicates` and `sandbox` are executed by the **TypeScript** binding only — they bind surfaces neither `nimbus_sdk` nor any Go package publishes.
`manifest` and `item` are executed by the **TypeScript** binding only too — they are fixture sets that need a JSON Schema validator, which the zero-runtime-dependency rule would make hand-written in both other bindings.
All five are real corpora with real guards, but no second implementation runs them, so they
carry no language-neutrality evidence. Treat a passing `jmap`, `predicates`, `sandbox`,
`manifest` or `item` run as "the reference implementation agrees with the spec", not as
"the spec is implementable twice". `jmap` is the one of the five whose place on this list
is temporary.

Which binding runs which corpus is declared in
[`docs/conformance-coverage.json`](../conformance-coverage.json) and rendered, with the
case counts, into [`docs/conformance-coverage.md`](../conformance-coverage.md).
`sdks/typescript/scripts/corpus-parity.test.ts` holds that declaration complete and holds this
paragraph to it in both directions, and CI's `conformance-report` job holds it true by
execution — every claimed corpus run case for case, or the build fails.

`sdks/typescript/scripts/schema-guard.test.ts` compares each schema's declared properties and
optionality against the emitted TypeScript — descending into inline object types, so `oauth` is
covered — and runs every fixture through `ajv`, plus through `runContractTests` for the
`equivalence` class. A schema that drifts from the reference implementation fails CI.

`sdks/typescript/scripts/rules-guard.test.ts` asserts the rule registry and the reference
implementation's rule table declare the same ids — none missing, none extra — and that every
published rule is asserted by at least one fixture. A rule with no fixture is a rule no binding
is held to.

`sdks/typescript/scripts/predicates-guard.test.ts` asserts the published segment set and
`ROW_DATA_TOOL_SEGMENTS` declare the same members, drives every predicate case through the
reference implementation, and checks the `HitlRequest` schema reaches the same verdict as the
runtime on every one of them — the same schema-versus-runtime equivalence the manifest corpus
asserts.

`sdks/typescript/scripts/sandbox-guard.test.ts` asserts the published probe protocol and
`sdks/typescript/src/testing/sandbox-protocol.ts` declare the same probe names, exit codes, and
error-code sets, replays every harness case against the real decision logic with a recording
stub, and drives every classify case through the probe's classification. A companion,
`sdks/typescript/scripts/probe-runtime.test.ts`, asserts the built probe calls no
runtime-specific global — the harness spawns the *consumer's* runtime, and a Bun-only call
failed under Node silently, because the resulting error carries no code and is classified as an
unexpected outcome.

`sdks/typescript/scripts/framing-guard.test.ts` validates the framing corpus against its
schemas and drives every case through `NdjsonLineReader`. It also runs under plain Node against
the built `dist/`, via `sdks/typescript/scripts/framing-node.mjs` in the cross-OS × Node-LTS
matrix: framing bottoms out in `TextDecoder`, whose edge behavior is not identical across
runtimes, and a corpus other languages are told to trust must not encode one runtime's quirk.

`sdks/typescript/scripts/negotiation-guard.test.ts` asserts the contract-version pattern is
identical across its one TypeScript spelling and its five copies (the hello schema, the
manifest schema, the rule registry, the spec document's prose, and the negotiation corpus's own
case schema, which carries the pattern twice); that `hello.schema.json` stays outside any
version directory, so the frozen-frame rule stays a failing test rather than only a comment;
that the corpus validates against its schemas and every case agrees with
`negotiateContractVersion`, `parseHello`, and `declaredVersionsMatch` respectively, with the
hello schema reaching the same verdict as `parseHello` on every well-formed frame; that the
reserved exit code agrees across the spec's prose, the `CONTRACT_HANDSHAKE_EXIT` constant, and
every refusal case in the corpus; and that a short-circuiting anti-binding cannot pass, proving the
corpus distinguishes validate-then-intersect from short-circuit-on-empty (RFC-0006). The three new
manifest rule ids are covered by `sdks/typescript/scripts/rules-guard.test.ts`
instead, which already asserts every published rule — old and new alike — is declared
identically by the registry and the rule table, and is asserted by at least one fixture.

`sdks/typescript/scripts/diagnostics-guard.test.ts` asserts the published patterns (`ts`,
`event`, `correlationId`, `fields` key) are spelled identically across the event schema and
the spec's own prose, that `levels.json` and the runtime's `DIAGNOSTIC_LEVELS` agree, that
the corpus validates against its schemas and every case agrees with `encodeDiagnostic`,
`parseDiagnostic`, and `meetsLevel` respectively, that every envelope member has both an
accepting and a rejecting case, that every rejection reason is produced by at least one
case, and that no parse case expects `line-too-long` — §5.1 requires that reason be
encode-only.

`sdks/typescript/scripts/url-resolution-guard.test.ts` validates the url-resolution corpus
against its schemas, holds the index and the cases directory to each other, and drives every
case through `resolveUrlWithBase`. It asserts every published §7 rejection reason —
`malformed`, `invalid-base`, `cross-origin` — is asserted by at least one case, that every
pinnable section (§3 through §7) is cited by at least one case, and that both outcomes are
exercised. It also pins §4 specifically against relative-reference resolution: a
protocol-relative case (`input` starting with `//`) must resolve by string concatenation,
staying on the base's own host, rather than by `urljoin` / `new URL(input, base)`, which would
read it as a network-authority reference and hand the fetch to a different host.

`sdks/typescript/scripts/data-profile-guard.test.ts` validates the data-profile corpus
against its schemas, holds the index and the cases directory to each other, and drives every
case through the battery's six functions. Its cases are discriminated by `kind` rather than
by an ok/refused outcome — the battery is six functions, not one predicate — so it asserts
every kind is exercised in place of asserting both outcomes. Four of its checks guard a
specific wrong implementation rather than a section: the §1.1 column cap needs a case whose
input actually exceeds 512 fields; §7.1 needs both the truncated and the untruncated empty
input, since a binding could otherwise satisfy it by special-casing the empty string ahead
of the truncation check; §6.1 needs a row count above 2⁵³−1, without which a binding
returning an exact integer type would pass every other parquet case; and at least one case
must carry non-alphabetical keys, or a binding decoding an object into a sorted map would
pass every object case. It also asserts §2.1 by **absence** — exactly the six kind names
reachable from JSON are asserted and no others, because a case pinning `undefined`,
`function`, `symbol` or `bigint` would violate the batteries preamble's §R3 rather than add
coverage.

`sdks/typescript/scripts/distribution-channel-guard.test.ts` validates the
distribution-channel corpus against its schemas, holds the index and the cases directory to
each other, and drives every case through `resolveDistributionChannel` and
`channelUpgradeHint`. Its anti-vacuity checks are mostly *negative* requirements, because
this battery's specification is full of them: a case must pin a resolver that **throws** in
both directions, or §3.1 is untested; a case must carry a marker differing only in case or
whitespace, or a binding folding or trimming it would pass; a case's exec path must lack the
tell-tale segment while its *resolved* path has it, or a binding skipping symlink resolution
would pass; and a case must supply a winget- or apt-shaped path expecting an **absence**, or
a binding adding a sixth path heuristic would pass. It also asserts every `resolve` case
supplies all three injected inputs — an absent one makes the reference implementation read
the runner's own machine — and that every path in the corpus is printable ASCII.

`sdks/typescript/scripts/icalendar-guard.test.ts` validates the icalendar corpus against
its schemas, holds the index and the cases directory to each other, and drives every case
through `parseICalendar` or `buildVEvent`. A `parse` case is compared by deep equality on
the **whole** thirteen-member event rather than member by member, so a member the corpus
later grows cannot be silently unasserted. Its anti-vacuity checks are the ones this
battery's shape needs: every expected event must state all thirteen members; a case must
distinguish an empty value from an absence in both `summary` and `organizer`, without
which Go's obvious zero-valued `ParsedEvent` passes the entire corpus; a case must carry
U+0130, without which all three languages' wrong `mailto:` searches pass; §R7 must be
pinned in both directions, by a U+FEFF the host trims should keep and a U+001C it should
not; and at least two `build` cases must exceed 75 octets — one of them multi-octet, or
"75 octets" is never distinguished from "75 characters" — with no `build` case's expected
output containing a fold sequence anywhere, which is what makes §7 executable rather than
merely settled.

`sdks/typescript/scripts/jmap-guard.test.ts` validates the jmap corpus against its
schemas, holds the index and the cases directory to each other, and drives every case
through one of ten entry points. Its anti-vacuity checks are shaped by what this battery
gets wrong when ported: each of §5's three rejection messages must be pinned verbatim, or
two of the three branches go untested; a case must expect a **raise** and another an
acceptance, or §5.1's whole distinction is unexercised; all three §5.2 host hazards must be
present — an explicit default port, a mixed-case host, an IPv6 literal — because the three
URL parsers disagree on each and a *different pair* agrees each time; a §6.4 case must
carry an astral character straddling the cap, without which a naive slice passes, as the
reference's did; §6.1's dropping rule and §6.2's never-drop rule must each be pinned,
since a binding sharing one helper between them fails whichever it did not implement; and
the list request must expect a query object with **no `filter` key at all**, an absence
that is only assertable if a case states it. One check is corpus-wide rather than
per-case: no expected preview may be ill-formed UTF-16, so a future case cannot quietly
pin a value a Python consumer raises on.

Every one of them refuses to pass vacuously — an empty corpus, a fixture on disk that no
index lists, a published rule or segment no fixture asserts, or a predicate corpus that only
ever expects one answer, is itself a failure.

Changes here follow the [RFC process](../GOVERNANCE.md#the-rfc-process): a change to the
spec is a change to the contract every binding must honor.
