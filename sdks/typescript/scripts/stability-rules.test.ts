import { describe, expect, test } from "bun:test";
import { readFromRepo } from "./paths.ts";
import {
  diffSurfaces,
  parseSurface,
  requiredFor,
  type SurfaceChange,
  type SurfaceEntry,
} from "./stability-rules.ts";

const change = (over: Partial<SurfaceChange>): SurfaceChange => ({
  name: "x",
  kind: "added",
  tier: "stable",
  binding: "typescript",
  wasDeprecated: false,
  ...over,
});

describe("requiredFor", () => {
  test("adding is a minor at every tier", () => {
    for (const tier of ["frozen", "stable", "experimental"] as const) {
      expect(requiredFor([change({ kind: "added", tier })]).impact).toBe("minor");
    }
  });

  test("breaking an experimental export is only a minor", () => {
    const r = requiredFor([change({ kind: "removed", tier: "experimental" })]);
    expect(r.impact).toBe("minor");
    expect(r.breaking).toBe(false);
  });

  test("breaking a stable export demands a breaking change", () => {
    const r = requiredFor([change({ kind: "signature", tier: "stable" })]);
    expect(r.impact).toBe("major");
    expect(r.breaking).toBe(true);
    expect(r.needsRfc).toBe(false);
  });

  // An `extended` change is a signature change that only ADDS optional members.
  // RFC-0015 §2 opens "the tier governs what it costs to break something, not what it
  // costs to add", and then charges `feat!:` for an addition anyway when that addition
  // happens to live inside an existing declaration. This is that inconsistency
  // corrected — the same correction, on the same grounds, as the `Export added` /
  // `frozen` cell below.
  test("extending a stable export with an optional member is a minor, not a break", () => {
    const r = requiredFor([change({ kind: "extended", tier: "stable" })]);
    expect(r.impact).toBe("minor");
    expect(r.breaking).toBe(false);
    expect(r.needsRfc).toBe(false);
  });

  test("a frozen export still needs an RFC to be extended", () => {
    // Deliberately NOT exempted. The frozen exemption below covers whole-export
    // additions only, and narrowing this correction to `stable` keeps its blast
    // radius to the cell the evidence actually covers.
    const r = requiredFor([change({ kind: "extended", tier: "frozen" })]);
    expect(r.needsRfc).toBe(true);
  });

  test("an extended experimental export is a minor, like every experimental change", () => {
    const r = requiredFor([change({ kind: "extended", tier: "experimental" })]);
    expect(r.impact).toBe("minor");
    expect(r.breaking).toBe(false);
  });

  // RFC-0017 §4 supersedes RFC-0015's `Export added` / `frozen` cell. The test this
  // replaced asserted the opposite — "additions included" — which is the rule that changed.
  test("adding to a frozen module needs no RFC", () => {
    const r = requiredFor([change({ kind: "added", tier: "frozen" })]);
    expect(r.needsRfc).toBe(false);
    expect(r.impact).toBe("minor");
    expect(r.breaking).toBe(false);
  });

  test("every other frozen surface change still demands an RFC", () => {
    for (const kind of ["removed", "signature", "demoted"] as const) {
      expect(requiredFor([change({ kind, tier: "frozen" })]).needsRfc, kind).toBe(true);
    }
  });

  test("a frozen addition cannot launder a frozen removal in the same diff", () => {
    const r = requiredFor([
      change({ kind: "added", tier: "frozen" }),
      change({ name: "old", kind: "removed", tier: "frozen", wasDeprecated: true }),
    ]);
    expect(r.needsRfc).toBe(true);
  });

  test("demoting a tier is breaking; promoting is not", () => {
    expect(requiredFor([change({ kind: "demoted", tier: "stable" })]).breaking).toBe(true);
    expect(requiredFor([change({ kind: "promoted", tier: "experimental" })]).breaking).toBe(false);
  });

  test("the requirement is the max across every change", () => {
    const r = requiredFor([
      change({ kind: "added", tier: "experimental" }),
      change({ kind: "removed", tier: "frozen", wasDeprecated: true }),
    ]);
    expect(r.impact).toBe("major");
    expect(r.needsRfc).toBe(true);
  });

  test("removing an unmarked stable TypeScript export is reported", () => {
    const r = requiredFor([change({ kind: "removed", tier: "stable", wasDeprecated: false })]);
    expect(r.notices.some((n) => /deprecation window/i.test(n))).toBe(true);
  });

  test("removing a stable Python export notices that the window is uncheckable", () => {
    const r = requiredFor([change({ kind: "removed", tier: "stable", binding: "python" })]);
    expect(r.notices.some((n) => /could not be checked/i.test(n))).toBe(true);
  });

  test("no changes means no requirement", () => {
    expect(requiredFor([]).impact).toBe("none");
  });
});

