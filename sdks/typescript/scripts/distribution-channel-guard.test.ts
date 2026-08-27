/**
 * The executable form of `docs/spec/batteries/v1/distribution-channel.md`.
 *
 * Structured like `data-profile-guard.test.ts`: validate the published schemas, hold the
 * index and the directory to each other, execute every case against the reference binding,
 * and refuse to pass vacuously.
 *
 * What this corpus exercises that no earlier one did: the battery reads the environment,
 * the executable path and the filesystem, so §1 requires all three to be INJECTED and the
 * case file supplies a realpath MAP. A key mapping to `null` means the resolver throws,
 * which is the only way §3.1 — "a failure yields the input unchanged" — is pinnable at all.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  channelUpgradeHint,
  type DistributionChannel,
  resolveDistributionChannel,
} from "../src/distribution-channel.ts";
import { createRecorder } from "./conformance-report.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/batteries/v1/distribution-channel.md";
const CORPUS_DIR = "docs/spec/conformance/v1/distribution-channel";
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const INDEX_PATH = `${CORPUS_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;

/** §1's closed set. */
const CHANNELS = ["homebrew", "scoop", "winget", "apt", "yum", "msi", "pkg"] as const;

/** Every section a case can pin. §1 is scope, but §1's injection requirement is testable. */
const PINNED_SECTIONS = ["§1", "§2", "§3", "§3.1", "§3.2", "§4", "§5"] as const;

type Case = {
  description: string;
  kind: "resolve" | "hint";
  env?: Record<string, string>;
  execPath?: string;
  realpath?: Record<string, string | null>;
  channel?: DistributionChannel;
  expect: { channel?: DistributionChannel | null; text?: string };
};
type IndexEntry = { file: string; section: string; reason: string };

const index = readJson(INDEX_PATH) as { spec: string; cases: IndexEntry[] };
const cases: { entry: IndexEntry; body: Case }[] = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

const recorder = createRecorder("distribution-channel", "guard");
afterAll(() => recorder.flush());

const resolves = (): { entry: IndexEntry; body: Case }[] =>
  cases.filter(({ body }) => body.kind === "resolve");

/**
 * The case's realpath map as an injectable function.
 *
 * A path absent from the map resolves to itself; a path mapping to `null` makes the
 * resolver THROW, which is what a real resolver does for a path it cannot resolve.
 */
