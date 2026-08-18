/** RFC 3986 scheme followed by its colon. The one thing that makes an input absolute. */
const ABSOLUTE_URL = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Removed by `new URL` and fetched as if absent. Spec §5 refuses them instead. */
const FORBIDDEN_WHITESPACE = /[\t\n\r]/;

/** Spec §6. Every other scheme has no default, so its port is always significant. */
const DEFAULT_PORTS: Readonly<Record<string, number | undefined>> = { http: 80, https: 443 };

/**
 * The spec §6 origin string, or `undefined` when the URL has no host.
 *
 * Not `URL#origin`: that is `"null"` for every non-special scheme, which would put a
 * JavaScript-ism into a message the conformance corpus pins for both bindings. Built by
 * hand it is the same string Python's `urlsplit` can produce, and for `http`/`https` it
 * is byte-identical to what `URL#origin` returns anyway.
 */
function originOf(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  const host = parsed.hostname.toLowerCase();
  if (host === "") {
    return undefined;
  }
  const fallback = DEFAULT_PORTS[scheme];
  const port = parsed.port === "" ? fallback : Number(parsed.port);
  if (port === undefined || port === fallback) {
    return `${scheme}://${host}`;
  }
  return `${scheme}://${host}:${String(port)}`;
}

/**
 * Resolve a path-or-URL against `baseUrl`, per
 * `docs/spec/connector-kit/v1/url-resolution.md`.
 *
 * A relative input is concatenated onto the base (§4) — but a base with no trailing
 * slash lets a relative input **extend the authority** (`@evil.com/x`, `.evil.com/x`),
 * so the concatenated result's origin is checked against the base's origin the same way
 * an absolute input is: if the base has a computable origin and the concatenation
 * doesn't share it, the resolution is refused as cross-origin rather than fetched. A
 * base with no computable origin (not a parseable absolute URL) skips the check — it is
 * not a credential-bearing endpoint — and the concatenation is returned unchanged. An
 * ABSOLUTE input is only allowed when it shares the base's origin — this is the single
 * chokepoint that prevents a caller-supplied pagination link (`@odata.nextLink`, etc.)
 * from redirecting a credential-bearing fetch at an attacker-controlled host (SSRF /
 * bearer-token exfiltration). A cross-origin, malformed, or unbased absolute URL throws
 * and is never fetched.
 *
 * Absoluteness is decided by §3's scheme rule, not by a `startsWith("http")` prefix test.
 * The heuristic was wrong at both edges: it rejected the legitimate relative path
 * `httpdocs/x`, and it read `ftp://evil.com` as relative and concatenated it. See
 * RFC-0011 for the semver reasoning on that correction.
 */
export function resolveUrlWithBase(baseUrl: string, pathOrUrl: string): string {
  if (!ABSOLUTE_URL.test(pathOrUrl)) {
    const concatenated = `${baseUrl}${pathOrUrl}`;
    const base = originOf(baseUrl);
    if (base === undefined) {
      return concatenated;
    }
    const target = originOf(concatenated);
    if (target !== base) {
      throw new Error(
        `resolveUrlWithBase: refusing to fetch cross-origin URL (got ${target ?? concatenated}, expected ${base})`,
      );
    }
    return concatenated;
  }
  const target = FORBIDDEN_WHITESPACE.test(pathOrUrl) ? undefined : originOf(pathOrUrl);
  if (target === undefined) {
    throw new Error("resolveUrlWithBase: refusing to fetch malformed absolute URL");
  }
  const base = originOf(baseUrl);
  if (base === undefined) {
    throw new Error("resolveUrlWithBase: base URL is not an absolute URL with a host");
  }
  if (target !== base) {
    throw new Error(
      `resolveUrlWithBase: refusing to fetch cross-origin URL (got ${target}, expected ${base})`,
    );
  }
  return pathOrUrl;
}

export type BearerJsonFetchResult = {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
};

export async function fetchBearerAuthorizedJson(
  url: string,
  token: string,
  init?: RequestInit,
  defaultHeaders?: Record<string, string>,
): Promise<BearerJsonFetchResult> {
  const mergedHeaders = new Headers({
    Authorization: `Bearer ${token}`,
    ...defaultHeaders,
  });
  if (init?.headers !== undefined) {
    const extra = new Headers(init.headers);
    for (const [k, v] of extra) {
      mergedHeaders.set(k, v);
    }
  }
  const res = await fetch(url, {
    ...init,
    headers: mergedHeaders,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}
