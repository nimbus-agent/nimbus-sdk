import { describe, expect, test } from "bun:test";
import {
  checkAggregate,
  compareImpact,
  impactOfMessage,
  parseConventionalSubject,
} from "./conventional-commit.ts";

describe("parseConventionalSubject", () => {
  test("parses type and description", () => {
    expect(parseConventionalSubject("feat: add a thing")).toEqual({
      type: "feat",
      scope: undefined,
      breaking: false,
      description: "add a thing",
    });
  });

  test("parses a scope", () => {
    const parsed = parseConventionalSubject("fix(ipc): stop dropping the final frame");
    expect(parsed?.type).toBe("fix");
    expect(parsed?.scope).toBe("ipc");
  });

  test("parses the breaking marker, with and without a scope", () => {
    expect(parseConventionalSubject("feat!: drop Node 20")?.breaking).toBe(true);
    expect(parseConventionalSubject("feat(sdk)!: drop Node 20")?.breaking).toBe(true);
    expect(parseConventionalSubject("feat(sdk): keep Node 20")?.breaking).toBe(false);
  });

  test("tolerates surrounding whitespace", () => {
    expect(parseConventionalSubject("  docs: tidy  ")?.type).toBe("docs");
  });

  test("keeps a colon that belongs to the description", () => {
    expect(parseConventionalSubject("docs: spec: the wire format")?.description).toBe(
      "spec: the wire format",
    );
  });

  describe("rejects", () => {
    // Each of these would be silently dropped by release-please, which is the whole
    // failure mode — so each must be a parse failure here rather than a lenient accept.
    const rejected: ReadonlyArray<readonly [string, string]> = [
      ["the #59 aggregate subject", "Phase 1: lift the contract out of TypeScript — wire spec"],
      ["no type at all", "just some words"],
      ["an uppercase type", "Feat: add a thing"],
      ["a mixed-case type", "Feat(sdk): add a thing"],
      ["no space after the colon", "feat:add a thing"],
      ["an empty description", "feat: "],
      ["an empty scope", "feat(): add a thing"],
      ["a nested paren in the scope", "feat(a(b)): add a thing"],
      ["a type containing a digit", "feat2: add a thing"],
      ["a bare WIP subject", "wip"],
      ["an empty subject", ""],
    ];
    for (const [label, subject] of rejected) {
      test(label, () => {
        expect(parseConventionalSubject(subject)).toBeNull();
      });
    }
  });

  test("accepts a type it does not classify", () => {
    // `chore` moves no version position, but it is still a well-formed subject: rule 1
    // asks whether release-please can parse it, not whether it triggers a release.
    expect(parseConventionalSubject("chore(main): release sdk 1.9.0")?.type).toBe("chore");
  });
});

describe("impactOfMessage", () => {
  test("classifies by type", () => {
    expect(impactOfMessage("feat: a")).toBe("minor");
    expect(impactOfMessage("fix: a")).toBe("patch");
    expect(impactOfMessage("perf: a")).toBe("patch");
    expect(impactOfMessage("revert: a")).toBe("patch");
    expect(impactOfMessage("docs: a")).toBe("none");
    expect(impactOfMessage("chore: a")).toBe("none");
    expect(impactOfMessage("ci: a")).toBe("none");
  });

  test("the breaking marker outranks the type", () => {
    expect(impactOfMessage("docs!: a")).toBe("major");
  });

  test("honors a BREAKING CHANGE footer in the body", () => {
    expect(impactOfMessage("feat: a\n\nBREAKING CHANGE: the manifest shape moved")).toBe("major");
    expect(impactOfMessage("docs: a\n\nBREAKING-CHANGE: the manifest shape moved")).toBe("major");
  });

  test("ignores the phrase outside a footer position", () => {
    expect(impactOfMessage("feat: a\n\nThis is not a BREAKING CHANGE: really")).toBe("minor");
  });

  test("an unparseable subject contributes nothing", () => {
    expect(impactOfMessage("wip\n\nmore work")).toBe("none");
  });
});

describe("compareImpact", () => {
  test("orders none < patch < minor < major", () => {
    expect(compareImpact("none", "patch")).toBeLessThan(0);
    expect(compareImpact("patch", "minor")).toBeLessThan(0);
    expect(compareImpact("minor", "major")).toBeLessThan(0);
    expect(compareImpact("major", "none")).toBeGreaterThan(0);
    expect(compareImpact("minor", "minor")).toBe(0);
  });
});

