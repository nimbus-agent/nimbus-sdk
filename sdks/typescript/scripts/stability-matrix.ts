/**
 * The cross-language stability matrix — capability rows, language columns, tier cells.
 *
 * The tier is READ from the three surface goldens on every render and never stored in the
 * claim comments, which carry grouping only. That is what makes a stale cell
 * unrepresentable rather than merely detectable: there is no second copy of the tier to go
 * stale. See docs/superpowers/specs/2026-08-30-stability-matrix-design.md §6.
 *
 * All I/O arrives through `MatrixIO` so the whole renderer is drivable from synthetic
 * input, for the same reason `docs-modules.ts` reads no files.
 */

import { buildSurface, collectEntryPoints, normalizeEol, type Tier } from "./api-surface.ts";
import { type Binding, MODULES_DIR, moduleKeyOf, parseCovers } from "./docs-modules.ts";
import { tiersByFile } from "./surface-claims.ts";

export type MatrixIO = {
  /** Repo-root-relative read: `docs/…`, `sdks/…`. */
  readRepo: (path: string) => string;
  /** TypeScript-package-root-relative read: `package.json`, `dist/…`. */
  readPackage: (path: string) => string;
  /** The `docs/modules/*.md` file names, sorted. */
  pages: () => readonly string[];
};

const BINDINGS: readonly Binding[] = ["typescript", "python", "go"];
const COLUMN: Record<Binding, string> = {
  typescript: "TypeScript",
  python: "Python",
  go: "Go",
};

/** Weakest first — a capability promises no more than its weakest published part. */
const WEAKEST_FIRST: readonly Tier[] = ["experimental", "stable", "frozen"];

/** A page's optional explanation for a row whose cells disagree (design §7). */
const TIER_NOTE = /<!--\s*tier-note:([\s\S]*?)-->/;

/** Every tier TypeScript publishes, grouped by the module key a page claims. */
function typescriptTiers(io: MatrixIO): Map<string, Tier[]> {
  const entries = collectEntryPoints(io.readPackage("package.json"));
  const surfaces = buildSurface(entries, io.readPackage);
  const fileOf = new Map(entries.map((entry) => [entry.label, entry.file]));

  const byModule = new Map<string, Tier[]>();
  for (const surface of surfaces) {
    const entryFile = fileOf.get(surface.label);
    if (entryFile === undefined) {
      throw new Error(
        `surface has no entry point named "${surface.label}" — collectEntryPoints() and ` +
          "buildSurface() were called with different inputs.",
      );
    }
    for (const exported of surface.exports) {
      const key = moduleKeyOf(entryFile, exported.source);
      const list = byModule.get(key);
      if (list === undefined) byModule.set(key, [exported.stability]);
      else list.push(exported.stability);
    }
  }
  return byModule;
}

function weakest(tiers: readonly Tier[]): Tier {
  for (const tier of WEAKEST_FIRST) {
    if (tiers.includes(tier)) return tier;
  }
  throw new Error("weakest() called with an empty tier list");
}

/** The page name a row is titled by: `ipc.md` -> `ipc`. */
function capabilityOf(file: string): string {
  return file.replace(/\.md$/, "");
}

type Row = { capability: string; cells: Record<Binding, Tier | null>; note: string | null };

function buildRows(io: MatrixIO): Row[] {
  const tiers: Record<Binding, Map<string, Tier[]>> = {
    typescript: typescriptTiers(io),
    python: tiersByFile(io.readRepo("docs/api-surface-python.md")),
    go: tiersByFile(io.readRepo("docs/api-surface-go.md")),
  };

  const rows: Row[] = [];
  for (const file of io.pages()) {
    // Normalised before matching, the way `parseCovers` and `api-surface.ts` already do.
    // `.gitattributes` sets `eol=lf`, but that governs checkout, not what an editor or a
    // stale working tree may hand back — and the repository normalises defensively rather
    // than trusting it.
    const text = normalizeEol(io.readRepo(`${MODULES_DIR}/${file}`));
    const claims = parseCovers(text);
    if (claims === null) continue;

    const cells: Record<Binding, Tier | null> = { typescript: null, python: null, go: null };
    for (const binding of BINDINGS) {
      const claimed = claims[binding].flatMap((key) => tiers[binding].get(key) ?? []);
      cells[binding] = claimed.length === 0 ? null : weakest(claimed);
    }

    rows.push({ capability: capabilityOf(file), cells, note: noteIn(text, file) });
  }
  return rows;
}

/**
 * A page's tier note, or null when it carries none.
 *
 * An EMPTY note throws rather than reading as absent. `<!-- tier-note: -->` is either an
 * unfinished sentence or an attempt to quiet the gate, and both deserve the same answer
 * `parseCovers` already gives an empty claim list: a marker that explains nothing cannot
 * be checked. Returning null instead would fire the disagreement error, but its message
 * would say the page has no explanation while a `tier-note` comment sits plainly in it.
 */
