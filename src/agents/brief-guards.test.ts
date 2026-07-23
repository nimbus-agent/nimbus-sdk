import { describe, expect, test } from "bun:test";
import { AGENT_KIND, AGENT_NAMES, type AgentName } from "./agent-names.js";
import type { AgentBrief, BriefFor } from "./brief-composites.js";
import { BRIEF_GUARDS, isConflictBrief, isExpertBrief } from "./brief-guards.js";

const base = { agentVersion: 1 as const, generatedAt: 1, latencyMs: 1, gaps: [] };

/**
 * A minimal well-formed brief per agent, plus the field(s) that distinguish
 * its guard from every other guard. Deleting any one of `distinguishing`
 * from the fixture must flip its own guard from accept to reject.
 */
const FIXTURES: { [A in AgentName]: { brief: BriefFor<A>; distinguishing: string[] } } = {
  expert: {
    brief: { ...base, kind: "expert", query: { topicOrFile: "x" }, ranked: [] },
    distinguishing: ["ranked"],
  },
  impact: {
    brief: {
      ...base,
      kind: "impact",
      query: { fileOrPrUrl: "x" },
      startEntityId: null,
      affected: [],
    },
    distinguishing: ["affected"],
  },
  catchup: {
    brief: {
      ...base,
      kind: "catchup",
      query: { sinceMs: 1 },
      selfPersonId: null,
      involvement: {
        ownedServices: [],
        activeRepos: [],
        incidentServices: [],
        collaboratorPersonIds: [],
      },
      sections: [],
    },
    distinguishing: ["sections"],
  },
  ghost: {
    brief: {
      ...base,
      kind: "ghost",
      query: { file: "x" },
      startEntityId: null,
      findings: [],
    },
    distinguishing: ["findings"],
  },
  conflicts: {
    brief: {
      ...base,
      kind: "conflict",
      query: { file: "x" },
      startEntityId: null,
      collisions: [],
    },
    distinguishing: ["collisions"],
  },
  huddle: {
    brief: { ...base, kind: "huddle", query: { sinceMs: 1 }, contributions: [] },
    distinguishing: ["contributions"],
  },
  janitor: {
    brief: {
      ...base,
      kind: "janitor",
      query: { resourceRef: "x", idleDays: 1 },
      idle: false,
      proposalSuppressed: false,
      cleanupAction: null,
      peersClear: 0,
      peersTouched: [],
    },
    distinguishing: ["idle", "peersTouched"],
  },
  preflight: {
    brief: {
      ...base,
      kind: "preflight",
      query: { ref: "x", namespace: "x" },
      downstreams: [],
      anyFailed: false,
      anyIncomplete: false,
    },
    distinguishing: ["downstreams", "anyFailed", "anyIncomplete"],
  },
};

describe("brief guards", () => {
  // Preserved from the original test — exact real-world payloads for the two
  // guards whose kind differs from the singular/plural naming trap.
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

  // `describe.each`/`test.each` take a mutable `unknown[]`, which both rejects
  // the `readonly` AGENT_NAMES tuple and widens the callback param to `any` —
  // silently erasing type-checking on every `FIXTURES[name]`/`BRIEF_GUARDS[name]`
  // lookup below. Plain loops keep `name` as the literal `AgentName` union.
  for (const name of AGENT_NAMES) {
    describe(name, () => {
      const { brief, distinguishing } = FIXTURES[name];
      const guard = BRIEF_GUARDS[name];

      test("a minimal well-formed brief is accepted", () => {
        expect(guard(brief)).toBe(true);
      });

      for (const field of distinguishing) {
        test(`rejects when ${field} is missing`, () => {
          const broken = { ...(brief as unknown as Record<string, unknown>) };
          delete broken[field];
          expect(guard(broken)).toBe(false);
        });
      }

      test("rejects the wrong kind", () => {
        const wrongKind = {
          ...(brief as unknown as Record<string, unknown>),
          kind: "not-a-kind",
        };
        expect(guard(wrongKind)).toBe(false);
      });

      test("BRIEF_GUARDS[name] is this agent's guard and no other's — accepts only its own brief", () => {
        for (const other of AGENT_NAMES) {
          const expected = other === name;
          expect(guard(FIXTURES[other].brief)).toBe(expected);
        }
      });
    });
  }

  test("every AGENT_KIND value matches the fixture's kind field", () => {
    for (const name of AGENT_NAMES) {
      const kind = (FIXTURES[name].brief as AgentBrief).kind;
      expect(kind).toBe(AGENT_KIND[name]);
    }
  });
});
