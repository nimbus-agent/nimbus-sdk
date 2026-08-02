import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  DIAGNOSTIC_LEVELS,
  encodeDiagnostic,
  meetsLevel,
  parseDiagnostic,
} from "../src/diagnostics/event.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/diagnostics/v1/diagnostics.md";
const EVENT_SCHEMA_PATH = "docs/spec/diagnostics/v1/diagnostic-event.schema.json";
const LEVELS_PATH = "docs/spec/diagnostics/v1/levels.json";

/** The one normative spelling of each pattern. Every other copy is compared against this. */
const TS_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$";
const NAME_PATTERN = "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)*$";
const FIELD_KEY_PATTERN = "^[a-z][a-z0-9]*$";
const CORRELATION_ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$";

describe("published artifacts", () => {
  test("the spec document exists and is normative", () => {
    const text = readText(SPEC_PATH);
    expect(text).toContain("**Status:** normative");
    expect(text).toContain("RFC 2119");
  });

  test("the event schema compiles under Ajv", () => {
    const ajv = new Ajv({ strict: false });
    expect(() => ajv.compile(readJson(EVENT_SCHEMA_PATH) as object)).not.toThrow();
  });

  test("levels.json publishes the four levels in order", () => {
    expect(readJson(LEVELS_PATH)).toEqual({ levels: ["debug", "info", "warn", "error"] });
  });

  test("no published pattern uses a shorthand digit class", () => {
    // `\d` is ASCII-only in JavaScript and Unicode-aware in Python and Rust. A binding
    // transcribing it silently accepts "١٢٣". Spelled classes remove the keystroke.
    expect(readText(EVENT_SCHEMA_PATH)).not.toContain("\\\\d");
  });

  test("the schema spells every pattern exactly as the spec does", () => {
    const schema = readJson(EVENT_SCHEMA_PATH) as {
      properties: Record<string, { pattern?: string; propertyNames?: { pattern: string } }>;
    };
    // Bracket access and optional chaining are required, not stylistic:
    // noPropertyAccessFromIndexSignature forbids dotting into a Record, and
    // noUncheckedIndexedAccess makes every lookup possibly-undefined. A missing
    // member still fails the comparison, so neither weakens the assertion.
    expect(schema.properties["ts"]?.pattern).toBe(TS_PATTERN);
    expect(schema.properties["event"]?.pattern).toBe(NAME_PATTERN);
    expect(schema.properties["correlationId"]?.pattern).toBe(CORRELATION_ID_PATTERN);
    expect(schema.properties["fields"]?.propertyNames?.pattern).toBe(FIELD_KEY_PATTERN);
  });
});

const CORPUS_DIR = "docs/spec/conformance/v1/diagnostics";
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const CORPUS_INDEX_PATH = `${CORPUS_DIR}/index.json`;

interface IndexEntry {
  file: string;
  section: string;
  reason: string;
}
interface Case {
  description: string;
  kind: "encode" | "parse" | "level";
  event?: unknown;
  line?: string;
  level?: string;
  threshold?: string;
  expect: Record<string, unknown>;
}

const index = readJson(CORPUS_INDEX_PATH) as { spec: string; cases: IndexEntry[] };
// Entry and body travel together rather than as two arrays indexed in parallel:
// noUncheckedIndexedAccess makes `index.cases[i]` possibly-undefined at every use.
const loaded = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));
const cases: Case[] = loaded.map((l) => l.body);

/**
 * The one reason no corpus case pins.
 *
 * Producing `line-too-long` requires an event whose encoded line exceeds
 * `IPC_MAX_LINE_BYTES` (1 MiB), so the case file would itself be over a megabyte — and
 * both packages ship `docs/spec`, the Python one bundling it into the wheel. It is pinned
 * instead by a unit test in each binding, which builds the oversized string in memory and
 * costs nothing on disk.
 *
 * Asserted below to be the ONLY exclusion, so this list cannot grow quietly.
 */
const UNPINNABLE_REASONS: ReadonlySet<string> = new Set(["line-too-long"]);

