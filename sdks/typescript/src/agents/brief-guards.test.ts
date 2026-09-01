import { describe, expect, test } from "bun:test";
import { AGENT_KIND, AGENT_NAMES, type AgentName } from "./agent-names.js";
import type { AgentBrief, BriefFor, ExpertBrief, WhyBrief } from "./brief-composites.js";
import { BRIEF_GUARDS, isConflictBrief, isExpertBrief, isWhyBrief } from "./brief-guards.js";

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
  why: {
    brief: {
      ...base,
      kind: "why",
      query: { ref: "src/a.ts", line: null },
      subject: null,
      findings: [],
    },
    distinguishing: ["findings"],
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

  // `expert` grows an item arm alongside its free-text one. Typed, so
  // `tsc --noEmit` is what proves `itemUrl` is part of the contract.
  test("an expert brief may record the item it was asked about", () => {
    const brief: ExpertBrief = {
      ...base,
      kind: "expert",
      query: {
        topicOrFile: "https://acme.atlassian.net/browse/PLAT-9",
        itemUrl: "https://acme.atlassian.net/browse/PLAT-9",
      },
      ranked: [],
    };
    expect(isExpertBrief(brief)).toBe(true);
  });

  test("the free-text expert arm is unchanged", () => {
    const brief: ExpertBrief = {
      ...base,
      kind: "expert",
      query: { topicOrFile: "src/clip.ts" },
      ranked: [],
    };
    expect(isExpertBrief(brief)).toBe(true);
  });

  // `why` answers three input arms and carries one subject field per arm. The
  // guard must accept every valid combination: enforcing "exactly one" here
  // would reject a fourth arm this package has not heard of yet.
  describe("why subject arms", () => {
    const whyBase = {
      ...base,
      kind: "why" as const,
      query: { ref: "https://acme.atlassian.net/browse/PLAT-9", line: null },
      findings: [],
    };
    const itemSubject = {
      itemId: "jira:PLAT-9",
      entityId: "e1",
      number: 9,
      url: "https://acme.atlassian.net/browse/PLAT-9",
      title: "Checkout times out",
      modifiedAt: 1_700_000_000_000,
      service: "jira",
      type: "issue",
    };
    const changeSubject = {
      itemId: "github:acme/web#482",
      entityId: "e2",
      repo: "acme/web",
      number: 482,
      url: "https://github.com/acme/web/pull/482",
      title: "Cache the checkout lookup",
      modifiedAt: 1_700_000_000_000,
    };
    const subject = { repoRoot: "/r", filePath: "src/a.ts", lineNo: 1, symbol: null };

    test("accepts a brief carrying the item subject", () => {
      // Typed, so `tsc --noEmit` proves `itemSubject` is part of the contract —
      // the guard alone would accept an unknown extra field and prove nothing.
      const brief: WhyBrief = { ...whyBase, subject: null, itemSubject };
      expect(isWhyBrief(brief)).toBe(true);
    });

    test("accepts all four valid subject combinations", () => {
      const refArm: WhyBrief = { ...whyBase, subject };
      const changeArm: WhyBrief = { ...whyBase, subject: null, changeSubject };
      const itemArm: WhyBrief = { ...whyBase, subject: null, itemSubject };
      const unresolved: WhyBrief = {
        ...whyBase,
        subject: null,
        changeSubject: null,
        itemSubject: null,
      };
      for (const brief of [refArm, changeArm, itemArm, unresolved]) {
        expect(isWhyBrief(brief)).toBe(true);
      }
    });
  });

  test("every AGENT_KIND value matches the fixture's kind field", () => {
    for (const name of AGENT_NAMES) {
      const kind = (FIXTURES[name].brief as AgentBrief).kind;
      expect(kind).toBe(AGENT_KIND[name]);
    }
  });
});
