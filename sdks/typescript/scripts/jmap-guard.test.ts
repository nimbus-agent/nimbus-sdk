/**
 * The executable form of `docs/spec/batteries/v1/jmap.md`.
 *
 * Structured like `icalendar-guard.test.ts`: validate the published schemas, hold the index
 * and the directory to each other, execute every case against the reference binding, and
 * refuse to pass vacuously.
 *
 * What this corpus exercises that no earlier one did: **ten** kinds, because §1's surface is
 * ten operations rather than one or two, and one of them — `validate-url` — is the only
 * function in any battery that **raises** rather than returning an absence (§5.1). Its cases
 * carry `ok: false` and an exact message, following `url-resolution`'s shape.
 *
 * `request` cases compare a **parsed structure**, never a serialised string: §9 records that
 * Go's `encoding/json` sorts a map's keys where the other two emit insertion order, so bytes
 * are not comparable across bindings.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  buildGetRequest,
  buildListRequest,
  buildSearchRequest,
  CORE_CAPABILITY,
  EMAIL_PROPERTIES,
  extractAttachments,
  extractEmailList,
  formatAddresses,
  MAIL_CAPABILITY,
  MAX_BODY_VALUE_BYTES,
  methodResponseArgs,
  PREVIEW_MAX_CHARS,
  parseSession,
  previewFor,
  SUBMISSION_CAPABILITY,
  validateApiUrl,
  viewEmail,
} from "../src/jmap-fastmail/index.ts";
import { createRecorder } from "./conformance-report.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/batteries/v1/jmap.md";
const CORPUS_DIR = "docs/spec/conformance/v1/jmap";
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const INDEX_PATH = `${CORPUS_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;

const KINDS = [
  "constants",
  "session",
  "validate-url",
  "view-email",
  "addresses",
  "attachments",
  "preview",
  "request",
  "extract",
  "extract-list",
] as const;

/**
 * Every section a case can pin.
 *
 * §1 and §9 are prose. §1.1 is a security *statement* about §2's and §6's numbers rather
 * than a rule of its own, and is pinned through them.
 */
const PINNED_SECTIONS = [
  "§2",
  "§3",
  "§4",
  "§5",
  "§5.1",
  "§5.2",
  "§6",
  "§6.1",
  "§6.2",
  "§6.3",
  "§6.4",
  "§7.1",
  "§7.2",
  "§7.3",
  "§8",
] as const;

type Case = {
  description: string;
  kind: (typeof KINDS)[number];
  parsed?: unknown;
  candidate?: string;
  allowedBase?: string;
  raw?: unknown;
  value?: unknown;
  form?: "list" | "search" | "get";
  accountId?: string;
  limit?: number;
  query?: string;
  id?: string;
  methodName?: string;
  expect: Record<string, unknown>;
};
type IndexEntry = { file: string; section: string; reason: string };

const index = readJson(INDEX_PATH) as { spec: string; cases: IndexEntry[] };
const cases: { entry: IndexEntry; body: Case }[] = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

const recorder = createRecorder("jmap", "guard");
afterAll(() => recorder.flush());

const ofKind = (kind: (typeof KINDS)[number]): { entry: IndexEntry; body: Case }[] =>
  cases.filter(({ body }) => body.kind === kind);

/** `TextEncoder`, never `Buffer` — no package in this repository declares `@types/node`. */
const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

