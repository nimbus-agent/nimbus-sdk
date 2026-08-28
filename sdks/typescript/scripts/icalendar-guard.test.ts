/**
 * The executable form of `docs/spec/batteries/v1/icalendar.md`.
 *
 * Structured like `distribution-channel-guard.test.ts`: validate the published schemas, hold
 * the index and the directory to each other, execute every case against the reference
 * binding, and refuse to pass vacuously.
 *
 * What this corpus exercises that no earlier one did: the battery has **two** functions, one
 * of which is a builder, so half the cases assert a parsed structure and half assert an exact
 * string. §R5 pins a builder's output byte for byte, which is why a `build` case's `expect` is
 * the whole document and not a line list — a binding producing the right lines in a different
 * order, or with a different terminator, does not conform.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  type BuildEventInput,
  buildVEvent,
  type ParsedEvent,
  parseICalendar,
} from "../src/icalendar.ts";
import { createRecorder } from "./conformance-report.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/batteries/v1/icalendar.md";
const CORPUS_DIR = "docs/spec/conformance/v1/icalendar";
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const INDEX_PATH = `${CORPUS_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;

/** §1's thirteen members, in the order §1's table lists them. */
const MEMBERS = [
  "uid",
  "recurrenceId",
  "summary",
  "description",
  "location",
  "start",
  "end",
  "allDay",
  "status",
  "organizer",
  "attendees",
  "rrule",
  "dtstamp",
] as const;

/**
 * Every section a case can pin.
 *
 * §1 and §9 are prose. §7.1 is deliberately absent: it constrains a fold that §7 says never
 * happens, so no case can enforce it — see §7.1's own closing paragraph and RFC-0018.
 */
const PINNED_SECTIONS = [
  "§2",
  "§3.1",
  "§3.2",
  "§3.3",
  "§4.1",
  "§4.2",
  "§5.1",
  "§5.2",
  "§5.3",
  "§5.4",
  "§5.5",
  "§6",
  "§7",
  "§8",
] as const;

type ExpectedEvent = Record<(typeof MEMBERS)[number], unknown>;
type Case = {
  description: string;
  kind: "parse" | "build";
  ics?: string;
  input?: BuildEventInput;
  now?: string;
  expect: { events?: ExpectedEvent[]; ics?: string };
};
type IndexEntry = { file: string; section: string; reason: string };

const index = readJson(INDEX_PATH) as { spec: string; cases: IndexEntry[] };
const cases: { entry: IndexEntry; body: Case }[] = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

const recorder = createRecorder("icalendar", "guard");
afterAll(() => recorder.flush());

const parses = (): { entry: IndexEntry; body: Case }[] =>
  cases.filter(({ body }) => body.kind === "parse");
const builds = (): { entry: IndexEntry; body: Case }[] =>
  cases.filter(({ body }) => body.kind === "build");

/** Every expected event across the whole corpus, flattened. */
const expectedEvents = (): ExpectedEvent[] =>
  parses().flatMap(({ body }) => body.expect.events ?? []);

/**
 * `TextEncoder`, not `Buffer.byteLength`.
 *
 * No package in this repository declares `@types/node`, and `Buffer` appears in exactly one
 * file — `scripts/framing-corpus.mjs`, which is not typechecked. A `Buffer` reference here
 * would either fail `tsc` or pass locally by borrowing an ambient type from the parent
 * checkout's `node_modules`, which is the failure mode CLAUDE.md records taking down
 * `build-test` on all three operating systems. Every other guard already uses `TextEncoder`.
 */
const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