function noteIn(pageText: string, file: string): string | null {
  const matched = TIER_NOTE.exec(pageText);
  if (matched === null) return null;
  const note = (matched[1] ?? "").trim();
  if (note.length === 0) {
    throw new Error(
      `docs/modules/${file} has an empty "tier-note:" comment. A note that explains ` +
        "nothing cannot be reviewed — say why the tiers differ, or delete the comment.",
    );
  }
  return note;
}

/**
 * A row whose bound cells disagree must explain itself.
 *
 * RFC-0015 §3 permits the same helper sitting at different tiers in two bindings, so a
 * disagreement is sometimes correct — which is exactly why it needs a recorded reason
 * rather than a rule. A gap needs none: gaps are the majority case and all say the same
 * thing (design §7).
 */
function assertDisagreementsExplained(rows: readonly Row[]): void {
  for (const row of rows) {
    const bound = BINDINGS.map((binding) => row.cells[binding]).filter(
      (tier): tier is Tier => tier !== null,
    );
    if (new Set(bound).size <= 1 || row.note !== null) continue;
    throw new Error(
      `"${row.capability}" is ${bound.join(" in one binding and ")} in another, with no ` +
        "explanation. A tier may honestly differ between bindings (RFC-0015 §3), so add " +
        `<!-- tier-note: … --> to docs/modules/${row.capability}.md saying why, or correct ` +
        "the tiers in source.",
    );
  }
}

/**
 * A row whose bound cells now AGREE must not still carry a note.
 *
 * The mirror image of `assertDisagreementsExplained`: a note is a second copy of the
 * tier, restated in prose, and this design's whole claim is that there is no second copy
 * to go stale. Left unchecked, a tier could later change until the disagreement a note
 * once explained no longer exists — the disagreement check stops requiring the note, and
 * a now-false explanation lingers, checked by nothing. This closes that path from the
 * other direction: an agreeing row with a note is itself the failure.
 */
function assertNoStaleNotes(rows: readonly Row[]): void {
  for (const row of rows) {
    if (row.note === null) continue;
    const bound = BINDINGS.map((binding) => row.cells[binding]).filter(
      (tier): tier is Tier => tier !== null,
    );
    if (new Set(bound).size > 1) continue;
    throw new Error(
      `docs/modules/${row.capability}.md has a "tier-note:" comment, but "${row.capability}" ` +
        "no longer disagrees across bindings — the tiers now agree. The note is stale: " +
        "remove it, or correct the tiers if the agreement itself is the mistake.",
    );
  }
}

/**
 * What a tier buys a consumer. Sourced from RFC-0015 §1-2 and DEPRECATION-POLICY.md; a
 * literal here rather than parsed out of them, because prose is not a data source and a
 * regex over an RFC would break the next time someone rewords a sentence.
 */
const TIER_PROMISE: ReadonlyArray<readonly [Tier, string, string, string]> = [
  ["frozen", "Yes — a normative spec and a conformance corpus", "Full window", "Yes"],
  ["stable", "No", "Full window", "No"],
  ["experimental", "No", "None — may change or be removed at any time", "No"],
];

function renderLegend(): string {
  const rows = TIER_PROMISE.map(
    ([tier, backed, window, rfc]) => `| \`${tier}\` | ${backed} | ${window} | ${rfc} |`,
  );
  return [
    "## What each tier promises",
    "",
    "| Tier | Spec- and corpus-backed | Deprecation window before removal | RFC required to break |",
    "|---|---|---|---|",
    ...rows,
    "",
    "The window itself is [`DEPRECATION-POLICY.md`](./DEPRECATION-POLICY.md)'s: marked in a",
    "minor, surviving a later minor, removed at a major. Tier and deprecation are orthogonal —",
    "an export can be `stable` and `@deprecated` at once (RFC-0015 §1).",
  ].join("\n");
}

type BindingFacts = {
  readonly column: string;
  readonly pkg: string;
  readonly registry: string;
  readonly rfc: string;
};

const BINDING_FACTS: Record<Binding, BindingFacts> = {
  typescript: {
    column: "TypeScript",
    pkg: "`@nimbus-dev/sdk`",
    registry: "npm",
    rfc: "[RFC-0016](./rfcs/0016-typescript-sdk-official.md)",
  },
  python: {
    column: "Python",
    pkg: "`nimbus-dev-sdk`",
    registry: "PyPI",
    rfc: "[RFC-0008](./rfcs/0008-python-sdk-official.md)",
  },
  go: {
    column: "Go",
    pkg: "`github.com/nimbus-agent/nimbus-sdk/sdks/go`",
    registry: "module proxy (a `sdks/go/vX.Y.Z` tag)",
    rfc: "[RFC-0013](./rfcs/0013-go-sdk-official.md)",
  },
};

type Coverage = {
  languages: Record<string, { claims: string[]; unclaimed: Record<string, string> }>;
};

