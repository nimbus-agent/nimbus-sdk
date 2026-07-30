/**
 * release.yml guard — the publisher tuple cannot drift from what the workflow does.
 *
 * `verify-python-publish` asserts the signing certificate names a particular GitHub
 * Environment. That expectation is a constant (`env.PYPI_ENVIRONMENT`), because
 * `jobs.<id>.environment` accepts only the github, needs, vars and inputs contexts —
 * not `env` — so the value cannot be an expression there.
 *
 * Left unguarded, renaming the environment makes the publish succeed and the *verify*
 * fail: a good release goes red, and fixing it needs a workflow edit rather than a
 * re-run. This asserts the relationship at every commit instead, so the drift fails on
 * the PR that introduces it.
 *
 * Sits beside release-config-guard.test.ts, which guards the release-please config the
 * same way — including its Python half. release.yml belongs to no single SDK.
 */
import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import { readFromRepo } from "./paths.ts";

/** `jobs.<id>.environment` is a bare string OR a map carrying `name` and optionally `url`. */
type JobEnvironment = string | { name?: string; url?: string } | undefined;

interface ReleaseWorkflow {
  env?: Record<string, string>;
  jobs: Record<string, { environment?: JobEnvironment; steps?: { name?: string }[] }>;
}

/**
 * The environment *name* a job deploys to, from either legal form.
 *
 * Adding `url:` alongside `name:` — which makes the deployment link clickable in the
 * GitHub UI — is an ordinary change, and a guard that understood only the string form
 * would reject it. That is a false alarm someone has to debug, which this repo's
 * existing guards are explicit about avoiding.
 *
 * Anything else yields `undefined` and fails the assertion loudly, rather than
 * comparing falsely equal to something.
 */
export function environmentName(environment: JobEnvironment): string | undefined {
  if (typeof environment === "string") {
    return environment;
  }
  // `typeof null === "object"`, so this null check is load-bearing, not defensive noise.
  if (typeof environment === "object" && environment !== null) {
    return environment.name;
  }
  return undefined;
}

const workflow = parse(readFromRepo(".github/workflows/release.yml")) as ReleaseWorkflow;

describe("the release workflow", () => {
  test("declares the PyPI environment exactly once, at workflow level", () => {
    // Bracket access: noPropertyAccessFromIndexSignature forbids dot access on an
    // index signature (workflow.env is Record<string, string>).
    expect(
      workflow.env?.["PYPI_ENVIRONMENT"],
      "release.yml must declare env.PYPI_ENVIRONMENT — verify-python-publish compares " +
        "the signing certificate against it",
    ).toBeDefined();
  });

  test("publish-python deploys to the environment the verifier expects", () => {
    // The load-bearing assertion. These two are the same fact stated twice because
    // GitHub gives no way to state it once; if they diverge, the publish succeeds and
    // the verification fails on an artifact that is perfectly fine.
    expect(
      environmentName(workflow.jobs["publish-python"]?.environment),
      "publish-python's environment name must equal env.PYPI_ENVIRONMENT",
    ).toBe(workflow.env?.["PYPI_ENVIRONMENT"] as string);
  });

  test("the environment name is read from either legal form", () => {
    // Pins the robustness above, so a later simplification back to a bare property read
    // fails here instead of on the PR that adds a `url:`.
    expect(environmentName("pypi")).toBe("pypi");
    expect(environmentName({ name: "pypi", url: "https://pypi.org/p/nimbus-dev-sdk" })).toBe(
      "pypi",
    );
    expect(environmentName(undefined)).toBeUndefined();
  });

  test("verify-python-publish still runs the cryptographic verification step", () => {
    // Guards against the step being renamed away or dropped in a refactor, which would
    // leave the job green while verifying nothing.
    const steps = (workflow.jobs["verify-python-publish"]?.steps ?? []).map((s) => s.name);
    expect(steps).toContain("Verify the PEP 740 attestation (cryptographic)");
  });
});
