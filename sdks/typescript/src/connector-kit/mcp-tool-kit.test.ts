import { afterEach, describe, expect, test } from "bun:test";
import {
  createRegisterSimpleTool,
  createZodToolRegistrar,
  encodeBasicAuthHeader,
  fetchWithTimeout,
  type HttpJsonBodyResponse,
  type HttpTextResponse,
  mcpJsonResult,
  mcpJsonResultFromTextIfOk,
  mcpJsonResultIfOk,
  parseJsonTextIfOk,
  putOptionalBoolean,
  putOptionalNonEmptyString,
  type RegisterSimpleToolFn,
  registerZodTool,
  requireProcessEnv,
  type ZodObjectSchema,
} from "./mcp-tool-kit.js";

// ─── mcpJsonResult ──────────────────────────────────────────────────────────────

describe("mcpJsonResult", () => {
  test("wraps data as a single pretty-printed JSON text block", () => {
    expect(mcpJsonResult({ a: 1, b: [1, 2] })).toEqual({
      content: [{ type: "text", text: JSON.stringify({ a: 1, b: [1, 2] }, null, 2) }],
    });
  });

  test("handles primitives and null", () => {
    expect(mcpJsonResult(null).content[0]?.text).toBe("null");
    expect(mcpJsonResult(42).content[0]?.text).toBe("42");
    expect(mcpJsonResult("x").content[0]?.text).toBe('"x"');
  });
});

// ─── registerZodTool / createZodToolRegistrar ──────────────────────────────────

type XArgs = { x: number };

function fakeSchema(
  result: { success: true; data: XArgs } | { success: false; error: { message: string } },
): ZodObjectSchema<XArgs> {
  return { shape: { x: {} }, safeParse: () => result };
}

describe("registerZodTool", () => {
  test("registers using the schema's shape, and the built handler forwards parsed data", async () => {
    let captured:
      | {
          name: string;
          description: string;
          inputShape: Record<string, unknown>;
          handler: (args: unknown) => Promise<ReturnType<typeof mcpJsonResult>>;
        }
      | undefined;
    const registerSimpleTool: RegisterSimpleToolFn = (name, description, inputShape, handler) => {
      captured = { name, description, inputShape, handler };
      return undefined;
    };
    const schema = fakeSchema({ success: true, data: { x: 7 } });

    let receivedArgs: XArgs | undefined;
    registerZodTool(registerSimpleTool, "tool1", "desc1", schema, async (args) => {
      receivedArgs = args;
      return mcpJsonResult({ ok: true });
    });

    expect(captured?.name).toBe("tool1");
    expect(captured?.description).toBe("desc1");
    expect(captured?.inputShape).toBe(schema.shape);

    const result = await captured?.handler({ ignored: "raw args, schema decides" });
    expect(receivedArgs).toEqual({ x: 7 });
    expect(result).toEqual(mcpJsonResult({ ok: true }));
  });

  test("throws the schema's error message on a failed parse, without calling the handler", async () => {
    let captured: ((args: unknown) => Promise<unknown>) | undefined;
    const registerSimpleTool: RegisterSimpleToolFn = (_n, _d, _s, handler) => {
      captured = handler;
      return undefined;
    };
    const schema = fakeSchema({ success: false, error: { message: "x is required" } });

    let handlerCalled = false;
    registerZodTool(registerSimpleTool, "t", "d", schema, async () => {
      handlerCalled = true;
      return mcpJsonResult({});
    });

    await expect(captured?.({})).rejects.toThrow("x is required");
    expect(handlerCalled).toBe(false);
  });
});

describe("createZodToolRegistrar", () => {
  test("returns a registrar equivalent to calling registerZodTool directly", async () => {
    let captured:
      | { name: string; handler: (args: unknown) => Promise<ReturnType<typeof mcpJsonResult>> }
      | undefined;
    const registerSimpleTool: RegisterSimpleToolFn = (name, _d, _s, handler) => {
      captured = { name, handler };
      return undefined;
    };
    const reg = createZodToolRegistrar(registerSimpleTool);
    const schema = fakeSchema({ success: true, data: { x: 3 } });

    reg("tool2", "desc2", schema, async (args) => mcpJsonResult(args));

    expect(captured?.name).toBe("tool2");
    const result = await captured?.handler({});
    expect(result).toEqual(mcpJsonResult({ x: 3 }));
  });
});

// ─── mcpJsonResultIfOk ──────────────────────────────────────────────────────────

