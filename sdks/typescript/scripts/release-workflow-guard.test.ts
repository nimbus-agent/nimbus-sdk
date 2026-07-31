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
  jobs: Record<string, { environment?: JobEnvironment; steps?: { name?: string; run?: string }[] }>;
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
const ciWorkflow = parse(readFromRepo(".github/workflows/ci.yml")) as ReleaseWorkflow;

/** Every `run:` script in a workflow, flattened across all jobs, tagged with its job id. */
function runScripts(parsed: ReleaseWorkflow): { job: string; run: string }[] {
  return Object.entries(parsed.jobs).flatMap(([job, definition]) =>
    (definition.steps ?? [])
      .map((step) => step.run)
      .filter((run): run is string => typeof run === "string")
      .map((run) => ({ job, run })),
  );
}

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

  // The gate is the *more* consequential of the two steps guarded in this file — it
  // prevents a bad build from ever reaching PyPI, where a publish can never be undone,
  // rather than merely reporting damage after the fact the way verify-python-publish
  // does. Guarding only the verifier and not this would be backwards.
  test("publish-python runs the pre-publish dist gate (scripts/gate_dist.py)", () => {
    // Matched by its `run:` command rather than its `name:` string: a cosmetic rename
    // of the step (e.g. "Gate the built distributions" -> "Gate dist/") must not make
    // this guard go blind to the step being deleted outright.
    const steps = workflow.jobs["publish-python"]?.steps ?? [];
    const gateIndex = steps.findIndex((step) => step.run?.includes("scripts/gate_dist.py"));
    expect(
      gateIndex,
      "publish-python must run scripts/gate_dist.py — deleting this step lets a bad " +
        "build ship permanently while every gate_dist.py unit test keeps passing, " +
        "since none of them exercise the workflow itself",
    ).toBeGreaterThanOrEqual(0);
  });

  // Cross-workflow, and deliberately not scoped to release.yml alone. The 0.1.2 release
  // failed because ci.yml's python job installed verify-requirements.txt and
  // release.yml's publish-python did not, while both ran `python -m mypy` over a tree
  // containing scripts/verify_publish.py. Guarding one file would leave the same drift
  // reachable from the other direction, so the invariant is stated over both: whoever
  // runs mypy installs what mypy needs.
  //
  // Reachability is the whole point. publish-python runs only when release-please cuts a
  // Python version, so no pull request executes it — the gap survived from the commit
  // that added the imports until the next release, invisible to every check. This test
  // runs on every PR, which is the only place the relationship can be caught in time.
  test("every job that runs mypy also installs verify-requirements.txt", () => {
    const offenders = [
      { file: ".github/workflows/ci.yml", parsed: ciWorkflow },
      { file: ".github/workflows/release.yml", parsed: workflow },
    ].flatMap(({ file, parsed }) =>
      runScripts(parsed)
        .filter(({ run }) => run.includes("python -m mypy"))
        // Same job, not merely the same file: the install and the mypy invocation must
        // share a runner. A sibling job installing it does this one no good.
        .filter(
          ({ job }) =>
            !runScripts(parsed).some(
              (step) => step.job === job && step.run.includes("verify-requirements.txt"),
            ),
        )
        .map(({ job }) => `${file}: job ${job}`),
    );

    expect(
      offenders,
      "mypy is strict and type-checks scripts/verify_publish.py, which imports " +
        "pypi_attestations, sigstore, cryptography and pyasn1 — none provided by " +
        "`pip install -e .`, since this package is dependency-free by policy. A job " +
        "running mypy without those installed fails on missing imports.",
    ).toEqual([]);
  });

  test("the mypy guard is load-bearing — it finds the jobs it claims to check", () => {
    // Without this, the assertion above passes vacuously the day someone renames the
    // mypy invocation: an empty offender list would read as "everything is fine".
    const mypyJobs = [ciWorkflow, workflow].flatMap((parsed) =>
      runScripts(parsed).filter(({ run }) => run.includes("python -m mypy")),
    );
    expect(
      mypyJobs.length,
      "no workflow job runs `python -m mypy` — either the Python type-check was dropped " +
        "from CI, or its invocation was reworded and the guard above now checks nothing",
    ).toBeGreaterThanOrEqual(2);
  });

  test("the dist gate runs before the PyPI publish step", () => {
    const steps = workflow.jobs["publish-python"]?.steps ?? [];
    const gateIndex = steps.findIndex((step) => step.run?.includes("scripts/gate_dist.py"));
    const publishIndex = steps.findIndex(
      (step) => step.name === "Publish to PyPI with attestations",
    );
    expect(
      publishIndex,
      "publish-python must still contain the 'Publish to PyPI with attestations' step",
    ).toBeGreaterThanOrEqual(0);
    expect(
      gateIndex,
      "the gate must run BEFORE the publish step — a gate that runs after the upload " +
        "cannot stop a bad build from shipping, since PyPI can never re-upload a version",
    ).toBeLessThan(publishIndex);
  });
});
