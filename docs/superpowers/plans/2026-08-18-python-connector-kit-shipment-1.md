# Python `connector-kit` — Shipment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the pure core of `nimbus_sdk.connector_kit` — `urls`, `env`, `results`,
`search_filter` — behind a normative URL-resolution specification and a conformance corpus
both bindings execute, correcting the TypeScript `startsWith("http")` heuristic to match.

**Architecture:** A fourth Python import root (`nimbus_sdk.connector_kit`) built the way
`ipc/` and `diagnostics/` already are — a package directory whose `__init__.py` re-exports
a fixed `__all__`. Every function in this shipment is pure and stdlib-only. The one piece
with contract weight, `resolve_url_with_base`, is specified normatively in
`docs/spec/connector-kit/v1/url-resolution.md` under RFC-0011 and pinned by a new
`conformance/v1/url-resolution` corpus that a TypeScript guard and a Python test both drive.

**Tech Stack:** Python 3.11+ (stdlib only: `re`, `math`, `json`, `os`, `urllib.parse`,
`typing`), TypeScript/Bun for the reference binding and its guards, JSON Schema (draft-07)
plus Ajv for the corpus schemas.

**Spec:** [`docs/superpowers/specs/2026-08-17-python-connector-kit-design.md`](../specs/2026-08-17-python-connector-kit-design.md)
and its review, [`2026-08-18-python-connector-kit-design-review.md`](../specs/2026-08-18-python-connector-kit-design-review.md).
Read both before starting. This plan implements **Shipment 1** only; Shipment 2 (transport,
router, `rest.py`, template rewrite) gets its own plan once this lands.

## Global Constraints

- **Zero runtime dependencies, both languages.** `[project].dependencies` in
  `sdks/python/pyproject.toml` stays `[]`; there is no `dependencies` key in
  `sdks/typescript/package.json`. If you need a helper, inline it.
- **Python floor is `requires-python = ">=3.11"`.** `TypedDict`, `NotRequired`, `Protocol`
  and subscriptable `collections.abc` are all in range; no version guard is ever needed.
- **`collections.abc`, never `typing`, for `Mapping` / `Sequence` / `Callable`.** ruff's
  `UP` ruleset is enabled and UP035 rejects the `typing` spelling outright.
- **ruff select is `["E", "F", "I", "N", "UP", "B", "A", "C4", "PT", "RUF"]`,
  line-length 88; `mypy` runs `strict = true` over `src`, `tests`, `scripts`,
  `hatch_build.py`.**
- **No `any` and no `console` in TypeScript `src/`** — Biome enforces `noExplicitAny` and
  `noConsole`. Use `unknown` and narrow with a type guard.
- **The distribution is `nimbus-dev-sdk`; the import is `nimbus_sdk`.**
- **Python reads the spec from `src/nimbus_sdk/_data/spec`, not `docs/spec`.** After
  editing anything under `docs/spec/`, run `python -m pip install -e .` from
  `sdks/python/` **before** `pytest`, or the suite reads the previous snapshot and passes
  while executing none of your cases. CI never hits this; it is a local-only false green.
- **The `index.json` is the corpus, not the `cases/` directory.** A case file and its index
  entry land in the same commit, always.
- **Two roots in TypeScript scripts.** Import `repoRoot` / `joinRepo` / `readFromRepo` from
  `sdks/typescript/scripts/paths.ts`; never compute a root yourself.
- **Conventional Commits.** release-please reads them. The TypeScript behaviour correction
  is `fix:`; the Python surface is `feat:`; documents are `docs:`.
- **Verify in a clone, not in the worktree.** A worktree under `.claude/worktrees/` borrows
  the parent checkout's `node_modules`, so a package can resolve a dependency it never
  declares. Before opening the PR run `git clone --branch <branch> . <tmpdir>` outside the
  repository, `bun install --frozen-lockfile`, and run the gates there.

## Two findings that change the design

Both were discovered while writing this plan. Neither invalidates the design; both change
what Shipment 1 contains.

### F1 — The template adoption cannot ship in Shipment 1

The design's "early template win" has `templates/python/src/nimbus_quickstart_connector/main.py`
adopt `results.py` in this shipment. It cannot, and the reason is written in
`.github/workflows/ci.yml`'s own comment on the `scaffold-python` job:

> *Ordering is not provenance. The step above works today only because the wheel's version
> happens to satisfy the template's `nimbus-dev-sdk>=0.3.0`, so pip finds the requirement
> already met and never asks the index. The moment that floor rises above the version this
> commit builds ... pip silently resolves the published SDK and this job goes green having
> tested something other than the commit under review.*

`sdks/python/pyproject.toml` is at `0.6.0`. `connector_kit` is released by release-please
**after** this merges, as `0.7.0`. So at merge time there is no published version a template
floor could name: leaving the floor at `>=0.3.0` hands a real author a template importing a
module their installed SDK does not have, and raising it to `>=0.7.0` makes CI try to resolve
a wheel that does not exist yet.

**Resolution:** the template adoption is Task 10, marked BLOCKED, with its trigger written
into the task. It is done in a follow-up PR after `nimbus-dev-sdk 0.7.0` publishes. Nothing
else in this shipment depends on it.

### F2 — `errors.py` and `types.py` are Shipment 1 modules

D3's module table assigns the error taxonomy to no shipment and discusses the `TypedDict`s
only under D8's router section, but `urls.py` raises `UrlResolutionError`, `env.py` raises
`MissingEnvError`, and `results.py` raises `HttpStatusError` and returns `McpToolResult`.
All three land here. `TransportError` / `TransportTimeoutError` and `McpToolDescriptor` stay
in Shipment 2 — they have no Shipment 1 caller.

---

## File structure

**Created — specification and governance**

| Path | Responsibility |
| --- | --- |
| `docs/rfcs/0011-url-resolution.md` | The decision record: why a binding of an admitted battery needs no new INCLUSION-POLICY §3 evidence, what the absoluteness rule is, and the semver call on the TypeScript correction. |
| `docs/spec/connector-kit/v1/url-resolution.md` | The normative document. Nine sections; §3–§7 are what the corpus pins, §8 is the credential-redirect MUST that Shipment 2 satisfies, §9 lists what is undefined in v1. |
| `docs/spec/conformance/v1/url-resolution/case.schema.json` | One case: `description`, `base`, `input`, `expect`. |
| `docs/spec/conformance/v1/url-resolution/index.schema.json` | The index manifest schema. `section` pattern `^§[0-9]+(\.[0-9]+)*$`. |
| `docs/spec/conformance/v1/url-resolution/index.json` | The corpus. Twenty-one entries. |
| `docs/spec/conformance/v1/url-resolution/cases/*.json` | Twenty-one case files. |
| `sdks/typescript/scripts/url-resolution-guard.test.ts` | The eighth guard: validates the schemas, executes every case against `resolveUrlWithBase`, and refuses to pass vacuously. |

**Created — the Python surface**

| Path | Responsibility |
| --- | --- |
| `sdks/python/src/nimbus_sdk/connector_kit/__init__.py` | Re-export plus `__all__`, and the docstring stating why this root is not hoisted into `nimbus_sdk`. |
| `sdks/python/src/nimbus_sdk/connector_kit/errors.py` | `ConnectorKitError` and the three Shipment 1 subclasses. |
| `sdks/python/src/nimbus_sdk/connector_kit/types.py` | `McpTextContent`, `McpToolResult`. |
| `sdks/python/src/nimbus_sdk/connector_kit/urls.py` | `resolve_url_with_base` — the SSRF chokepoint, and the only corpus-gated module in the kit. |
| `sdks/python/src/nimbus_sdk/connector_kit/env.py` | `require_env` — the single place ambient state enters. |
| `sdks/python/src/nimbus_sdk/connector_kit/results.py` | `json_result`, `error_result`, `json_result_if_ok`, `json_result_from_text_if_ok`, `parse_json_text_if_ok`, and the two response `Protocol`s they read. |
| `sdks/python/src/nimbus_sdk/connector_kit/search_filter.py` | The ten search helpers. |
| `sdks/python/tests/test_connector_kit_urls.py` | Unit tests for the traps the corpus does not reach. |
| `sdks/python/tests/test_connector_kit_env.py` | `require_env` and its seam. |
| `sdks/python/tests/test_connector_kit_results.py` | The result builders, including the two JSON-serialisation divergences. |
| `sdks/python/tests/test_connector_kit_search_filter.py` | One test per TypeScript test, plus the case-folding and cap traps. |
| `sdks/python/tests/test_url_resolution_corpus.py` | Drives the corpus. Its `load_corpus("url-resolution")` call is what `corpus-parity.test.ts` reads. |

**Modified**

| Path | Change |
| --- | --- |
| `sdks/typescript/src/connector-kit/fetch-bearer-json.ts` | `resolveUrlWithBase` implements §3–§7 instead of `startsWith("http")`. |
| `sdks/typescript/src/connector-kit/fetch-bearer-json.test.ts` | Two existing assertions invert; new ones for the origin rules. |
| `sdks/typescript/CHANGELOG.md` | The `fix:` entry. |
| `sdks/python/CHANGELOG.md` | The `feat:` entry. |
| `sdks/python/README.md` | The fourth import root. |
| `docs/spec/README.md` | Seven guards → eight; six corpora → seven; a `connector-kit/v1/` section; `url-resolution` named in the language-neutrality paragraph. |
| `docs/rfcs/README.md` | RFC-0011 in the index. |
| `docs/modules/connector-kit.md` | The Python binding and its asymmetries. |
| `docs/ROADMAP.md` | The Phase 3 box, narrowed to what Shipment 2 still owes. |
| `CLAUDE.md` | Three import roots → four; the behavioural-divergence inventory scoped to the contract surfaces. |

---

## The rule, in one place

Every task below implements or pins this. It is repeated here so no task has to be read
against another.

**Absoluteness (§3).** `input` is absolute when it matches `^[A-Za-z][A-Za-z0-9+.-]*:`
— an RFC 3986 scheme followed by a colon. Nothing else makes it absolute.

**Relative (§4).** A non-absolute input resolves to `base + input`, **by string
concatenation** — never by RFC 3986 relative-reference resolution. The base is not parsed,
not validated, and not normalised on this path.

The distinction is load-bearing, not stylistic. A protocol-relative input `//evil.com/x`
has no scheme and is therefore relative by §3, and the two readings of "resolve" disagree
about where it points:

```
"https://api.example.com" + "//evil.com/x"                  -> https://api.example.com//evil.com/x   (host api.example.com)
urljoin("https://api.example.com", "//evil.com/x")          -> https://evil.com/x                    (host evil.com)
```

Both lines were run; the second is the measured output of Python 3.14's
`urllib.parse.urljoin`. `urljoin` is the one-line way a binding author naturally writes
"resolve a relative path", and it hands a caller-supplied string a *network-authority
reference* that redirects the credential-bearing fetch to another host — the exact
exfiltration the chokepoint exists to prevent, reached through the branch that never checks
an origin. Concatenation is the rule; `urljoin` and `new URL(input, base)` are both wrong.

**Absolute (§5).** Checked in this order:

1. If the input contains U+0009, U+000A or U+000D → `malformed`.
2. If the input has no host, or its port is not a decimal integer → `malformed`.

**Origin (§6).** The origin of a URL is the string `scheme://host` when the port is absent
or equal to the scheme's default, and `scheme://host:port` otherwise. `scheme` and `host`
are lowercased. Defaults are 80 for `http` and 443 for `https`; every other scheme has none.
An IPv6 host is bracketed. Userinfo is ignored — the host is what follows the last `@`.

**Rejections (§7),** evaluated in this order, each with exactly this message:

| Order | Reason | Message |
| --- | --- | --- |
| 1 | `malformed` | `resolveUrlWithBase: refusing to fetch malformed absolute URL` |
| 2 | `invalid-base` | `resolveUrlWithBase: base URL is not an absolute URL with a host` |
| 3 | `cross-origin` | `resolveUrlWithBase: refusing to fetch cross-origin URL (got <target>, expected <base>)` |

On success the function returns `input` **unchanged** — never a normalised form.

**Credentials (§8).** A binding MUST NOT carry credentials across an origin change. No
Shipment 1 case pins this; Shipment 2's transport tests do.

**Undefined in v1 (§9).** A host that is not a sequence of ASCII letters, digits, `-` and
`.`, nor a bracketed IPv6 literal — non-ASCII/IDNA hosts, hosts containing a space, hosts
containing a backslash. Bindings MAY reject or MAY apply their platform's parsing; no case
pins a verdict, and neither binding may invent one. This follows the precedent
`diagnostics.md` §8 sets for a lone surrogate in `extensionId`.

Why the camelCase `resolveUrlWithBase:` prefix appears in Python messages: the message is
contract text, named for the contract's export, not for either binding's spelling of it.
Byte-identical messages are what let the corpus pin them once for both languages.

---

## Task 1: RFC-0011 and the normative document

**Files:**
- Create: `docs/rfcs/0011-url-resolution.md`
- Create: `docs/spec/connector-kit/v1/url-resolution.md`
- Modify: `docs/rfcs/README.md` (the index table)
- Modify: `docs/spec/README.md` (a new `### connector-kit/v1/` section)

**Interfaces:**
- Consumes: nothing.
- Produces: the section numbers §1–§9 and the three rejection reasons `malformed`,
  `invalid-base`, `cross-origin`, which Tasks 2, 3, 4 and 5 all cite verbatim.

- [ ] **Step 1: Read the two governing documents before writing**

Run: `sed -n '1,80p' docs/GOVERNANCE.md` and `sed -n '1,60p' docs/INCLUSION-POLICY.md`

You need GOVERNANCE's change classes (a new normative document is contract-affecting, so
RFC required) and INCLUSION-POLICY §2 and §3, both of which RFC-0011 argues from.

- [ ] **Step 2: Read RFC-0003 as the shape to follow**

Run: `sed -n '1,60p' docs/rfcs/0003-pure-predicates.md`

RFC-0003 is the precedent the design names — a pure-helper surface promoted to a normative
document with a corpus. Match its section headings and its status header.

- [ ] **Step 3: Write `docs/spec/connector-kit/v1/url-resolution.md`**

The document is normative. Its header MUST contain the literal strings `**Status:** normative`
and `RFC 2119` — Task 3's guard asserts both, the same way `diagnostics-guard.test.ts`
asserts them of `diagnostics.md`.

Sections, in this order and with these numbers. **Each is a markdown heading spelled
exactly `## §N Title`** — `## §3 Absoluteness`, `## §4 Relative resolution`, and so on.
Not a bold bullet, not `###`. Task 3's guard asserts `text.includes("## " + section)` for
every indexed case, so any other spelling fails the corpus guard on a document that is
otherwise correct. The corpus's `section` values are these numbers:

- **§1 Scope.** What `resolveUrlWithBase` / `resolve_url_with_base` is for: it is the single
  chokepoint that stops a caller-supplied pagination link (`@odata.nextLink` and friends)
  from redirecting a credential-bearing fetch at an attacker-controlled host. It is not a
  general URL parser and does not aim to be one.
