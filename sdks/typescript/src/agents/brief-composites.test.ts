import { describe, expect, test } from "bun:test";
import type { WhyBrief } from "./brief-composites.js";
import { isWhyBrief } from "./brief-guards.js";
import type { WhyChangeSubject } from "./brief-types.js";

const base = { agentVersion: 1 as const, generatedAt: 1, latencyMs: 1, gaps: [] };

/**
 * The non-breaking claim, enforced rather than asserted: a `WhyBrief` written
 * before `changeSubject` existed must still satisfy the type. If this file ever
 * stops compiling, the field stopped being optional and the release stopped
 * being a minor.
 */
const legacy: WhyBrief = {
  ...base,
  kind: "why",
  query: { ref: "src/a.ts", line: 12 },
  subject: { repoRoot: "/repo", filePath: "src/a.ts", lineNo: 12, symbol: null },
  findings: [],
};

const changeSubject: WhyChangeSubject = {
  itemId: "github:acme/web#482",
  entityId: "ent_1",
  repo: "acme/web",
  number: 482,
  url: "https://github.com/acme/web/pull/482",
  title: "Cache the resolver",
  modifiedAt: 1_700_000_000_000,
};

const fromPr: WhyBrief = {
  ...base,
  kind: "why",
  query: { ref: "https://github.com/acme/web/pull/482", line: null },
  subject: null,
  changeSubject,
  findings: [],
};

describe("WhyBrief.changeSubject", () => {
  test("a brief written without it is still a WhyBrief", () => {
    expect(legacy.changeSubject).toBeUndefined();
    expect(isWhyBrief(legacy)).toBe(true);
  });

  test("a brief carrying it is still a WhyBrief", () => {
    expect(isWhyBrief(fromPr)).toBe(true);
  });

  /**
   * `isWhyBrief` checks the wire shape (`kind`, `agentVersion`, `gaps`,
   * `generatedAt`, `latencyMs`, `query`, and `findings` being an array). An
   * optional field needs no guard clause, and adding one would reject the
   * legacy brief above. Pinned so a future edit to `brief-guards.ts` has to
   * argue with a test rather than with a comment.
   */
  test("the guard does not require the new field", () => {
    const { changeSubject: _dropped, ...withoutIt } = fromPr;
    expect(isWhyBrief(withoutIt)).toBe(true);
  });

  test("null is distinguishable from absent", () => {
    const explicitlyNone: WhyBrief = { ...legacy, changeSubject: null };
    expect(explicitlyNone.changeSubject).toBeNull();
    expect(isWhyBrief(explicitlyNone)).toBe(true);
  });

  /**
   * A DIFFERENT axis from the test above: that one is about `changeSubject`
   * itself being null versus absent; this one is about its members being null.
   * `number` and `modifiedAt` are `number | null` because a connector may index
   * a pull request without either, and null must survive the round trip as a
   * value rather than being confused with an omitted field.
   */
  test("nullable members accept null", () => {
    const sparse: WhyChangeSubject = {
      ...changeSubject,
      number: null,
      modifiedAt: null,
    };
    const brief: WhyBrief = { ...fromPr, changeSubject: sparse };
    expect(brief.changeSubject?.number).toBeNull();
    expect(brief.changeSubject?.modifiedAt).toBeNull();
    expect(isWhyBrief(brief)).toBe(true);
  });
});
