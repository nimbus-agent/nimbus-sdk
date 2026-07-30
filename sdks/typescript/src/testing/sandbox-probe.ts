/**
 * Sandbox probe binary — invoked by `runSandboxContractTests`.
 *
 * The probe is a tiny standalone program that the contract harness forks
 * (typically wrapped by the gateway's sandbox runner) to exercise one
 * specific capability and report the outcome via process exit code.
 *
 * Exit codes:
 *   0  — expected pass (network reach to a listed host succeeded)
 *   2  — unexpected outcome (test fails)
 *   10 — expected EACCES/EPERM on filesystem read (sandbox enforced)
 *   11 — expected ECONNREFUSED/EPERM/EHOSTUNREACH/ENETUNREACH on network
 *
 * Invocation:
 *   bun sandbox-probe.ts --probe=<name> --arg=<value>
 *
 * Probes:
 *   network-listed   — HEAD-fetch https://<arg>/ ; succeed if 2xx-4xx
 *   network-unlisted — fetch http://192.0.2.1 (TEST-NET-1); succeed if blocked
 *   fs-denied        — read a known-protected path; succeed if EACCES
 */

import { readFile } from "node:fs/promises";

import { fsDeniedExit, networkBlockedExit, SANDBOX_PROBE_EXIT } from "./sandbox-protocol.js";

// The first occurrence wins, which is what `find` does — and is normative, so that a
// binding using a "last wins" argument parser is not quietly incompatible.
const probe = process.argv.find((a) => a.startsWith("--probe="))?.slice(8);
const arg = process.argv.find((a) => a.startsWith("--arg="))?.slice(6);

function errorCode(e: unknown): string | undefined {
  return (
    (e as { code?: string; cause?: { code?: string } }).code ??
    (e as { cause?: { code?: string } }).cause?.code
  );
}

async function probeNetworkListed(): Promise<number> {
  const url = `https://${arg ?? ""}/`;
  try {
    const res = await fetch(url, { method: "HEAD" });
    // A reachability probe, not an authorization one: 401 and 404 both prove the host was
    // reached, so only 5xx and transport failures count against it.
    return res.status >= 200 && res.status < 500
      ? SANDBOX_PROBE_EXIT.pass
      : SANDBOX_PROBE_EXIT.unexpected;
  } catch {
    return SANDBOX_PROBE_EXIT.unexpected;
  }
}

async function probeNetworkUnlisted(): Promise<number> {
  try {
    // 192.0.2.1 is RFC 5737 TEST-NET-1 — unroutable by definition, so this is
    // an egress-block probe that must never establish a connection. https
    // rather than http: the outcome is decided at TCP connect (the error codes
    // below), well before any TLS handshake, so the scheme is behaviourally
    // irrelevant here and the secure one avoids modelling a cleartext call.
    await fetch("https://192.0.2.1");
    return SANDBOX_PROBE_EXIT.unexpected;
  } catch (e: unknown) {
    return networkBlockedExit(errorCode(e));
  }
}

async function probeFsDenied(): Promise<number> {
  const path =
    process.platform === "win32" ? String.raw`C:\Windows\System32\config\SAM` : "/etc/passwd";
  try {
    // `node:fs/promises`, not `Bun.file`. The harness spawns the CONSUMER's `execPath`, and
    // this package ships a dist/ that CI runs on a Node LTS matrix. Under Node the Bun
    // global threw a ReferenceError that this very `catch` swallowed — and a ReferenceError
    // carries no `code`, so it was classified as an unexpected outcome and surfaced to the
    // author as a sandbox failure. See RFC-0004 §8.
    await readFile(path, "utf8");
    return SANDBOX_PROBE_EXIT.unexpected;
  } catch (e: unknown) {
    return fsDeniedExit(errorCode(e));
  }
}

async function main(): Promise<void> {
  if (probe === "network-listed") process.exit(await probeNetworkListed());
  if (probe === "network-unlisted") process.exit(await probeNetworkUnlisted());
  if (probe === "fs-denied") process.exit(await probeFsDenied());
  // Every outcome the protocol does not name — including an unknown probe and a missing
  // --probe — is `unexpected`, never a code of the probe's own invention.
  process.exit(SANDBOX_PROBE_EXIT.unexpected);
}

await main();