describe("diagnostics corpus", () => {
  test("every case validates against case.schema.json", () => {
    const validate = new Ajv({ strict: false }).compile(readJson(CASE_SCHEMA_PATH) as object);
    for (const { entry, body } of loaded) {
      if (!validate(body)) {
        throw new Error(`${entry.file}: ${JSON.stringify(validate.errors)}`);
      }
    }
  });

  test("the index validates against index.schema.json", () => {
    const validate = new Ajv({ strict: false }).compile(
      readJson(`${CORPUS_DIR}/index.schema.json`) as object,
    );
    if (!validate(index)) throw new Error(JSON.stringify(validate.errors));
  });

  test("every case on disk is indexed, and every indexed case exists", () => {
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases")).filter((f) =>
      f.endsWith(".json"),
    );
    expect(new Set(index.cases.map((e) => e.file.replace("cases/", "")))).toEqual(new Set(onDisk));
  });

  test("the corpus is not empty", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test("every level appears in an accepted encode case", () => {
    const accepted = new Set(
      cases
        .filter((c) => c.kind === "encode" && c.expect["ok"])
        .map((c) => (c.event as { level?: string } | null)?.level),
    );
    for (const level of DIAGNOSTIC_LEVELS) expect(accepted).toContain(level);
  });

  test("every reason token is produced by at least one case", () => {
    const schema = readJson(CASE_SCHEMA_PATH) as {
      properties: { expect: { properties: { reason: { enum: string[] } } } };
    };
    const produced = new Set(cases.filter((c) => !c.expect["ok"]).map((c) => c.expect["reason"]));
    for (const reason of schema.properties.expect.properties.reason.enum) {
      if (UNPINNABLE_REASONS.has(reason)) continue;
      expect(produced).toContain(reason);
    }
  });

  test("line-too-long is the only reason the corpus does not pin", () => {
    // Guards the carve-out above: widening it requires editing this assertion, which is
    // what makes the exclusion reviewable rather than silent.
    expect([...UNPINNABLE_REASONS]).toEqual(["line-too-long"]);
  });

  test("every envelope member has both an accept and a reject case", () => {
    // The gate with no precedent: it is what stops a member shipping unpinned.
    const members = [
      "ts",
      "level",
      "extensionId",
      "event",
      "kind",
      "correlationId",
      "fields",
      "error",
    ];
    const accepted = new Set(
      cases
        .filter((c) => c.kind === "encode" && Boolean(c.expect["ok"]))
        .flatMap((c) => Object.keys((c.event ?? {}) as object)),
    );
    const rejectedPaths = new Set(
      cases.filter((c) => !c.expect["ok"]).map((c) => String(c.expect["path"] ?? "").split("/")[1]),
    );
    for (const member of members) {
      expect(accepted).toContain(member);
      expect(rejectedPaths).toContain(member);
    }
  });

  test("the runtime level set matches the published data", () => {
    // Drift: the package is dependency-free and does no I/O, so the runtime holds its
    // own copy. Same situation as row-data-segments.json, same guard.
    // Published data first: `[...DIAGNOSTIC_LEVELS]` is a literal-union array, which
    // toEqual will not accept a plain string[] against. The assertion is the same.
    expect((readJson(LEVELS_PATH) as { levels: string[] }).levels).toEqual([...DIAGNOSTIC_LEVELS]);
  });
});

describe("diagnostics corpus — execution", () => {
  for (const { entry, body } of loaded) {
    test(`${entry.file}: ${body.description}`, () => {
      if (body.kind === "encode") {
        const result = encodeDiagnostic(body.event);
        if (body.expect["ok"]) {
          expect(result).toEqual({ ok: true, line: body.expect["line"] as string });
        } else {
          expect(result).toEqual({
            ok: false,
            reason: body.expect["reason"] as never,
            path: body.expect["path"] as string,
          });
        }
      } else if (body.kind === "parse") {
        const result = parseDiagnostic(body.line as string);
        if (body.expect["ok"]) {
          expect(result).toEqual({ ok: true, event: body.expect["event"] as never });
        } else {
          expect(result).toEqual({
            ok: false,
            reason: body.expect["reason"] as never,
            path: body.expect["path"] as string,
          });
        }
      } else {
        expect(meetsLevel(body.level as never, body.threshold as never)).toBe(
          body.expect["meets"] as boolean,
        );
      }
    });
  }
});

describe("audit-logger deprecation window", () => {
  test("all three exports are marked, and the message survives extraction", () => {
    const surface = readText("docs/api-surface.md");
    for (const name of ["createScopedAuditLogger", "AuditLogger", "AuditEmit"]) {
      const section = surface.split(`### \`${name}\``)[1] ?? "";
      expect(section).toContain("**Deprecated:**");
      // The extractor ends a @deprecated message at the next whitespace-preceded @word,
      // so an unwrapped @nimbus-dev/sdk truncates it to "use". Backticks are required.
      expect(section).toContain("`@nimbus-dev/sdk/diagnostics`");
      expect(section).toContain("2.0.0");
    }
  });
});
