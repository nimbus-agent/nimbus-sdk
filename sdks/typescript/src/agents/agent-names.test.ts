import { describe, expect, test } from "bun:test";
import { AGENT_KIND, AGENT_NAMES } from "./agent-names.js";

describe("agent names", () => {
  test("all nine agents are listed", () => {
    expect([...AGENT_NAMES]).toEqual([
      "expert",
      "impact",
      "catchup",
      "ghost",
      "conflicts",
      "huddle",
      "janitor",
      "preflight",
      "why",
    ]);
  });

  test("conflicts emits the singular kind — the one name that is not its agent", () => {
    expect(AGENT_KIND.conflicts).toBe("conflict");
  });

  test("every other agent's kind equals its name", () => {
    for (const name of AGENT_NAMES) {
      if (name === "conflicts") continue;
      expect(AGENT_KIND[name]).toBe(name);
    }
  });
});
