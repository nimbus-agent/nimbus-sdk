import { expect, test } from "bun:test";
import manifest from "../.release-please-manifest.json";
import pkg from "../package.json";

test("package identity is standalone nimbus-sdk", () => {
  expect(pkg.name).toBe("@nimbus-dev/sdk");
  expect(pkg.license).toBe("MIT");
  expect(pkg.repository.url).toBe("git+https://github.com/nimbus-agent/nimbus-sdk.git");
  expect((pkg.repository as Record<string, unknown>).directory).toBeUndefined();
  expect((pkg as Record<string, unknown>).dependencies).toBeUndefined();
});

test("package.json version tracks the release-please manifest baseline", () => {
  // release-please owns the version and updates package.json and the manifest
  // in the same commit, so the two must agree. Asserting a hardcoded literal
  // here breaks on every release: bumping the version is precisely what a
  // release PR does, so the check fails on the one PR that must pass. That is
  // not hypothetical — a hardcoded "1.3.0" blocked the 1.4.0 release PR. It
  // passed until now only because this repo was extracted from the monorepo
  // already at 1.3.0, which made the first release a no-op bump and hid the
  // landmine. Mirrors nimbus-client's check-package-identity.test.ts.
  expect(pkg.version).toBe(manifest["."]);
});
