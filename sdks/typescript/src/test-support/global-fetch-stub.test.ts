import { afterEach, describe, expect, test } from "bun:test";

import { restoreGlobalFetch, stubGlobalFetch } from "./global-fetch-stub.js";

describe("stubGlobalFetch / restoreGlobalFetch", () => {
  afterEach(restoreGlobalFetch);

  test("hands the intercepted url and init to the handler and resolves with its Response", async () => {
    // Collected into an array rather than a `let ... | null`: TypeScript does not track an
    // assignment made inside a callback, so the nullable form narrows to `null` at the
    // assertion and stops compiling.
    const seen: { url: string; method: string | undefined }[] = [];
    stubGlobalFetch((url, init) => {
      seen.push({ url, method: init?.method });
      return new Response("stubbed", { status: 418 });
    });

    const res = await fetch("https://x.example/y", { method: "POST" });

    expect(seen).toEqual([{ url: "https://x.example/y", method: "POST" }]);
    expect(res.status).toBe(418);
    expect(await res.text()).toBe("stubbed");
  });

  test("a handler returning a promise is awaited rather than leaked to the caller", async () => {
    stubGlobalFetch(async () => new Response("async", { status: 200 }));
    expect(await (await fetch("https://x.example")).text()).toBe("async");
  });

  test("restore reinstates the real fetch even after a re-stub, not the previous stub", () => {
    // The whole suite runs in one process, so a stub left installed by one file is still
    // installed for every file after it. Two stubs before one restore is the case that
    // separates a module-load capture from a capture taken inside `stubGlobalFetch`: the
    // lazy version would record the FIRST stub as the original and "restore" to that,
    // handing the next file a fake `fetch` that looks restored. A single stub/restore pair
    // passes either way, which is why this stubs twice.
    const real = globalThis.fetch;

    stubGlobalFetch(() => new Response("first"));
    const firstStub = globalThis.fetch;
    expect(firstStub).not.toBe(real);

    stubGlobalFetch(() => new Response("second"));
    expect(globalThis.fetch).not.toBe(firstStub);

    restoreGlobalFetch();

    expect(globalThis.fetch).toBe(real);
  });
});