function renderBindingStatus(io: MatrixIO): string {
  const coverage = JSON.parse(io.readRepo("docs/conformance-coverage.json")) as Coverage;
  const rows = BINDINGS.map((binding) => {
    const facts = BINDING_FACTS[binding];
    const entry = coverage.languages[binding];
    if (entry === undefined) {
      throw new Error(
        `docs/conformance-coverage.json has no "${binding}" language entry — the matrix ` +
          "cannot state its corpora. Add it there rather than hard-coding a count here.",
      );
    }
    const total = entry.claims.length + Object.keys(entry.unclaimed).length;
    return `| ${facts.column} | Official — ${facts.rfc} | ${facts.pkg} | ${facts.registry} | ${entry.claims.length} of ${total} |`;
  });

  return [
    "## Binding status",
    "",
    "| Binding | Officiality | Package | Published through | Corpora executed |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "Officiality is a governance act, not a test result — it is",
    "[GOVERNANCE.md's four criteria](./GOVERNANCE.md#how-a-language-becomes-official), the",
    "fourth of which is an accepted RFC. Which corpora each binding executes, and why it",
    "does not claim the rest, is [`conformance-coverage.md`](./conformance-coverage.md)'s.",
  ].join("\n");
}

/** The first capture of `pattern` in `text`, or a failure naming what was being read. */
function must(text: string, pattern: RegExp, what: string): string {
  const found = pattern.exec(text)?.[1];
  if (found === undefined) {
    throw new Error(`could not read ${what} — the matrix will not restate a floor it cannot find.`);
  }
  return found;
}

function renderRuntimeSupport(io: MatrixIO): string {
  const node = (JSON.parse(io.readPackage("package.json")) as { engines?: { node?: string } })
    .engines?.node;
  if (node === undefined) {
    throw new Error("sdks/typescript/package.json declares no engines.node");
  }
  const python = must(
    io.readRepo("sdks/python/pyproject.toml"),
    /^requires-python\s*=\s*"([^"]+)"/m,
    "requires-python from sdks/python/pyproject.toml",
  );
  const go = must(
    io.readRepo("sdks/go/go.mod"),
    /^go\s+(\S+)/m,
    "the go directive from sdks/go/go.mod",
  );

  return [
    "## Runtime support",
    "",
    "| Binding | Declared floor | Where it is declared |",
    "|---|---|---|",
    `| TypeScript | \`${node}\` | \`engines.node\` |`,
    `| Python | \`${python}\` | \`requires-python\` |`,
    `| Go | \`${go}\` | the \`go\` directive |`,
    "",
    "These are read from the packages themselves on every render, so this table cannot",
    "drift from what the packages declare. CI proves each floor on Linux and Windows on",
    "every pull request; macOS runs only the newest supported Node and Go, not the floor",
    "itself, so this table's Go and TypeScript rows are unproven there (Python's floor",
    "runs on all three). See [docs/README.md](./README.md#supported-versions) for every",
    "version CI actually tests, per OS. Go's floor names the *older* of the two supported",
    "minors on purpose. Dropping a runtime version is a breaking change under",
    "[`DEPRECATION-POLICY.md`](./DEPRECATION-POLICY.md).",
  ].join("\n");
}

const BANNER = `# Stability and support matrix

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with \`bun run build && bun run stability:matrix\`.
     Tiers are read from the three API-surface goldens on every render and are never
     stored here — see docs/superpowers/specs/2026-08-30-stability-matrix-design.md. -->

What each capability promises you, in each language that binds it. A \`—\` means that
binding does not publish the capability at all.
`;

function renderTable(rows: readonly Row[]): string {
  const head = `| Capability | ${BINDINGS.map((b) => COLUMN[b]).join(" | ")} |`;
  const rule = `|---|${BINDINGS.map(() => "---").join("|")}|`;
  const body = rows.map((row) => {
    const cells = BINDINGS.map((binding) => {
      const tier = row.cells[binding];
      return tier === null ? "—" : `\`${tier}\``;
    });
    return `| [\`${row.capability}\`](./modules/${row.capability}.md) | ${cells.join(" | ")} |`;
  });
  return [head, rule, ...body].join("\n");
}

export function renderMatrix(io: MatrixIO): string {
  const rows = buildRows(io);
  if (rows.length === 0) {
    throw new Error("no capability pages resolved — the matrix would render empty");
  }
  assertDisagreementsExplained(rows);
  assertNoStaleNotes(rows);
  return [
    BANNER,
    renderTable(rows),
    "",
    renderLegend(),
    "",
    renderBindingStatus(io),
    "",
    renderRuntimeSupport(io),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const { readdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { packageRoot, repoRoot } = await import("./paths.ts");

  const io: MatrixIO = {
    readRepo: (path) => readFileSync(join(repoRoot, path), "utf8"),
    readPackage: (path) => readFileSync(join(packageRoot, path), "utf8"),
    pages: () =>
      readdirSync(join(repoRoot, MODULES_DIR))
        .filter((name) => name.endsWith(".md"))
        .sort(),
  };
  writeFileSync(join(repoRoot, "docs/stability-matrix.md"), renderMatrix(io), "utf8");
}