const surface = (
  name: string,
  tier: string,
  decl: string,
  deprecated = false,
  typeOnly = false,
): string =>
  [
    `### \`${name}\`${typeOnly ? " *(type-only)*" : ""}`,
    "",
    ...(deprecated ? ["**Deprecated:** gone soon", ""] : []),
    `**Stability:** ${tier}`,
    "",
    "From `./m.js`.",
    "",
    "```ts",
    decl,
    "```",
    "",
  ].join("\n");

describe("parseSurface / diffSurfaces", () => {
  test("parses name, tier, declaration and deprecation", () => {
    const entry = parseSurface(surface("a", "stable", "declare const a: number;", true)).get("a");
    expect(entry?.tier).toBe("stable");
    expect(entry?.deprecated).toBe(true);
    expect(entry?.declaration).toContain("const a");
  });

  test("detects an addition", () => {
    const base = parseSurface("");
    const head = parseSurface(surface("a", "experimental", "declare const a: number;"));
    expect(diffSurfaces(base, head, "typescript")).toEqual([
      {
        name: "a",
        kind: "added",
        tier: "experimental",
        binding: "typescript",
        wasDeprecated: false,
      },
    ]);
  });

  test("a removal carries the BASE tier and the BASE deprecation state", () => {
    const base = parseSurface(surface("a", "stable", "declare const a: number;", true));
    const [change] = diffSurfaces(base, parseSurface(""), "typescript");
    expect(change?.kind).toBe("removed");
    expect(change?.tier).toBe("stable");
    expect(change?.wasDeprecated).toBe(true);
  });

  test("detects a signature change", () => {
    const base = parseSurface(surface("a", "stable", "declare const a: number;"));
    const head = parseSurface(surface("a", "stable", "declare const a: string;"));
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("signature");
  });

  // Finding 6: renderSurface appends " *(type-only)*" OUTSIDE the backticks, where
  // HEADING's capture group cannot see it. A barrel flip from `export { SomeClass }`
  // to `export type { SomeClass }` is breaking for value consumers, so it must be
  // detected — folded into `declaration` rather than dropped on the floor.
  test("a type-only flip is detected as a signature change", () => {
    const base = parseSurface(surface("A", "stable", "declare class A {}", false, false));
    const head = parseSurface(surface("A", "stable", "declare class A {}", false, true));
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("signature");
  });

  test("an unchanged type-only marker produces no change", () => {
    const only = surface("A", "stable", "declare class A {}", false, true);
    expect(diffSurfaces(parseSurface(only), parseSurface(only), "typescript")).toEqual([]);
  });

  test("detects a demotion and a promotion", () => {
    const base = parseSurface(surface("a", "frozen", "declare const a: number;"));
    const head = parseSurface(surface("a", "stable", "declare const a: number;"));
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("demoted");
    expect(diffSurfaces(head, base, "typescript")[0]?.kind).toBe("promoted");
  });

  test("an unchanged export produces no change", () => {
    const only = surface("a", "stable", "declare const a: number;");
    expect(diffSurfaces(parseSurface(only), parseSurface(only), "typescript")).toEqual([]);
  });

  // CORRECTION 1: a Python/Go bullet's indented sub-bullets (class members, Protocol
  // methods) are not separate entries — they must be absorbed into the enclosing
  // bullet's declaration, or a member-only change on a frozen class is invisible.
  test("a class member change is detected as a signature change on the class", () => {
    const pythonSurface = (memberType: string): string =>
      [
        "## `nimbus_sdk`",
        "",
        "1 exports.",
        "",
        "- `class NegotiationOk` — **frozen**",
        `  - \`version: ${memberType}\``,
        "- `CONTRACT_VERSIONS: tuple[str, ...]` — **frozen**",
        "",
      ].join("\n");

    const base = parseSurface(pythonSurface("str"));
    const head = parseSurface(pythonSurface("int"));

    const changes = diffSurfaces(base, head, "python");
    expect(changes).toEqual([
      {
        name: "class NegotiationOk",
        kind: "signature",
        tier: "frozen",
        binding: "python",
        wasDeprecated: false,
      },
    ]);
  });

  // CORRECTION 2: a Go bullet whose declaration itself contains a backtick (a struct
  // tag) is fenced with doubled backticks and padding spaces. The greedy BULLET regex
  // still matches it; the resulting key is uglier than a normal bullet's but it must
  // stay stable and unique so these three struct types never silently drop out of the
  // surface.
  test("a doubled-backtick struct-tag bullet parses to a stable, unique key", () => {
    const goSurface = [
      "## `connectorkit`",
      "",
      "1 exports.",
      "",
      '- `` type MCPTextContent struct { Text string `json:"text"`; Type string `json:"type"` } `` — **experimental**',
      "",
    ].join("\n");

    const entries = parseSurface(goSurface);
    expect(entries.size).toBe(1);
    const [key, entry] = [...entries][0] ?? ["", undefined];
    expect(key).toContain("MCPTextContent");
    expect(entry?.tier).toBe("experimental");

    expect(diffSurfaces(parseSurface(goSurface), parseSurface(goSurface), "go")).toEqual([]);
  });

  // FIX ROUND 1: a bare name (heading form) or bare declaration (bullet form) is not
  // unique across `## `section`` boundaries — docs/api-surface.md really does publish
  // two unrelated `asRecord` functions, one from `.` and one from `./connector-kit`.
  // Every key must be qualified by its enclosing section.
  const twoHeadingSections = (aDecl: string, bDecl: string): string =>
    [
      "## `.`",
      "",
      "1 exports.",
      "",
      "### `shared`",
      "",
      "**Stability:** stable",
      "",
      "From `./a.js`.",
      "",
      "```ts",
      aDecl,
      "```",
      "",
      "## `./other`",
      "",
      "1 exports.",
      "",
      "### `shared`",
      "",
      "**Stability:** frozen",
      "",
      "From `./b.js`.",
      "",
      "```ts",
      bDecl,
      "```",
      "",
    ].join("\n");

  test("heading form: same name in two sections with different declarations parses to two entries", () => {
    const entries = twoHeadingSections(
      "declare const shared: number;",
      "declare const shared: string;",
    );
    expect(parseSurface(entries).size).toBe(2);
  });

  test("heading form: a change in one section reports exactly one signature change, attributed to it", () => {
    const base = parseSurface(
      twoHeadingSections("declare const shared: number;", "declare const shared: string;"),
    );
    const head = parseSurface(
      twoHeadingSections("declare const shared: boolean;", "declare const shared: string;"),
    );

    const changes = diffSurfaces(base, head, "typescript");
    expect(changes).toEqual([
      {
        name: "shared",
        kind: "signature",
        tier: "stable",
        binding: "typescript",
        wasDeprecated: false,
      },
    ]);
  });

  const stableType = (decl: string) =>
    [
      "### `Brief`",
      "",
      "**Stability:** stable",
      "",
      "From `./a.js`.",
      "",
      "```ts",
      decl,
      "```",
      "",
    ].join("\n");

  test("adding an optional member is `extended`, not `signature`", () => {
    const base = parseSurface(
      stableType(
        ["export type Brief = {", '    kind: "why";', "    findings: string[];", "};"].join("\n"),
      ),
    );
    const head = parseSurface(
      stableType(
        [
          "export type Brief = {",
          '    kind: "why";',
          "    subject?: string | null;",
          "    findings: string[];",
          "};",
        ].join("\n"),
      ),
    );

    expect(diffSurfaces(base, head, "typescript")).toEqual([
      {
        name: "Brief",
        kind: "extended",
        tier: "stable",
        binding: "typescript",
        wasDeprecated: false,
      },
    ]);
  });

  test("adding a REQUIRED member is still a signature change", () => {
    const base = parseSurface(
      stableType(["export type Brief = {", "    a: string;", "};"].join("\n")),
    );
    const head = parseSurface(
      stableType(["export type Brief = {", "    a: string;", "    b: number;", "};"].join("\n")),
    );
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("signature");
  });

  test("changing an existing member's type is still a signature change", () => {
    const base = parseSurface(
      stableType(["export type Brief = {", "    a: string;", "};"].join("\n")),
    );
    const head = parseSurface(
      stableType(["export type Brief = {", "    a: number;", "};"].join("\n")),
    );
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("signature");
  });

  test("making a required member optional is still a signature change", () => {
    // A consumer reading the old shape could rely on the field being present.
    const base = parseSurface(
      stableType(["export type Brief = {", "    a: string;", "};"].join("\n")),
    );
    const head = parseSurface(
      stableType(["export type Brief = {", "    a?: string;", "};"].join("\n")),
    );
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("signature");
  });

  test("removing a member is still a signature change, even alongside an optional addition", () => {
    // The classifier must require every base member to survive — otherwise a removal
    // could ride along with an addition and be laundered into a minor.
    const base = parseSurface(
      stableType(["export type Brief = {", "    a: string;", "    b: string;", "};"].join("\n")),
    );
    const head = parseSurface(
      stableType(["export type Brief = {", "    a: string;", "    c?: string;", "};"].join("\n")),
    );
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("signature");
  });

  // An optional PARAMETER is not an optional member. `tsc` emits a parameter list on one
  // line, so today an added parameter rewrites that line and is caught by containment —
  // but the classifier must not depend on that, because a future emitter could wrap.
  test("an added optional parameter is a signature change, not `extended`", () => {
    const base = parseSurface(
      stableType(["export declare function f(", "    a: string,", "): void;"].join("\n")),
    );
    const head = parseSurface(
      stableType(
        ["export declare function f(", "    a: string,", "    options?: Options,", "): void;"].join(
          "\n",
        ),
      ),
    );
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("signature");
  });

  // The other half of that boundary: an optional property added inside an expanded inline
  // object type IS additive for every caller, and must stay `extended`. `createBriefGuard`
  // in the real golden has exactly this shape.
  test("an optional property inside an expanded object type stays `extended`", () => {
    const base = parseSurface(
      stableType(
        ["export declare function f(opts?: {", "    requireQuery?: boolean;", "}): void;"].join(
          "\n",
        ),
      ),
    );
    const head = parseSurface(
      stableType(
        [
          "export declare function f(opts?: {",
          "    requireQuery?: boolean;",
          "    strict?: boolean;",
          "}): void;",
        ].join("\n"),
      ),
    );
    expect(diffSurfaces(base, head, "typescript")[0]?.kind).toBe("extended");
  });

  test("bullet form: identical declaration text in two sections parses to two entries", () => {
    const twoBulletSections = [
      "## `nimbus_sdk`",
      "",
      "1 exports.",
      "",
      "- `func shared() string` — **stable**",
      "",
      "## `nimbus_sdk.other`",
      "",
      "1 exports.",
      "",
      "- `func shared() string` — **stable**",
      "",
    ].join("\n");

    expect(parseSurface(twoBulletSections).size).toBe(2);
  });
});

