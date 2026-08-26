# Nimbus distribution-channel battery contract v1

**Status:** normative. **Contract version:** `v1`.

This document specifies the `distribution-channel` battery: how a Nimbus binary determines
which package manager installed it, and what it tells the user about upgrading. When the
answer is a package manager, the self-updater steps aside so that the package manager owns
updates.

Read [`./README.md`](./README.md) first — its rules §R1–§R7 apply here and are not repeated.
The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is
[`sdks/typescript/src/distribution-channel.ts`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/sdks/typescript/src/distribution-channel.ts),
published from the `.` entry point. The executable form of this document is the corpus at
[`../../conformance/v1/distribution-channel/`](../../conformance/v1/distribution-channel/).
Where prose and corpus appear to disagree, the corpus is the tiebreaker.

## §1 Scope, and the three injected inputs

Two functions and one closed set.

```
DistributionChannel = "homebrew" | "scoop" | "winget" | "apt" | "yum" | "msi" | "pkg"

resolveDistributionChannel(options)  -> DistributionChannel | null
channelUpgradeHint(channel)          -> string
```

`resolveDistributionChannel` is the §R1 case. It reads three things about the running
process, and a conformant binding MUST make all three injectable:

| Input | Default in the reference | Injected as |
|---|---|---|
| the environment | `process.env` | a string-to-string map |
| the running executable's path | `process.execPath` | a string |
| symlink resolution | `realpathSync` | a function from path to path |

A binding MUST NOT reach the real environment, the real executable path, or the real
filesystem when all three are supplied. This is what makes the function's whole specified
behaviour reachable from a conformance case: a case supplies a realpath **map** rather than a
filesystem, and the binding consults it.

The channel set is closed. A binding MUST NOT accept, resolve to, or emit a hint for any
value outside the seven above.

## §2 The environment marker takes precedence

`resolveDistributionChannel` consults the environment first, and its answer wins outright
over §3.

The variable is **`NIMBUS_DISTRIBUTION_CHANNEL`**. Its value is compared against the seven
channel names by exact string equality — no trimming, no case folding, no aliasing. `apt`
matches; `APT`, ` apt` and `apt-get` do not.

- A value equal to one of the seven resolves to that channel, and §3 is not consulted.
- **A value that is not one of the seven is ignored**, and resolution falls through to §3. It
  is not an error, and it does not resolve to an absence on its own.
- An absent or empty value falls through to §3.

The ignore rule matters: an operator who sets the variable to `brew` has not disabled channel
detection, they have merely failed to set it, and the path heuristics still run.

## §3 Path heuristics

If §2 produced nothing, the executable path is examined.

1. **Resolve symlinks first.** The injected realpath function is applied to the executable
   path, and every subsequent step operates on its result. This step is not optional: package
   managers expose a binary through a symlink in a `bin` directory whose own path carries
   none of the segments below, so a binding that skips it resolves Homebrew installs to an
   absence.
2. **Normalise.** Every backslash becomes a forward slash, and the whole path is lowercased.
   This is what makes the segment tests below work identically on Windows and POSIX paths.
3. **Test in order**, first match wins:
   - a path containing `/cellar/` or `/.linuxbrew/` resolves to `homebrew`;
   - a path containing `/scoop/apps/` resolves to `scoop`;
   - anything else resolves to an **absence** (§R6).

`/cellar/` covers macOS Homebrew at `/opt/homebrew/Cellar/…` and `/usr/local/Cellar/…`;
`/.linuxbrew/` covers Linuxbrew at `/home/linuxbrew/.linuxbrew/…`. Both are matched
post-lowercasing, which is why the literal is `cellar` and not `Cellar`.

### §3.1 A realpath that fails yields the input unchanged

If symlink resolution fails — the path does not exist, permission is denied, the platform
does not support the call — the **input path is used unchanged** and resolution continues.
The failure MUST NOT propagate to the caller and MUST NOT resolve to an absence on its own.

A binary whose path cannot be resolved is still very often a binary whose path already
carries the tell-tale segment, so failing soft here strictly increases the number of correct
answers.

### §3.2 Only two of the seven channels are path-detectable

`homebrew` and `scoop` are reachable from §3. `winget`, `apt`, `yum`, `msi` and `pkg` are
reachable **only** through §2's environment marker — their installers place binaries at paths
with no distinguishing segment.

This is specified rather than incidental: a binding MUST NOT add heuristics for the other
five. A new heuristic would make two bindings answer differently for the same path, which is
precisely what this document exists to prevent. Adding one is a change to this section.

## §4 Upgrade hints

`channelUpgradeHint(channel)` returns advice for a user whose Nimbus was installed through
that channel. Per §R5 these are **contract text**: a binding that returns the right meaning in
different words does not conform, and the conformance corpus asserts all seven as literals.

| Channel | Exact return value |
|---|---|
| `homebrew` | `Installed via Homebrew — run 'brew upgrade nimbus' to update.` |
| `scoop` | `Installed via Scoop — run 'scoop update nimbus' to update.` |
| `winget` | `Installed via winget — run 'winget upgrade NimbusAgent.Nimbus' to update.` |
| `apt` | `Installed via apt — run 'sudo apt update && sudo apt upgrade nimbus' to update.` |
| `yum` | `Installed via dnf/yum — run 'sudo dnf upgrade nimbus' to update.` |
| `msi` | `Installed via the Windows installer — download the latest .msi from the releases page.` |
| `pkg` | `Installed via the macOS installer — download the latest .pkg from the releases page.` |

Three details a binding will otherwise get wrong:

- The separator is an **em dash** (U+2014) surrounded by single spaces, not a hyphen.
- The quotes around commands are **ASCII apostrophes** (U+0027), not typographic quotes.
- `yum`'s text names **dnf/yum** and its command is `dnf`, not `yum`. The channel is named for
  the ecosystem; the advice names the tool people now use.

There is no hint for an absence. `channelUpgradeHint` is total over the seven channels and is
not called with `null`; a binding whose type system cannot express that MUST make the
unreachable case explicit rather than inventing an eighth string.

## §5 Composition

`resolveDistributionChannel` is §2 then §3, first answer wins:

```
resolve(env, execPath, realpath) =
    fromEnv(env)                       if it produced a channel
    otherwise fromPath(realpath(execPath))
```

Both may produce an absence, and an absence from both is an absence overall — the plain
direct-download install, which is the case where the self-updater stays enabled. That
absence is a normal, expected result and not a failure (§R6).