describe("checkAggregate", () => {
  test("passes a single-commit PR whose subject matches its commit", () => {
    const verdict = checkAggregate({
      title: "feat(sdk): publish the sandbox probe protocol",
      commits: [{ sha: "4a6eba1c", message: "feat(sdk): publish the sandbox probe protocol" }],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.violations).toEqual([]);
  });

  test("reproduces the 1.9.0 regression: non-conventional aggregate over a feat stack", () => {
    const verdict = checkAggregate({
      title: "Phase 1: lift the contract out of TypeScript — wire spec and manifest rule registry",
      commits: [
        { sha: "a9c6a8a6", message: "docs(spec): publish the NDJSON framing wire spec (#56)" },
        { sha: "15ab4b22", message: "feat(sdk): publish the manifest rules as a registry (#57)" },
        { sha: "ddc2387e", message: "feat(sdk): publish the pure predicates (#60)" },
      ],
    });
    expect(verdict.ok).toBe(false);
    // Both rules fire: the subject does not parse, and it under-declares a minor.
    expect(verdict.violations).toHaveLength(2);
    expect(verdict.declared).toBe("none");
    expect(verdict.required).toBe("minor");
    expect(verdict.violations[1]).toContain("15ab4b22");
    expect(verdict.violations[1]).toContain("ddc2387e");
    // The docs commit is not an offender — it does not demand a minor.
    expect(verdict.violations[1]).not.toContain("a9c6a8a6");
  });

  test("fails a docs-titled stack that carries a feat", () => {
    const verdict = checkAggregate({
      title: "docs: lift the contract out of TypeScript",
      commits: [
        { sha: "aaaaaaaa", message: "docs(spec): the wire spec" },
        { sha: "bbbbbbbb", message: "feat(sdk): the rule registry" },
      ],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toHaveLength(1);
    expect(verdict.declared).toBe("none");
    expect(verdict.required).toBe("minor");
  });

  test("fails a feat-titled stack that carries a breaking change", () => {
    const verdict = checkAggregate({
      title: "feat(sdk): reshape the manifest",
      commits: [
        { sha: "aaaaaaaa", message: "feat(sdk): add a field" },
        { sha: "bbbbbbbb", message: "feat(sdk)!: drop the legacy permissions array" },
      ],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.required).toBe("major");
    expect(verdict.violations[0]).toContain("!");
  });

  test("fails when the breaking change is declared only in a body footer", () => {
    const verdict = checkAggregate({
      title: "fix(sdk): tighten the manifest check",
      commits: [
        {
          sha: "aaaaaaaa",
          message: "fix(sdk): tighten the manifest check\n\nBREAKING CHANGE: rejects empty ids",
        },
      ],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.required).toBe("major");
  });

  test("passes a correctly-declared stack", () => {
    const verdict = checkAggregate({
      title: "feat(sdk): lift the contract out of TypeScript",
      commits: [
        { sha: "aaaaaaaa", message: "docs(spec): the wire spec" },
        { sha: "bbbbbbbb", message: "feat(sdk): the rule registry" },
        { sha: "cccccccc", message: "feat(sdk): the pure predicates" },
      ],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.declared).toBe("minor");
    expect(verdict.required).toBe("minor");
  });

  test("allows over-declaring, which only over-bumps", () => {
    const verdict = checkAggregate({
      title: "feat(sdk): a generous subject",
      commits: [{ sha: "aaaaaaaa", message: "fix(sdk): a small fix" }],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.declared).toBe("minor");
    expect(verdict.required).toBe("patch");
  });

  test("passes a docs-only stack titled docs", () => {
    const verdict = checkAggregate({
      title: "docs: refresh the roadmap",
      commits: [
        { sha: "aaaaaaaa", message: "docs: past tense" },
        { sha: "bbbbbbbb", message: "docs: prune plans" },
      ],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.declared).toBe("none");
    expect(verdict.required).toBe("none");
  });

  test("passes release-please's own PR", () => {
    const verdict = checkAggregate({
      title: "chore(main): release sdk 1.9.0",
      commits: [{ sha: "2b2304c0", message: "chore(main): release sdk 1.9.0" }],
    });
    expect(verdict.ok).toBe(true);
  });

  test("reports unparseable commits as opaque without failing", () => {
    const verdict = checkAggregate({
      title: "fix(sdk): a small fix",
      commits: [
        { sha: "aaaaaaaa", message: "wip" },
        { sha: "bbbbbbbb", message: "fix(sdk): a small fix" },
      ],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.opaque).toEqual(["aaaaaaaa wip"]);
  });

  test("an empty commit list cannot under-declare", () => {
    const verdict = checkAggregate({ title: "chore: nothing", commits: [] });
    expect(verdict.ok).toBe(true);
    expect(verdict.required).toBe("none");
  });

  test("names the offending commits, not every commit", () => {
    const verdict = checkAggregate({
      title: "chore: a stack",
      commits: [
        { sha: "aaaaaaaa", message: "chore: noise" },
        { sha: "bbbbbbbb", message: "fix(sdk): a fix" },
        { sha: "cccccccc", message: "feat(sdk): a feature" },
      ],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations[0]).toContain("cccccccc");
    expect(verdict.violations[0]).not.toContain("aaaaaaaa");
    expect(verdict.violations[0]).not.toContain("bbbbbbbb");
  });
});
