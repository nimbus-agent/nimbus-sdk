// Package distributionchannel binds the Nimbus distribution-channel battery.
//
// Normative document: docs/spec/batteries/v1/distribution-channel.md, whose preamble is
// docs/spec/batteries/v1/README.md. The executable form is the corpus at
// docs/spec/conformance/v1/distribution-channel/, which sdks/go/conformance runs in full —
// all 27 cases, from the same index.json the TypeScript and Python bindings read.
//
// It reports which package manager installed the running binary, so the self-updater can
// step aside and let that package manager own updates. An absence is the plain
// direct-download install, where the self-updater stays enabled: a normal answer rather
// than a failure.
//
// # Everything it reads is injected
//
// This is the first Nimbus battery that reads the outside world — the environment, the
// running executable's path, and the filesystem — so §R1 of the preamble requires all
// three to be supplied by the caller. Config carries them; its zero value reads the real
// process, and that default is deliberately outside the conformance corpus, because a case
// whose expected answer is "whatever this host happens to be" pins nothing.
//
// # Three things this binding must do that the obvious Go does not
//
// Backslashes are normalised with strings.ReplaceAll, never filepath.ToSlash. ToSlash
// replaces os.PathSeparator, which on Linux is already "/" — so it is a no-op there and a
// Windows path keeps its backslashes, and the §3 segment test never matches. It does the
// right thing on Windows, so the mistake passes on a developer's machine and fails in CI.
//
// A resolver that fails yields the input path unchanged (§3.1), and that is handled here
// rather than expected of the resolver. The TypeScript reference had the equivalent catch
// inside its DEFAULT resolver only, so the guarantee held in production and failed for
// every injected one; the corpus is what found that.
//
// The marker comparison is exact (§2): no trimming, no case folding, no aliasing. An
// unrecognised value is IGNORED rather than treated as "detection off", so the path
// heuristics still run — an operator who set NIMBUS_DISTRIBUTION_CHANNEL to "brew" has
// failed to set it, not disabled anything.
//
// Frozen per RFC-0015's mechanical definition: backed by a normative document under
// docs/spec/ and executed by a conformance-corpus guard. Both have held since the corpus
// went green in all three bindings.
//
// Stability: frozen
package distributionchannel
