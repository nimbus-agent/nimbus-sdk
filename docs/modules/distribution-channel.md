<!-- covers: distribution-channel -->

# `distribution-channel`

Resolves which package manager installed the running Nimbus binary, and produces the
upgrade hint for that channel. When a package manager owns the install, the self-updater
steps aside.

## When you reach for it

When you print an upgrade instruction, or when you must decide whether it is legitimate to
replace the binary in place.

## Constraints that are load-bearing

- **`null` means "no channel was detected" — which is not the same as "no package manager
  owns this install".** Path detection covers exactly two of the seven channels: Homebrew (a
  `/Cellar/` or `/.linuxbrew/` segment) and Scoop (`/scoop/apps/`). The other five —
  `winget`, `apt`, `yum`, `msi`, `pkg` — are reachable **only** through the
  `NIMBUS_DISTRIBUTION_CHANNEL` marker, so an apt-managed binary launched without that marker
  resolves to `null` exactly as a direct download does. A direct download is one of the things
  `null` can mean; treating `null` on its own as a green light for self-update is how the
  module's whole purpose gets defeated.
- **The env marker wins, and an unknown value is ignored rather than trusted.**
  `NIMBUS_DISTRIBUTION_CHANNEL` takes precedence over the path heuristics; a value outside
  the seven known channels falls through to the heuristics rather than being returned.
- **Symlinks are resolved before the path is inspected**, because a package manager exposes
  its binary through a `bin` symlink whose own path carries none of the tell-tale segments.
- **Every ambient read is a parameter.** `env`, `execPath`, and `realpath` all default to
  the live process but are injectable, so this is testable without touching the machine —
  see the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
- **`channelUpgradeHint` is exhaustive over `DistributionChannel`.** Adding a channel is a
  contract change that will not compile until the hint is written.

## Example

```ts
import {
  channelUpgradeHint,
  type DistributionChannel,
  type ResolveChannelOptions,
  resolveDistributionChannel,
} from "@nimbus-dev/sdk";

/** Live resolution: reads the real env and exec path. */
export function upgradeHint(): string {
  const channel: DistributionChannel | null = resolveDistributionChannel();
  if (channel === null) {
    // Undetected, not unmanaged: apt, yum, winget, msi and pkg all land here without the
    // env marker, so this branch is not a licence to replace the binary in place.
    return "No install channel detected — check for a package manager before self-updating.";
  }
  return channelUpgradeHint(channel);
}

/** The same call with every ambient read substituted, as a test would do it. */
const options: ResolveChannelOptions = {
  env: { NIMBUS_DISTRIBUTION_CHANNEL: "homebrew" },
  execPath: "/usr/local/bin/nimbus",
  realpath: (p) => p,
};

export const forced: DistributionChannel | null = resolveDistributionChannel(options);
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.

## Python binding

`nimbus_sdk.distribution_channel` (`sdks/python/src/nimbus_sdk/distribution_channel/`)
publishes **3** names — `DistributionChannel`, `resolve_distribution_channel`,
`channel_upgrade_hint` — and runs the **27-case** corpus of
[`batteries/v1/distribution-channel.md`](../spec/batteries/v1/distribution-channel.md).

`DistributionChannel` is a `Literal` rather than a `str`, so `mypy --strict` rejects an eighth
value at the call site. That is what "closed set" has to mean in a typed binding; §1 states
the set and the type enforces it.

**Everything it reads is injected** (§R1): the environment map, the executable path and the
resolver all come from the caller. The defaults read the real process and are deliberately
outside the corpus, because a case whose expected answer is "whatever this host happens to
be" pins nothing — and would answer differently on each of CI's three operating systems.

## Go binding

`distributionchannel` (`sdks/go/distributionchannel/`) publishes **13** declarations, and the
gap from Python's 3 is entirely Go spelling a `Config` struct and its members as separate
names.

Two things it does that the obvious Go does not:

- **Backslashes are normalised with `strings.ReplaceAll`, never `filepath.ToSlash`.**
  `ToSlash` replaces `os.PathSeparator`, which on Linux is already `/` — so it is a **no-op
  there** and a Windows path keeps its backslashes, and §3's segment test never matches. It
  does the right thing on Windows, so the mistake passes on a developer's machine and fails
  in CI. Python has the same trap in `PurePath.as_posix`.
- **A resolver that fails yields the input path unchanged** (§3.1), handled here rather than
  expected of the resolver. The TypeScript reference had the equivalent `catch` inside its
  *default* resolver only, so the guarantee held in production and failed for every injected
  one. The corpus is what found that, and it is registered in RFC-0017 §6.1.