- **§2 Terminology.** RFC 2119 keywords. Define *base*, *input*, *origin*, *absolute*.
- **§3 Absoluteness.** The scheme rule, verbatim: an input is absolute when and only when it
  matches `^[A-Za-z][A-Za-z0-9+.-]*:`. State both edges this replaces — that `httpdocs/x` is
  relative (a prefix heuristic reads it as absolute and rejects a legitimate path) and that
  `notes:2024/x` is absolute and therefore rejected as malformed (a scheme-shaped relative
  segment is the price of a correct rule, and it is a price this document names rather than
  hides).
- **§4 Relative resolution.** `base + input`, by concatenation. No parsing of the base, no
  normalisation, no slash insertion or removal. An empty input resolves to the base.
  State the prohibition as a MUST NOT and name both traps: a binding MUST NOT resolve the
  input as an RFC 3986 relative reference against the base. Reproduce the two measured
  `//evil.com/x` outputs from *The rule, in one place* above, and say why the difference
  matters — a protocol-relative input is relative by §3 and so never reaches the origin
  check, which makes §4 the one branch where a wrong implementation exfiltrates the token
  silently. Name `urllib.parse.urljoin` and `new URL(input, base)` as the specific
  constructs that are wrong here; a future Go or Rust binding will reach for its own
  equivalent and deserves to be told before it does.
- **§5 Absolute resolution.** The two malformed conditions, in order: forbidden whitespace
  (U+0009, U+000A, U+000D anywhere in the input), then a missing host or a non-integer port.
- **§6 Origin.** The origin string and how it is built — lowercased scheme and host, the
  default-port table (80/`http`, 443/`https`, none for anything else), the bracketed IPv6
  form, and that userinfo is ignored so the host is what follows the **last** `@`.
- **§7 Rejection.** The three reasons, their evaluation order, and their exact messages.
  Reproduce the table from *The rule, in one place* above.
- **§8 Credentials across an origin change.** `A binding MUST NOT carry credentials across
  an origin change.` Explain that this is a property of the contract and not of any one
  runtime: JavaScript's `fetch` satisfies it by stripping `Authorization` per the Fetch
  standard, Python's `urllib.request` does not and a binding there must implement it, and a
  future Go or Rust binding inherits a stated requirement instead of rediscovering it. State
  that the obligation binds every transport a binding accepts, not only its default one.
  **Name no third-party HTTP client and make no claim about which ones strip by default** —
  that is a security claim about code this document does not control, and it has changed
  across releases.
- **§9 Undefined in v1.** The host set from *The rule, in one place*, and why: bracketing
  and lowercasing are cheap and identical everywhere, IDNA is neither, and a
  dependency-free package in two languages cannot agree on punycode without one of them
  growing a dependency or a hand-rolled implementation. Cite `diagnostics.md` §8 as the
  precedent for disclosing undefined behaviour rather than inventing a verdict.

- [ ] **Step 4: Write `docs/rfcs/0011-url-resolution.md`**

It must make four arguments, each in its own section:

1. **Why no INCLUSION-POLICY §3 evidence is needed.** §3 requires a battery be used by two
   connectors, or one plus a written case. There are no first-party Python connectors, so a
   literal reading blocks the work. The reading this RFC adopts: *a binding of an
   already-admitted battery is not a new battery.* The kit passed §3 on TypeScript's
   evidence; Pillar 2's polyglot promise is that a binding follows. Write this reasoning out
   in full — every future Go or Rust battery port will cite it as precedent.
2. **Why the corpus takes the RFC path when the kit does not.** Every existing corpus pins a
   normative document and there is none for URL resolution. Writing one adds a normative
   document under `docs/spec/`, which GOVERNANCE classes as contract-affecting.
3. **The rule, and the two heuristic edges it replaces.** Reproduce §3's argument.
4. **The semver call**, below.

- [ ] **Step 5: Write the semver section, honestly**

The TypeScript correction lands as `fix:` — a patch. Three behaviour changes, each stated
with what it does to a caller:

- **Previously threw, now succeeds.** `resolveUrlWithBase("https://api.example.com", "httpbin/status")`
  raised on a legitimate relative path. No caller can have depended on that except by
  catching an error it should never have produced.
- **Previously succeeded, now throws — but the success was in name only.** A non-`http`
  scheme such as `ftp://evil.com` did not match `startsWith("http")`, so it was concatenated
  into `https://api.example.comftp://evil.com` — a malformed string that fails at the fetch.
  It now matches the scheme rule, mismatches the origin, and is rejected properly. No input
  that previously produced a *working* URL changes.
- **Previously succeeded, now throws — genuinely.** An absolute input containing a raw tab,
  LF or CR was silently stripped by `new URL` and fetched. This is now `malformed`. This one
  does narrow a working input, and it is claimed as a patch on security grounds: no
  legitimate API emits a pagination link containing a bare control character, and one that
  does is a log-injection and request-smuggling signal. Say so in these words rather than
  eliding the case.

Then record what was **declined**, so it does not read as an oversight: rejecting an absolute
URL that carries userinfo. `https://user@api.example.com/x` resolves same-origin today and
returns a working URL, so rejecting it would break the patch-level call for no security gain
— the host comparison already governs, and `https://api.example.com@evil.com/x` is rejected
by §6 because the host is what follows the last `@`.

- [ ] **Step 6: Add RFC-0011 to the index**

Run: `grep -n "0010" docs/rfcs/README.md`

Add the row in the same shape as RFC-0010's, status `accepted`.

- [ ] **Step 7: Add the `connector-kit/v1/` section to `docs/spec/README.md`**

Insert a `### connector-kit/v1/` section after `### diagnostics/v1/`, matching that
section's register: what the document is, what it guarantees, and a link to RFC-0011. Do
**not** touch the guard count or the corpus count yet — those belong with Task 3, which is
what makes them true.

- [ ] **Step 8: Verify nothing compiles the new prose, then commit**

Run: `cd sdks/typescript && bun run test 2>&1 | tail -20`
Expected: PASS. `scripts/docs-snippets.test.ts` compiles fenced `ts` blocks only under
`docs/modules/*.md`, `docs/README.md` and the package README — nothing under `docs/spec/` or
`docs/rfcs/`. Any code sample you wrote in either new document is unchecked prose: re-read
it by hand.

```bash
git add docs/rfcs/0011-url-resolution.md docs/rfcs/README.md docs/spec/connector-kit docs/spec/README.md
git commit -m "docs(spec): specify URL resolution for the connector kit (RFC-0011)"
```

---

## Task 2: TypeScript conforms to the rule

**Files:**
- Modify: `sdks/typescript/src/connector-kit/fetch-bearer-json.ts:1-30`
- Test: `sdks/typescript/src/connector-kit/fetch-bearer-json.test.ts:6-45`
- Modify: `sdks/typescript/CHANGELOG.md`

**Interfaces:**
- Consumes: §3–§7 from Task 1.
- Produces: `resolveUrlWithBase(baseUrl: string, pathOrUrl: string): string`, unchanged in
  signature. Task 3's guard imports it from `../src/connector-kit/fetch-bearer-json.ts`.

- [ ] **Step 1: Write the failing tests**

Replace the `describe("resolveUrlWithBase", ...)` block in
`sdks/typescript/src/connector-kit/fetch-bearer-json.test.ts` with this. Two of the existing
assertions invert; the rest are new and pin §5 and §6.