/** A lone surrogate — ill-formed UTF-16, and not encodable as UTF-8 by any consumer. */
const hasLoneSurrogate = (s: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s) || /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe("published artifacts", () => {
  test("the spec document exists and is normative", () => {
    const text = readText(SPEC_PATH);
    expect(text).toContain("**Status:** normative");
    expect(text).toContain("RFC 2119");
  });

  test("the index validates against its own schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(INDEX_SCHEMA_PATH) as object);
    expect(validate(index), JSON.stringify(validate.errors)).toBe(true);
  });

  test("every case validates against the case schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(CASE_SCHEMA_PATH) as object);
    for (const { entry, body } of cases) {
      expect(validate(body), `${entry.file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  test("the index and the cases directory hold each other", () => {
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases")).sort();
    const indexed = index.cases.map((c) => c.file.replace("cases/", "")).sort();
    expect(indexed).toEqual(onDisk);
  });
});

describe("the corpus cannot pass vacuously", () => {
  test("it is non-empty, and every declared kind has a case", () => {
    expect(cases.length).toBeGreaterThanOrEqual(55);
    expect([...new Set(cases.map(({ body }) => body.kind))].sort()).toEqual([...KINDS].sort());
  });

  test("§5's three rejection messages are each pinned, verbatim", () => {
    // §R5 makes the message contract text: a binding refusing for the right reason in
    // different words does not conform. Without one case per message, two of the three
    // branches are untested.
    const messages = new Set(
      ofKind("validate-url")
        .filter(({ body }) => body.expect["ok"] === false)
        .map(({ body }) => body.expect["message"] as string),
    );
    expect(messages.has("JMAP apiUrl is not a valid absolute URL")).toBe(true);
    expect(messages.has("JMAP apiUrl must use https")).toBe(true);
    expect([...messages].some((m) => m.startsWith("JMAP apiUrl host "))).toBe(true);
  });

  test("§5.1 is pinned by a case expecting a raise, and by one expecting acceptance", () => {
    const urls = ofKind("validate-url");
    expect(urls.some(({ body }) => body.expect["ok"] === false)).toBe(true);
    expect(urls.some(({ body }) => body.expect["ok"] === true)).toBe(true);
  });

  test("§5.2's three host-normalisation hazards are each pinned", () => {
    // Measured: the three URL parsers disagree three ways, and a DIFFERENT pair agrees
    // each time — JS drops a default port where Python and Go keep it; JS and Python
    // lowercase where Go does not; JS and Go keep IPv6 brackets where Python strips them.
    // Two of the three change the accept/reject verdict, so a corpus without all three
    // lets a naive binding through.
    const candidates = ofKind("validate-url").map(({ body }) => body.candidate ?? "");
    expect(
      candidates.some((c) => /:443\//.test(c)),
      "no case pins an explicit default port",
    ).toBe(true);
    expect(
      candidates.some((c) => /[A-Z]/.test(c.replace(/^https?:/, ""))),
      "no case pins a mixed-case host",
    ).toBe(true);
    expect(
      candidates.some((c) => c.includes("[")),
      "no case pins an IPv6 literal",
    ).toBe(true);
  });

  test("§6.4 is pinned by a truncating case that carries an astral character", () => {
    // The cap is measured in the binding's own string unit, and truncation MUST NOT split
    // a code point. Without an astral character straddling the boundary, a naive slice
    // passes — which is exactly what the reference did.
    const straddling = ofKind("preview").filter(({ body }) => {
      const raw = body.raw as Record<string, unknown> | undefined;
      const text = typeof raw?.["preview"] === "string" ? (raw["preview"] as string) : "";
      return text.length > PREVIEW_MAX_CHARS && utf8Length(text) > text.length;
    });
    expect(straddling.length, "no §6.4 case truncates a multi-unit character").toBeGreaterThan(0);
  });

  test("no expected preview is ill-formed UTF-16", () => {
    // A lone surrogate cannot be encoded as UTF-8 at all, so a corpus that expected one
    // would be pinning a value a Python consumer raises on. Asserted corpus-wide, so a
    // future case cannot introduce one quietly.
    for (const { entry, body } of cases) {
      const preview = body.expect["preview"];
      if (typeof preview === "string") {
        expect(hasLoneSurrogate(preview), `${entry.file} expects a lone surrogate`).toBe(false);
      }
    }
  });

  test("§6.1 and §6.2's opposite rules are each pinned", () => {
    // Addresses DROP empty results; attachments NEVER drop. A binding sharing one helper
    // fails one of these two whichever way it chooses — but only if both are present.
    const dropping = ofKind("addresses").filter(({ body }) => {
      const input = Array.isArray(body.value) ? body.value.length : 0;
      return input > 0 && (body.expect["formatted"] as unknown[]).length < input;
    });
    expect(dropping.length, "no case pins §6.1's dropping rule").toBeGreaterThan(0);

    const keeping = ofKind("attachments").filter(({ body }) => {
      if (!Array.isArray(body.value)) return false;
      const out = body.expect["attachments"] as unknown[];
      return (
        body.value.length > 0 &&
        out.length === body.value.length &&
        body.value.some((v) => v === null || typeof v !== "object")
      );
    });
    expect(keeping.length, "no case pins §6.2's never-drop rule on a non-record").toBeGreaterThan(
      0,
    );
  });

  test("§7.2's list form is pinned as omitting filter entirely", () => {
    // Not null, not {}. The absence is only assertable if a case expects a query object
    // with no `filter` key at all.
    const list = ofKind("request").filter(({ body }) => body.form === "list");
    expect(list.length).toBeGreaterThan(0);
    for (const { entry, body } of list) {
      const req = body.expect["request"] as {
        methodCalls: [string, Record<string, unknown>, string][];
      };
      const query = req.methodCalls[0]?.[1] ?? {};
      expect(Object.hasOwn(query, "filter"), `${entry.file} expects a filter on a list`).toBe(
        false,
      );
    }
  });

  test("every pinnable section is cited by at least one case", () => {
    const cited = new Set(index.cases.map((c) => c.section));
    for (const section of PINNED_SECTIONS) {
      expect(cited.has(section), `no case cites ${section}`).toBe(true);
    }
  });

  test("every case cites a section the document actually has", () => {
    const text = readText(SPEC_PATH);
    for (const entry of index.cases) {
      const heading = new RegExp(`^#{2,3} ${entry.section}(\\s|$)`, "m");
      expect(heading.test(text), `${entry.file} cites a missing ${entry.section}`).toBe(true);
    }
  });
});

