import { expect, test } from "bun:test";
import pkg from "../package.json";
import { readFromRepo } from "./paths.ts";

const manifest = JSON.parse(readFromRepo(".release-please-manifest.json")) as Record<
  string,
  string
>;

test("package identity is standalone nimbus-sdk", () => {
  expect(pkg.name).toBe("@nimbus-dev/sdk");
  expect(pkg.license).toBe("MIT");
  expect(pkg.repository.url).toBe("git+https://github.com/nimbus-agent/nimbus-sdk.git");
  // Bracket access: noPropertyAccessFromIndexSignature forbids dot access on an
  // index signature.
  // The package lives in a monorepo subdirectory, so `directory` tells npm and GitHub
  // where its README and sources actually are. It was asserted absent while the package
  // sat at the repository root; the move to sdks/typescript inverted that.
  expect((pkg.repository as Record<string, unknown>)["directory"]).toBe("sdks/typescript");
  // Asserted absent: enforces the dependency-free rule for the published surface.
  expect((pkg as Record<string, unknown>)["dependencies"]).toBeUndefined();
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
  // noUncheckedIndexedAccess widens the lookup to `string | undefined`; the key is
  // known present because it is the package's path in release-please-config.json — it
  // moved from "." to "sdks/typescript" when the SDK moved, and release-please owns both
  // this manifest and package.json, updating them together in the same commit, so the
  // two must agree.
  expect(pkg.version).toBe(manifest["sdks/typescript"] as string);
});