/** The whole thirteen-member object, so a comparison cannot miss a member. */
function toComparable(event: ParsedEvent): ExpectedEvent {
  return {
    uid: event.uid,
    recurrenceId: event.recurrenceId,
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    status: event.status,
    organizer: event.organizer,
    attendees: [...event.attendees],
    rrule: event.rrule,
    dtstamp: event.dtstamp,
  };
}

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
  test("it is non-empty, and both kinds are exercised", () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
    expect(parses().length).toBeGreaterThan(0);
    expect(builds().length).toBeGreaterThan(0);
  });

  test("every expected event states all thirteen members", () => {
    // The schema requires this, and it is asserted again here because the Python and Go
    // runners never see the schema. A case omitting `allDay` would silently stop asserting
    // the member most likely to regress — §3.3's whole-element parameter match.
    for (const { entry, body } of parses()) {
      for (const [i, event] of (body.expect.events ?? []).entries()) {
        expect(Object.keys(event).sort(), `${entry.file}: event ${i}`).toEqual(
          [...MEMBERS].sort(),
        );
      }
    }
  });

  test("both parse outcomes are exercised", () => {
    expect(parses().some(({ body }) => (body.expect.events ?? []).length > 0)).toBe(true);
    expect(parses().some(({ body }) => (body.expect.events ?? []).length === 0)).toBe(true);
  });

  test("a case distinguishes an empty value from an absence, in both members", () => {
    // Without these, Go's obvious `ParsedEvent` — plain `string` per §R6's zero-value rule —
    // passes the entire corpus. §1 makes the empty string a reachable, real answer, so only
    // a pointer can tell it from an absence. See the Go binding's own note.
    expect(expectedEvents().some((e) => e["summary"] === "")).toBe(true);
    expect(expectedEvents().some((e) => e["summary"] === null)).toBe(true);
    expect(expectedEvents().some((e) => e["organizer"] === "")).toBe(true);
    expect(expectedEvents().some((e) => e["organizer"] === null)).toBe(true);
  });

  test("§5.3 is pinned against host-language case folding", () => {
    // U+0130 is the one code point whose full lowercase is longer than itself, so a binding
    // indexing a lowercased copy and slicing the original is off by one from it onward — and
    // Go's simple mapping is off by one the OTHER way. Without a case carrying it, all three
    // wrong implementations pass.
    const withTurkishI = parses().filter(({ body }) => (body.ics ?? "").includes("İ"));
    expect(
      withTurkishI.length,
      "no case contains U+0130, so §5.3's fold is unpinned",
    ).toBeGreaterThan(0);
  });

  test("§8 is pinned in both directions against a delegating trim", () => {
    // U+FEFF is IN §R7's set and neither Python's str.strip() nor Go's strings.TrimSpace
    // removes it; U+001C is OUT of the set and Python's str.strip() does remove it. One case
    // each. They fail in opposite directions, so neither implies the other.
    const ics = parses().map(({ body }) => body.ics ?? "");
    expect(ics.some((t) => t.includes("\ufeff")), "no case pins U+FEFF as trimmed").toBe(true);
    expect(ics.some((t) => t.includes("\u001c")), "no case pins U+001C as kept").toBe(true);
  });

  test("§7 is pinned by build cases that exceed 75 octets and carry no fold", () => {
    // §7 is executable only because a case supplies a value longer than the RFC 5545 limit.
    // Settled by RFC-0018: the line is emitted whole.
    const long = builds().filter(({ body }) => utf8Length(body.expect.ics ?? "") > 75);
    expect(long.length, "no build case exceeds 75 octets, so §7 asserts nothing").toBeGreaterThanOrEqual(2);
    for (const { entry, body } of builds()) {
      // A fold is CRLF followed by SPACE or HTAB. No conforming output contains one.
      expect(/\r\n[ \t]/.test(body.expect.ics ?? ""), `${entry.file} contains a fold`).toBe(false);
    }
    // One of them must be multi-octet, or "75 octets" is never distinguished from
    // "75 characters" and a binding measuring the wrong one passes.
    expect(
      long.some(({ body }) => utf8Length(body.expect.ics ?? "") > (body.expect.ics ?? "").length),
      "no long build case carries a multi-octet character",
    ).toBe(true);
  });

  test("every build case's expected output ends with CRLF", () => {
    // §6's last line is terminated too. Asserted corpus-wide rather than by one case, so a
    // future case cannot quietly introduce an unterminated expectation.
    for (const { entry, body } of builds()) {
      expect((body.expect.ics ?? "").endsWith("\r\n"), `${entry.file} does not end with CRLF`).toBe(
        true,
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
    // Chapters are `## §5`, subsections are `### §5.1`, so match the token after the hashes
    // rather than a literal `"## "` prefix.
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
      if (body.kind === "build") {
        const { input, now } = body;
        if (input === undefined || now === undefined) {
          throw new Error(`${entry.file}: a build case needs both input and now`);
        }
        expect(buildVEvent(input, now)).toBe(body.expect.ics ?? "");
        recorder.record(entry.file);
        return;
      }
      const { ics } = body;
      if (ics === undefined) {
        throw new Error(`${entry.file}: a parse case needs ics`);
      }
      // Deep equality on the WHOLE event. A per-member loop never looks at a member the
      // corpus later grows and passes; this fails and names the case.
      expect(parseICalendar(ics).map(toComparable)).toEqual(body.expect.events ?? []);
      recorder.record(entry.file);
    });
  }
});
