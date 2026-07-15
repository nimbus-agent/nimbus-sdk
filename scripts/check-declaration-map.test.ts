import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

test("build emits declaration maps", () => {
  expect(existsSync("dist/index.d.ts.map")).toBe(true);
});
