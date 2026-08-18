import { afterEach, describe, expect, test } from "bun:test";
import { fetchBearerAuthorizedJson, resolveUrlWithBase } from "./fetch-bearer-json.js";

// ─── resolveUrlWithBase (the SSRF chokepoint) ──────────────────────────────────

describe("resolveUrlWithBase", () => {
  const base = "https://api.example.com";

  test("prefixes a relative path with the base URL", () => {
    expect(resolveUrlWithBase(base, "/v1/x")).toBe("https://api.example.com/v1/x");
  });

  test("an empty input resolves to the base", () => {
    expect(resolveUrlWithBase(base, "")).toBe(base);
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

  test("an explicit default port is the same origin as none (spec §6)", () => {
    // Python's urlsplit reports the port verbatim where the WHATWG URL parser elides it.
    // Without the default-port table both bindings disagree on a legitimate pagination link.
    const abs = "https://api.example.com:443/x";
    expect(resolveUrlWithBase(base, abs)).toBe(abs);
    expect(resolveUrlWithBase("http://api.example.com:80", "http://api.example.com/x")).toBe(
      "http://api.example.com/x",
    );
  });

  test("scheme and host compare case-insensitively", () => {
    expect(resolveUrlWithBase(base, "HTTPS://API.Example.COM/x")).toBe("HTTPS://API.Example.COM/x");
  });

  test("an IPv6 host compares by its bracketed form, port included", () => {
    const v6 = "http://[::1]:8080";
    expect(resolveUrlWithBase(v6, `${v6}/x`)).toBe(`${v6}/x`);
    expect(() => resolveUrlWithBase(v6, "http://[::1]:9090/x")).toThrow(
      "resolveUrlWithBase: refusing to fetch cross-origin URL (got http://[::1]:9090, expected http://[::1]:8080)",
    );
  });

  test("userinfo is ignored — the host is what follows the last '@'", () => {
    expect(() => resolveUrlWithBase(base, "https://api.example.com@evil.com/x")).toThrow(
      "resolveUrlWithBase: refusing to fetch cross-origin URL (got https://evil.com, expected https://api.example.com)",
    );
  });

  test("a non-http scheme is absolute, and rejected as cross-origin rather than concatenated", () => {
    // The heuristic read this as relative and produced "https://api.example.comftp://evil.com".
    expect(() => resolveUrlWithBase(base, "ftp://evil.com/x")).toThrow(
      "resolveUrlWithBase: refusing to fetch cross-origin URL (got ftp://evil.com, expected https://api.example.com)",
    );
  });

  test("an absolute URL with no host is malformed", () => {
    expect(() => resolveUrlWithBase(base, "http://")).toThrow(
      "resolveUrlWithBase: refusing to fetch malformed absolute URL",
    );
  });

  test("a non-integer port is malformed", () => {
    expect(() => resolveUrlWithBase(base, "https://api.example.com:notaport/x")).toThrow(
      "resolveUrlWithBase: refusing to fetch malformed absolute URL",
    );
  });

  test("a raw tab, LF or CR in an absolute URL is malformed, not silently stripped", () => {
    // new URL removes these and fetches the stripped form. A pagination link containing one
    // is a log-injection / request-smuggling signal, not a URL.
    for (const ws of ["\t", "\n", "\r"]) {
      expect(() => resolveUrlWithBase(base, `https://api.example.com/a${ws}b`)).toThrow(
        "resolveUrlWithBase: refusing to fetch malformed absolute URL",
      );
    }
  });

  test("a bare path that merely starts with 'http' as text is relative, not absolute", () => {
    // The inverted assertion. "httpdocs" is not a scheme — there is no colon — so §3 makes
    // this relative. The old startsWith("http") heuristic threw on a legitimate path.
    expect(resolveUrlWithBase(base, "httpdocs/x")).toBe("https://api.example.comhttpdocs/x");
  });

  test("a scheme-shaped relative segment is absolute, and malformed for want of a host", () => {
    // The other edge of §3, disclosed rather than hidden: "notes:" is a valid RFC 3986
    // scheme, so "notes:2024/x" takes the absolute branch and has no host.
    expect(() => resolveUrlWithBase(base, "notes:2024/x")).toThrow(
      "resolveUrlWithBase: refusing to fetch malformed absolute URL",
    );
  });

  test("a base that is not an absolute URL with a host is rejected as such", () => {
    expect(() => resolveUrlWithBase("api.example.com", "https://api.example.com/x")).toThrow(
      "resolveUrlWithBase: base URL is not an absolute URL with a host",
    );
  });

  test("the base is not parsed on the relative path", () => {
    // §4: concatenation only. A base with no scheme is fine here — it is the caller's string.
    expect(resolveUrlWithBase("api.example.com", "/x")).toBe("api.example.com/x");
  });

  test("a protocol-relative input is concatenated as a path, not resolved as an authority", () => {
    // §4 is concatenation, never RFC 3986 relative-reference resolution. `//evil.com/x`
    // has no scheme, so it is relative and never reaches the origin check — which makes
    // this the one branch where a wrong implementation exfiltrates the token silently.
    // `new URL("//evil.com/x", base)` would return https://evil.com/x.
    expect(resolveUrlWithBase(base, "//evil.com/x")).toBe("https://api.example.com//evil.com/x");
    expect(new URL(resolveUrlWithBase(base, "//evil.com/x")).hostname).toBe("api.example.com");
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
