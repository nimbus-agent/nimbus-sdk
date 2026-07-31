/**
 * The drift guard the deleted `examples/quickstart-connector/` used to carry.
 *
 * That example existed so the published README's quickstart had something CI executed, and its
 * test asserted the two were byte-identical. The example is gone — it taught `registerTool`,
 * which discards both its arguments — and the quickstart is now the generated template, which
 * CI generates, installs, builds, tests and drives as a process. The guard has to move with it,
 * or the README goes stale against code that is running.
 *
 * The old assertion could be equality: the README fence *was* the example file, whole. It cannot
 * be here — the README and the quickstart pages show excerpts of a 114-line `main.ts` — so this
 * is deliberately weaker and honest about it: every line a document quotes must be a real line of
 * the file it names, and the lines must appear in the same order. That catches an edited quote, a
 * renamed symbol, a changed signature and reordered code; it does not catch a quote that omits
 * something newly important. A weaker guard that holds beats a stronger one that is fictional.
 *
 * Two marker kinds, because two things get quoted:
 *
 * - `<!-- excerpt-of: <path> -->` — source code. Whole-line matching, so indentation is content.
 * - `<!-- quoted-from: <path> -->` — text embedded in a string literal, `index.ts`'s `USAGE`
 *   among them, whose first line is not a whole line of the file (`const USAGE = \`Usage: …`).
 *   Substring matching, still order-preserving.
 *
 * Blank lines and a lone elision marker (`// …`, `# …`, `…`) are skipped; everything else is
 * checked. Adding a marker to any listed document opts that fence in — nothing has to be
 * registered here.
 *
 * Two limits, both deliberate. **Under-quoting is not caught:** an excerpt is a subsequence,
 * so deleting a line from a quote leaves it green. That is the one axis the old equality check
 * covered and this cannot. **`DOCUMENTS` is a fixed list, not discovery:** a fourth page
 * carrying markers is unguarded until its path is added below, so "adding a marker opts a
 * fence in" holds only *within* these three files. Discovery was rejected — globbing `docs/`
 * would silently take on the RFCs and the spec, whose fences quote frozen historical text on
 * purpose and would start failing as the code moves past them.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** `<repo>/tools/create-connector/src` → `<repo>`. */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** Documents whose marked fences are checked. Repo-root-relative, POSIX. */
const DOCUMENTS = [
  "sdks/typescript/README.md",
  "docs/quickstart-typescript.md",
  "docs/quickstart-python.md",
] as const;

const MARKER = /^<!--\s*(excerpt-of|quoted-from):\s*(\S+)\s*-->\s*$/;
const FENCE = /^\s*```/;
const ELISIONS = new Set(["// …", "# …", "…"]);

/** How many lines after a marker the opening fence may appear. Markdown wants a blank line. */
const FENCE_LOOKAHEAD = 3;

interface Excerpt {
  readonly document: string;
  /** 1-based line of the marker, for failure messages. */
  readonly line: number;
  readonly kind: "excerpt-of" | "quoted-from";
  /** Repo-root-relative path the marker names. */
  readonly source: string;
  readonly body: readonly string[];
}

function readRepoFile(relative: string): string {
  return readFileSync(join(REPO_ROOT, ...relative.split("/")), "utf8").replace(/\r\n?/g, "\n");
}

/** Trailing whitespace is what an editor changes; leading whitespace is content. */
function stripTrailing(line: string): string {
  return line.replace(/\s+$/, "");
}

function isChecked(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== "" && !ELISIONS.has(trimmed);
}

function excerptsIn(document: string): Excerpt[] {
  const lines = readRepoFile(document).split("\n");
  const found: Excerpt[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const marker = MARKER.exec(lines[i] ?? "");
    if (marker === null) continue;

    let open = -1;
    for (let j = i + 1; j <= i + FENCE_LOOKAHEAD && j < lines.length; j += 1) {
      if ((lines[j] ?? "").trim() === "") continue;
      if (FENCE.test(lines[j] ?? "")) open = j;
      break;
    }
    if (open === -1) {
      throw new Error(`${document}:${i + 1} — an excerpt marker is not followed by a fenced block`);
    }

    const body: string[] = [];
    let close = -1;
    for (let j = open + 1; j < lines.length; j += 1) {
      if (FENCE.test(lines[j] ?? "")) {
        close = j;
        break;
      }
      body.push(stripTrailing(lines[j] ?? ""));
    }
    if (close === -1) {
      throw new Error(`${document}:${open + 1} — the excerpt's fenced block is never closed`);
    }

    found.push({
      document,
      line: i + 1,
      kind: (marker[1] ?? "excerpt-of") as Excerpt["kind"],
      source: marker[2] ?? "",
      body,
    });
    i = close;
  }

  return found;
}

const EXCERPTS = DOCUMENTS.flatMap(excerptsIn);

describe("documentation excerpts are pinned to the code they quote", () => {
  test("every listed document carries at least one marked excerpt", () => {
    for (const document of DOCUMENTS) {
      expect(
        EXCERPTS.filter((excerpt) => excerpt.document === document).length,
        `${document} has no <!-- excerpt-of: … --> marker; the quickstart it documents is ` +
          "unpinned and can drift from the template silently",
      ).toBeGreaterThan(0);
    }
  });

  test.each(EXCERPTS.map((excerpt) => [`${excerpt.document}:${excerpt.line}`, excerpt] as const))(
    "%s quotes its source faithfully",
    (label, excerpt) => {
      const checked = excerpt.body.filter(isChecked);
      expect(
        checked.length,
        `${label} — an excerpt of ${excerpt.source} with fewer than three checked lines is not ` +
          "a guard; if the quote shrank this far, delete the marker deliberately",
      ).toBeGreaterThanOrEqual(3);

      const text = readRepoFile(excerpt.source);
      const sourceLines = text.split("\n").map(stripTrailing);

      let cursor = 0;
      for (const line of checked) {
        const at =
          excerpt.kind === "excerpt-of"
            ? sourceLines.indexOf(line, cursor)
            : text.indexOf(line, cursor);
        expect(
          at,
          `${label} — ${JSON.stringify(line)} is not in ${excerpt.source} after ` +
            `${excerpt.kind === "excerpt-of" ? `line ${String(cursor)}` : `offset ${String(cursor)}`}` +
            ". The document and the code it quotes have drifted apart: fix whichever is wrong.",
        ).toBeGreaterThanOrEqual(0);
        cursor = excerpt.kind === "excerpt-of" ? at + 1 : at + line.length;
      }
    },
  );
});
