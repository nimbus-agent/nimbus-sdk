import { describe, expect, test } from "bun:test";
import { MockGateway } from "./index.js";

describe("MockGateway", () => {
  test("callTool resolves to an empty object, whatever tool and input it is given", async () => {
    const gateway = new MockGateway();
    await expect(gateway.callTool("calendar_list", {})).resolves.toEqual({});
    await expect(gateway.callTool("drive_get", { id: "f1", depth: 2 })).resolves.toEqual({});
  });

  // A connector's test awaits the gateway call it is replacing, so the stand-in has to be
  // asynchronous too: a plain `{}` would pass an `await` but fail a `.then`.
  test("callTool returns a promise, as a real gateway call does", async () => {
    const pending = new MockGateway().callTool("calendar_list", {});
    expect(pending).toBeInstanceOf(Promise);
    await pending;
  });
});
