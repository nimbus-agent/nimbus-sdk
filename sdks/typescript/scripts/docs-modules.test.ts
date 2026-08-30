import { describe, expect, test } from "bun:test";
import type { EntryPoint, EntrySurface } from "./api-surface.ts";
import { moduleKeyOf, modulesInSurface, parseCovers, unclaimedModules } from "./docs-modules.ts";

describe("moduleKeyOf", () => {
  test("strips the dist/ prefix and the .d.ts suffix", () => {
    expect(moduleKeyOf("dist/index.d.ts", "./crypto/jwt.js")).toBe("crypto/jwt");
  });

  test("resolves relative to the importing entry, not the repo root", () => {
    expect(moduleKeyOf("dist/ipc/index.d.ts", "./ndjson-line-reader.js")).toBe(
      "ipc/ndjson-line-reader",
    );
  });

  test("maps (local) to the entry barrel's own module", () => {
    expect(moduleKeyOf("dist/testing/index.d.ts", "(local)")).toBe("testing/index");
  });

  test("maps (local) on the root barrel to index", () => {
    expect(moduleKeyOf("dist/index.d.ts", "(local)")).toBe("index");
  });
});

describe("modulesInSurface", () => {
  const entries: EntryPoint[] = [
    { label: ".", file: "dist/index.d.ts" },
    { label: "./testing", file: "dist/testing/index.d.ts" },
  ];

  test("returns every distinct module, sorted, with the exports that live in each", () => {
    const surfaces: EntrySurface[] = [
      {
        label: ".",
        exports: [
          {
            name: "signJwt",
            typeOnly: false,
            source: "./crypto/jwt.js",
            declaration: "",
            deprecated: null,
            stability: "stable",
          },
          {
            name: "decodeJwt",
            typeOnly: false,
            source: "./crypto/jwt.js",
            declaration: "",
            deprecated: null,
            stability: "stable",
          },
          {
            name: "buildIcs",
            typeOnly: false,
            source: "./icalendar.js",
            declaration: "",
            deprecated: null,
            stability: "stable",
          },
        ],
      },
      {
        label: "./testing",
        exports: [
          {
            name: "MockGateway",
            typeOnly: false,
            source: "(local)",
            declaration: "",
            deprecated: null,
            stability: "stable",
          },
        ],
      },
    ];

    expect(modulesInSurface(entries, surfaces)).toEqual(
      new Map([
        ["crypto/jwt", ["decodeJwt", "signJwt"]],
        ["icalendar", ["buildIcs"]],
        ["testing/index", ["MockGateway"]],
      ]),
    );
  });

  test("throws when a surface label has no matching entry point", () => {
    const orphan: EntrySurface[] = [
      {
        label: "./ghost",
        exports: [
          {
            name: "x",
            typeOnly: false,
            source: "./a.js",
            declaration: "",
            deprecated: null,
            stability: "stable",
          },
        ],
      },
    ];
    expect(() => modulesInSurface(entries, orphan)).toThrow(/no entry point named "\.\/ghost"/);
  });
});

describe("unclaimedModules", () => {
  test("names a module in the surface that no page claims", () => {
    const modules = new Map([
      ["crypto/jwt", ["decodeJwt", "signJwt"]],
      ["icalendar", ["buildVEvent"]],
    ]);
    const claimedBy = new Map([["icalendar", "icalendar.md"]]);

    // Synthetic, not a throwaway export in src/: this is the failing direction the guard
    // never takes against the real repository, where every module is claimed.
    expect(unclaimedModules(modules, claimedBy)).toEqual(["crypto/jwt"]);
  });

  test("returns [] when every module in the surface is claimed", () => {
    const modules = new Map([
      ["crypto/jwt", ["signJwt"]],
      ["icalendar", ["buildVEvent"]],
    ]);
    const claimedBy = new Map([
      ["crypto/jwt", "crypto.md"],
      ["icalendar", "icalendar.md"],
    ]);

    expect(unclaimedModules(modules, claimedBy)).toEqual([]);
  });

  test("a claim naming a module the surface does not contain does not mask a real gap", () => {
    const modules = new Map([["crypto/jwt", ["signJwt"]]]);
    const claimedBy = new Map([["icalendar", "icalendar.md"]]);

    expect(unclaimedModules(modules, claimedBy)).toEqual(["crypto/jwt"]);
  });
});