describe("the reference binding satisfies every case", () => {
  for (const { entry, body } of cases) {
    test(`${entry.file}: ${body.description}`, () => {
      runCase(entry, body);
      recorder.record(entry.file);
    });
  }
});

function runCase(entry: IndexEntry, body: Case): void {
  switch (body.kind) {
    case "constants": {
      const constants = body.expect["constants"] as Record<string, unknown> | undefined;
      if (constants !== undefined) {
        const actual: Record<string, unknown> = {
          CORE_CAPABILITY,
          MAIL_CAPABILITY,
          SUBMISSION_CAPABILITY,
          MAX_BODY_VALUE_BYTES,
          PREVIEW_MAX_CHARS,
        };
        for (const [name, want] of Object.entries(constants)) {
          expect(actual[name], `${entry.file}: ${name}`).toBe(want);
        }
      }
      const properties = body.expect["emailProperties"];
      if (properties !== undefined) {
        expect([...EMAIL_PROPERTIES]).toEqual(properties as string[]);
      }
      return;
    }
    case "session":
      expect(parseSession(body.parsed)).toEqual(body.expect["session"] as never);
      return;
    case "validate-url": {
      const { candidate, allowedBase } = body;
      if (candidate === undefined || allowedBase === undefined) {
        throw new Error(`${entry.file}: a validate-url case needs candidate and allowedBase`);
      }
      if (body.expect["ok"] === true) {
        expect(validateApiUrl(candidate, allowedBase)).toBe(body.expect["url"] as string);
        return;
      }
      // §5.1 — it RAISES. `toThrow` with an exact string asserts the message is contract
      // text, and that an absence-returning binding fails rather than silently passing.
      expect(() => validateApiUrl(candidate, allowedBase)).toThrow(
        body.expect["message"] as string,
      );
      return;
    }
    case "view-email":
      expect(viewEmail(body.raw)).toEqual(body.expect["view"] as never);
      return;
    case "addresses":
      expect(formatAddresses(body.value)).toEqual(body.expect["formatted"] as string[]);
      return;
    case "attachments":
      expect(extractAttachments(body.value)).toEqual(body.expect["attachments"] as never);
      return;
    case "preview": {
      const raw = body.raw;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error(`${entry.file}: a preview case needs a record raw`);
      }
      expect(previewFor(raw as Record<string, unknown>)).toBe(body.expect["preview"] as string);
      return;
    }
    case "request": {
      const { form, accountId } = body;
      if (form === undefined || accountId === undefined) {
        throw new Error(`${entry.file}: a request case needs form and accountId`);
      }
      // Structural comparison, never a serialised one — §9.
      const built =
        form === "list"
          ? buildListRequest(accountId, body.limit ?? 0)
          : form === "search"
            ? buildSearchRequest(accountId, body.query ?? "", body.limit ?? 0)
            : buildGetRequest(accountId, body.id ?? "");
      expect(built).toEqual(body.expect["request"] as never);
      return;
    }
    case "extract": {
      const { methodName } = body;
      if (methodName === undefined) {
        throw new Error(`${entry.file}: an extract case needs methodName`);
      }
      expect(methodResponseArgs(body.parsed, methodName)).toEqual(body.expect["args"] as never);
      return;
    }
    case "extract-list":
      expect(extractEmailList(body.parsed)).toEqual(body.expect["list"] as unknown[]);
      return;
  }
}
