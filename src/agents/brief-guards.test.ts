import { describe, expect, test } from "bun:test";
import { AGENT_NAMES } from "./agent-names.ts";
import { BRIEF_GUARDS, isConflictBrief, isExpertBrief } from "./brief-guards.ts";

const base = { agentVersion: 1, generatedAt: 1, latencyMs: 1, gaps: [] };

describe("brief guards", () => {
  test("a well-formed expert brief is accepted", () => {
    expect(
      isExpertBrief({ ...base, kind: "expert", query: { topicOrFile: "x" }, ranked: [] }),
    ).toBe(true);
  });

  test("a brief missing query is rejected — every gateway guard is strict", () => {
    expect(isExpertBrief({ ...base, kind: "expert", ranked: [] })).toBe(false);
  });

  test("the wrong kind is rejected", () => {
    expect(isExpertBrief({ ...base, kind: "impact", query: {}, ranked: [] })).toBe(false);
  });

  test("a conflicts brief carries the singular kind", () => {
    expect(
      isConflictBrief({ ...base, kind: "conflict", query: { file: "a" }, collisions: [] }),
    ).toBe(true);
    expect(
      isConflictBrief({ ...base, kind: "conflicts", query: { file: "a" }, collisions: [] }),
    ).toBe(false);
  });

  test("BRIEF_GUARDS has an entry per agent", () => {
    for (const name of AGENT_NAMES) expect(typeof BRIEF_GUARDS[name]).toBe("function");
  });
});