/**
 * Anti-vacuity: `parseSurface`'s correctness against the real goldens was previously
 * proved only by an uncommitted scratch script. This gate's one unsurvivable failure
 * mode is a parser that silently returns too few entries — it then reads every real
 * diff as "nothing changed" and passes everything, failing OPEN. `> 0` would not catch
 * a regression that still returns *some* entries, so the counts are pinned exactly.
 * Pinning them exactly also means adding a new entry point forces an update here,
 * which is the moment to check the gate still sees the whole surface — the same
 * reasoning `api-surface.ts` uses when it refuses to write a golden with zero exports.
 */
describe("parseSurface against the real goldens", () => {
  test("docs/api-surface.md", () => {
    expect(parseSurface(readFromRepo("docs/api-surface.md")).size).toBe(248);
  });

  test("docs/api-surface-python.md", () => {
    expect(parseSurface(readFromRepo("docs/api-surface-python.md")).size).toBe(123);
  });

  test("docs/api-surface-go.md", () => {
    expect(parseSurface(readFromRepo("docs/api-surface-go.md")).size).toBe(180);
  });
});

describe("source annotations on bullets", () => {
  const withoutSource = "## `ipc`\n\n- `func ParseHello(s string) HelloResult` — **frozen**\n";
  const withSource =
    "## `ipc`\n\n- `func ParseHello(s string) HelloResult` — **frozen** — from `ipc/hello`\n";

  test("an annotation after the tier leaves the key and the entry identical", () => {
    const before = parseSurface(withoutSource);
    const after = parseSurface(withSource);

    expect([...after.keys()]).toEqual([...before.keys()]);
    expect([...after.keys()]).toEqual(["ipc::func ParseHello(s string) HelloResult"]);
    expect(after.get("ipc::func ParseHello(s string) HelloResult")).toEqual(
      before.get("ipc::func ParseHello(s string) HelloResult") as SurfaceEntry,
    );
  });

  test("adding the annotation to a whole golden produces no SurfaceChange", () => {
    expect(diffSurfaces(parseSurface(withoutSource), parseSurface(withSource), "go")).toEqual([]);
  });

  test("a doubled-backtick span (a Go struct tag) still parses with an annotation", () => {
    const entries = parseSurface(
      '## `connectorkit`\n\n- ``type T struct { X string `json:"x"` }`` — **experimental** — from `connectorkit/types`\n',
    );
    expect(entries.size).toBe(1);
    expect([...entries.values()][0]?.tier).toBe("experimental");
  });
});