```ts
describe("resolveUrlWithBase", () => {
  const base = "https://api.example.com";

  test("prefixes a relative path with the base URL", () => {
    expect(resolveUrlWithBase(base, "/v1/x")).toBe("https://api.example.com/v1/x");
  });

  test("an empty input resolves to the base", () => {
    expect(resolveUrlWithBase(base, "")).toBe(base);
  });

  test("passes through an absolute same-origin URL unchanged", () => {
    const abs = "https://api.example.com/v1/x?page=2";
    expect(resolveUrlWithBase(base, abs)).toBe(abs);
  });

  test("throws on a cross-origin absolute URL, naming both origins", () => {
    expect(() => resolveUrlWithBase(base, "https://evil.example.com/steal")).toThrow(
      "resolveUrlWithBase: refusing to fetch cross-origin URL (got https://evil.example.com, expected https://api.example.com)",
    );
  });

  test("treats a different scheme on the same host as a different origin", () => {
    expect(() => resolveUrlWithBase(base, "http://api.example.com/x")).toThrow(
      /refusing to fetch cross-origin URL/,
    );
  });

  test("treats a different port on the same host as a different origin", () => {
    expect(() => resolveUrlWithBase(base, "https://api.example.com:8443/x")).toThrow(
      /refusing to fetch cross-origin URL/,
    );
  });

  test("an explicit default port is the same origin as none (spec §6)", () => {
    // Python's urlsplit reports the port verbatim where the WHATWG URL parser elides it.
    // Without the default-port table both bindings disagree on a legitimate pagination link.
    const abs = "https://api.example.com:443/x";
    expect(resolveUrlWithBase(base, abs)).toBe(abs);
    expect(resolveUrlWithBase("http://api.example.com:80", "http://api.example.com/x")).toBe(
      "http://api.example.com/x",
    );
  });

  test("scheme and host compare case-insensitively", () => {
    expect(resolveUrlWithBase(base, "HTTPS://API.Example.COM/x")).toBe(
      "HTTPS://API.Example.COM/x",
    );
  });

  test("an IPv6 host compares by its bracketed form, port included", () => {
    const v6 = "http://[::1]:8080";
    expect(resolveUrlWithBase(v6, `${v6}/x`)).toBe(`${v6}/x`);
    expect(() => resolveUrlWithBase(v6, "http://[::1]:9090/x")).toThrow(
      "resolveUrlWithBase: refusing to fetch cross-origin URL (got http://[::1]:9090, expected http://[::1]:8080)",
    );
  });

  test("userinfo is ignored — the host is what follows the last '@'", () => {
    expect(() => resolveUrlWithBase(base, "https://api.example.com@evil.com/x")).toThrow(
      "resolveUrlWithBase: refusing to fetch cross-origin URL (got https://evil.com, expected https://api.example.com)",
    );
  });

  test("a non-http scheme is absolute, and rejected as cross-origin rather than concatenated", () => {
    // The heuristic read this as relative and produced "https://api.example.comftp://evil.com".
    expect(() => resolveUrlWithBase(base, "ftp://evil.com/x")).toThrow(
      "resolveUrlWithBase: refusing to fetch cross-origin URL (got ftp://evil.com, expected https://api.example.com)",
    );
  });

  test("an absolute URL with no host is malformed", () => {
    expect(() => resolveUrlWithBase(base, "http://")).toThrow(
      "resolveUrlWithBase: refusing to fetch malformed absolute URL",
    );
  });

  test("a non-integer port is malformed", () => {
    expect(() => resolveUrlWithBase(base, "https://api.example.com:notaport/x")).toThrow(
      "resolveUrlWithBase: refusing to fetch malformed absolute URL",
    );
  });

  test("a raw tab, LF or CR in an absolute URL is malformed, not silently stripped", () => {
    // new URL removes these and fetches the stripped form. A pagination link containing one
    // is a log-injection / request-smuggling signal, not a URL.
    for (const ws of ["\t", "\n", "\r"]) {
      expect(() => resolveUrlWithBase(base, `https://api.example.com/a${ws}b`)).toThrow(
        "resolveUrlWithBase: refusing to fetch malformed absolute URL",
      );
    }
  });

  test("a bare path that merely starts with 'http' as text is relative, not absolute", () => {
    // The inverted assertion. "httpdocs" is not a scheme — there is no colon — so §3 makes
    // this relative. The old startsWith("http") heuristic threw on a legitimate path.
    expect(resolveUrlWithBase(base, "httpdocs/x")).toBe("https://api.example.comhttpdocs/x");
  });

  test("a scheme-shaped relative segment is absolute, and malformed for want of a host", () => {
    // The other edge of §3, disclosed rather than hidden: "notes:" is a valid RFC 3986
    // scheme, so "notes:2024/x" takes the absolute branch and has no host.
    expect(() => resolveUrlWithBase(base, "notes:2024/x")).toThrow(
      "resolveUrlWithBase: refusing to fetch malformed absolute URL",
    );
  });

  test("a base that is not an absolute URL with a host is rejected as such", () => {
    expect(() => resolveUrlWithBase("api.example.com", "https://api.example.com/x")).toThrow(
      "resolveUrlWithBase: base URL is not an absolute URL with a host",
    );
  });

  test("the base is not parsed on the relative path", () => {
    // §4: concatenation only. A base with no scheme is fine here — it is the caller's string.
    expect(resolveUrlWithBase("api.example.com", "/x")).toBe("api.example.com/x");
  });

  test("a protocol-relative input is concatenated as a path, not resolved as an authority", () => {
    // §4 is concatenation, never RFC 3986 relative-reference resolution. `//evil.com/x`
    // has no scheme, so it is relative and never reaches the origin check — which makes
    // this the one branch where a wrong implementation exfiltrates the token silently.
    // `new URL("//evil.com/x", base)` would return https://evil.com/x.
    expect(resolveUrlWithBase(base, "//evil.com/x")).toBe(
      "https://api.example.com//evil.com/x",
    );
    expect(new URL(resolveUrlWithBase(base, "//evil.com/x")).hostname).toBe(
      "api.example.com",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sdks/typescript && bun test src/connector-kit/fetch-bearer-json.test.ts`
Expected: FAIL. At minimum `httpdocs/x` still throws, `ftp://evil.com/x` concatenates, and
every message assertion misses because the current code throws `Invalid URL`.

- [ ] **Step 3: Implement §3–§7**

Replace the top of `sdks/typescript/src/connector-kit/fetch-bearer-json.ts` — everything
from `export function resolveUrlWithBase` upward, leaving `BearerJsonFetchResult` and
`fetchBearerAuthorizedJson` untouched:

```ts
/** RFC 3986 scheme followed by its colon. The one thing that makes an input absolute. */
const ABSOLUTE_URL = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Removed by `new URL` and fetched as if absent. Spec §5 refuses them instead. */
const FORBIDDEN_WHITESPACE = /[\t\n\r]/;

/** Spec §6. Every other scheme has no default, so its port is always significant. */
const DEFAULT_PORTS: Readonly<Record<string, number | undefined>> = { http: 80, https: 443 };

/**
 * The spec §6 origin string, or `undefined` when the URL has no host.
 *
 * Not `URL#origin`: that is `"null"` for every non-special scheme, which would put a
 * JavaScript-ism into a message the conformance corpus pins for both bindings. Built by
 * hand it is the same string Python's `urlsplit` can produce, and for `http`/`https` it
 * is byte-identical to what `URL#origin` returns anyway.
 */
function originOf(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  const host = parsed.hostname.toLowerCase();
  if (host === "") {
    return undefined;
  }
  const fallback = DEFAULT_PORTS[scheme];
  const port = parsed.port === "" ? fallback : Number(parsed.port);
  if (port === undefined || port === fallback) {
    return `${scheme}://${host}`;
  }
  return `${scheme}://${host}:${String(port)}`;
}

/**
 * Resolve a path-or-URL against `baseUrl`, per
 * `docs/spec/connector-kit/v1/url-resolution.md`.
 *
 * A relative input is concatenated onto the base (§4). An ABSOLUTE input is only allowed
 * when it shares the base's origin — this is the single chokepoint that prevents a
 * caller-supplied pagination link (`@odata.nextLink`, etc.) from redirecting a
 * credential-bearing fetch at an attacker-controlled host (SSRF / bearer-token
 * exfiltration). A cross-origin, malformed, or unbased absolute URL throws and is never
 * fetched.
 *
 * Absoluteness is decided by §3's scheme rule, not by a `startsWith("http")` prefix test.
 * The heuristic was wrong at both edges: it rejected the legitimate relative path
 * `httpdocs/x`, and it read `ftp://evil.com` as relative and concatenated it. See
 * RFC-0011 for the semver reasoning on that correction.
 */
export function resolveUrlWithBase(baseUrl: string, pathOrUrl: string): string {
  if (!ABSOLUTE_URL.test(pathOrUrl)) {
    return `${baseUrl}${pathOrUrl}`;
  }
  const target = FORBIDDEN_WHITESPACE.test(pathOrUrl) ? undefined : originOf(pathOrUrl);
  if (target === undefined) {
    throw new Error("resolveUrlWithBase: refusing to fetch malformed absolute URL");
  }
  const base = originOf(baseUrl);
  if (base === undefined) {
    throw new Error("resolveUrlWithBase: base URL is not an absolute URL with a host");
  }
  if (target !== base) {
    throw new Error(
      `resolveUrlWithBase: refusing to fetch cross-origin URL (got ${target}, expected ${base})`,
    );
  }
  return pathOrUrl;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd sdks/typescript && bun test src/connector-kit/`
Expected: PASS, including `rest-tool-kit.test.ts`, which composes `resolveUrlWithBase`.

- [ ] **Step 5: Run the whole TypeScript suite and the linters**

Run: `cd sdks/typescript && bun run typecheck && bun run lint && bun run test`
Expected: all PASS.

Then confirm the exported surface did not move — the signature is unchanged, so
`api-surface.md` should not change:

Run: `cd sdks/typescript && bun run api:surface && git diff --stat docs/api-surface.md`
Expected: no diff. If there is one, commit it — the gate reads that file.

- [ ] **Step 6: Add the CHANGELOG entry**

Run: `sed -n '1,25p' sdks/typescript/CHANGELOG.md`

Add under an `Unreleased`/`Bug Fixes` heading in the file's existing register:

```markdown
* **connector-kit:** `resolveUrlWithBase` decides absoluteness by RFC 3986 scheme rather
  than a `startsWith("http")` prefix test, and compares origins by the rule in
  `docs/spec/connector-kit/v1/url-resolution.md` §6 — default ports elided, IPv6 hosts
  bracketed, userinfo ignored. A legitimate relative path such as `httpdocs/x` no longer
  throws; `ftp://evil.com` is now rejected as cross-origin rather than concatenated into a
  malformed string; an absolute URL carrying a raw tab, LF or CR is now rejected rather
  than silently stripped and fetched. See RFC-0011 for the semver reasoning.
```

- [ ] **Step 7: Commit**

```bash
git add sdks/typescript/src/connector-kit/fetch-bearer-json.ts \
        sdks/typescript/src/connector-kit/fetch-bearer-json.test.ts \
        sdks/typescript/CHANGELOG.md
git commit -m "fix(connector-kit): resolve URLs by scheme and origin, not by a prefix heuristic"
```

---

## Task 3: The `url-resolution` corpus and its guard

**Files:**
- Create: `docs/spec/conformance/v1/url-resolution/case.schema.json`
- Create: `docs/spec/conformance/v1/url-resolution/index.schema.json`
- Create: `docs/spec/conformance/v1/url-resolution/index.json`
- Create: `docs/spec/conformance/v1/url-resolution/cases/` — twenty-one files
- Create: `sdks/typescript/scripts/url-resolution-guard.test.ts`
- Modify: `docs/spec/README.md` (guard count, corpus count, the cases paragraph)

**Interfaces:**
- Consumes: §3–§7 and the three reason strings from Task 1; `resolveUrlWithBase` from Task 2.
- Produces: the corpus area name `url-resolution` and the case shape
  `{description, base, input, expect}`, which Task 5's Python runner reads with
  `load_corpus("url-resolution")`.

- [ ] **Step 1: Read the corpus you are copying the shape from**

Run: `cat docs/spec/conformance/v1/diagnostics/index.schema.json` and
`sed -n '1,40p' docs/spec/conformance/v1/framing/case.schema.json`

Note that `additionalProperties` is `false` on the index entry — `file`, `section`, `reason`,
nothing else — and that `file` is matched against `^cases/[A-Za-z0-9._-]+\.json$` so an entry
cannot reach outside the corpus.

- [ ] **Step 2: Write `case.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/conformance/v1/url-resolution/case.schema.json",
  "title": "URL-resolution conformance case",
  "description": "One resolution. A base, an input, and either the exact string returned or the exact refusal — reason and message both, so two bindings are held to the same words and not merely to the same verdict.",
  "type": "object",
  "required": ["description", "base", "input", "expect"],
  "additionalProperties": false,
  "properties": {
    "description": { "type": "string", "pattern": "\\S" },
    "base": {
      "type": "string",
      "description": "The base URL. Deliberately unconstrained: one case supplies a base that is not a URL at all, which is what invalid-base pins."
    },
    "input": {
      "type": "string",
      "description": "The path-or-URL being resolved. Unconstrained for the same reason — most cases assert a malformed value is refused."
    },
    "expect": {
      "type": "object",
      "required": ["ok"],
      "additionalProperties": false,
      "properties": {
        "ok": { "type": "boolean" },
        "url": {
          "type": "string",
          "description": "On success: the exact string returned. Never a normalised form — §4 concatenates and §5 returns the input unchanged."
        },
        "reason": {
          "enum": ["malformed", "invalid-base", "cross-origin"],
          "description": "On refusal: the §7 reason."
        },
        "message": {
          "type": "string",
          "description": "On refusal: the exact §7 message. A binding that refuses for the right reason with different words fails the case, which is the point — the message is contract text."
        }
      },
      "allOf": [
        {
          "if": { "properties": { "ok": { "const": true } } },
          "then": { "required": ["url"] }
        },
        {
          "if": { "properties": { "ok": { "const": false } } },
          "then": { "required": ["reason", "message"] }
        }
      ]
    }
  }
}
```

- [ ] **Step 3: Write `index.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/conformance/v1/url-resolution/index.schema.json",
  "title": "URL-resolution corpus index",
  "description": "Machine-readable manifest of the url-resolution cases, so a runner in any language consumes the corpus without parsing prose.",
  "type": "object",
  "required": ["spec", "cases"],
  "additionalProperties": false,
  "properties": {
    "spec": {
      "const": "../../../connector-kit/v1/url-resolution.md",
      "description": "The normative document this corpus is the executable form of."
    },
    "cases": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["file", "section", "reason"],
        "additionalProperties": false,
        "properties": {
          "file": {
            "type": "string",
            "pattern": "^cases/[A-Za-z0-9._-]+\\.json$",
            "description": "Case path relative to this directory. No path separators in the filename, so an entry cannot reach outside the corpus."
          },
          "section": {
            "type": "string",
            "pattern": "^§[0-9]+(\\.[0-9]+)*$",
            "description": "The specification section this case pins. Subsection-capable like the diagnostics corpus, because §5's two malformed conditions are separately citable."
          },
          "reason": { "type": "string", "pattern": "\\S" }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Write the twenty-one case files**

Each is one JSON object matching `case.schema.json`. Write them exactly as given — the
`base` and `input` values are load-bearing.

`cases/relative-path-prefixed.json`
```json
{
  "description": "A relative path is concatenated onto the base.",
  "base": "https://api.example.com",
  "input": "/v1/x",
  "expect": { "ok": true, "url": "https://api.example.com/v1/x" }
}
```

`cases/relative-empty-input.json`
```json
{
  "description": "An empty input resolves to the base itself.",
  "base": "https://api.example.com",
  "input": "",
  "expect": { "ok": true, "url": "https://api.example.com" }
}
```

`cases/relative-scheme-like-prefix.json`
```json
{
  "description": "A path merely beginning with the letters 'http' is relative — there is no colon, so no scheme.",
  "base": "https://api.example.com",
  "input": "httpdocs/x",
  "expect": { "ok": true, "url": "https://api.example.comhttpdocs/x" }
}
```

`cases/protocol-relative-is-a-path.json`
```json
{
  "description": "A protocol-relative input has no scheme, so §3 makes it relative and §4 concatenates it — the host stays api.example.com. A binding implementing §4 with urllib.parse.urljoin or new URL(input, base) resolves it to https://evil.com/x instead and sends the bearer token there, and because the input is relative it never reaches the origin check that would have caught it. Caught by 0 of the other 20 cases: every one of them either carries a scheme or resolves to a path with no authority component.",
  "base": "https://api.example.com",
  "input": "//evil.com/x",
  "expect": { "ok": true, "url": "https://api.example.com//evil.com/x" }
}
```

`cases/relative-base-not-parsed.json`
```json
{
  "description": "The base is not parsed, validated or normalised on the relative path.",
  "base": "api.example.com",
  "input": "/x",
  "expect": { "ok": true, "url": "api.example.com/x" }
}
```

`cases/absolute-same-origin-passthrough.json`
```json
{
  "description": "A same-origin absolute URL is returned unchanged, query and all.",
  "base": "https://api.example.com",
  "input": "https://api.example.com/v1/x?page=2",
  "expect": { "ok": true, "url": "https://api.example.com/v1/x?page=2" }
}
```

`cases/cross-origin-rejected.json`
```json
{
  "description": "A cross-origin absolute URL is refused, naming both origins.",
  "base": "https://api.example.com",
  "input": "https://evil.example.com/steal",
  "expect": {
    "ok": false,
    "reason": "cross-origin",
    "message": "resolveUrlWithBase: refusing to fetch cross-origin URL (got https://evil.example.com, expected https://api.example.com)"
  }
}
```

`cases/cross-scheme-rejected.json`
```json
{
  "description": "The same host over a different scheme is a different origin.",
  "base": "https://api.example.com",
  "input": "http://api.example.com/x",
  "expect": {
    "ok": false,
    "reason": "cross-origin",
    "message": "resolveUrlWithBase: refusing to fetch cross-origin URL (got http://api.example.com, expected https://api.example.com)"
  }
}
```

`cases/cross-port-rejected.json`
```json
{
  "description": "The same host on a different explicit port is a different origin.",
  "base": "https://api.example.com",
  "input": "https://api.example.com:8443/x",
  "expect": {
    "ok": false,
    "reason": "cross-origin",
    "message": "resolveUrlWithBase: refusing to fetch cross-origin URL (got https://api.example.com:8443, expected https://api.example.com)"
  }
}
```

`cases/default-port-https-elided.json`
```json
{
  "description": "An explicit :443 on https is the same origin as none. Python's urlsplit reports the port verbatim where the WHATWG parser elides it, so without the default-port table the bindings disagree on a legitimate pagination link.",
  "base": "https://api.example.com",
  "input": "https://api.example.com:443/x",
  "expect": { "ok": true, "url": "https://api.example.com:443/x" }
}
```

`cases/default-port-http-elided.json`
```json
{
  "description": "The complement, with the default on the base rather than on the input: an explicit :80 on http is the same origin as none.",
  "base": "http://api.example.com:80",
  "input": "http://api.example.com/x",
  "expect": { "ok": true, "url": "http://api.example.com/x" }
}
```

`cases/host-and-scheme-case-folded.json`
```json
{
  "description": "Scheme and host compare case-insensitively, and the input is still returned in the caller's casing.",
  "base": "https://api.example.com",
  "input": "HTTPS://API.Example.COM/x",
  "expect": { "ok": true, "url": "HTTPS://API.Example.COM/x" }
}
```

`cases/ipv6-host-same-origin.json`
```json
{
  "description": "An IPv6 host is bracketed in the origin string. Python's urlsplit().hostname strips the brackets and TypeScript's URL.hostname keeps them, so a binding comparing raw hostnames disagrees with the other on every IPv6 base.",
  "base": "http://[::1]:8080",
  "input": "http://[::1]:8080/x",
  "expect": { "ok": true, "url": "http://[::1]:8080/x" }
}
```

`cases/ipv6-cross-port-rejected.json`
```json
{
  "description": "Two listeners on one host differ by port alone — the origin change a same-host redirect makes, written down.",
  "base": "http://[::1]:8080",
  "input": "http://[::1]:9090/x",
  "expect": {
    "ok": false,
    "reason": "cross-origin",
    "message": "resolveUrlWithBase: refusing to fetch cross-origin URL (got http://[::1]:9090, expected http://[::1]:8080)"
  }
}
```

`cases/userinfo-host-is-after-last-at.json`
```json
{
  "description": "Userinfo is ignored: the host of https://api.example.com@evil.com is evil.com. A binding reading the netloc rather than the host accepts this and sends the bearer token to the attacker.",
  "base": "https://api.example.com",
  "input": "https://api.example.com@evil.com/x",
  "expect": {
    "ok": false,
    "reason": "cross-origin",
    "message": "resolveUrlWithBase: refusing to fetch cross-origin URL (got https://evil.com, expected https://api.example.com)"
  }
}
```

`cases/non-special-scheme-cross-origin.json`
```json
{
  "description": "A non-http scheme is absolute and rejected as cross-origin. The startsWith('http') heuristic read this as relative and concatenated it into https://api.example.comftp://evil.com — caught by 0 of the 0 cases that existed before this corpus, and by no test in the TypeScript suite either.",
  "base": "https://api.example.com",
  "input": "ftp://evil.com/x",
  "expect": {
    "ok": false,
    "reason": "cross-origin",
    "message": "resolveUrlWithBase: refusing to fetch cross-origin URL (got ftp://evil.com, expected https://api.example.com)"
  }
}
```

`cases/no-host-rejected.json`
```json
{
  "description": "An absolute URL with no host is malformed.",
  "base": "https://api.example.com",
  "input": "http://",
  "expect": {
    "ok": false,
    "reason": "malformed",
    "message": "resolveUrlWithBase: refusing to fetch malformed absolute URL"
  }
}
```

`cases/scheme-shaped-relative-segment.json`
```json
{
  "description": "The disclosed edge of §3: 'notes:' is a valid RFC 3986 scheme, so notes:2024/x is absolute and malformed for want of a host rather than being concatenated as a path.",
  "base": "https://api.example.com",
  "input": "notes:2024/x",
  "expect": {
    "ok": false,
    "reason": "malformed",
    "message": "resolveUrlWithBase: refusing to fetch malformed absolute URL"
  }
}
```

`cases/non-integer-port-rejected.json`
```json
{
  "description": "A port that is not a decimal integer is malformed. Python reaches this by the ValueError urlsplit().port raises; TypeScript by new URL throwing.",
  "base": "https://api.example.com",
  "input": "https://api.example.com:notaport/x",
  "expect": {
    "ok": false,
    "reason": "malformed",
    "message": "resolveUrlWithBase: refusing to fetch malformed absolute URL"
  }
}
```

`cases/tab-in-absolute-rejected.json`
```json
{
  "description": "A raw tab in an absolute URL is malformed. new URL removes U+0009/U+000A/U+000D and fetches the stripped form, so without this rule TypeScript silently fetches a URL the caller never wrote while Python fetches a different one or fails.",
  "base": "https://api.example.com",
  "input": "https://api.example.com/a\tb",
  "expect": {
    "ok": false,
    "reason": "malformed",
    "message": "resolveUrlWithBase: refusing to fetch malformed absolute URL"
  }
}
```

`cases/invalid-base-rejected.json`
```json
{
  "description": "A base that is not an absolute URL with a host is refused with its own reason, distinguishing caller misconfiguration from attacker input. Only reachable on the absolute path — §4 never parses the base.",
  "base": "api.example.com",
  "input": "https://api.example.com/x",
  "expect": {
    "ok": false,
    "reason": "invalid-base",
    "message": "resolveUrlWithBase: base URL is not an absolute URL with a host"
  }
}
```

- [ ] **Step 5: Write `index.json` listing all twenty-one**

Every case file above, in the order written, each with `file`, `section` and `reason`. The
`reason` is prose explaining what the case buys — it is not the `expect.reason` enum. Copy
each case's `description` as a starting point and expand it where the case is defending
against a specific wrong binding. Sections:

| file | section |
| --- | --- |
| `relative-path-prefixed.json` | `§4` |
| `relative-empty-input.json` | `§4` |
| `relative-scheme-like-prefix.json` | `§3` |
| `protocol-relative-is-a-path.json` | `§4` |
| `relative-base-not-parsed.json` | `§4` |
| `absolute-same-origin-passthrough.json` | `§5` |
| `cross-origin-rejected.json` | `§7` |
| `cross-scheme-rejected.json` | `§6` |
| `cross-port-rejected.json` | `§6` |
| `default-port-https-elided.json` | `§6` |
| `default-port-http-elided.json` | `§6` |
| `host-and-scheme-case-folded.json` | `§6` |
| `ipv6-host-same-origin.json` | `§6` |
| `ipv6-cross-port-rejected.json` | `§6` |
| `userinfo-host-is-after-last-at.json` | `§6` |
| `non-special-scheme-cross-origin.json` | `§6` |
| `no-host-rejected.json` | `§5` |
| `scheme-shaped-relative-segment.json` | `§3` |
| `non-integer-port-rejected.json` | `§5` |
| `tab-in-absolute-rejected.json` | `§5` |
| `invalid-base-rejected.json` | `§7` |

The file opens with `"spec": "../../../connector-kit/v1/url-resolution.md"`.

- [ ] **Step 6: Write the guard**

Create `sdks/typescript/scripts/url-resolution-guard.test.ts`:

```ts
/**
 * The executable form of `docs/spec/connector-kit/v1/url-resolution.md`.
 *
 * Structured like `diagnostics-guard.test.ts`: validate the published schemas, hold the
 * index and the directory to each other, execute every case against the reference binding,
 * and refuse to pass vacuously. The last part is the point — a corpus that cannot fail is
 * a corpus that reports coverage it does not have.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { resolveUrlWithBase } from "../src/connector-kit/fetch-bearer-json.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/connector-kit/v1/url-resolution.md";
const CORPUS_DIR = "docs/spec/conformance/v1/url-resolution";
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const INDEX_PATH = `${CORPUS_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;

/** The §7 reasons. Every one must be asserted by at least one case. */
const REASONS = ["malformed", "invalid-base", "cross-origin"] as const;

/**
 * §8 is deliberately absent: the credential-redirect MUST binds a transport, and this
 * corpus drives a pure function. Shipment 2's transport tests are what pin it. §1, §2 and
 * §9 are prose — scope, terminology, and behaviour no case may pin by definition.
 */
const PINNED_SECTIONS = ["§3", "§4", "§5", "§6", "§7"] as const;

type Expect = { ok: true; url: string } | { ok: false; reason: string; message: string };
type Case = { description: string; base: string; input: string; expect: Expect };
type IndexEntry = { file: string; section: string; reason: string };

const index = readJson(INDEX_PATH) as { spec: string; cases: IndexEntry[] };
const cases: { entry: IndexEntry; body: Case }[] = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

describe("published artifacts", () => {
  test("the spec document exists and is normative", () => {
    const text = readText(SPEC_PATH);
    expect(text).toContain("**Status:** normative");
    expect(text).toContain("RFC 2119");
  });

  test("the index validates against its own schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(INDEX_SCHEMA_PATH) as object);
    expect(validate(index), JSON.stringify(validate.errors)).toBe(true);
  });

  test("every case validates against the case schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(CASE_SCHEMA_PATH) as object);
    for (const { entry, body } of cases) {
      expect(validate(body), `${entry.file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  test("the index and the cases directory hold each other", () => {
    // A case on disk that no index lists is a case no runner executes — the corpus would
    // report it as covered while testing nothing.
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases")).sort();
    const indexed = index.cases.map((c) => c.file.replace("cases/", "")).sort();
    expect(indexed).toEqual(onDisk);
  });
});

describe("the corpus cannot pass vacuously", () => {
  test("it is non-empty", () => {
    expect(cases.length).toBeGreaterThanOrEqual(21);
  });

  test("both outcomes are exercised", () => {
    expect(cases.some(({ body }) => body.expect.ok)).toBe(true);
    expect(cases.some(({ body }) => !body.expect.ok)).toBe(true);
  });

  test("every published rejection reason is asserted by at least one case", () => {
    const asserted = new Set(
      cases.filter(({ body }) => !body.expect.ok).map(({ body }) => (body.expect as { reason: string }).reason),
    );
    expect([...asserted].sort()).toEqual([...REASONS].sort());
  });

  test("every pinnable section is cited by at least one case", () => {
    const cited = new Set(index.cases.map((c) => c.section));
    for (const section of PINNED_SECTIONS) {
      expect(cited.has(section), `no case cites ${section}`).toBe(true);
    }
  });

  test("every case cites a section the document actually has", () => {
    const text = readText(SPEC_PATH);
    for (const { entry } of index.cases) {
      expect(text.includes(`## ${entry.section}`), `${entry.file} cites a missing section`).toBe(
        true,
      );
    }
  });

  test("§4 is pinned against relative-reference resolution", () => {
    // A protocol-relative input is the only case that distinguishes concatenation from
    // urljoin / new URL(input, base), and it is the one whose absence would go unnoticed:
    // every other relative case resolves identically under both readings.
    const authorityReference = cases.filter(({ body }) => body.input.startsWith("//"));
    expect(authorityReference.length, "no case pins a protocol-relative input").toBeGreaterThan(0);
    for (const { body } of authorityReference) {
      expect(body.expect.ok).toBe(true);
      if (body.expect.ok) {
        expect(body.expect.url).toBe(`${body.base}${body.input}`);
      }
    }
  });

  test("a relative case and an absolute case disagree about the base, so §3 is load-bearing", () => {
    // Without this the corpus could be satisfied by a binding that treats every input as
    // relative: concatenation would pass every ok case and no refusal case would exist.
    const relative = cases.filter(({ body }) => body.expect.ok && body.expect.url.startsWith(body.base));
    const absolute = cases.filter(({ body }) => body.expect.ok && body.expect.url === body.input);
    expect(relative.length).toBeGreaterThan(0);
    expect(absolute.length).toBeGreaterThan(0);
  });
});

describe("the reference binding satisfies every case", () => {
  for (const { entry, body } of cases) {
    test(`${entry.file}: ${body.description}`, () => {
      if (body.expect.ok) {
        expect(resolveUrlWithBase(body.base, body.input)).toBe(body.expect.url);
        return;
      }
      const message = body.expect.message;
      expect(() => resolveUrlWithBase(body.base, body.input)).toThrow(message);
    });
  }
});
```

- [ ] **Step 7: Run the guard**

Run: `cd sdks/typescript && bun test scripts/url-resolution-guard.test.ts`
Expected: PASS, twenty-one case tests plus the schema and anti-vacuity tests.

If `every case cites a section the document actually has` fails, your headings in
`url-resolution.md` are not spelled `## §3 ...`. Fix the document, not the test — the check
is what keeps a case from citing a section that was renamed out from under it.

- [ ] **Step 8: Prove the corpus catches the old binding**

This is the measurement the house convention asks for, and it is worth doing once by hand:

```bash
cd sdks/typescript
git stash push src/connector-kit/fetch-bearer-json.ts
bun test scripts/url-resolution-guard.test.ts 2>&1 | tail -5
git stash pop
```
Expected: a double-digit number of failures against the pre-Task-2 implementation. Record
the count in the PR description. If it is zero, the corpus is testing nothing.

- [ ] **Step 9: Update `docs/spec/README.md`**

Three edits:

1. `Seven guards run on every pull request` → `Eight guards ...`.
2. In `### conformance/v1/`, `Six corpora, because the contract has six kinds of assertion.`
   → `Seven corpora, because the contract has seven kinds of assertion.`
3. Add a `**URL-resolution cases**` paragraph after the `**Diagnostics cases**` one, in the
   same register: what a case is (`a base, an input, and either the exact string returned or
   the exact refusal — reason and message both`), and why the message is pinned rather than
   only the verdict.

Do **not** add `url-resolution` to the language-neutrality paragraph yet. Python does not
run it until Task 5, and `corpus-parity.test.ts` fails on a README that names a corpus
Python never runs — which is exactly the check working.

- [ ] **Step 10: Run the whole suite**

Run: `cd sdks/typescript && bun run test`
Expected: PASS. `corpus-parity.test.ts` must still be green: it will now see
`url-resolution` as a TypeScript-only corpus and demand it be *disclosed* as such —
its `the TypeScript-only corpora are disclosed somewhere in the document` test looks for
`` `url-resolution` `` followed by `TypeScript` on the same line. Add that disclosure
sentence to `docs/spec/README.md` and note in it that the Python runner arrives in the same
branch, so the sentence is deleted again in Task 5.

- [ ] **Step 11: Commit**

```bash
git add docs/spec/conformance/v1/url-resolution docs/spec/README.md \
        sdks/typescript/scripts/url-resolution-guard.test.ts
git commit -m "test(spec): add the url-resolution conformance corpus and its guard"
```

---

## Task 4: The Python package, its errors, and `urls.py`

**Files:**
- Create: `sdks/python/src/nimbus_sdk/connector_kit/__init__.py`
- Create: `sdks/python/src/nimbus_sdk/connector_kit/errors.py`
- Create: `sdks/python/src/nimbus_sdk/connector_kit/urls.py`
- Test: `sdks/python/tests/test_connector_kit_urls.py`

**Interfaces:**
- Consumes: §3–§7 from Task 1.
- Produces:
  - `ConnectorKitError(Exception)`, `UrlResolutionError(ConnectorKitError)`,
    `MissingEnvError(ConnectorKitError)`,
    `HttpStatusError(ConnectorKitError)` with `.service: str`, `.status: int`, `.snippet: str`
  - `resolve_url_with_base(base_url: str, path_or_url: str) -> str`

- [ ] **Step 1: Write the failing test**

Create `sdks/python/tests/test_connector_kit_urls.py`:

```python
"""``resolve_url_with_base`` — the SSRF chokepoint.

The conformance corpus in ``test_url_resolution_corpus.py`` is what holds this function
to the TypeScript binding. These tests cover what a corpus case cannot: that the raised
type is ``UrlResolutionError`` rather than a bare ``Exception``, and the §9 inputs no
case pins.
"""

from __future__ import annotations

from urllib.parse import urljoin, urlsplit

import pytest

from nimbus_sdk.connector_kit import ConnectorKitError, UrlResolutionError, resolve_url_with_base

BASE = "https://api.example.com"


def test_relative_path_is_concatenated() -> None:
    assert resolve_url_with_base(BASE, "/v1/x") == "https://api.example.com/v1/x"


def test_absolute_same_origin_returns_the_input_unchanged() -> None:
    absolute = "https://api.example.com/v1/x?page=2"
    assert resolve_url_with_base(BASE, absolute) is absolute


def test_cross_origin_raises_url_resolution_error() -> None:
    with pytest.raises(UrlResolutionError) as excinfo:
        resolve_url_with_base(BASE, "https://evil.example.com/steal")
    assert str(excinfo.value) == (
        "resolveUrlWithBase: refusing to fetch cross-origin URL "
        "(got https://evil.example.com, expected https://api.example.com)"
    )


def test_url_resolution_error_is_a_connector_kit_error() -> None:
    # One base class is what lets a connector catch the whole kit in one clause.
    with pytest.raises(ConnectorKitError):
        resolve_url_with_base(BASE, "https://evil.example.com/steal")


def test_malformed_message_does_not_echo_the_input() -> None:
    # The malformed input is attacker-controlled and lands in logs. Echoing it would make
    # this function a log-injection vector on exactly the path that exists to stop one.
    with pytest.raises(UrlResolutionError) as excinfo:
        resolve_url_with_base(BASE, "https://api.example.com/a\tb")
    assert str(excinfo.value) == "resolveUrlWithBase: refusing to fetch malformed absolute URL"
    assert "\t" not in str(excinfo.value)


@pytest.mark.parametrize("whitespace", ["\t", "\n", "\r"])
def test_every_forbidden_whitespace_character_is_refused(whitespace: str) -> None:
    with pytest.raises(UrlResolutionError):
        resolve_url_with_base(BASE, f"https://api.example.com/a{whitespace}b")


def test_a_protocol_relative_input_is_concatenated_not_joined() -> None:
    # §4 is concatenation, never RFC 3986 relative-reference resolution. Measured:
    #   "https://api.example.com" + "//evil.com/x"          -> host api.example.com
    #   urljoin("https://api.example.com", "//evil.com/x")  -> host evil.com
    # "//evil.com/x" has no scheme, so §3 makes it relative and it never reaches the
    # origin check — which makes this the one branch where the natural one-line
    # implementation sends the bearer token to another host with nothing to stop it.
    resolved = resolve_url_with_base(BASE, "//evil.com/x")
    assert resolved == "https://api.example.com//evil.com/x"
    assert urlsplit(resolved).hostname == "api.example.com"
    assert urljoin(BASE, "//evil.com/x") == "https://evil.com/x"  # the trap, pinned


def test_a_space_is_not_forbidden_whitespace() -> None:
    # §5 lists three characters, not "whitespace". A space in a path is percent-encoded by
    # every client and appears in real pagination links; refusing it would break callers.
    absolute = "https://api.example.com/a b"
    assert resolve_url_with_base(BASE, absolute) == absolute


def test_undefined_host_is_refused_by_this_binding_and_that_is_not_pinned() -> None:
    # §9: a non-ASCII host is UNDEFINED in v1. This binding refuses it because urlsplit
    # applies no IDNA and the origin comparison would then be a byte comparison of two
    # different encodings. TypeScript's URL punycodes and accepts. No corpus case pins
    # either answer, and neither binding may invent one.
    with pytest.raises(UrlResolutionError):
        resolve_url_with_base("https://пример.рф", "https://пример.рф/x")
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd sdks/python && python -m pytest tests/test_connector_kit_urls.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'nimbus_sdk.connector_kit'`.

- [ ] **Step 3: Write `errors.py`**

```python
"""The kit's exception taxonomy.

One base class, so a connector catches the whole kit in a single ``except``. The messages
of the three subclasses here are byte-identical to the ones the TypeScript kit throws,
including its camelCase export names: the message is contract text, named for the
contract's export rather than for either binding's spelling of it, and
``docs/spec/connector-kit/v1/url-resolution.md`` §7 pins it for both.

``TransportError`` and ``TransportTimeoutError`` join this module in shipment 2, when
there is a transport to raise them.
"""

from __future__ import annotations


class ConnectorKitError(Exception):
    """Base class for every error the connector kit raises."""


class UrlResolutionError(ConnectorKitError):
    """``resolve_url_with_base`` refused. See url-resolution.md §7."""


class MissingEnvError(ConnectorKitError):
    """A required environment variable is unset or empty."""


class HttpStatusError(ConnectorKitError):
    """A response arrived and was not 2xx.

    Carries the parts separately as well as in the message. TypeScript throws a bare
    ``Error`` here, so ``.status`` / ``.service`` / ``.snippet`` are a Python-only
    convenience — a surface asymmetry in Python's favour, documented alongside
    ``format_timestamp`` in ``docs/modules/connector-kit.md``.
    """

    def __init__(self, service: str, status: int, snippet: str) -> None:
        super().__init__(f"{service} {status}: {snippet}")
        self.service = service
        self.status = status
        self.snippet = snippet
```

- [ ] **Step 4: Write `urls.py`**

```python
"""Resolving a path-or-URL against a base — the kit's SSRF chokepoint.

The binding of ``docs/spec/connector-kit/v1/url-resolution.md``. It has its own module,
one function long, deliberately: this is the only corpus-gated code in the kit and the
only place a caller-supplied string decides where a credential-bearing request goes. It
should not be findable only by reading a grab-bag.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

from nimbus_sdk.connector_kit.errors import UrlResolutionError

#: §3. An RFC 3986 scheme followed by its colon — the one thing that makes an input
#: absolute. A prefix test such as ``startswith("http")`` is wrong at both edges: it reads
#: the legitimate relative path ``httpdocs/x`` as absolute, and reads ``ftp://evil.com`` as
#: relative and concatenates it.
_ABSOLUTE_URL = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")

#: §5. Removed by the WHATWG URL parser and fetched as if absent, which would make the two
#: bindings fetch different URLs from the same input. Refused here instead.
_FORBIDDEN_WHITESPACE = frozenset("\t\n\r")

#: §6. Every other scheme has no default, so its port is always significant.
_DEFAULT_PORTS = {"http": 80, "https": 443}

#: §9. Anything outside these is UNDEFINED in v1 — non-ASCII/IDNA hosts above all. This
#: binding refuses them; TypeScript's URL punycodes and accepts. No corpus case pins
#: either answer, and neither binding may invent one until the manifest rule registry
#: constrains the identifier's format enough to rule the question out structurally.
#:
#: Two patterns, not one, and tested on separate branches below: ``urlsplit().hostname``
#: strips an IPv6 literal's brackets, so a single pattern trying to match the bracketed
#: form never sees it and would refuse every IPv6 host as malformed.
_ASCII_HOST = re.compile(r"^[A-Za-z0-9.-]+$")
_IPV6_HOST = re.compile(r"^[0-9A-Fa-f:.]+$")

_MALFORMED = "resolveUrlWithBase: refusing to fetch malformed absolute URL"
_INVALID_BASE = "resolveUrlWithBase: base URL is not an absolute URL with a host"


def _origin(url: str) -> str | None:
    """The §6 origin string, or ``None`` when ``url`` has no usable host.

    ``urlsplit().hostname`` rather than ``.netloc``: the former lowercases, drops the
    userinfo, and strips the IPv6 brackets, where the latter does none of those. Without
    it ``https://api.example.com@evil.com`` compares as ``api.example.com`` and the bearer
    token goes to the attacker.
    """
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if not scheme:
        return None
    try:
        port = parts.port
    except ValueError:
        # A port that is not a decimal integer. TypeScript reaches the same verdict by
        # `new URL` throwing.
        return None
    host = parts.hostname
    if not host:
        return None
    host = host.lower()
    if ":" in host:
        if not _IPV6_HOST.match(host):
            return None
        # urlsplit strips the brackets an IPv6 literal must carry in an origin; TypeScript's
        # URL.hostname keeps them. Re-adding them here is what makes the two comparable.
        host = f"[{host}]"
    elif not _ASCII_HOST.match(host):
        return None
    default = _DEFAULT_PORTS.get(scheme)
    if port is None or port == default:
        return f"{scheme}://{host}"
    return f"{scheme}://{host}:{port}"


def resolve_url_with_base(base_url: str, path_or_url: str) -> str:
    """Resolve ``path_or_url`` against ``base_url``.

    A relative input is concatenated onto the base (§4); the base is not parsed on that
    path. An absolute input is returned unchanged only when it shares the base's origin —
    the single chokepoint that stops a caller-supplied pagination link from redirecting a
    credential-bearing fetch at an attacker-controlled host.

    Raises :class:`UrlResolutionError` on a malformed input, an unusable base, or an
    origin mismatch, with the exact §7 message in each case.
    """
    if not _ABSOLUTE_URL.match(path_or_url):
        return f"{base_url}{path_or_url}"
    if _FORBIDDEN_WHITESPACE.intersection(path_or_url):
        raise UrlResolutionError(_MALFORMED)
    target = _origin(path_or_url)
    if target is None:
        raise UrlResolutionError(_MALFORMED)
    base = _origin(base_url)
    if base is None:
        raise UrlResolutionError(_INVALID_BASE)
    if target != base:
        raise UrlResolutionError(
            f"resolveUrlWithBase: refusing to fetch cross-origin URL "
            f"(got {target}, expected {base})"
        )
    return path_or_url
```

- [ ] **Step 5: Write `__init__.py`**

```python
"""Batteries for hand-rolled Nimbus connectors — the Python binding of
``@nimbus-dev/sdk/connector-kit``.

Deliberately NOT re-exported from ``nimbus_sdk``. The split mirrors the ``.`` vs
``./connector-kit`` boundary the TypeScript exports map has published since 1.15.0: each
import root is a separate **surface**. The kit is batteries rather than contract — it has
no conformance corpus of its own beyond ``url-resolution`` — and hoisting its names to the
top level would erase a boundary the TypeScript package states.

Shipment 1 is the pure core: URL resolution, the environment seam, the MCP result
builders, and the search helpers. The transport, the tool router and the REST factories
arrive in shipment 2.
"""

from __future__ import annotations

from nimbus_sdk.connector_kit.errors import (
    ConnectorKitError,
    HttpStatusError,
    MissingEnvError,
    UrlResolutionError,
)
from nimbus_sdk.connector_kit.urls import resolve_url_with_base

__all__ = [
    "ConnectorKitError",
    "HttpStatusError",
    "MissingEnvError",
    "UrlResolutionError",
    "resolve_url_with_base",
]
```

Tasks 6, 7 and 8 each extend this import block and this `__all__`. `__all__` stays sorted —
ruff's `RUF022` checks it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd sdks/python && python -m pip install -e . && python -m pytest tests/test_connector_kit_urls.py -q`
Expected: PASS.

The editable reinstall is not optional even though you did not touch `docs/spec` — the new
subpackage has to be visible to the installed distribution.

- [ ] **Step 7: Lint and typecheck**

Run: `cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy`
Expected: all clean. If `ruff format --check` fails, run `python -m ruff format .` and
re-read the diff before accepting it.

- [ ] **Step 8: Commit**

```bash
git add sdks/python/src/nimbus_sdk/connector_kit sdks/python/tests/test_connector_kit_urls.py
git commit -m "feat(connector-kit): add the nimbus_sdk.connector_kit root with URL resolution"
```

---

## Task 5: Python executes the corpus

**Files:**
- Create: `sdks/python/tests/test_url_resolution_corpus.py`
- Modify: `docs/spec/README.md` (the language-neutrality paragraph)

**Interfaces:**
- Consumes: `resolve_url_with_base` from Task 4; the corpus from Task 3.
- Produces: the `load_corpus("url-resolution")` call that `corpus-parity.test.ts` reads off
  this file to decide what the neutrality claim may say.

- [ ] **Step 1: Write the failing test**

Create `sdks/python/tests/test_url_resolution_corpus.py`:

```python
"""Drive ``resolve_url_with_base`` from the published conformance corpus.

Reads the spec data bundled at build time into ``src/nimbus_sdk/_data/spec``, which
``spec_root()`` prefers over the repository's ``docs/spec``. That copy is gitignored and
regenerated by the hatch build hook, so **adding a case to docs/spec is not enough
locally**: without ``python -m pip install -e .`` first, this suite runs the previous
snapshot and passes while executing none of the new cases.

The cases carry the exact §7 message, not only the verdict, so the two bindings are held
to the same words. That is the whole reason the message is in the case file rather than in
each binding's own unit tests.
"""

from __future__ import annotations

import pytest

from nimbus_sdk import load_corpus
from nimbus_sdk.connector_kit import UrlResolutionError, resolve_url_with_base

CASES = load_corpus("url-resolution")


def _ids() -> list[str]:
    return [str(case["description"]) for case in CASES]


def test_the_corpus_is_not_empty() -> None:
    # A load_corpus that silently returned [] would make every parametrised test below
    # vanish rather than fail. Twenty-one is the count at the corpus's introduction; the
    # TypeScript guard is what holds the exact list.
    assert len(CASES) >= 21


def _outcome(case: dict[str, object]) -> bool:
    expect = case["expect"]
    assert isinstance(expect, dict)
    return bool(expect["ok"])


def test_both_outcomes_are_exercised() -> None:
    # A corpus of only-accepts or only-refuses is not coverage. The TypeScript guard makes
    # the same assertion; both bindings refuse to report a half-corpus as a passing one.
    assert {_outcome(case) for case in CASES} == {True, False}


@pytest.mark.parametrize("case", CASES, ids=_ids())
def test_case(case: dict[str, object]) -> None:
    base = case["base"]
    input_ = case["input"]
    expect = case["expect"]
    assert isinstance(base, str)
    assert isinstance(input_, str)
    assert isinstance(expect, dict)

    if expect["ok"]:
        assert resolve_url_with_base(base, input_) == expect["url"]
        return

    with pytest.raises(UrlResolutionError) as excinfo:
        resolve_url_with_base(base, input_)
    assert str(excinfo.value) == expect["message"]
```

Every access narrows with `isinstance` rather than casting, because `load_corpus` returns
`list[dict[str, object]]` and `mypy --strict` is what holds the case files to the shape the
schema declares. If you find yourself reaching for `cast` or a `type: ignore`, the case
schema and the test disagree — fix the test.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sdks/python && python -m pytest tests/test_url_resolution_corpus.py -q`
Expected: FAIL with `FileNotFoundError: no conformance corpus for 'url-resolution'` — the
bundled `_data/spec` snapshot predates Task 3.

That failure is the trap working. It is what a passing run would look like if the snapshot
were merely *stale* rather than *absent*, which is why the reinstall is a step and not a note.

- [ ] **Step 3: Reinstall and run again**

Run: `cd sdks/python && python -m pip install -e . && python -m pytest tests/test_url_resolution_corpus.py -q`
Expected: PASS — twenty-one parametrised cases plus the two anti-vacuity tests.

- [ ] **Step 4: Update the language-neutrality paragraph**

In `docs/spec/README.md`, the paragraph beginning `holds the contract to being
**language-neutral**` names the corpora the second binding executes. Add `url-resolution`
to that list, and delete the TypeScript-only disclosure sentence Task 3 added for it —
Python runs it now, so that sentence would be false.

`corpus-parity.test.ts` checks both directions and will tell you if you got one of them
wrong. Re-read the paragraph afterwards: it also carries a sentence about *what* the
parity means, and a corpus about a helper rather than about the wire deserves a clause
saying so.

- [ ] **Step 5: Run both suites**

Run: `cd sdks/typescript && bun run test`
Expected: PASS, `corpus-parity.test.ts` included.

Run: `cd sdks/python && python -m pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add sdks/python/tests/test_url_resolution_corpus.py docs/spec/README.md
git commit -m "test(connector-kit): execute the url-resolution corpus from the Python binding"
```

---

## Task 6: `env.py`

**Files:**
- Create: `sdks/python/src/nimbus_sdk/connector_kit/env.py`
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/__init__.py`
- Test: `sdks/python/tests/test_connector_kit_env.py`

**Interfaces:**
- Consumes: `MissingEnvError` from Task 4.
- Produces: `require_env(name: str, env: Mapping[str, str] = os.environ) -> str`.

- [ ] **Step 1: Write the failing test**

Create `sdks/python/tests/test_connector_kit_env.py`:

```python
"""``require_env`` — the single place ambient state enters the kit."""

from __future__ import annotations

from types import MappingProxyType

import pytest

from nimbus_sdk.connector_kit import MissingEnvError, require_env


def test_returns_the_value_from_the_supplied_mapping() -> None:
    assert require_env("TOKEN", {"TOKEN": "abc"}) == "abc"


def test_raises_naming_the_variable_when_absent() -> None:
    with pytest.raises(MissingEnvError) as excinfo:
        require_env("TOKEN", {})
    assert str(excinfo.value) == "TOKEN is not set"


def test_an_empty_value_counts_as_unset() -> None:
    # Matching TypeScript's requireProcessEnv, which tests `t === undefined || t === ""`.
    with pytest.raises(MissingEnvError):
        require_env("TOKEN", {"TOKEN": ""})


def test_the_seam_is_a_real_default_and_reads_the_process_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("NIMBUS_TEST_TOKEN", "live")
    assert require_env("NIMBUS_TEST_TOKEN") == "live"


def test_the_default_tracks_later_mutations_of_os_environ(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # os.environ is bound once, at import. It is a live mapping, so that binding is not a
    # snapshot — a helper that copied it would pass the test above and fail this one.
    monkeypatch.delenv("NIMBUS_TEST_TOKEN", raising=False)
    with pytest.raises(MissingEnvError):
        require_env("NIMBUS_TEST_TOKEN")
    monkeypatch.setenv("NIMBUS_TEST_TOKEN", "later")
    assert require_env("NIMBUS_TEST_TOKEN") == "later"


def test_an_immutable_mapping_is_an_acceptable_seam() -> None:
    # `Mapping`, not `MutableMapping`, is what makes this work: a MappingProxyType has no
    # __setitem__ at all. The annotation itself is held by `mypy --strict`, not by pytest —
    # this is the runtime half of that claim, and it is the half that would actually break
    # a caller if the parameter type were widened.
    assert require_env("TOKEN", MappingProxyType({"TOKEN": "abc"})) == "abc"


def test_reading_the_environment_never_writes_to_it() -> None:
    # A helper whose job is reading must not mutate the seam it is handed — including not
    # inserting a default for a missing key, which dict.setdefault-style code would.
    supplied = {"TOKEN": "abc"}
    require_env("TOKEN", supplied)
    with pytest.raises(MissingEnvError):
        require_env("ABSENT", supplied)
    assert supplied == {"TOKEN": "abc"}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sdks/python && python -m pytest tests/test_connector_kit_env.py -q`
Expected: FAIL — `ImportError: cannot import name 'require_env'`.

- [ ] **Step 3: Write `env.py`**

```python
"""Reading a required environment variable, through a replaceable seam.

TypeScript's ``requireProcessEnv`` reads ``process.env`` directly with no seam, which is
the exact pattern ``docs/INCLUSION-POLICY.md`` §2 names as a failure: *"a helper that reads
``process.env.API_ENDPOINT`` with no way to override it still fails criterion 2."* This
binding is stricter than its original on purpose; the TypeScript fix is tracked as a
follow-up rather than replicated here for symmetry.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from nimbus_sdk.connector_kit.errors import MissingEnvError


def require_env(name: str, env: Mapping[str, str] = os.environ) -> str:
    """Return ``env[name]``, or raise :class:`MissingEnvError` if it is unset or empty.

    ``env`` defaults to ``os.environ`` itself, not to a copy of it: the default is a live
    mapping, so a variable set after this module is imported is still visible. It is
    annotated as the read-only :class:`~collections.abc.Mapping` rather than
    ``MutableMapping`` — a helper whose job is reading the environment should not hand its
    caller a seam that invites writing to it.

    An empty string counts as unset, matching TypeScript's ``requireProcessEnv``.
    """
    value = env.get(name)
    if not value:
        raise MissingEnvError(f"{name} is not set")
    return value
```

- [ ] **Step 4: Extend `__init__.py`**

Add `from nimbus_sdk.connector_kit.env import require_env` to the import block and
`"require_env"` to `__all__`, keeping both sorted.

- [ ] **Step 5: Run the tests**

Run: `cd sdks/python && python -m pytest tests/test_connector_kit_env.py -q && python -m ruff check . && python -m mypy`
Expected: PASS and clean.

If ruff flags `os.environ` as a mutable default: it will not — B006 targets literal
mutables and B008 targets *calls* in defaults, and `os.environ` is neither. If a future
ruff release disagrees, add the `noqa` with this paragraph's reasoning rather than
switching to `None` and resolving inside the body; the design specifies this signature in
D5 because a real default is what makes the seam honest.

- [ ] **Step 6: Commit**

```bash
git add sdks/python/src/nimbus_sdk/connector_kit/env.py \
        sdks/python/src/nimbus_sdk/connector_kit/__init__.py \
        sdks/python/tests/test_connector_kit_env.py
git commit -m "feat(connector-kit): add require_env with a replaceable environment seam"
```

---

## Task 7: `types.py` and `results.py`

**Files:**
- Create: `sdks/python/src/nimbus_sdk/connector_kit/types.py`
- Create: `sdks/python/src/nimbus_sdk/connector_kit/results.py`
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/__init__.py`
- Test: `sdks/python/tests/test_connector_kit_results.py`

**Interfaces:**
- Consumes: `ConnectorKitError`, `HttpStatusError` from Task 4.
- Produces:
  - `McpTextContent` / `McpToolResult` (TypedDicts)
  - `JsonBodyResponse` / `TextResponse` (read-only Protocols; Shipment 2's `HttpResponse`
    satisfies both structurally)
  - `json_result(data: object) -> McpToolResult`
  - `error_result(message: str) -> McpToolResult`
  - `json_result_if_ok(service_label: str, res: JsonBodyResponse, snippet_max: int = 300) -> McpToolResult`
  - `json_result_from_text_if_ok(service_label: str, res: TextResponse, *, max_snippet: int = 400, json_parse_error_message: str | None = None) -> McpToolResult`
  - `parse_json_text_if_ok(service_label: str, res: TextResponse, max_snippet: int = 400) -> object`

- [ ] **Step 1: Write the failing test**

Create `sdks/python/tests/test_connector_kit_results.py`:

```python
"""The MCP result builders.

Wire-shaped by design: the keys are the MCP wire keys — ``content``, ``isError`` — not
snake_case. The kit's job is producing the MCP contract shape, and a consumer that is not
the ``mcp`` package should get something usable without importing pydantic.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import pytest

from nimbus_sdk.connector_kit import (
    ConnectorKitError,
    HttpStatusError,
    error_result,
    json_result,
    json_result_from_text_if_ok,
    json_result_if_ok,
    parse_json_text_if_ok,
)


@dataclass(frozen=True)
class FakeResponse:
    """Structurally satisfies both response Protocols. Shipment 2's HttpResponse is the
    same shape, which is what makes these helpers transport-agnostic."""

    ok: bool
    status: int
    text: str
    json: object = None


def test_json_result_wraps_data_as_one_pretty_printed_text_block() -> None:
    assert json_result({"a": 1}) == {
        "content": [{"type": "text", "text": '{\n  "a": 1\n}'}]
    }


def test_json_result_indents_exactly_as_json_stringify_does() -> None:
    # JSON.stringify(x, null, 2) and json.dumps(x, indent=2) agree on separators — ","
    # with no trailing space, ": " after a key. A binding passing separators=(", ", ": ")
    # would produce a different byte string for every multi-key object.
    text = json_result({"a": 1, "b": [1, 2]})["content"][0]["text"]
    assert text == '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}'


def test_json_result_emits_non_ascii_raw() -> None:
    # json.dumps defaults to ensure_ascii=True and would emit "\u00e9" where
    # JSON.stringify emits the character. Same JSON, different bytes — and the text lands
    # in front of a human.
    text = json_result({"name": "café"})["content"][0]["text"]
    assert "café" in text
    assert "\\u" not in text


def test_json_result_refuses_a_non_finite_number() -> None:
    # The one deliberate divergence in this module. JavaScript's JSON.stringify turns NaN
    # and Infinity into `null`; Python's json.dumps emits the bare tokens NaN/Infinity,
    # which are not JSON and which no conformant parser on the other end will read. This
    # binding refuses rather than emitting either. Documented in docs/modules/connector-kit.md.
    with pytest.raises(ValueError):
        json_result({"n": float("inf")})


def test_error_result_sets_the_wire_key_is_error() -> None:
    assert error_result("boom") == {
        "content": [{"type": "text", "text": "boom"}],
        "isError": True,
    }


def test_json_result_returns_no_is_error_key_at_all() -> None:
    # NotRequired, not `isError: False`. A caller reading `result.get("isError")` must be
    # able to distinguish "not an error" from "error flag absent".
    assert "isError" not in json_result({"a": 1})


def test_json_result_if_ok_wraps_json_on_ok() -> None:
    res = FakeResponse(ok=True, status=200, text="{}", json={"a": 1})
    assert json_result_if_ok("svc", res) == json_result({"a": 1})


def test_json_result_if_ok_raises_with_status_and_a_300_char_snippet() -> None:
    res = FakeResponse(ok=False, status=503, text="x" * 400, json=None)
    with pytest.raises(HttpStatusError) as excinfo:
        json_result_if_ok("svc", res)
    assert str(excinfo.value) == f"svc 503: {'x' * 300}"
    assert excinfo.value.status == 503
    assert excinfo.value.service == "svc"


def test_json_result_if_ok_respects_a_custom_snippet_max() -> None:
    res = FakeResponse(ok=False, status=500, text="y" * 50, json=None)
    with pytest.raises(HttpStatusError) as excinfo:
        json_result_if_ok("svc", res, snippet_max=10)
    assert str(excinfo.value) == "svc 500: yyyyyyyyyy"


def test_json_result_from_text_if_ok_parses_then_wraps() -> None:
    res = FakeResponse(ok=True, status=200, text='{"a": 1}')
    assert json_result_from_text_if_ok("svc", res) == json_result({"a": 1})


def test_json_result_from_text_if_ok_uses_a_400_char_snippet_by_default() -> None:
    res = FakeResponse(ok=False, status=404, text="z" * 500)
    with pytest.raises(HttpStatusError) as excinfo:
        json_result_from_text_if_ok("svc", res)
    assert str(excinfo.value) == f"svc 404: {'z' * 400}"


def test_json_result_from_text_if_ok_raises_a_stable_message_on_malformed_json() -> None:
    res = FakeResponse(ok=True, status=200, text="not json")
    with pytest.raises(ConnectorKitError) as excinfo:
        json_result_from_text_if_ok("svc", res)
    assert str(excinfo.value) == "svc: invalid JSON response"


def test_the_caller_supplied_parse_message_wins_on_the_parse_path() -> None:
    res = FakeResponse(ok=True, status=200, text="not json")
    with pytest.raises(ConnectorKitError) as excinfo:
        json_result_from_text_if_ok("svc", res, json_parse_error_message="jira said no")
    assert str(excinfo.value) == "jira said no"


def test_the_caller_supplied_parse_message_is_not_used_on_the_non_ok_path() -> None:
    res = FakeResponse(ok=False, status=500, text="boom")
    with pytest.raises(HttpStatusError) as excinfo:
        json_result_from_text_if_ok("svc", res, json_parse_error_message="jira said no")
    assert str(excinfo.value) == "svc 500: boom"


def test_parse_json_text_if_ok_returns_the_parsed_value() -> None:
    res = FakeResponse(ok=True, status=200, text='{"a": 1}')
    assert parse_json_text_if_ok("svc", res) == {"a": 1}


def test_parse_json_text_if_ok_never_parses_on_the_non_ok_path() -> None:
    res = FakeResponse(ok=False, status=418, text="not json")
    with pytest.raises(HttpStatusError):
        parse_json_text_if_ok("svc", res)


def test_parse_json_text_if_ok_propagates_the_decode_error_on_ok() -> None:
    # Matching TypeScript, which lets JSON.parse's own error through here rather than
    # rewriting it — this helper composes multi-part results and the caller wants the detail.
    res = FakeResponse(ok=True, status=200, text="not json")
    with pytest.raises(json.JSONDecodeError):
        parse_json_text_if_ok("svc", res)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sdks/python && python -m pytest tests/test_connector_kit_results.py -q`
Expected: FAIL — `ImportError: cannot import name 'json_result'`.

- [ ] **Step 3: Write `types.py`**

```python
"""The wire shapes the kit returns.

Wire-shaped, per the design's D8: the keys are the MCP wire keys — ``inputSchema``,
``isError`` — not snake_case, because the kit's job is producing the MCP contract shape and
a consumer that is not the ``mcp`` package should get something usable.

Wire-shaped is not untyped. These ``TypedDict``s give an author completion and ``mypy``
checking without importing pydantic; the generated connector carries a small explicit
adapter into ``types.CallToolResult``, and that adapter is the only place pydantic appears.

``McpToolDescriptor`` joins this module in shipment 2, with the router that returns it.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


class McpTextContent(TypedDict):
    """One text block in an MCP tool result."""

    type: Literal["text"]
    text: str


class McpToolResult(TypedDict):
    """An MCP tool result.

    ``isError`` is ``NotRequired`` rather than defaulted to ``False`` so a caller can tell
    "not an error" from "the flag is absent", which is what the wire does.
    """

    content: list[McpTextContent]
    isError: NotRequired[bool]  # noqa: N815 — an MCP wire key, not a Python name
```

If ruff does not flag `isError` on your version, delete the `noqa` — `RUF100` fails an
unused one. Run `python -m ruff check .` and let it tell you which way round it is.

- [ ] **Step 4: Write `results.py`**

```python
"""Building MCP tool results, and turning a fetched response into one.

Every function here is pure and transport-agnostic: the two ``Protocol``s below are the
only thing it knows about a response, and shipment 2's ``HttpResponse`` satisfies them
structurally. That is what lets an author using an async client such as ``httpx`` skip the
kit's transport entirely and still use these helpers — see the design's D6.
"""

from __future__ import annotations

import json
from typing import Protocol

from nimbus_sdk.connector_kit.errors import ConnectorKitError, HttpStatusError
from nimbus_sdk.connector_kit.types import McpTextContent, McpToolResult


class TextResponse(Protocol):
    """A response whose body has been read as text."""

    @property
    def ok(self) -> bool: ...
    @property
    def status(self) -> int: ...
    @property
    def text(self) -> str: ...


class JsonBodyResponse(TextResponse, Protocol):
    """A response whose body has additionally been parsed, or ``None`` if it would not parse."""

    @property
    def json(self) -> object: ...


def json_result(data: object) -> McpToolResult:
    """Wrap ``data`` as a single pretty-printed JSON text block.

    ``ensure_ascii=False`` because ``JSON.stringify`` emits the character where Python
    would emit ``\\u00e9`` — same JSON, different bytes, and the text lands in front of a
    human. ``allow_nan=False`` is the one deliberate divergence: JavaScript turns ``NaN``
    and ``Infinity`` into ``null``, and Python's default emits the bare tokens, which are
    not JSON at all. Refusing is the only option that does not silently produce something
    the other end cannot read.
    """
    text = json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False)
    content: McpTextContent = {"type": "text", "text": text}
    return {"content": [content]}


def error_result(message: str) -> McpToolResult:
    """An MCP tool result carrying ``message`` and the ``isError`` flag.

    Python-only: TypeScript's kit has no counterpart, because its tool registrar turns a
    thrown error into this shape itself. Shipment 2's ``ToolRouter`` is what needs it here.
    """
    content: McpTextContent = {"type": "text", "text": message}
    return {"content": [content], "isError": True}


def json_result_if_ok(
    service_label: str, res: JsonBodyResponse, snippet_max: int = 300
) -> McpToolResult:
    """After a JSON-body fetch: raise with status and a body snippet, else wrap ``res.json``."""
    if not res.ok:
        raise HttpStatusError(service_label, res.status, res.text[:snippet_max])
    return json_result(res.json)


def json_result_from_text_if_ok(
    service_label: str,
    res: TextResponse,
    *,
    max_snippet: int = 400,
    json_parse_error_message: str | None = None,
) -> McpToolResult:
    """After a text-body fetch: raise on non-2xx, else parse the body and wrap it.

    ``json_parse_error_message`` is for callers that need a stable diagnostic on a parse
    failure. It is used on the parse path only — a non-2xx still raises
    :class:`HttpStatusError` with the status and snippet.
    """
    if not res.ok:
        raise HttpStatusError(service_label, res.status, res.text[:max_snippet])
    try:
        parsed = json.loads(res.text)
    except ValueError as exc:
        message = json_parse_error_message or f"{service_label}: invalid JSON response"
        raise ConnectorKitError(message) from exc
    return json_result(parsed)


def parse_json_text_if_ok(
    service_label: str, res: TextResponse, max_snippet: int = 400
) -> object:
    """Like :func:`json_result_from_text_if_ok`, but returns the parsed value.

    For composing a multi-part tool result. The decode error propagates unrewritten on the
    ok-but-malformed path, matching TypeScript, because a caller assembling several
    responses wants the detail rather than a flattened message.
    """
    if not res.ok:
        raise HttpStatusError(service_label, res.status, res.text[:max_snippet])
    return json.loads(res.text)
```

- [ ] **Step 5: Extend `__init__.py`**

Add to the import block and to `__all__`, both sorted:
`JsonBodyResponse`, `McpTextContent`, `McpToolResult`, `TextResponse`, `error_result`,
`json_result`, `json_result_from_text_if_ok`, `json_result_if_ok`, `parse_json_text_if_ok`.

- [ ] **Step 6: Run the tests**

Run: `cd sdks/python && python -m pytest tests/test_connector_kit_results.py -q && python -m ruff check . && python -m mypy`
Expected: PASS and clean.

If mypy rejects `FakeResponse` as a `JsonBodyResponse`, the Protocol members are declared
as plain attributes rather than as read-only properties — a frozen dataclass field does not
satisfy a mutable protocol attribute. Fix the Protocol, not the test.

- [ ] **Step 7: Commit**

```bash
git add sdks/python/src/nimbus_sdk/connector_kit/types.py \
        sdks/python/src/nimbus_sdk/connector_kit/results.py \
        sdks/python/src/nimbus_sdk/connector_kit/__init__.py \
        sdks/python/tests/test_connector_kit_results.py
git commit -m "feat(connector-kit): add the MCP result builders and their wire types"
```

---

## Task 8: `search_filter.py`

**Files:**
- Create: `sdks/python/src/nimbus_sdk/connector_kit/search_filter.py`
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/__init__.py`
- Test: `sdks/python/tests/test_connector_kit_search_filter.py`

**Interfaces:**
- Consumes: `json_result` and `McpToolResult` from Task 7.
- Produces: `as_record`, `as_objectish`, `string_field`, `tag_text`, `tag_names_from_objects`,
  `fields_from_keys`, `nested_string`, `filter_by_query`, `make_query_filter`,
  `matches_result` — plus the type aliases `FieldExtractor` and `SearchFilter`.

- [ ] **Step 1: Write the failing test**

Create `sdks/python/tests/test_connector_kit_search_filter.py`. This is a one-for-one port
of `sdks/typescript/src/connector-kit/search-filter.test.ts` plus the divergence traps.
Read that file first: `sed -n '1,120p' sdks/typescript/src/connector-kit/search-filter.test.ts`.

```python
"""The search helpers — a one-for-one port of search-filter.test.ts, plus the traps.

Three behaviours would diverge from TypeScript if written the obvious way, and each has
its own test below: case folding, the limit cap, and what an array row means.
"""

from __future__ import annotations

import math

from nimbus_sdk.connector_kit import (
    as_objectish,
    as_record,
    fields_from_keys,
    filter_by_query,
    make_query_filter,
    matches_result,
    nested_string,
    string_field,
    tag_names_from_objects,
    tag_text,
)

ROWS: list[object] = [
    {"name": "alpha", "tags": ["x", "y"]},
    {"name": "beta", "tags": ["z"]},
    {"name": "gamma", "tags": []},
]


def _names(item: object) -> list[str | None] | None:
    row = as_objectish(item)
    if row is None:
        return None
    return [string_field(row, "name")]


# ─── filter_by_query ──────────────────────────────────────────────────────────


def test_matches_case_insensitively() -> None:
    out = filter_by_query(ROWS, query="ALPHA", fields=_names)
    assert out == [ROWS[0]]


def test_a_non_match_returns_empty() -> None:
    assert filter_by_query(ROWS, query="delta", fields=_names) == []


def test_an_empty_query_matches_every_non_skipped_item() -> None:
    assert filter_by_query(ROWS, query="", fields=_names) == ROWS


def test_a_custom_limit_caps_in_encounter_order() -> None:
    assert filter_by_query(ROWS, query="", limit=2, fields=_names) == ROWS[:2]


def test_the_cap_defaults_to_fifty() -> None:
    many: list[object] = [{"name": f"row{i}"} for i in range(60)]
    assert len(filter_by_query(many, query="row", fields=_names)) == 50


def test_a_zero_limit_returns_nothing_not_one_row() -> None:
    # The cap is compared with >= after a push, so without the explicit zero check the
    # first match is already in the list before the loop can stop.
    assert filter_by_query(ROWS, query="", limit=0, fields=_names) == []


def test_a_negative_limit_returns_nothing() -> None:
    assert filter_by_query(ROWS, query="", limit=-5, fields=_names) == []


def test_a_non_finite_limit_falls_back_to_the_default_cap() -> None:
    # Not to "unlimited": a caller who wants everything omits limit, and honouring inf
    # would make nan and inf behave alike when only one of them is plausibly deliberate.
    many: list[object] = [{"name": f"row{i}"} for i in range(60)]
    assert len(filter_by_query(many, query="row", limit=math.nan, fields=_names)) == 50
    assert len(filter_by_query(many, query="row", limit=math.inf, fields=_names)) == 50


def test_a_fractional_limit_floors_rather_than_overshooting() -> None:
    assert len(filter_by_query(ROWS, query="", limit=2.7, fields=_names)) == 2


def test_fields_returning_none_skips_the_item_entirely() -> None:
    assert filter_by_query([1, "s", None], query="", fields=_names) == []


def test_tolerates_none_field_parts() -> None:
    # JavaScript's Array#join renders null and undefined as "". Python's str.join raises
    # on a None element, so the binding must map them itself.
    def fields(_item: object) -> list[str | None]:
        return [None, "alpha"]

    assert filter_by_query([{"name": "x"}], query="alpha", fields=fields) == [{"name": "x"}]


def test_case_folding_is_lower_not_casefold() -> None:
    # str.casefold() maps ß to "ss" where JavaScript's toLowerCase leaves it alone, so a
    # casefold binding matches "strasse" against "straße" and TypeScript does not.
    rows: list[object] = [{"name": "Straße"}]
    assert filter_by_query(rows, query="strasse", fields=_names) == []
    assert filter_by_query(rows, query="straße", fields=_names) == rows


def test_the_dotted_capital_i_folds_the_way_javascript_folds_it() -> None:
    # NOT a second lower-vs-casefold case — measured on CPython 3.14 (UCD 16.0.0) and
    # Node 24, all three agree that U+0130 folds to U+0069 U+0307:
    #   "İstanbul".lower()      -> ['0x69', '0x307', '0x73', ...]
    #   "İstanbul".casefold()   -> ['0x69', '0x307', '0x73', ...]
    #   "İstanbul".toLowerCase()-> ['0x69', '0x307', '0x73', ...]
    # It is here as a cross-binding parity pin: the fold expands one code point into two,
    # which is where a binding doing a byte-wise or single-code-point fold breaks. The
    # query is spelled with escapes because the combining dot is invisible in an editor.
    rows: list[object] = [{"name": "İstanbul"}]
    assert filter_by_query(rows, query="i̇stanbul", fields=_names) == rows
    # And the bare ASCII spelling must NOT match, which is what makes the line above an
    # assertion about the fold rather than about substring search: the combining dot sits
    # between the "i" and the "s", so "istanbul" is not a substring of the folded haystack.
    assert filter_by_query(rows, query="istanbul", fields=_names) == []


# ─── as_record / as_objectish ─────────────────────────────────────────────────


def test_as_record_accepts_a_mapping_and_rejects_everything_else() -> None:
    assert as_record({"a": 1}) == {"a": 1}
    for value in (None, 1, "s", [1, 2], True):
        assert as_record(value) is None


def test_as_objectish_accepts_a_mapping() -> None:
    assert as_objectish({"a": 1}) == {"a": 1}


def test_as_objectish_normalises_an_array_to_the_empty_mapping() -> None:
    # TypeScript returns the array itself, typed as a record, where every string key read
    # yields undefined. Python cannot index a list by string, so an array becomes the empty
    # mapping — which produces the identical result for every read the kit performs, and
    # keeps an array row matching rather than being dropped.
    assert as_objectish([1, 2]) == {}


def test_as_objectish_rejects_none_and_primitives() -> None:
    for value in (None, 1, "s", True):
        assert as_objectish(value) is None


# ─── string_field / tag_text / tag_names_from_objects ─────────────────────────


def test_string_field_reads_a_string_and_empties_everything_else() -> None:
    assert string_field({"a": "v"}, "a") == "v"
    assert string_field({}, "a") == ""
    assert string_field({"a": 1}, "a") == ""
    assert string_field({"a": None}, "a") == ""


def test_tag_text_joins_string_tags_with_spaces() -> None:
    assert tag_text({"tags": ["x", "y"]}) == "x y"
    assert tag_text({}) == ""
    assert tag_text({"tags": "x"}) == ""
    assert tag_text({"tags": ["x", 1, None]}) == "x"
    assert tag_text({"tags": [1, None]}) == ""


def test_tag_names_from_objects_joins_the_name_of_each_tag_object() -> None:
    assert tag_names_from_objects({"tags": [{"name": "a"}, {"name": "b"}]}) == "a b"
    assert tag_names_from_objects({}) == ""
    assert tag_names_from_objects({"tags": "a"}) == ""
    assert tag_names_from_objects({"tags": [1, "s"]}) == ""
    assert tag_names_from_objects({"tags": [{"name": ""}, {"name": 1}, {}]}) == ""


# ─── fields_from_keys ─────────────────────────────────────────────────────────


def test_fields_from_keys_reads_the_requested_keys() -> None:
    extract = fields_from_keys(["a", "b"])
    assert extract({"a": "1", "b": "2"}) == ["1", "2"]


def test_fields_from_keys_empties_missing_and_non_string_keys() -> None:
    extract = fields_from_keys(["a", "b"])
    assert extract({"a": 1}) == ["", ""]


def test_fields_from_keys_appends_tag_text_when_asked() -> None:
    extract = fields_from_keys(["a"], tags=True)
    assert extract({"a": "1", "tags": ["x"]}) == ["1", "x"]
    assert fields_from_keys(["a"])({"a": "1", "tags": ["x"]}) == ["1"]


def test_fields_from_keys_returns_none_for_a_non_objectish_item() -> None:
    assert fields_from_keys(["a"])(1) is None


def test_fields_from_keys_treats_an_array_item_as_objectish() -> None:
    assert fields_from_keys(["a"])([1, 2]) == [""]


# ─── nested_string ────────────────────────────────────────────────────────────


def test_nested_string_reads_a_leaf_down_a_path() -> None:
    root = {"metadata": {"labels": {"app": "web"}}}
    assert nested_string(root, ["metadata", "labels", "app"]) == "web"


def test_nested_string_reads_a_single_segment_path() -> None:
    assert nested_string({"a": "v"}, ["a"]) == "v"


def test_nested_string_empties_a_missing_or_non_record_segment() -> None:
    assert nested_string({"a": {"b": "v"}}, ["a", "missing", "b"]) == ""
    assert nested_string({"a": "not-a-record"}, ["a", "b"]) == ""


def test_nested_string_empties_a_non_string_or_missing_leaf() -> None:
    assert nested_string({"a": 1}, ["a"]) == ""
    assert nested_string({"a": {"b": "v"}}, ["a", "missing"]) == ""


def test_nested_string_handles_an_empty_path() -> None:
    # TypeScript's `path.at(-1) ?? ""` reads root[""]. Python's path[-1] would raise
    # IndexError, so the fallback is reproduced rather than inherited.
    assert nested_string({"": "v"}, []) == "v"
    assert nested_string({"a": "v"}, []) == ""


# ─── make_query_filter / matches_result ───────────────────────────────────────


def test_make_query_filter_builds_a_filter_over_the_extractor() -> None:
    search = make_query_filter(fields_from_keys(["name"]))
    assert search(ROWS, query="beta") == [ROWS[1]]


def test_make_query_filter_passes_the_limit_through() -> None:
    search = make_query_filter(fields_from_keys(["name"]))
    assert search(ROWS, query="", limit=1) == [ROWS[0]]


def test_matches_result_wraps_the_filtered_rows() -> None:
    search = make_query_filter(fields_from_keys(["name"]))
    assert matches_result(ROWS, search, query="beta") == json_result({"matches": [ROWS[1]]})


def test_matches_result_returns_an_empty_match_set_for_non_array_rows() -> None:
    search = make_query_filter(fields_from_keys(["name"]))
    assert matches_result(None, search, query="x") == {
        "content": [{"type": "text", "text": '{\n  "matches": []\n}'}]
    }
```

`json_result` is imported in that file alongside the search helpers — add it to the import
block at the top.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd sdks/python && python -m pytest tests/test_connector_kit_search_filter.py -q`
Expected: FAIL — `ImportError: cannot import name 'as_record'`.

- [ ] **Step 3: Write `search_filter.py`**

```python
"""Filtering rows by a query string — the search kit.

A port of ``@nimbus-dev/sdk/connector-kit``'s ``search-filter``. Three things would
diverge from that binding if written the obvious way, and each is handled here rather
than left to a comment:

* **Case folding.** ``str.lower()``, never ``str.casefold()``. ``casefold`` maps ``ß`` to
  ``ss`` where JavaScript's ``toLowerCase`` leaves it alone, so a casefold binding matches
  a query of ``strasse`` against a row reading ``straße`` and TypeScript does not.
* **The cap.** ``math.isfinite`` for the ``nan`` / ``inf`` guard, ``max(0, floor(n))`` for
  the rest. TypeScript's docstring argues no generated connector can observe this because
  its Zod schema constrains ``limit`` before the handler runs. That claim is **weaker**
  here: shipment 2's router takes validation as an optional seam, so a connector that
  omits it passes a raw ``limit`` straight through. These edges are more reachable in
  Python, not less.
* **Array rows.** ``as_objectish`` normalises a list to the empty mapping — see its
  docstring.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

from nimbus_sdk.connector_kit.results import json_result
from nimbus_sdk.connector_kit.types import McpToolResult

#: Reads the searchable string parts off one row, or ``None`` to skip the row entirely.
FieldExtractor = Callable[[object], Sequence[str | None] | None]

#: A ``make_query_filter`` result — the shape every connector search filter has.
SearchFilter = Callable[..., list[object]]

_DEFAULT_CAP = 50


def as_record(value: object) -> dict[str, object] | None:
    """The value as a mapping, or ``None``. Arrays are rejected."""
    if isinstance(value, dict):
        return value
    return None


def as_objectish(value: object) -> dict[str, object] | None:
    """The value as a mapping, or ``None``. Arrays are accepted as the empty mapping.

    TypeScript's ``asObjectish`` returns the array itself, typed as a record, where every
    string key read yields ``undefined``. Python cannot index a list by string, so an array
    is normalised to ``{}`` — which produces the identical result for every read this
    module performs, and keeps an array row *matching an empty query* rather than being
    dropped, which returning ``None`` would have changed.
    """
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        return {}
    return None


def string_field(row: dict[str, object], key: str) -> str:
    """``row[key]`` when it is a string, else ``""``."""
    value = row.get(key)
    return value if isinstance(value, str) else ""


def tag_text(row: dict[str, object]) -> str:
    """The row's string ``tags`` joined by spaces; ``""`` when there are none."""
    tags = row.get("tags")
    if not isinstance(tags, list):
        return ""
    return " ".join(t for t in tags if isinstance(t, str))


def tag_names_from_objects(row: dict[str, object]) -> str:
    """The ``name`` of each ``{"name": str}`` tag object, joined by spaces.

    Returns ``""`` when ``tags`` is absent, is not a list, or holds no object entries with
    a non-empty string ``name``.
    """
    tags = row.get("tags")
    if not isinstance(tags, list):
        return ""
    names: list[str] = []
    for tag in tags:
        entry = as_objectish(tag)
        if entry is None:
            continue
        name = entry.get("name")
        if isinstance(name, str) and name != "":
            names.append(name)
    return " ".join(names)


def _normalize_cap(limit: float | None) -> int:
    """A caller-supplied ``limit`` as a finite, non-negative integer cap.

    Non-finite falls back to the documented default rather than to "unlimited": a caller
    who wants everything omits ``limit``, and silently honouring ``inf`` would make ``nan``
    and ``inf`` behave alike when only one of them is plausibly deliberate.
    """
    if limit is None or not math.isfinite(limit):
        return _DEFAULT_CAP
    return max(0, math.floor(limit))


def filter_by_query(
    items: Sequence[object],
    *,
    query: str,
    fields: FieldExtractor,
    limit: float | None = None,
) -> list[object]:
    """The items whose extracted fields contain ``query``, case-insensitively, up to the cap."""
    needle = query.lower()
    cap = _normalize_cap(limit)
    # A zero cap asks for nothing; without this the first match is appended before the
    # `>=` check can stop it.
    if cap == 0:
        return []
    out: list[object] = []
    for item in items:
        parts = fields(item)
        if parts is None:
            continue
        haystack = " ".join("" if p is None else p for p in parts).lower()
        if needle not in haystack:
            continue
        out.append(item)
        if len(out) >= cap:
            break
    return out


def fields_from_keys(
    keys: Sequence[str], *, tags: bool = False
) -> Callable[[object], list[str] | None]:
    """A field extractor reading a fixed list of string keys off each objectish row.

    Set ``tags`` to append the standard ``tags`` text. Collapses the boilerplate extractor
    body shared by the simpler connectors.
    """

    def extract(item: object) -> list[str] | None:
        row = as_objectish(item)
        if row is None:
            return None
        parts = [string_field(row, key) for key in keys]
        if tags:
            parts.append(tag_text(row))
        return parts

    return extract


def nested_string(root: dict[str, object], path: Sequence[str]) -> str:
    """A nested string field by key path, or ``""`` when any segment or the leaf is missing.

    An empty ``path`` reads ``root[""]`` — reproducing TypeScript's ``path.at(-1) ?? ""``
    fallback, which Python's ``path[-1]`` would have turned into an ``IndexError``.
    """
    current: dict[str, object] | None = root
    for segment in path[:-1]:
        if current is None:
            return ""
        current = as_record(current.get(segment))
    if current is None:
        return ""
    leaf = current.get(path[-1] if path else "")
    return leaf if isinstance(leaf, str) else ""


def make_query_filter(fields: FieldExtractor) -> SearchFilter:
    """Build a ``search(items, query=..., limit=...)`` function from a field extractor."""

    def search(
        items: Sequence[object], *, query: str, limit: float | None = None
    ) -> list[object]:
        return filter_by_query(items, query=query, fields=fields, limit=limit)

    return search


def matches_result(
    rows: object, search: SearchFilter, *, query: str, limit: float | None = None
) -> McpToolResult:
    """The ``{"matches": [...]}`` envelope: filter the rows when they are a list, else empty.

    ``rows`` stays ``object`` because external payloads are untyped at the boundary.
    """
    matches = search(rows, query=query, limit=limit) if isinstance(rows, list) else []
    return json_result({"matches": matches})
```

- [ ] **Step 4: Extend `__init__.py`**

Add to the import block and to `__all__`, both sorted: `FieldExtractor`, `SearchFilter`,
`as_objectish`, `as_record`, `fields_from_keys`, `filter_by_query`, `make_query_filter`,
`matches_result`, `nested_string`, `string_field`, `tag_names_from_objects`, `tag_text`.

- [ ] **Step 5: Run the tests**

Run: `cd sdks/python && python -m pytest tests/test_connector_kit_search_filter.py -q`
Expected: PASS.

The two folding tests were measured before this plan was written, so treat a failure as a
real finding rather than as a literal to adjust:

```
CPython 3.14.6 / UCD 16.0.0        Node 24.18.1
"İstanbul".lower()    -> 69 307    "İstanbul".toLowerCase() -> 69 307    (agree)
"İstanbul".casefold() -> 69 307
"Straße".lower()      -> ... df    "Straße".toLowerCase()   -> ... df    (agree)
"Straße".casefold()   -> ... 73 73                                       (diverges)
```

`ß` is the **only** one of the two that discriminates `lower()` from `casefold()`; `İ` is a
cross-binding parity pin. If your interpreter disagrees with either row, do **not** adjust
the literal to match — record it as a fourth divergence in the module docstring and in
`docs/modules/connector-kit.md`, the way `event.py` records the lone surrogate. Python's
`str.lower()` is driven by the compiled Unicode database and is not locale-sensitive, so a
disagreement means a UCD version difference worth naming, not a machine quirk.

- [ ] **Step 6: Run the whole Python suite, lint and typecheck**

Run: `cd sdks/python && python -m pytest -q && python -m ruff check . && python -m ruff format --check . && python -m mypy`
Expected: all PASS and clean.

- [ ] **Step 7: Commit**

```bash
git add sdks/python/src/nimbus_sdk/connector_kit/search_filter.py \
        sdks/python/src/nimbus_sdk/connector_kit/__init__.py \
        sdks/python/tests/test_connector_kit_search_filter.py
git commit -m "feat(connector-kit): add the search helpers"
```

---

## Task 9: Documentation and changelogs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `sdks/python/README.md`
- Modify: `sdks/python/CHANGELOG.md`
- Modify: `docs/modules/connector-kit.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: the finished surface from Tasks 4, 6, 7, 8.
- Produces: nothing code reads.

- [ ] **Step 1: Update `CLAUDE.md`'s import-root section**

`## Python surface (three import roots, deliberately)` becomes four. Add the
`nimbus_sdk.connector_kit` entry after `nimbus_sdk.diagnostics`, listing what Shipment 1
ships and noting the transport/router arrive in Shipment 2.

Then widen the justification paragraph, which currently reads that the split states *"each
is a separate contract."* The kit is batteries — it has no contract of its own beyond
`url-resolution`. The justification becomes *"each is a separate **surface**"*, which the
TypeScript `exports` map has implied since 1.15.0 by giving `connector-kit` its own entry
point. Say this explicitly; it is design decision D1 and a reader will otherwise think the
paragraph drifted.

- [ ] **Step 2: Scope the behavioural-divergence inventory**

`CLAUDE.md` says **The bindings differ in three *behavioral* ways.** `json_result`'s
non-finite-number refusal is a fourth, and leaving the sentence as it stands makes it
false. Scope it to the contract surfaces — the sentence is about `ipc` and `diagnostics`,
which are contracts with corpora, and the kit is batteries. Add a following sentence
pointing at `docs/modules/connector-kit.md` for the kit's own divergences, so a reader is
not left thinking the inventory is exhaustive across the package.

- [ ] **Step 3: Update the commands section**

`CLAUDE.md`'s Python command block is unchanged, but the guard inventory under
*Conventions / non-negotiables* says **Four CI gates guard the TypeScript surface** and
that *"All four read TypeScript only; there is no equivalent gate for the Python surface."*
That is still true and is now more load-bearing than it was — this shipment roughly doubles
the Python surface. Add the cross-reference to the design's Follow-up 2 so the gap is
findable from here.

- [ ] **Step 4: Document the root in `sdks/python/README.md`**

Run: `grep -n "diagnostics" sdks/python/README.md`

Follow exactly how that file documents `nimbus_sdk.diagnostics`: a heading, one paragraph
on what the root is for, and a short runnable example. The example must import from
`nimbus_sdk.connector_kit` and must not import `nimbus_sdk` for a kit name — that is the
boundary the module docstring states.

Nothing typechecks Python snippets in this repository (`docs-snippets.test.ts` reads
TypeScript only), so run the example by hand before committing it:

```bash
cd sdks/python && python - <<'PY'
from nimbus_sdk.connector_kit import resolve_url_with_base, json_result
print(resolve_url_with_base("https://api.example.com", "/v1/x"))
print(json_result({"matches": []})["content"][0]["text"])
PY
```

- [ ] **Step 5: Update `docs/modules/connector-kit.md`**

Add a **Python binding** section. It must cover:

- The import root and what Shipment 1 ships.
- The three exports with no Python counterpart, from D4, each with its reason:
  `createRegisterSimpleTool` / `registerZodTool` / `ZodObjectSchema` (superseded by the
  Shipment 2 router — Python's `mcp.Server` exposes no `.tool` method, so a duck-typed
  registrar would match nothing), `fetchWithTimeout` (`AbortSignal.any` has no Python
  analogue), and `McpListResult` as a type (the Python return is a `TypedDict`, because
  `types.CallToolResult` is a pydantic model that cannot be duck-typed).
- The asymmetries in Python's favour: `require_env`'s `env` seam, which TypeScript lacks
  and which INCLUSION-POLICY §2 requires; `HttpStatusError`'s `.status` / `.service` /
  `.snippet`; and `error_result`, which TypeScript has no counterpart for.
- The divergences: `json_result` refusing a non-finite number where `JSON.stringify` emits
  `null`, and — if Step 5 of Task 8 found one — the `İ` folding.

Do not add a `<!-- covers: -->` entry. That comment resolves the *TypeScript* surface's
modules and there is no new one; `docs-coverage.test.ts` would fail on a claim it cannot
resolve.

- [ ] **Step 6: Update `docs/ROADMAP.md`**

The Phase 3 box `A **Python connector-kit**` is not yet done — Shipment 2 owes the
transport, the router, `rest.py` and the template rewrite. Leave the checkbox unticked and
rewrite the body to say what now exists and what remains, so the paragraph describing the
scaffold workaround is no longer the whole story. Do not tick it and do not delete the
scaffold paragraph — Task 10 is what makes that paragraph false.

Check no other roadmap claim went stale: `grep -n "corpora\|corpus" docs/ROADMAP.md` and
derive any count you find rather than trusting it. That file has carried a wrong one before.

- [ ] **Step 7: Add the Python CHANGELOG entry**

Run: `sed -n '1,25p' sdks/python/CHANGELOG.md`

Add a `Features` entry in the file's existing register naming the new import root and its
five modules, and a `Bug Fixes`-adjacent note is not needed — nothing in the Python package
changed behaviour.

- [ ] **Step 8: Run everything**

Run: `cd sdks/typescript && bun run typecheck && bun run lint && bun run test`
Run: `cd sdks/python && python -m pip install -e . && python -m pytest -q && python -m ruff check . && python -m ruff format --check . && python -m mypy`
Run from the repository root: `bun run scaffold:test && bun run scaffold:lint && bun run scaffold:typecheck`

The scaffolder suite is included deliberately even though this shipment does not touch the
templates: `docs-excerpts.test.ts` pins `sdks/typescript/README.md` and the quickstarts to
the template files, and it runs under `scaffold:test` rather than under the TypeScript
suite. If you edited either README it is the only thing that will tell you.

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md sdks/python/README.md sdks/python/CHANGELOG.md \
        docs/modules/connector-kit.md docs/ROADMAP.md
git commit -m "docs(connector-kit): document the Python import root and its asymmetries"
```

- [ ] **Step 10: Verify in a clone, outside the repository**

The worktree borrows the parent checkout's `node_modules`. Reproduce CI honestly:

```bash
cd "$(mktemp -d)"
git clone --branch worktree-python-connector-kit "C:/gitrep/nimbus-sdk" checkout
cd checkout && bun install --frozen-lockfile
bun run test && bun run scaffold:test
cd sdks/python && python -m pip install -e . && python -m pytest -q && python -m mypy
```
Expected: all PASS. This is the run that would have caught `tools/create-connector`'s
undeclared `@types/node` before it took down `build-test` on three operating systems.

---

## Task 10: BLOCKED — the template adopts `results.py`

**Do not start this task in this branch.** It is recorded here so the work is not lost and
so a reviewer can see it was considered rather than forgotten.

**Trigger:** `nimbus-dev-sdk` has published a version containing `nimbus_sdk.connector_kit`
— `0.7.0`, cut by release-please after Shipment 1 merges. Confirm with
`pip index versions nimbus-dev-sdk` before starting.

**Why it cannot ship now:** see F1 at the top of this plan. Raising the template's
`nimbus-dev-sdk>=0.3.0` floor above the version this commit builds makes the
`scaffold-python` CI job resolve the SDK from PyPI instead of from the wheel under test —
the exact failure `.github/workflows/ci.yml` warns about in its own comment — and leaving
the floor alone hands a real author a template importing a module their SDK does not have.

**Files:**
- Modify: `tools/create-connector/templates/python/pyproject.toml` — floor to `>=0.7.0`
- Modify: `tools/create-connector/templates/python/src/nimbus_quickstart_connector/main.py`
- Possibly modify: `docs/quickstart-python.md`, `sdks/typescript/README.md` — whatever
  `docs-excerpts.test.ts` quotes from the changed template lines

**Scope:** `_json_result` and `_error_result` only. They are pure dict builders today and
become two-line adapters over `json_result` / `error_result`:

```python
def _json_result(payload: dict[str, str]) -> types.CallToolResult:
    return _to_call_tool_result(json_result(payload))
```

`_on_list_tools`, `_on_call_tool` and the inline `isinstance` check stay put — they need
the router, which is Shipment 2.

**Verification:** `bun run scaffold:test` for the excerpt drift guard, then the
`scaffold-python` CI job, which generates, installs, builds, tests and drives the project
end to end. That job passing against the rewritten template is the proof.

---

## Self-review

Run against the spec after the plan is written, before execution starts.

**Spec coverage.** D1 → Task 4 (the root) and Task 9 (the `CLAUDE.md` justification).
D2 → Task 1. D3 → Tasks 4, 6, 7, 8, with F2 correcting the module table.
D4 → Task 9's `docs/modules/connector-kit.md` section. D5 → Task 6. D6, D7, D8 → Shipment 2,
except the `TypedDict`s D8 names, which Task 7 ships because `results.py` returns them.
The `startsWith("http")` correction → Tasks 1 and 2. The corpus → Tasks 3 and 5. The
divergence traps — case folding, `normalize_cap`, origin comparison — → Tasks 8 and 4, each
with its own test. Testing section → each task's test steps. Documentation section → Task 9.
Follow-ups 1–5 are recorded, not done, which is what the design asks.

**Not covered, deliberately:** the "early template win", which F1 defers to Task 10. That
is the one place this plan does not deliver what the design's Shipment 1 scope names, and
the reason is external to the design.

**Measured, not assumed.** Three facts this plan asserts were run before it was written,
and each is reproduced at the point it is used: `urljoin("https://api.example.com",
"//evil.com/x")` returns `https://evil.com/x` (Task 3's protocol-relative case), and the
`İ` / `ß` folding table in Task 8 Step 5. If any of them fails to reproduce on the
executor's machine that is a finding to record, not a literal to adjust.

## Carried to Shipment 2

Named here so Shipment 2's plan starts from them rather than rediscovering them.

1. **`res.text` must never raise.** `results.py` takes a `TextResponse` whose `text` is
   already a `str`, so decoding is entirely the transport's problem — and a non-2xx body is
   exactly where a server is most likely to return something that is not valid UTF-8 (a
   proxy error page, a truncated gzip, a binary blob). If `UrllibTransport` decodes
   strictly, `HttpStatusError` never gets raised: the transport dies with a
   `UnicodeDecodeError` on the error path, which is the worst place to lose the status
   code. `UrllibTransport` MUST decode with `errors="replace"`, and that belongs in a test
   driving the real `http.server` fixture — a fake transport hands back a `str` and cannot
   see the bug. Raised in review of this plan; it is a Shipment 2 requirement because
   Shipment 1 ships no transport.
2. **`AsyncTransport`**, deferred per D6 with an explicit trigger: a real connector whose
   throughput is measurably hurt by the `to_thread` hop. Not "`mcp` is async".
3. **A conformance harness for third-party transports** proving the §8 credential-redirect
   rule. Worth having once more than one transport exists.
4. **`requireProcessEnv` has no `env` seam** in TypeScript, failing INCLUSION-POLICY §2.
   Task 6 makes the Python binding stricter than its original rather than replicating the
   bug; the TypeScript fix is a separate change.
5. **No Python surface-snapshot gate.** This shipment roughly doubles the Python public
   surface with nothing equivalent to `api-surface.md` guarding it.
