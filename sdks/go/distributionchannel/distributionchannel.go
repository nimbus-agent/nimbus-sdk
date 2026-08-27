package distributionchannel

import (
	"os"
	"path/filepath"
	"strings"
)

// Channel is one of §1's seven distribution channels.
//
// A defined type rather than a bare string, so a caller cannot pass an arbitrary value
// where a channel is expected. The set is closed: a binding MUST NOT accept, resolve to,
// or emit a hint for anything outside it.
type Channel string

// §1's closed set.
const (
	Homebrew Channel = "homebrew"
	Scoop    Channel = "scoop"
	Winget   Channel = "winget"
	Apt      Channel = "apt"
	Yum      Channel = "yum"
	MSI      Channel = "msi"
	Pkg      Channel = "pkg"
)

// EnvVar is §2's marker. Exported because a caller assembling an environment for Resolve
// needs to name it, and hard-coding the string at every call site is how it drifts.
const EnvVar = "NIMBUS_DISTRIBUTION_CHANNEL"

var knownChannels = map[string]Channel{
	"homebrew": Homebrew,
	"scoop":    Scoop,
	"winget":   Winget,
	"apt":      Apt,
	"yum":      Yum,
	"msi":      MSI,
	"pkg":      Pkg,
}

// §4, verbatim. Contract text rather than merely its meaning: a binding returning the right
// advice in different words does not conform. The separator is an em dash (U+2014) and the
// quotes are ASCII apostrophes (U+0027); yum's text names dnf/yum and its command is dnf,
// because the channel is named for the ecosystem while the advice names the tool people use.
var hints = map[Channel]string{
	Homebrew: "Installed via Homebrew — run 'brew upgrade nimbus' to update.",
	Scoop:    "Installed via Scoop — run 'scoop update nimbus' to update.",
	Winget:   "Installed via winget — run 'winget upgrade NimbusAgent.Nimbus' to update.",
	Apt:      "Installed via apt — run 'sudo apt update && sudo apt upgrade nimbus' to update.",
	Yum:      "Installed via dnf/yum — run 'sudo dnf upgrade nimbus' to update.",
	MSI:      "Installed via the Windows installer — download the latest .msi from the releases page.",
	Pkg:      "Installed via the macOS installer — download the latest .pkg from the releases page.",
}

// Config carries the three inputs §R1 requires to be injectable.
//
// The zero value reads the real process: Env from os.Environ, ExecPath from os.Executable,
// and Realpath from filepath.EvalSymlinks. Those defaults are deliberately outside the
// conformance corpus — a case whose expected answer is "whatever this host happens to be"
// would pin nothing.
type Config struct {
	// Env is §2's environment. A nil map is an empty environment, NOT the process's own:
	// a caller who supplies a Config at all has asked to be isolated from the host, and
	// silently reading os.Environ for a nil field would defeat that at the worst moment.
	Env map[string]string

	// ExecPath is the running executable's path. Empty means "read the real one".
	ExecPath string

	// Realpath resolves symlinks. Nil means filepath.EvalSymlinks.
	//
	// It may return an error: §3.1 requires a failure to yield the input path unchanged,
	// and that is handled by this package rather than expected of the function.
	Realpath func(string) (string, error)

	// envSet records whether Env was supplied, so a deliberately empty environment is
	// distinguishable from an absent one. Unexported: a caller sets it by using
	// WithEnv rather than by assignment.
	envSet bool
}

// WithEnv returns a copy of c whose environment is env, including when env is empty.
//
// Needed because Go cannot distinguish "field omitted" from "field set to the zero value",
// and §1 requires an EMPTY environment to be expressible — several corpus cases supply one
// to prove the host is not consulted.
func (c Config) WithEnv(env map[string]string) Config {
	c.Env = env
	c.envSet = true
	return c
}

// resolveSafely applies the resolver, or returns the input unchanged when it fails.
//
// §3.1. Failing soft is right rather than merely lenient: a binary whose path cannot be
// resolved very often still carries the tell-tale segment, so using the unresolved path
// strictly increases the number of correct answers.
func resolveSafely(execPath string, realpath func(string) (string, error)) string {
	resolved, err := realpath(execPath)
	if err != nil {
		return execPath
	}
	return resolved
}

// fromEnv applies §2. An unrecognised value is IGNORED, not an error and not an absence in
// its own right: resolution falls through to §3.
func fromEnv(env map[string]string) (Channel, bool) {
	// Exact string equality: no trimming, no case folding, no aliasing. "apt" matches;
	// "APT", " apt" and "apt-get" do not.
	channel, ok := knownChannels[env[EnvVar]]
	return channel, ok
}

// fromPath applies §3.
func fromPath(execPath string, realpath func(string) (string, error)) (Channel, bool) {
	resolved := resolveSafely(execPath, realpath)
	// strings.ReplaceAll, NOT filepath.ToSlash: ToSlash replaces os.PathSeparator, which on
	// Linux is already "/", so it is a no-op there and a Windows path keeps its
	// backslashes. It converts correctly on Windows, so the mistake passes on a
	// developer's machine and fails in CI's Linux conformance job.
	normalised := strings.ToLower(strings.ReplaceAll(resolved, `\`, "/"))
	if strings.Contains(normalised, "/cellar/") || strings.Contains(normalised, "/.linuxbrew/") {
		return Homebrew, true
	}
	if strings.Contains(normalised, "/scoop/apps/") {
		return Scoop, true
	}
	// §3.2: only these two are path-detectable. A binding MUST NOT add a heuristic for the
	// other five — a new one would make two bindings answer differently for one path.
	return "", false
}

// Resolve reports the channel this binary was installed through (§5).
//
// The environment marker wins outright over the path heuristics. The second return value
// is false for the plain direct-download install, which is a normal answer rather than a
// failure — never an error (§R6).
func Resolve(cfg Config) (Channel, bool) {
	env := cfg.Env
	if !cfg.envSet && env == nil {
		env = environMap()
	}

	execPath := cfg.ExecPath
	if execPath == "" {
		if actual, err := os.Executable(); err == nil {
			execPath = actual
		}
	}

	realpath := cfg.Realpath
	if realpath == nil {
		realpath = filepath.EvalSymlinks
	}

	if channel, ok := fromEnv(env); ok {
		return channel, true
	}
	return fromPath(execPath, realpath)
}

// environMap reads the real process environment, for the zero-value Config only.
func environMap() map[string]string {
	env := map[string]string{}
	for _, entry := range os.Environ() {
		if name, value, found := strings.Cut(entry, "="); found {
			env[name] = value
		}
	}
	return env
}

// UpgradeHint returns §4's advice for a channel, as contract text.
//
// The second return value is false for a value outside §1's closed set. Go checks no
// exhaustiveness on a map lookup and has no non-empty string type, so an unknown Channel is
// reachable however the type is declared — reporting it beats inventing an eighth string.
func UpgradeHint(channel Channel) (string, bool) {
	hint, ok := hints[channel]
	return hint, ok
}
