import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { echo } from "./handlers.js";

describe("echo", () => {
  test("returns its input", async () => {
    assert.deepEqual(await echo({ text: "hello" }), { text: "hello" });
  });
});