describe("mcpJsonResultIfOk", () => {
  test("wraps json on ok", () => {
    const res: HttpJsonBodyResponse = { ok: true, status: 200, json: { a: 1 }, text: "{}" };
    expect(mcpJsonResultIfOk("svc", res)).toEqual(mcpJsonResult({ a: 1 }));
  });

  test("throws with status and a 300-char snippet by default on non-ok", () => {
    const res: HttpJsonBodyResponse = { ok: false, status: 500, json: null, text: "x".repeat(500) };
    expect(() => mcpJsonResultIfOk("svc", res)).toThrow(`svc 500: ${"x".repeat(300)}`);
  });

  test("respects a custom snippetMax", () => {
    const res: HttpJsonBodyResponse = { ok: false, status: 404, json: null, text: "abcdefgh" };
    expect(() => mcpJsonResultIfOk("svc", res, 3)).toThrow("svc 404: abc");
  });
});

// ─── mcpJsonResultFromTextIfOk ──────────────────────────────────────────────────

describe("mcpJsonResultFromTextIfOk", () => {
  test("parses text as JSON and wraps on ok", () => {
    const res: HttpTextResponse = { ok: true, status: 200, text: JSON.stringify({ a: 1 }) };
    expect(mcpJsonResultFromTextIfOk("svc", res)).toEqual(mcpJsonResult({ a: 1 }));
  });

  test("throws with status + a 400-char snippet by default on non-ok", () => {
    const res: HttpTextResponse = { ok: false, status: 403, text: "forbidden" };
    expect(() => mcpJsonResultFromTextIfOk("svc", res)).toThrow("svc 403: forbidden");
  });

  test("throws a stable generic message on malformed JSON when ok", () => {
    const res: HttpTextResponse = { ok: true, status: 200, text: "not json" };
    expect(() => mcpJsonResultFromTextIfOk("svc", res)).toThrow("svc: invalid JSON response");
  });

  test("prefers the caller-provided parse-error message over the generic one", () => {
    const res: HttpTextResponse = { ok: true, status: 200, text: "not json" };
    expect(() =>
      mcpJsonResultFromTextIfOk("svc", res, { jsonParseErrorMessage: "custom parse failure" }),
    ).toThrow("custom parse failure");
  });

  test("the caller-provided parse-error message is not used on the non-ok path", () => {
    const res: HttpTextResponse = { ok: false, status: 500, text: "boom" };
    expect(() =>
      mcpJsonResultFromTextIfOk("svc", res, { jsonParseErrorMessage: "custom parse failure" }),
    ).toThrow("svc 500: boom");
  });

  test("respects a custom maxSnippet on the non-ok path", () => {
    const res: HttpTextResponse = { ok: false, status: 500, text: "abcdefgh" };
    expect(() => mcpJsonResultFromTextIfOk("svc", res, { maxSnippet: 3 })).toThrow("svc 500: abc");
  });
});

// ─── parseJsonTextIfOk ──────────────────────────────────────────────────────────

describe("parseJsonTextIfOk", () => {
  test("returns parsed JSON on ok", () => {
    expect(parseJsonTextIfOk("svc", { ok: true, status: 200, text: '{"a":1}' })).toEqual({ a: 1 });
  });

  test("throws with status + snippet on non-ok and never attempts to parse", () => {
    expect(() => parseJsonTextIfOk("svc", { ok: false, status: 401, text: "denied" })).toThrow(
      "svc 401: denied",
    );
  });

  test("propagates the JSON.parse error on ok but malformed body", () => {
    expect(() => parseJsonTextIfOk("svc", { ok: true, status: 200, text: "nope" })).toThrow();
  });

  test("respects a custom maxSnippet on the non-ok path", () => {
    expect(() => parseJsonTextIfOk("svc", { ok: false, status: 500, text: "abcdefgh" }, 3)).toThrow(
      "svc 500: abc",
    );
  });
});

// ─── putOptionalNonEmptyString / putOptionalBoolean ────────────────────────────

describe("putOptionalNonEmptyString", () => {
  test("sets the key when value is a non-empty string", () => {
    const body: Record<string, unknown> = {};
    putOptionalNonEmptyString(body, "k", "v");
    expect(body).toEqual({ k: "v" });
  });

  test("does not set the key when value is undefined", () => {
    const body: Record<string, unknown> = { existing: 1 };
    putOptionalNonEmptyString(body, "k", undefined);
    expect(body).toEqual({ existing: 1 });
  });

  test("does not set the key when value is an empty string", () => {
    const body: Record<string, unknown> = {};
    putOptionalNonEmptyString(body, "k", "");
    expect(body).toEqual({});
  });
});

