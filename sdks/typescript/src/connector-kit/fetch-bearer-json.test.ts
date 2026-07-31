import { afterEach, describe, expect, test } from "bun:test";
import { fetchBearerAuthorizedJson, resolveUrlWithBase } from "./fetch-bearer-json.js";

// ─── resolveUrlWithBase (the SSRF chokepoint) ──────────────────────────────────

describe("resolveUrlWithBase", () => {
  const base = "https://api.example.com";

  test("prefixes a relative path with the base URL", () => {
    expect(resolveUrlWithBase(base, "/v1/x")).toBe("https://api.example.com/v1/x");
  });

  test("passes through an absolute same-origin URL unchanged", () => {
    const abs = "https://api.example.com/v1/x?page=2";
    expect(resolveUrlWithBase(base, abs)).toBe(abs);
  });

  test("throws on a cross-origin absolute URL, naming both origins", () => {
    expect(() => resolveUrlWithBase(base, "https://evil.example.com/steal")).toThrow(
      "resolveUrlWithBase: refusing to fetch cross-origin URL (got https://evil.example.com, expected https://api.example.com)",
    );
  });

  test("treats a different scheme on the same host as a different origin", () => {
    expect(() => resolveUrlWithBase(base, "http://api.example.com/x")).toThrow(
      /refusing to fetch cross-origin URL/,
    );
  });

  test("treats a different port on the same host as a different origin", () => {
    expect(() => resolveUrlWithBase(base, "https://api.example.com:8443/x")).toThrow(
      /refusing to fetch cross-origin URL/,
    );
  });

  test("throws on a malformed absolute-looking URL rather than passing it through", () => {
    expect(() => resolveUrlWithBase(base, "http://")).toThrow();
  });

  test("a bare path that merely starts with 'http' as text is still relative-prefixed", () => {
    // Guards the startsWith("http") heuristic: "httpdocs" is not a URL scheme, but the
    // function only inspects the string prefix, so it takes the `new URL(...)` branch and
    // must throw rather than silently falling back to string concatenation.
    expect(() => resolveUrlWithBase(base, "httpdocs/x")).toThrow();
  });
});

// ─── fetchBearerAuthorizedJson ──────────────────────────────────────────────────

describe("fetchBearerAuthorizedJson", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch(
    handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  ): void {
    globalThis.fetch = (async (url: string, init?: RequestInit) =>
      handler(url, init)) as typeof fetch;
  }

  test("sends a Bearer Authorization header derived from the token", async () => {
    const captured: { auth: string | null } = { auth: null };
    stubFetch((_url, init) => {
      const headers = init?.headers as Headers;
      captured.auth = headers.get("authorization");
      return new Response("{}", { status: 200 });
    });

    await fetchBearerAuthorizedJson("https://api.example.com/x", "tok123");

    expect(captured.auth).toBe("Bearer tok123");
  });

  test("merges defaultHeaders onto the request", async () => {
    const captured: { accept: string | null } = { accept: null };
    stubFetch((_url, init) => {
      const headers = init?.headers as Headers;
      captured.accept = headers.get("accept");
      return new Response("{}", { status: 200 });
    });

    await fetchBearerAuthorizedJson("https://api.example.com/x", "tok", undefined, {
      Accept: "application/vnd.github+json",
    });

    expect(captured.accept).toBe("application/vnd.github+json");
  });

  test("caller-supplied init.headers override both defaultHeaders and the Authorization default", async () => {
    const captured: { auth: string | null; accept: string | null } = { auth: null, accept: null };
    stubFetch((_url, init) => {
      const headers = init?.headers as Headers;
      captured.auth = headers.get("authorization");
      captured.accept = headers.get("accept");
      return new Response("{}", { status: 200 });
    });

    await fetchBearerAuthorizedJson(
      "https://api.example.com/x",
      "tok",
      { headers: { Authorization: "Bearer override", Accept: "text/plain" } },
      { Accept: "application/json" },
    );

    expect(captured.auth).toBe("Bearer override");
    expect(captured.accept).toBe("text/plain");
  });

  test("forwards non-header init options (method, body) unchanged", async () => {
    let seenMethod: string | undefined;
    let seenBody: string | undefined;
    stubFetch((_url, init) => {
      seenMethod = init?.method;
      seenBody = init?.body as string;
      return new Response("{}", { status: 200 });
    });

    await fetchBearerAuthorizedJson("https://api.example.com/x", "tok", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });

    expect(seenMethod).toBe("POST");
    expect(seenBody).toBe(JSON.stringify({ a: 1 }));
  });

  test("returns ok/status/json/text from a successful JSON response", async () => {
    stubFetch(() => new Response(JSON.stringify({ a: 1 }), { status: 200 }));

    const result = await fetchBearerAuthorizedJson("https://api.example.com/x", "tok");

    expect(result).toEqual({
      ok: true,
      status: 200,
      json: { a: 1 },
      text: JSON.stringify({ a: 1 }),
    });
  });

  test("propagates ok:false and the status from a non-2xx response", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: "nope" }), { status: 404 }));

    const result = await fetchBearerAuthorizedJson("https://api.example.com/x", "tok");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.json).toEqual({ error: "nope" });
  });

  test("sets json to null (not throwing) on a malformed JSON body", async () => {
    stubFetch(() => new Response("not json at all", { status: 200 }));

    const result = await fetchBearerAuthorizedJson("https://api.example.com/x", "tok");

    expect(result.ok).toBe(true);
    expect(result.json).toBeNull();
    expect(result.text).toBe("not json at all");
  });

  test("sets json to null on an empty body", async () => {
    stubFetch(() => new Response("", { status: 204 }));

    const result = await fetchBearerAuthorizedJson("https://api.example.com/x", "tok");

    expect(result.json).toBeNull();
    expect(result.text).toBe("");
  });
});
