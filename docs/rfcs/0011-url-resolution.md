# RFC-0011 — URL resolution for the connector kit

- **Status:** accepted
- **Opened:** 2026-08-18
- **Landed:** 2026-08-18 — this document, `docs/spec/connector-kit/v1/url-resolution.md`, and
  `docs/spec/README.md` land together; the conformance corpus, the TypeScript correction, and
  the Python binding follow in this same feature's later commits
- **Affects:** `docs/spec/` (new `connector-kit/v1/` area), `@nimbus-dev/sdk`
  (`resolveUrlWithBase` in `./connector-kit`), `nimbus_sdk.connector_kit` (a new,
  not-yet-existing Python import root this RFC's document is written to bind in advance)
- **Roadmap:** [Phase 3](../ROADMAP.md#phase-3--scale-languages--batteries) — "A Python
  `connector-kit`," which today names the asymmetry rather than closing it: TypeScript
  publishes [`@nimbus-dev/sdk/connector-kit`](../modules/connector-kit.md) and
  `nimbus-dev-sdk` has none, so a generated Python connector re-derives what the kit would
  absorb in its own `main.py`
- **Pillars:** 1 (the contract), 2 (polyglot SDKs), 3 (batteries), 8 (no secrets, no
  credential leakage — this is the SSRF / token-exfiltration chokepoint)
- **Builds on:** [RFC-0003](./0003-pure-predicates.md), whose normative-document-plus-corpus
  pattern this reuses for a pure helper already shipping in TypeScript; [RFC-0010](./0010-diagnostics-contract-v0.md),
  whose "land the normative document now, the corpus and the second binding in later commits
  of the same feature" sequencing this RFC follows exactly

## Problem

`resolveUrlWithBase` already exists in TypeScript, in `sdks/typescript/src/connector-kit/fetch-bearer-json.ts`,
and it is not correct. It classifies an input as absolute using a prefix check —
`pathOrUrl.startsWith("http")` — rather than the presence of a URL scheme, and that heuristic
is wrong at both of its edges: it misclassifies the legitimate relative path `httpdocs/x` as
absolute, and, more seriously, it lets any non-`http`-prefixed absolute URL fall through to
string concatenation, silently building a malformed URL like `https://api.example.comftp://evil.com`
that then fails at the fetch rather than being rejected as the cross-origin attempt it is. A
correct implementation and a correct specification of it need to exist before a Python binding
of the same function can be written at all — there is currently nothing language-neutral to
bind.

This RFC exists to fix that in the right order: specify the rule normatively, so the TypeScript
correction and the Python implementation that follows are both bound to the same document
rather than to each other's source.

Two objections stand in the way of doing this the way every other normative document in this
package was done, and this RFC exists to answer both before the later tasks in this feature
build on the answer.

## §1 Why no INCLUSION-POLICY §3 evidence is needed

[`INCLUSION-POLICY.md` §3](../INCLUSION-POLICY.md#3-genuinely-reused) requires a battery be
used by at least two connectors, or by one plus a written case for the second, before it is
admitted. A literal reading blocks this work outright: there are no first-party Python
connectors today, so a Python `resolveUrlWithBase` cannot point at a second consumer, written
or otherwise, any more than the TypeScript one already in production could when it was first
written.

But §3 is not being asked to admit a new battery. `connector-kit` — TypeScript's, including
`resolveUrlWithBase` — was admitted once already, on TypeScript's own evidence: it is the
Bearer-auth REST fetcher every hand-rolled first-party connector in the Nimbus monorepo uses,
which is exactly the "used by at least two connectors" bar §3 sets, met before this RFC exists.
What is being proposed here is not a new module clearing that bar again; it is a second
*language's binding* of a module that already cleared it once.

The reading this RFC adopts, and that every future battery port should cite as precedent: **a
binding of an already-admitted battery is not a new battery.** §3 exists to stop the surface
growing by accretion — to make sure nothing is added on the strength of "this seems useful"
alone. That concern does not re-apply on the second binding of something the first binding
already justified with real, checkable use; re-litigating reuse evidence per language would
make Pillar 2's polyglot promise conditional on re-proving Pillar 3's admission bar once per
language, which is not what either pillar states and not a cost the roadmap's own Phase 3 box
("the hottest batteries ported to the additional languages") accounts for. The kit passed §3
on TypeScript's evidence once; a binding is what "polyglot" was always going to mean for a
battery that already passed.

## §2 Why the corpus takes the RFC path when the kit does not

If §1 settles that admitting a Python `resolveUrlWithBase` needs no fresh reuse evidence, why
does this land as an RFC at all, rather than as the additive PR-plus-review process
[GOVERNANCE.md](../GOVERNANCE.md#change-classes) gives an ordinary battery addition?

Because this feature does not stop at porting the existing function. Every other conformance
corpus in this repository pins a normative document under `docs/spec/` — framing pins
`wire/v1/framing.md`, negotiation pins `negotiation/v1/contract-version.md`, diagnostics pins
`diagnostics/v1/diagnostics.md`. There is no such document for URL resolution: TypeScript's
`resolveUrlWithBase` has a docstring and a source file, not a specification, and a docstring
is not something a second language can be held to byte-for-byte the way a message string or a
rejection order can. Writing `url-resolution.md` is what makes a corpus possible at all — and
writing it adds a normative document under `docs/spec/`, which
[GOVERNANCE.md's change-class table](../GOVERNANCE.md#change-classes) classes as
**contract-affecting**: "changing an exported type, the wire protocol, the schemas, or a
conformance invariant." A new conformance invariant is exactly what this is, so the RFC
process applies regardless of what §1 settles about reuse evidence — the two questions are
independent, and this RFC answers both because both gate the same feature.

## §3 The rule, and the two heuristic edges it replaces

**Absoluteness.** An input is absolute when, and only when, it matches
`^[A-Za-z][A-Za-z0-9+.-]*:` — an RFC 3986 scheme followed by a colon. Nothing else makes it
absolute.

**Relative resolution.** A non-absolute input resolves to `base + input`, by string
concatenation — never by RFC 3986 relative-reference resolution. The base is not parsed, not
validated, and not normalised on this path.

This replaces the `startsWith("http")` prefix check at both of its wrong edges. `httpdocs/x`
is relative under the scheme rule — there is no colon, so it is never mistaken for an absolute
URL — where the prefix heuristic reads its first four characters and misclassifies it,
rejecting a legitimate relative path a connector author never meant as a URL. And
`notes:2024/x` is absolute under the scheme rule and therefore rejected as malformed (§5 of
the normative document) rather than silently concatenated: `notes` is a syntactically valid
scheme, so treating it as one is correct even though it costs a connector author the ability to
write a relative path whose first segment is immediately followed by a colon. That
scheme-shaped relative segment is the price of a correct rule, and the normative document names
that price rather than hiding it — the alternative, a heuristic that gets `notes:2024/x` right
by accident, is exactly the shape of heuristic that gets `httpdocs/x` wrong.

The distinction between concatenation and relative-reference resolution is not stylistic; it is
the one branch that determines whether the chokepoint holds at all. `//evil.com/x` has no
scheme, so it is relative by the rule above — concatenated onto the base, it becomes
`https://api.example.com//evil.com/x`, an odd path on the connector's own origin. Resolved as
an RFC 3986 relative reference — the behavior of `urllib.parse.urljoin` in Python and of
`new URL(input, base)` in JavaScript — it becomes `https://evil.com/x`, because a
protocol-relative input is a *network-authority reference* under that grammar: it names a
different host without naming a different scheme. A protocol-relative input never reaches the
origin check that governs every other absolute input, because by the scheme rule it is never
classified as absolute at all — so if this one branch is implemented as relative-reference
resolution instead of concatenation, the chokepoint's whole guarantee is bypassed silently, and
nothing downstream notices. `docs/spec/connector-kit/v1/url-resolution.md` §4 states this as a
MUST NOT and names both constructs so a future Go or Rust binding is told before its author
reaches for the equivalent one-liner.

## §4 The semver call

TypeScript's correction lands as `fix:` — a patch, not a `feat:` and not a major. Three
behavior changes follow from replacing the prefix heuristic with the scheme rule, and each is
stated here in terms of what it does to a caller, because a patch-level claim on a function
whose behavior changes needs to survive exactly this scrutiny.

**Previously threw, now succeeds.** `resolveUrlWithBase("https://api.example.com", "httpbin/status")`
raised on a legitimate relative path, because the old heuristic read its `http` prefix as an
absolute URL and tried to parse it as one. No caller can have depended on that failure except
by catching an error the function should never have produced in the first place — there is no
legitimate use of "this call always throws" to protect.

**Previously succeeded, now throws — but the success was in name only.** A non-`http`-prefixed
absolute URL such as `ftp://evil.com` did not match `startsWith("http")`, so the old code
concatenated it onto the base: `https://api.example.comftp://evil.com`. That string is not a
valid URL; it was never going to fetch anything, only fail later at the point something tried
to construct a request from it. Under the scheme rule it is correctly recognized as absolute,
correctly found to mismatch the base's origin, and rejected with a real, typed reason instead
of a malformed string. No input that previously produced a *working* URL changes under this
correction — only inputs that were already broken, in a way this now names instead of hides.

**Previously succeeded, now throws — genuinely.** An absolute input containing a raw tab, LF,
or CR — say, an absolute URL with an embedded newline — was silently stripped of that
whitespace by `new URL(...)` and fetched anyway. Under this document's §5, that input is now
`malformed` and rejected outright. This is the one change that narrows a previously-working
input, and it is claimed as a patch on security grounds rather than smoothed over: no
legitimate API emits a pagination link containing a bare control character, and a link that
does is a log-injection and request-smuggling signal, not a URL a connector should ever
silently clean up and fetch. Saying so plainly, rather than eliding this case among the other
two, is the honest version of this table.

**What was considered and declined.** Rejecting an absolute URL that carries userinfo —
`https://user@api.example.com/x` — was considered and declined. That URL resolves same-origin
today under either implementation and returns a working, correctly-scoped fetch; rejecting it
would break a call a caller can genuinely be relying on today, for no security gain, since the
host comparison in §6 already governs regardless of userinfo. The credential-exfiltration shape
userinfo actually enables — `https://api.example.com@evil.com/x`, where the attacker's host is
disguised as userinfo on the *expected* host — is already rejected under this document, because
§6 defines the host as whatever follows the **last** `@`: that input's host is `evil.com`, the
origin check fails, and it is rejected as `cross-origin` exactly as it should be. There is
nothing left for a userinfo-specific rejection to buy.

## Compatibility impact

| Change | Semver | Who is affected |
|---|---|---|
| `docs/spec/connector-kit/v1/url-resolution.md` added | none (spec document) | New path. Nobody validating against the existing spec areas is touched. |
| TypeScript's `resolveUrlWithBase` corrected to the scheme rule | patch (`fix`) | Per §4 above: callers relying on a thrown error for a legitimate relative path are helped; callers relying on a malformed-but-non-throwing concatenation for a non-`http` absolute URL were never actually working; callers passing an absolute URL with embedded whitespace, genuinely, are newly rejected — on security grounds. |
| `nimbus_sdk.connector_kit` added, not re-exported from `nimbus_sdk` | minor (`feat`, in the commit that adds it) | Nobody existing. A consumer must opt in to the new import root, mirroring the `.` / `./ipc` / `./diagnostics` boundary [`CLAUDE.md`](../../CLAUDE.md) already documents for Python. |
| A new conformance corpus under `docs/spec/conformance/v1/url-resolution/` | none | New path, its own index — the same reasoning that kept framing, predicates, negotiation, and diagnostics off the shared document index applies here too. |

## Migration

None for this document's own landing — it adds a new spec path nothing yet reads. The
TypeScript `fix:` described in §4 requires no caller-side migration under the compatibility
analysis above; a caller who was catching an error from a legitimate relative path, or relying
on a malformed concatenated string that never fetched successfully, needed no code that this
correction breaks. A caller passing an absolute URL with an embedded control character will see
a newly-thrown `malformed` error and should stop doing so — the correction treats that input as
what it is.

## Alternatives rejected

**Treat this as an ordinary additive battery PR, skipping the RFC.** Rejected in §2: writing
the normative document a corpus can pin is itself contract-affecting under
[GOVERNANCE.md's change-class table](../GOVERNANCE.md#change-classes), independent of whether
§1 settles the reuse question.

**Require fresh two-connector evidence for the Python binding, per a literal reading of
INCLUSION-POLICY §3.** Rejected in §1: it would block every future binding of every
already-admitted battery on evidence the *battery* already supplied once, making the polyglot
promise conditional on re-clearing an admission bar per language for something already
admitted.

**Ship the TypeScript correction as `feat:` or hold it for a major, rather than `fix:`.**
Rejected in §4: none of the three behavior changes breaks a caller relying on genuinely working
behavior, and the one that narrows an input does so on a stated security basis a patch is
allowed to claim.

**Reject absolute URLs carrying userinfo.** Rejected in §4: no security gain over the existing
last-`@` host rule in §6, at the cost of breaking a call that resolves correctly today.

**Fully normalise the resolved absolute URL rather than returning `input` unchanged on
success.** Not proposed by this RFC and not adopted: `docs/spec/connector-kit/v1/url-resolution.md`
§7 states that the function returns `input` unchanged, because the guarantee this document
makes is about which origin a fetch reaches, not about what the URL string looks like
afterward — normalising it would be a second, unrelated behavior change riding on this one.

## Out of scope

- **The conformance corpus itself.** `docs/spec/conformance/v1/url-resolution/`, its
  `index.json`, its schema, and its cases are a later commit in this same feature, per the
  "Landed" line above.
- **The TypeScript correction's implementation.** This RFC specifies and justifies the rule;
  applying it to `fetch-bearer-json.ts` is a separate, later commit, held to the corpus once
  it exists.
- **The Python binding itself**, `nimbus_sdk.connector_kit.resolve_url_with_base`, and the rest
  of the Python `connector-kit` surface the roadmap's Phase 3 box names — `main.py`'s
  `_on_list_tools`, `_on_call_tool`, and a JSON result helper are still TypeScript-only after
  this RFC. This RFC unblocks the URL-resolution slice of that gap; it does not close the gap.
- **IDNA / punycode host normalisation**, and any other case
  `docs/spec/connector-kit/v1/url-resolution.md` §9 marks undefined. Deferred there, not
  decided here.
