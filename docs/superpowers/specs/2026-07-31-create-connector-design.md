# Scaffolding a connector — design

**Sub-project D1.** Delivers ROADMAP Phase 2 box 3 (*per-language quickstarts*) in full and
builds, but does not publish, the starter named in box 2. Publishing is D2.

## The problem

The path from "I want to build a Nimbus connector" to a working one currently runs through a
README that teaches a dead end.

`sdks/typescript/README.md` §Quickstart shows a connector that calls
`server.registerTool(...)` and then `server.start()`. `NimbusExtensionServer.registerTool` is a
no-op — it takes a name and a definition and discards both (`src/server.ts:31-33`), and no tool
dispatch exists anywhere in the package. An author who follows that quickstart gets a program
that declares a tool, registers it, starts, and does nothing. Their handler is reachable only
from their own unit test. Nothing tells them.

Python has no quickstart at all, and no examples directory.

## What a connector can actually do

Two findings shape everything below, and the second corrects the first.

**`registerTool` is not the path.** It is a stub whose eventual implementation belongs to a
gateway loop this repository does not own: `docs/spec/wire/v1/framing.md` §1 assigns envelopes,
method names, correlation and liveness to the gateway. That is the same boundary that stopped
the handshake runtime where it stopped.

**But the tool surface is reachable anyway, through injection.**
`connector-kit`'s `createRegisterSimpleTool(server)` (`src/connector-kit/mcp-tool-kit.ts:125-136`)
duck-types any object carrying a `.tool()` method and returns a bound registrar. It never
imports an MCP SDK; the server is supplied by the caller, exactly as `HandshakeIo` supplies the
byte stream. So the published package stays dependency-free while a connector project brings
`@modelcontextprotocol/sdk` itself and serves tools for real.

This repository has never demonstrated that end to end — `examples/calendar-connector`'s
docblock states the opposite ("it does not serve traffic on its own"), which was true of that
file and easy to over-read as true of the package. A generated project is where the pattern
gets shown and, more importantly, executed in CI.

## Scope

**In:** two templates, the CLI that copies them, the CI that proves a generated project runs,
and the quickstart docs.

**Out:** publishing `@nimbus-dev/create-connector` to npm — its release-please component, its
OIDC provenance job, and the `npm create` documentation. That is D2, deliberately separate: it
is release-pipeline work, a different risk domain from authoring, and mixing the two is the
combination that produced the missing hash-pin in the release-pipeline sub-project. Until D2,
the CLI runs from the repository and `cp -r` is the documented fallback, so nothing an author
needs is blocked on it.

## Layout

```
tools/create-connector/
  package.json            # @nimbus-dev/create-connector, private: true until D2
  tsconfig.json
  src/index.ts            # parse -> validate -> copy -> substitute
  src/*.test.ts
  templates/
    typescript/           # a real, runnable project
    python/               # a real, runnable project
```

`tools/create-connector` becomes a second Bun workspace member alongside `sdks/typescript`, so
the CLI is typechecked, linted and tested by the machinery that already exists rather than by
new machinery. The templates are **data**: Biome lints them, `tsc` never compiles them. They
import `@modelcontextprotocol/sdk` and `mcp`, which this repository does not install and must
not start installing — the templates' dependencies belong to the author's project, not to ours.

The CLI must run under **Node**, not only Bun, because `npm create` invokes it with Node once
D2 publishes it. It builds to `dist/` and declares `engines.node >= 22`, matching the SDK.

The scaffolder is named `@nimbus-dev/create-connector` rather than the ROADMAP's literal
`create-nimbus-connector` for the reason recorded in `CLAUDE.md`: npm's unscoped namespace is
flat, and this project already lost `nimbus-sdk` on PyPI to an unrelated package. A name inside
a scope we own cannot be taken from us. `npm create @nimbus-dev/connector my-conn` resolves to
it.

## Templates are placeholder-free real projects

The templates carry a fixed name and are valid, runnable projects exactly as they sit in the
tree. The CLI derives three casing variants from the `<name>` argument and replaces the
template's own variants **everywhere** — in the contents of every text file, and in every path
segment:

| Variant | Template literal | Generated, for `my-connector` |
|---|---|---|
| kebab | `nimbus-quickstart-connector` | `my-connector` |
| snake | `nimbus_quickstart_connector` | `my_connector` |
| title | `Nimbus Quickstart Connector` | `My Connector` |

Substituting **path segments** is not optional: the Python template's package lives at
`src/nimbus_quickstart_connector/`, and `main.py` and every test import it by that name. A
content-only rewrite produces a project whose `pyproject.toml` names a package that does not
exist on disk.

An earlier draft of this design named three specific sites — the project name, `manifest.id`,
and `manifest.displayName` — and asserted the whole-tree guard below anyway. Those two
statements contradict each other: the template's name also appears in both READMEs, in the
Python package's directory name, in its imports, and in whatever file someone adds next.
Enumerating sites guarantees the enumeration and the guard drift apart. Substituting everywhere
makes the guard *exactly* the specification rather than an approximation of it.

The cost is over-substitution — a name appearing as a substring of something that should not
change. The template names are distinctive enough that this is not a live hazard today, and the
generated project's own build and tests run in CI immediately afterward, which is where a
mangled identifier would surface.

A template written with `__PROJECT_NAME__` placeholders cannot be linted, typechecked, tested,
or executed in place. Every kind of drift you would most want to catch — a renamed export, a
broken import, a manifest field that no longer validates — stays invisible until someone
generates a project and runs it by hand. A template that is a real project is exercised by the
same tooling as the rest of the repository, and the substitution step stays small enough to
verify exhaustively.

**The guard, and it is mutation-provable.** After generating, assert that **no occurrence of
any of the three variants survives anywhere in the output tree** — every file's contents and
every path. Add a file to the template that names it, and the guard covers it for free. The
convenient invariant would be "the known substitutions were applied"; the right one is "nothing
of the template's identity is left behind," and it is the reason the substitution is whole-tree
rather than a list.

Name validation happens before any file is written: the argument must satisfy npm package-name
rules for TypeScript and be a valid module identifier for Python. It does **not** need to
satisfy a `manifest.id` pattern, because none exists — the rule registry constrains `id` only
as a required non-empty string (`manifest.id.required` in `docs/spec/rules/v1/manifest-rules.json`;
`MANIFEST_RULES` carries no entry beyond that). The CLI is therefore stricter than the contract
here, and deliberately: it is choosing a name that must also work as a package name in an
ecosystem, which is the tighter of the two constraints. The CLI refuses to write into a
directory that exists and is non-empty.

## What a generated project contains

```
my-connector/
  manifest.(ts|py)          declares the tool surface; passes runContractTests
  handlers.(ts|py)          plain functions, no SDK coupling
  handlers.test.(ts|py)     they are tested
  main.(ts|py)              MCP server + handshake
  README.md                 what is contract, and what is your choice
  package.json | pyproject.toml
```

`main` owns an MCP server from the official SDK, adapts it with `createRegisterSimpleTool` in
TypeScript, and runs the handshake over stdio — returning cleanly on agreement and exiting
`CONTRACT_HANDSHAKE_EXIT` (`20`) on refusal, which is what
`docs/spec/negotiation/v1/contract-version.md` §7 requires of a connector. The SDK exports that
constant precisely so a caller can act on a refusal the package itself will not act on, and
**both bindings already export it under that identical name** — `contract-version.ts:53` and
`contract.py:32`, the latter re-exported from `nimbus_sdk/__init__.py`. The two quickstarts can
therefore name the same constant, and neither template needs to hardcode `20`.

`handlers` deliberately import nothing from the SDK. An author's business logic should be
testable without a wire protocol, and keeping the boundary visible in the generated shape is
cheaper than explaining it in prose.

Python has no `connector-kit`, so its `main` wires the `mcp` package directly. The file split is
identical to TypeScript's — `manifest` / `handlers` / `main` — so the two quickstarts read as
the same project in two languages; the difference is confined to `main`, where the few lines
`createRegisterSimpleTool` would otherwise absorb sit inline, commented as exactly that. Keeping
them inline and visible is the point: hand-rolling a Python helper module here would amount to
designing a Python `connector-kit` inside a scaffold, without the RFC such a surface deserves.

