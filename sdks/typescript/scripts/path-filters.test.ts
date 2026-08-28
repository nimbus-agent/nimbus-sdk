/**
 * Holds `.github/path-filters.yml` and the `if:` guards in `ci.yml` to each other.
 *
 * This repository already guards its hand-maintained lists — `corpus-parity.test.ts` holds
 * `ci.yml`'s two guard lists, and Go's `golden_test.go` holds its `packages` list. A path
 * filter is the same shape of hazard with a worse consequence, because **it fails open**: a
 * filter that is too narrow means the job does not run, `ci-complete` reports green, and
 * nothing turns red to say so.
 *
 * So the assertions here are about the couplings a reader would not think to check, not
 * about the filters being "right" in general — that is what evaluating them against real
 * change sets is for.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { repoRoot } from "./paths.ts";

const FILTERS_PATH = ".github/path-filters.yml";
const WORKFLOW_PATH = ".github/workflows/ci.yml";

const readRepo = (p: string): string => readFileSync(join(repoRoot, p), "utf8");

/** The anchors expand into nested arrays; flatten and drop the anchor-only keys. */
function loadFilters(): Record<string, string[]> {
  const raw = parse(readRepo(FILTERS_PATH)) as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name === "common" || name === "spec") continue;
    out[name] = (value as (string | string[])[]).flat();
  }
  return out;
}

const filters = loadFilters();
const workflow = readRepo(WORKFLOW_PATH);

describe("path filters", () => {
  test("there are filters at all, and the anchors expanded", () => {
    // A parse that silently produced {} would make every assertion below vacuous.
    expect(Object.keys(filters).length).toBeGreaterThanOrEqual(5);
    for (const [name, patterns] of Object.entries(filters)) {
      expect(patterns.length, name).toBeGreaterThan(0);
      expect(
        patterns.every((p) => typeof p === "string"),
        name,
      ).toBe(true);
    }
  });

  test("every filter includes the workflow and this file", () => {
    // A change to ci.yml or to the filters themselves must run everything they gate, or the
    // change ships untested by the thing it changes.
    for (const [name, patterns] of Object.entries(filters)) {
      expect(patterns, name).toContain(WORKFLOW_PATH);
      expect(patterns, name).toContain(FILTERS_PATH);
    }
  });

  test("every filter includes docs/spec", () => {
    // `docs/spec` is not documentation. It is bundled into
    // sdks/python/src/nimbus_sdk/_data/spec by the hatch build hook and mirrored into
    // sdks/go/spec/data by `go generate ./spec`, so a spec change reaches all three
    // bindings — and the scaffolder too, because scaffold-python builds the SDK wheel from
    // the commit under test and installs it. That last one was missed on the first draft of
    // the filters and found by evaluating them against a real change set, which is why it
    // is asserted here rather than left to review.
    for (const [name, patterns] of Object.entries(filters)) {
      expect(patterns, `${name} would skip on a docs/spec change`).toContain("docs/spec/**");
    }
  });

  test("every filter a job names exists and is an output of the changes job", () => {
    // `needs.changes.outputs.typescrpit` is not an error in Actions — it is the empty
    // string, which never equals 'true', so the job silently never runs again and CI stays
    // green. This is the assertion that catches that.
    const named = [...workflow.matchAll(/needs\.changes\.outputs\.([A-Za-z0-9_-]+)/g)]
      .map((m) => m[1])
      .filter((name): name is string => name !== undefined);
    expect(named.length, "no job is gated on the filter at all").toBeGreaterThanOrEqual(7);

    const declared = [
      ...workflow.matchAll(/^ {6}([a-z-]+): \$\{\{ steps\.filter\.outputs\.([a-z-]+) \}\}$/gm),
    ];
    const outputs = new Set(declared.map((m) => m[1]));
    for (const match of declared) {
      // [0] is the whole line; the two capture groups are the output name and the step
      // output it reads. A copy-paste that left the source name behind would make an
      // output permanently empty, and therefore its job permanently skipped.
      const key = match[1];
      const source = match[2];
      expect(source, `changes.outputs.${key} reads steps.filter.outputs.${source}`).toBe(key);
    }
    for (const name of new Set(named)) {
      expect(outputs.has(name), `no changes.outputs.${name}`).toBe(true);
      expect(filters[name], `no filter named ${name}`).toBeDefined();
    }
  });

  test("every heavy job is gated, so a new one cannot quietly run on everything", () => {
    // The inverse of the test above: not "does every gate name a real filter" but "is every
    // job that costs a matrix actually gated". A new job added without an `if:` runs on
    // every pull request forever and nothing says so.
    for (const job of [
      "build-test",
      "node-smoke",
      "python",
      "go",
      "conformance",
      "scaffold-typescript",
      "scaffold-python",
    ]) {
      const block = workflow.slice(workflow.indexOf(`\n  ${job}:\n`));
      const head = block.slice(0, block.indexOf("steps:"));
      expect(head, `${job} is not gated on the changes filter`).toContain("needs.changes.outputs.");
    }
  });

  test("ci-complete fails when the filter itself did not succeed", () => {
    // Path filtering makes `skipped` a normal outcome, which removes the blanket check that
    // made ci-complete trustworthy. This is the narrower one that replaces it: a skip only
    // means "the filter said so" if the filter ran. Asserted on the workflow text because
    // the alternative is discovering it the one time a cancelled filter turns everything
    // green.
    expect(workflow).toContain("needs.changes.result != 'success'");
    expect(workflow).toContain("needs: [changes,");
  });
});
