import { realpathSync } from "node:fs";

/**
 * Channels a Nimbus binary can be distributed through. When Nimbus runs from a
 * package-manager install, the self-updater steps aside so the package manager
 * owns updates.
 *
 * @moduleStability stable
 *
 * Lives in the SDK so the gateway and CLI share one copy: the `cli` package
 * reaches the gateway over IPC only (no source imports), so a shared pure helper
 * must live in a package both may depend on — the same pattern the manifest
 * signer uses.
 */
export type DistributionChannel = "homebrew" | "scoop" | "winget" | "apt" | "yum" | "msi" | "pkg";

const KNOWN_CHANNELS = new Set<DistributionChannel>([
  "homebrew",
  "scoop",
  "winget",
  "apt",
  "yum",
  "msi",
  "pkg",
] satisfies readonly DistributionChannel[]);

export interface ResolveChannelOptions {
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Defaults to `process.execPath`. */
  execPath?: string;
  /**
   * Resolves symlinks so a package manager's real install path (e.g. Homebrew's
   * Cellar) is inspected rather than the `bin` symlink that launched the process.
   * Injectable for tests; defaults to `realpathSync`.
   *
   * May throw: a resolver that fails yields the input path unchanged, and that is handled
   * here rather than expected of the function — so an injected resolver gets the same
   * guarantee the default one does.
   */
  realpath?: (p: string) => string;
}

/**
 * §3.1: a resolver that fails yields the input path unchanged.
 *
 * Wrapped at the point of USE rather than inside the default resolver, because the
 * guarantee has to hold for an *injected* resolver too — and a conformance corpus
 * necessarily injects one. It previously lived inside a `safeRealpath` wrapper around the
 * DEFAULT resolver, so the guarantee held in production and failed for every caller who
 * supplied their own; no test caught that, because none injected a throwing resolver.
 *
 * Failing soft is the right behaviour rather than merely the lenient one: a binary whose
 * path cannot be resolved very often still carries the tell-tale segment, so using the
 * unresolved path strictly increases the number of correct answers.
 */
function resolveSafely(execPath: string, realpath: (p: string) => string): string {
  try {
    return realpath(execPath);
  } catch {
    return execPath;
  }
}

function fromEnv(env: Record<string, string | undefined>): DistributionChannel | null {
  const raw = env["NIMBUS_DISTRIBUTION_CHANNEL"];
  if (raw && KNOWN_CHANNELS.has(raw as DistributionChannel)) {
    return raw as DistributionChannel;
  }
  return null;
}

function fromPath(execPath: string, realpath: (p: string) => string): DistributionChannel | null {
  // Resolve symlinks first: package managers expose the binary via a symlink whose
  // own path may not contain the tell-tale Cellar/apps segment.
  const resolved = resolveSafely(execPath, realpath);
  const p = resolved.replaceAll("\\", "/").toLowerCase();
  // Homebrew: macOS `/opt/homebrew/Cellar/...` or `/usr/local/Cellar/...`,
  // Linuxbrew `/home/linuxbrew/.linuxbrew/...`.
  if (p.includes("/cellar/") || p.includes("/.linuxbrew/")) {
    return "homebrew";
  }
  // Scoop: `~/scoop/apps/<app>/...`.
  if (p.includes("/scoop/apps/")) {
    return "scoop";
  }
  return null;
}

/**
 * Resolve the distribution channel this binary was installed through, or `null`
 * for a plain/direct-download install (where the self-updater stays enabled).
 * An explicit `NIMBUS_DISTRIBUTION_CHANNEL` env marker takes precedence over
 * path heuristics; an unknown marker value is ignored.
 */
export function resolveDistributionChannel(
  opts: ResolveChannelOptions = {},
): DistributionChannel | null {
  const env = opts.env ?? process.env;
  const execPath = opts.execPath ?? process.execPath;
  const realpath = opts.realpath ?? realpathSync;
  return fromEnv(env) ?? fromPath(execPath, realpath);
}

/** Human-facing upgrade hint per channel, used by `nimbus update`. */
export function channelUpgradeHint(channel: DistributionChannel): string {
  switch (channel) {
    case "homebrew":
      return "Installed via Homebrew — run 'brew upgrade nimbus' to update.";
    case "scoop":
      return "Installed via Scoop — run 'scoop update nimbus' to update.";
    case "winget":
      return "Installed via winget — run 'winget upgrade NimbusAgent.Nimbus' to update.";
    case "apt":
      return "Installed via apt — run 'sudo apt update && sudo apt upgrade nimbus' to update.";
    case "yum":
      return "Installed via dnf/yum — run 'sudo dnf upgrade nimbus' to update.";
    case "msi":
      return "Installed via the Windows installer — download the latest .msi from the releases page.";
    case "pkg":
      return "Installed via the macOS installer — download the latest .pkg from the releases page.";
  }
}
