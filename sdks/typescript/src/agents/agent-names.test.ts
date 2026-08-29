import { describe, expect, test } from "bun:test";
import { AGENT_KIND, AGENT_NAMES } from "./agent-names.js";

describe("agent names", () => {
  // A golden over the MODELLED subset, not over the gateway's roster. It catches an
  // unintended edit to the list; it cannot catch the list falling behind the gateway,
  // because this package cannot import the gateway to ask. Its old name — "all nine agents
  // are listed" — claimed the second thing while doing the first, and stayed green across
  // the five agent additions that made the claim false.
  test("the modelled subset is exactly these nine", () => {
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
