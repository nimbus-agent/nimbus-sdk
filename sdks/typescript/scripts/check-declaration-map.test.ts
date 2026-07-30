import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./paths.ts";

test("build emits declaration maps", () => {
  expect(existsSync(join(packageRoot, "dist/index.d.ts.map"))).toBe(true);
});