describe("parseCovers", () => {
  test("reads a single-line covers comment", () => {
    expect(parseCovers("<!-- covers: icalendar -->\n\n# iCalendar\n")).toEqual({
      typescript: ["icalendar"],
      python: [],
      go: [],
    });
  });

  test("reads a multi-line covers comment and trims each entry", () => {
    const page =
      "<!-- covers: crypto/jwt, crypto/canonical-json,\n             crypto/verify-signature -->\n";
    expect(parseCovers(page)).toEqual({
      typescript: ["crypto/jwt", "crypto/canonical-json", "crypto/verify-signature"],
      python: [],
      go: [],
    });
  });

  test("is CRLF-independent", () => {
    // The comma case alone doesn't discriminate: `split(",").map(t => t.trim())`
    // strips a `\r` at either end of a token whether or not normalizeEol ran, since
    // `trim()` treats `\r` as whitespace. So this puts the `\r` where `trim` cannot
    // reach it — interior to a single claim, with no comma either side — which
    // genuinely fails (yielding "a\r\n  b" instead of "a\n  b") if normalizeEol is
    // removed. Verified by temporarily removing that call and watching this fail.
    expect(parseCovers("<!-- covers: a\r\n  b -->")).toEqual({
      typescript: ["a\n  b"],
      python: [],
      go: [],
    });
  });

  test("is CRLF-independent across a wrapped, comma-separated list too", () => {
    expect(parseCovers("<!-- covers: a,\r\n  b -->\r\n")).toEqual({
      typescript: ["a", "b"],
      python: [],
      go: [],
    });
  });

  test("whitespace is not a delimiter — a missing comma stays one malformed claim", () => {
    expect(parseCovers("<!-- covers: alpha beta -->")?.typescript).toEqual(["alpha beta"]);
  });

  test("returns null when the page has no covers comment", () => {
    expect(parseCovers("# A page with no marker\n")).toBeNull();
  });

  test("throws when a page declares two covers comments", () => {
    const page = "<!-- covers: a -->\n<!-- covers: b -->\n";
    expect(() => parseCovers(page)).toThrow(/declares more than one "covers:" comment/);
  });

  test("throws on an empty covers list rather than treating it as no claim", () => {
    expect(() => parseCovers("<!-- covers: -->\n")).toThrow(/empty "covers:" list/);
  });
});

describe("language-qualified claims", () => {
  test("an unprefixed list is all TypeScript, unchanged from today", () => {
    const claims = parseCovers("<!-- covers: icalendar -->");
    expect(claims).toEqual({ typescript: ["icalendar"], python: [], go: [] });
  });

  test("a wrapped unprefixed list still parses", () => {
    const claims = parseCovers("<!-- covers: crypto/jwt,\n     crypto/canonical-json -->");
    expect(claims?.typescript).toEqual(["crypto/jwt", "crypto/canonical-json"]);
  });

  test("a prefix sets the active binding for itself and every later token", () => {
    const claims = parseCovers(
      "<!-- covers: contract-version, ipc/hello\n     py: contract, ipc/hello\n     go: contract/negotiate, contract/version -->",
    );
    expect(claims).toEqual({
      typescript: ["contract-version", "ipc/hello"],
      python: ["contract", "ipc/hello"],
      go: ["contract/negotiate", "contract/version"],
    });
  });

  test("a page may claim nothing in TypeScript", () => {
    const claims = parseCovers("<!-- covers: go: spec/spec -->");
    expect(claims).toEqual({ typescript: [], python: [], go: ["spec/spec"] });
  });

  test("a prefix with an empty remainder throws", () => {
    expect(() => parseCovers("<!-- covers: icalendar, py: -->")).toThrow(/empty/i);
  });

  test("a mistyped prefix throws by name instead of becoming a TypeScript claim", () => {
    expect(() => parseCovers("<!-- covers: icalendar, python: connector_kit/env -->")).toThrow(
      /invalid claim prefix .*python: connector_kit\/env/,
    );
    expect(() => parseCovers("<!-- covers: icalendar, go : spec/spec -->")).toThrow(
      /invalid claim prefix/,
    );
  });

  test("a page with no comment is still null", () => {
    expect(parseCovers("# icalendar\n")).toBeNull();
  });

  test("two comments still throw", () => {
    expect(() => parseCovers("<!-- covers: a -->\n<!-- covers: b -->")).toThrow(/more than one/);
  });
});