The gap gets **recorded rather than narrated**: D1 adds a Python connector-kit line to the
ROADMAP's Phase 3 batteries section, so the asymmetry is tracked where the next person will look
instead of only in a template comment.

**The generated README draws one line explicitly**: the manifest shape, the handshake, and exit
code 20 are *contract* — the gateway depends on them. Which MCP server you use and how your
tools are implemented are *your choice*. That line matters because this repository does not own
the gateway contract, and a scaffold is the most authoritative-looking document a first-time
author will read.

## Verification

The property worth pinning is not "the template is valid inside this repository." It is "a
stranger can generate this and run it." Those differ: inside the workspace, `@nimbus-dev/sdk`
resolves through Bun's workspace link, and Node's resolution walks up to the root
`node_modules` from anywhere in the tree. A template can lint, typecheck and pass tests in
place while being broken for every real user — a missing `files` entry, a wrong dependency
range, an import that only worked because the workspace flattened it.

So: two CI jobs, `scaffold-typescript` and `scaffold-python`, each of which

1. packs the SDK from this commit — `bun pm pack` / `python -m build`;
2. creates a temporary directory **outside the repository tree**;
3. runs the real CLI into it;
4. installs the packed artifact plus the generated project's own dependencies;
5. runs the generated project's own build and tests;
6. **drives the generated connector as a process**: writes a hello on its stdin and asserts it
   answers with one and exits `0`; then writes a hello declaring a disjoint version set and
   asserts it exits `20`.

Step 6 is what separates this from a lint. Steps 1-5 prove the project assembles; only step 6
proves it speaks the contract. Break the exit code, drop the handshake call, or write the hello
after reading instead of before, and the job goes red.

Both jobs join `ci-ok`'s `needs` list. That job fails on `skipped` as well as on `failure`
(`.github/workflows/ci.yml`), so neither may be made conditional.

**These two jobs need the network policy widened.** Every job runs `step-security/harden-runner`
with `egress-policy: block` and an explicit `host:port` allowlist. Installing a generated
project's dependencies means `scaffold-typescript` adds `registry.npmjs.org:443`, and
`scaffold-python` adds `pypi.org:443` and `files.pythonhosted.org:443` — those hosts, that port,
on those two jobs only. No other job's allowlist changes. This is called out here so it is a
decision in review rather than a surprise in a diff.

Caching the dependencies to run these jobs offline was considered and **rejected**. A warm cache
would suppress precisely the signal this design is buying: a template dependency range that has
gone bad resolves from the cache and stays green, and the breakage surfaces months later in an
author's terminal instead of in our CI. The fresh install is the test.

## Documentation

- `docs/quickstart-typescript.md` and `docs/quickstart-python.md` — language-neutral location,
  consistent with `docs/` belonging to neither binding.
- `sdks/typescript/README.md` §Quickstart replaced with the working pattern. The existing test
  asserting the README and the example have not drifted apart is repointed at the template, so
  the README stays pinned to code that CI executes.
- `sdks/python/README.md` gains its first quickstart.
- `examples/quickstart-connector/` is deleted. It would otherwise be a second, stub-teaching
  answer to the same question; `examples/calendar-connector/` stays, since it demonstrates
  something else — a realistic contract-valid manifest with a HITL-gated write.
- ROADMAP box 3 checked; box 2 annotated as built-but-unpublished, pending D2.

## Risks carried knowingly

**We demonstrate an integration pattern for a contract we do not own.** The mitigation is the
generated README's contract/choice split, and the fact that everything on the contract side of
that line is executed in CI against the published spec.

**Template dependency ranges will age.** The mitigation is that the scaffold jobs install fresh
on every run, so a break surfaces as a red CI job on an unrelated PR rather than as a silent
failure for an author months later. That is noisy by design; a pinned lockfile inside the
template would be quieter and would hide exactly the failure we want to see.

## Task shape

Five tasks: the TypeScript template; the Python template; the CLI with its validation and
substitution guards; the two scaffold CI jobs; the documentation and ROADMAP update.