function realpathFrom(map: Record<string, string | null>): (p: string) => string {
  return (p: string): string => {
    if (!(p in map)) return p;
    const target = map[p];
    if (target === null || target === undefined) {
      throw new Error(`ENOENT: cannot resolve ${p}`);
    }
    return target;
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
  test("it is non-empty", () => {
    expect(cases.length).toBeGreaterThanOrEqual(24);
  });

  test("every channel has a hint case, and every hint is distinct", () => {
    const hinted = cases.filter(({ body }) => body.kind === "hint");
    expect(hinted.map(({ body }) => body.channel).sort()).toEqual([...CHANNELS].sort());
    // Seven identical strings would satisfy the line above and pin nothing.
    expect(new Set(hinted.map(({ body }) => body.expect.text)).size).toBe(CHANNELS.length);
  });

  test("both resolve outcomes are exercised", () => {
    expect(resolves().some(({ body }) => body.expect.channel !== null)).toBe(true);
    expect(resolves().some(({ body }) => body.expect.channel === null)).toBe(true);
  });

  test("§3.1 is pinned by a resolver that throws, in both directions", () => {
    const throwing = resolves().filter(({ body }) =>
      Object.values(body.realpath ?? {}).includes(null),
    );
    expect(throwing.length, "no case pins a realpath that fails").toBeGreaterThanOrEqual(2);
    // One must still resolve to a channel. An absence-only pair would pass under a binding
    // that swallowed the throw AND returned an absence, which is not what §3.1 requires.
    expect(throwing.some(({ body }) => body.expect.channel !== null)).toBe(true);
    expect(throwing.some(({ body }) => body.expect.channel === null)).toBe(true);
  });

  test("§3 is pinned against skipping symlink resolution", () => {
    // The exec path carries no tell-tale segment and the RESOLVED path does. A binding
    // that never calls the resolver returns an absence and fails only here.
    const symlink = resolves().filter(({ body }) => {
      if (body.expect.channel === null) return false;
      const raw = (body.execPath ?? "").replaceAll("\\", "/").toLowerCase();
      return (
        !raw.includes("/cellar/") && !raw.includes("/.linuxbrew/") && !raw.includes("/scoop/apps/")
      );
    });
    expect(symlink.length, "no case requires symlink resolution").toBeGreaterThan(0);
  });

  test("§2 is pinned against a case-insensitive or trimming comparison", () => {
    const nearMisses = resolves().filter(({ body }) => {
      const raw = body.env?.["NIMBUS_DISTRIBUTION_CHANNEL"];
      return raw !== undefined && raw !== "" && raw !== raw.trim().toLowerCase();
    });
    expect(nearMisses.length, "no case pins exact-equality matching").toBeGreaterThan(0);
  });

  test("§3.2 is pinned by a path that looks like a non-detectable channel", () => {
    // Without this a binding that added a sixth heuristic would pass every other case.
    const shaped = resolves().filter(
      ({ body }) =>
        body.expect.channel === null && /winget|\/usr\/bin\//i.test(body.execPath ?? ""),
    );
    expect(shaped.length, "no case forbids a sixth path heuristic").toBeGreaterThan(0);
  });

  test("every resolve case supplies all three injected inputs", () => {
    // The host must never leak in: `resolveDistributionChannel` falls back to process.env
    // and process.execPath for an absent option, so a case missing a field would silently
    // test the RUNNER'S OWN machine and pass or fail by accident, differently on each of
    // the three CI operating systems. The schema requires all three; this asserts it again
    // where the harm would occur, because the Python and Go runners never see the schema.
    for (const { entry, body } of resolves()) {
      expect(body.env, `${entry.file}: no env`).toBeDefined();
      expect(body.execPath, `${entry.file}: no execPath`).toBeDefined();
      expect(body.realpath, `${entry.file}: no realpath`).toBeDefined();
    }
  });

  test("every path in the corpus is printable ASCII", () => {
    // §3 lowercases the WHOLE path, and Go's strings.ToLower applies Unicode's simple case
    // mapping where Python and JavaScript apply the full one — they disagree on U+0130. A
    // case carrying `İ` would pin a value the three bindings do not share. Covers the
    // realpath map's keys and values too, not just execPath: those are lowercased as well.
    const offenders: string[] = [];
    for (const { entry, body } of resolves()) {
      const paths = [
        body.execPath ?? "",
        ...Object.keys(body.realpath ?? {}),
        ...Object.values(body.realpath ?? {}).filter((v): v is string => v !== null),
      ];
      if (paths.some((p) => !/^[\x20-\x7E]*$/.test(p))) offenders.push(entry.file);
    }
    expect(offenders, "a non-ASCII path pins a value the three bindings do not share").toEqual([]);
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
      if (body.kind === "hint") {
        const { channel, expect: want } = body;
        if (channel === undefined || want.text === undefined) {
          throw new Error(`${entry.file}: a hint case needs both channel and expect.text`);
        }
        expect(channelUpgradeHint(channel)).toBe(want.text);
        recorder.record(entry.file);
        return;
      }
      // Narrowed rather than passed through: an `undefined` here would make the reference
      // implementation fall back to process.env / process.execPath and quietly test this
      // runner's own machine. The schema requires all three and so does the assertion
      // above; this is the third gate, at the point where the harm would actually happen.
      const { env, execPath, realpath } = body;
      if (env === undefined || execPath === undefined || realpath === undefined) {
        throw new Error(`${entry.file}: a resolve case needs env, execPath and realpath`);
      }
      const channel = resolveDistributionChannel({
        env,
        execPath,
        realpath: realpathFrom(realpath),
      });
      expect(channel).toBe(body.expect.channel ?? null);
      recorder.record(entry.file);
    });
  }
});
