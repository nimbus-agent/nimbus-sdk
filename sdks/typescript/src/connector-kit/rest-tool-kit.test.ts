import { afterEach, describe, expect, test } from "bun:test";
import { mcpJsonResult, type ZodObjectSchema } from "./mcp-tool-kit.js";
import { makeRestFetcher, makeRestToolRegistrar, type RestToolRegistrar } from "./rest-tool-kit.js";

// ─── makeRestFetcher ─────────────────────────────────────────────────────────────

describe("makeRestFetcher", () => {
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

  test("resolves a relative path against apiBase and authorizes with the Bearer token", async () => {
    const captured: { url: string | undefined; auth: string | null } = {
      url: undefined,
      auth: null,
    };
    stubFetch((url, init) => {
      captured.url = url;
      const headers = init?.headers as Headers;
      captured.auth = headers.get("authorization");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const fetcher = makeRestFetcher({ apiBase: "https://api.example.com", token: "tok" });
    const result = await fetcher("/v1/things");

    expect(captured.url).toBe("https://api.example.com/v1/things");
    expect(captured.auth).toBe("Bearer tok");
    expect(result).toEqual({ ok: true, status: 200, json: { ok: true }, text: '{"ok":true}' });
  });

  test("merges defaultHeaders and passes through init", async () => {
    const captured: { customHeader: string | null; method: string | undefined } = {
      customHeader: null,
      method: undefined,
    };
    stubFetch((_url, init) => {
      const headers = init?.headers as Headers;
      captured.customHeader = headers.get("x-custom");
      captured.method = init?.method;
      return new Response("{}", { status: 200 });
    });

    const fetcher = makeRestFetcher({
      apiBase: "https://api.example.com",
      token: "tok",
      defaultHeaders: { "X-Custom": "yes" },
    });
    await fetcher("/x", { method: "DELETE" });

    expect(captured.customHeader).toBe("yes");
    expect(captured.method).toBe("DELETE");
  });

  test("rejects a cross-origin absolute URL — the SSRF guard applies through the fetcher", async () => {
    stubFetch(() => new Response("{}", { status: 200 }));
    const fetcher = makeRestFetcher({ apiBase: "https://api.example.com", token: "tok" });

    await expect(fetcher("https://evil.example.com/steal")).rejects.toThrow(
      /refusing to fetch cross-origin URL/,
    );
  });

  test("returns ok:false with the status on a non-2xx response, without throwing", async () => {
    stubFetch(() => new Response(JSON.stringify({ message: "nope" }), { status: 403 }));
    const fetcher = makeRestFetcher({ apiBase: "https://api.example.com", token: "tok" });

    const result = await fetcher("/x");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.json).toEqual({ message: "nope" });
  });
});

// ─── makeRestToolRegistrar ────────────────────────────────────────────────────────

type ThingArgs = { id: string };

const thingSchema: ZodObjectSchema<ThingArgs> = {
  shape: { id: {} },
  safeParse: (args) => ({ success: true, data: args as ThingArgs }),
};

/** Captures the handler a registrar-under-test builds, so it can be invoked directly. */
function capturingRegistrar(): {
  registrar: RestToolRegistrar;
  handler: () => (args: unknown) => Promise<ReturnType<typeof mcpJsonResult>>;
} {
  let captured: ((args: unknown) => Promise<ReturnType<typeof mcpJsonResult>>) | undefined;
  const registrar: RestToolRegistrar = (_name, _description, _schema, handler) => {
    captured = handler as (args: unknown) => Promise<ReturnType<typeof mcpJsonResult>>;
  };
  return {
    registrar,
    handler: () => {
      if (captured === undefined) throw new Error("registrar was never called");
      return captured;
    },
  };
}

const TOKEN_ENV = "NIMBUS_REST_TOOL_KIT_TEST_TOKEN";

describe("makeRestToolRegistrar", () => {
  afterEach(() => {
    delete process.env[TOKEN_ENV];
  });

  test("registers exactly once, forwarding name/description/schema unchanged", () => {
    const calls: Array<{ name: string; description: string; schema: unknown }> = [];
    const registrar: RestToolRegistrar = (name, description, schema, _handler) => {
      calls.push({ name, description, schema });
    };
    const reg = makeRestToolRegistrar({
      registrar,
      tokenEnv: TOKEN_ENV,
      serviceLabel: "svc",
      fetch: async () => ({ ok: true, status: 200, json: {}, text: "{}" }),
    });

    reg("get_thing", "Gets a thing.", thingSchema, (args) => `/things/${args.id}`);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      name: "get_thing",
      description: "Gets a thing.",
      schema: thingSchema,
    });
  });

  test("on invocation: reads the token env, calls cfg.fetch with token + built path, and wraps json on ok", async () => {
    process.env[TOKEN_ENV] = "secret-token";
    const fetchCalls: Array<{ token: string; pathOrUrl: string; init: RequestInit | undefined }> =
      [];
    const { registrar, handler } = capturingRegistrar();
    const reg = makeRestToolRegistrar({
      registrar,
      tokenEnv: TOKEN_ENV,
      serviceLabel: "svc",
      fetch: async (token, pathOrUrl, init) => {
        fetchCalls.push({ token, pathOrUrl, init });
        return { ok: true, status: 200, json: { name: "widget" }, text: '{"name":"widget"}' };
      },
    });

    reg("get_thing", "Gets a thing.", thingSchema, (args) => `/things/${args.id}`);
    const result = await handler()({ id: "7" });

    expect(fetchCalls).toEqual([
      { token: "secret-token", pathOrUrl: "/things/7", init: undefined },
    ]);
    expect(result).toEqual(mcpJsonResult({ name: "widget" }));
  });

  test("passes buildInit's result through as the fetch init", async () => {
    process.env[TOKEN_ENV] = "secret-token";
    const fetchCalls: Array<{ pathOrUrl: string; init: RequestInit | undefined }> = [];
    const { registrar, handler } = capturingRegistrar();
    const reg = makeRestToolRegistrar({
      registrar,
      tokenEnv: TOKEN_ENV,
      serviceLabel: "svc",
      fetch: async (_token, pathOrUrl, init) => {
        fetchCalls.push({ pathOrUrl, init });
        return { ok: true, status: 200, json: {}, text: "{}" };
      },
    });

    reg(
      "delete_thing",
      "Deletes a thing.",
      thingSchema,
      (args) => `/things/${args.id}`,
      () => ({ method: "DELETE" }),
    );
    await handler()({ id: "9" });

    expect(fetchCalls).toEqual([{ pathOrUrl: "/things/9", init: { method: "DELETE" } }]);
  });

  test("throws before fetching when the token env var is unset", async () => {
    let fetchCalled = false;
    const { registrar, handler } = capturingRegistrar();
    const reg = makeRestToolRegistrar({
      registrar,
      tokenEnv: TOKEN_ENV,
      serviceLabel: "svc",
      fetch: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: {}, text: "{}" };
      },
    });

    reg("get_thing", "Gets a thing.", thingSchema, (args) => `/things/${args.id}`);

    await expect(handler()({ id: "1" })).rejects.toThrow(`${TOKEN_ENV} is not set`);
    expect(fetchCalled).toBe(false);
  });

  test("throws with service label + status + body snippet on a non-ok fetch result", async () => {
    process.env[TOKEN_ENV] = "secret-token";
    const { registrar, handler } = capturingRegistrar();
    const reg = makeRestToolRegistrar({
      registrar,
      tokenEnv: TOKEN_ENV,
      serviceLabel: "widgets",
      fetch: async () => ({ ok: false, status: 500, json: null, text: "internal error" }),
    });

    reg("get_thing", "Gets a thing.", thingSchema, (args) => `/things/${args.id}`);

    await expect(handler()({ id: "1" })).rejects.toThrow("widgets 500: internal error");
  });

  test("respects a custom snippetMax when reporting a non-ok fetch result", async () => {
    process.env[TOKEN_ENV] = "secret-token";
    const { registrar, handler } = capturingRegistrar();
    const reg = makeRestToolRegistrar({
      registrar,
      tokenEnv: TOKEN_ENV,
      serviceLabel: "widgets",
      snippetMax: 4,
      fetch: async () => ({ ok: false, status: 500, json: null, text: "abcdefgh" }),
    });

    reg("get_thing", "Gets a thing.", thingSchema, (args) => `/things/${args.id}`);

    await expect(handler()({ id: "1" })).rejects.toThrow("widgets 500: abcd");
  });
});