describe("putOptionalBoolean", () => {
  test("sets the key when value is true", () => {
    const body: Record<string, unknown> = {};
    putOptionalBoolean(body, "k", true);
    expect(body).toEqual({ k: true });
  });

  test("sets the key when value is false — false is meaningful, not absence", () => {
    const body: Record<string, unknown> = {};
    putOptionalBoolean(body, "k", false);
    expect(body).toEqual({ k: false });
  });

  test("does not set the key when value is undefined", () => {
    const body: Record<string, unknown> = { existing: 1 };
    putOptionalBoolean(body, "k", undefined);
    expect(body).toEqual({ existing: 1 });
  });
});

// ─── createRegisterSimpleTool ───────────────────────────────────────────────────

describe("createRegisterSimpleTool", () => {
  test("returns a function bound to the server, forwarding all arguments", () => {
    let received: unknown[] = [];
    const server = {
      label: "srv",
      tool(...args: unknown[]): unknown {
        received = args;
        // Proves the returned function is actually bound to `server`, not just
        // forwarding — an unbound `.tool` would see `this` as undefined here.
        return this.label;
      },
    };
    const registerFn = createRegisterSimpleTool(server);
    const handler = async () => mcpJsonResult({});
    const result = registerFn("name", "desc", { x: {} }, handler);

    expect(result).toBe("srv");
    expect(received).toEqual(["name", "desc", { x: {} }, handler]);
  });

  test("throws for null, non-object, or an object missing a callable .tool", () => {
    expect(() => createRegisterSimpleTool(null)).toThrow(
      "createRegisterSimpleTool: expected MCP server with .tool",
    );
    expect(() => createRegisterSimpleTool("nope")).toThrow(
      "createRegisterSimpleTool: expected MCP server with .tool",
    );
    expect(() => createRegisterSimpleTool({})).toThrow(
      "createRegisterSimpleTool: expected MCP server with .tool",
    );
    expect(() => createRegisterSimpleTool({ tool: "not-a-function" })).toThrow(
      "createRegisterSimpleTool: expected MCP server with .tool",
    );
  });
});

// ─── requireProcessEnv ───────────────────────────────────────────────────────────

describe("requireProcessEnv", () => {
  const KEY = "NIMBUS_CONNECTOR_KIT_TEST_VAR";

  afterEach(() => {
    delete process.env[KEY];
  });

  test("returns the value when set", () => {
    process.env[KEY] = "abc";
    expect(requireProcessEnv(KEY)).toBe("abc");
  });

  test("throws naming the var when unset", () => {
    expect(() => requireProcessEnv(KEY)).toThrow(`${KEY} is not set`);
  });

  test("throws when set to an empty string", () => {
    process.env[KEY] = "";
    expect(() => requireProcessEnv(KEY)).toThrow(`${KEY} is not set`);
  });
});

// ─── fetchWithTimeout ────────────────────────────────────────────────────────────

describe("fetchWithTimeout", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("resolves with the underlying Response and forwards url/init", async () => {
    const response = new Response("ok", { status: 201 });
    let seenUrl: string | undefined;
    let seenInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return response;
    }) as typeof fetch;

    const result = await fetchWithTimeout("https://x.example/y", { method: "POST" });

    expect(result).toBe(response);
    expect(seenUrl).toBe("https://x.example/y");
    expect(seenInit?.method).toBe("POST");
  });

  test("aborts via its own timeout when the request hangs past timeoutMs", async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }) as typeof fetch;

    await expect(fetchWithTimeout("https://x.example", {}, 10)).rejects.toThrow();
  });

  test("composes a caller-supplied signal with the timeout's own", async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }) as typeof fetch;

    const callerController = new AbortController();
    // A generous timeout: this must reject because the CALLER aborted, not the timer.
    const promise = fetchWithTimeout(
      "https://x.example",
      { signal: callerController.signal },
      60_000,
    );
    callerController.abort();

    await expect(promise).rejects.toThrow();
  });

  test("does not swallow a fetch rejection unrelated to the timeout", async () => {
    globalThis.fetch = (async (_url: string, _init?: RequestInit): Promise<Response> => {
      throw new Error("network down");
    }) as typeof fetch;

    await expect(fetchWithTimeout("https://x.example")).rejects.toThrow("network down");
  });
});

// ─── encodeBasicAuthHeader ────────────────────────────────────────────────────────

describe("encodeBasicAuthHeader", () => {
  test("returns Basic <base64(email:token)>", () => {
    const header = encodeBasicAuthHeader("user@example.com", "secret");
    expect(header).toBe(
      `Basic ${Buffer.from("user@example.com:secret", "utf8").toString("base64")}`,
    );
  });

  test("round-trips through base64 decoding, tolerating colons in the token", () => {
    const header = encodeBasicAuthHeader("a@b.com", "tok:with:colons");
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString("utf8");
    expect(decoded).toBe("a@b.com:tok:with:colons");
  });
});
