/**
 * The framing conformance corpus, loaded and driven.
 *
 * Shared by `framing-guard.test.ts` (which runs it against `src/` under Bun) and
 * `framing-node.mjs` (which runs it against the built `dist/` under plain Node). Framing
 * expectations bottom out in `TextDecoder`, whose edge behavior is not identical across
 * runtimes, so a corpus other languages are told to trust must be proven under both.
 *
 * Plain ESM rather than TypeScript for the same reason `smoke-calls.mjs` is: Node runs it
 * directly, with no build step between the corpus and the artifact under test.
 *
 * The chunk vocabulary is the corpus's own, documented in `case.schema.json`:
 * `utf8` for readable content, `base64` for exact octets, `repeat` for content too large to
 * inline, and `concat` to build one chunk from several.
 */
import { readdirSync, readFileSync } from "node:fs";

// Plain ESM run directly by Node (see framing-node.mjs), so this anchors via import.meta.url
// rather than importing the packageRoot/repoRoot split in ./paths.ts. Repo-root-relative,
// one level up from scripts/ today — see ./paths.ts for the split this mirrors.
const CORPUS_URL = new URL("../docs/spec/conformance/v1/framing/", import.meta.url);

/** Repo-relative, for error messages that a reader can paste into an editor. */
export const CORPUS_DIR = "docs/spec/conformance/v1/framing";

const decoder = new TextDecoder("utf-8", { fatal: false });
const encoder = new TextEncoder();

/** One file from the corpus, parsed. Paths are relative to the corpus directory. */
export function readCorpusJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, CORPUS_URL), "utf8"));
}

export function loadIndex() {
  return readCorpusJson("index.json");
}

/** Every `cases/*.json` actually present, so an unlisted case can be caught. */
export function caseFilesOnDisk() {
  return readdirSync(new URL("cases/", CORPUS_URL))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `cases/${name}`)
    .sort();
}

/** The index entries, each with its case body attached. */
export function loadCases() {
  return loadIndex().cases.map((entry) => ({ ...entry, body: readCorpusJson(entry.file) }));
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function expandRepeat(spec) {
  if (typeof spec.byte === "number") {
    return new Uint8Array(spec.count).fill(spec.byte);
  }
  return encoder.encode(spec.utf8.repeat(spec.count));
}

/** A chunk descriptor to the octets it denotes. */
export function expandChunk(descriptor) {
  if ("utf8" in descriptor) return encoder.encode(descriptor.utf8);
  if ("base64" in descriptor) return Uint8Array.from(Buffer.from(descriptor.base64, "base64"));
  if ("repeat" in descriptor) return expandRepeat(descriptor.repeat);
  if ("concat" in descriptor) return concatBytes(descriptor.concat.map(expandChunk));
  throw new Error(`unrecognized chunk descriptor: ${JSON.stringify(descriptor)}`);
}

/** An expected frame to its text. A repeat descriptor keeps 1 MiB cases out of git. */
export function expandFrame(expected) {
  if (typeof expected === "string") return expected;
  return decoder.decode(expandRepeat(expected.repeat));
}

/** Long frames make failure messages unreadable; the length is the useful part. */
function describe(text) {
  const shown = text.length > 60 ? `${JSON.stringify(text.slice(0, 60))}…` : JSON.stringify(text);
  return `${shown} (${text.length} chars)`;
}

function compareFrames(got, want, label, failures) {
  if (got.length !== want.length) {
    failures.push(
      `${label}: expected ${want.length} frame(s), got ${got.length} — ` +
        `[${got.map(describe).join(", ")}]`,
    );
    return;
  }
  for (let i = 0; i < want.length; i++) {
    if (got[i] !== want[i]) {
      failures.push(`${label}: frame ${i} expected ${describe(want[i])}, got ${describe(got[i])}`);
    }
  }
}

/**
 * Drive one case through a reader and report what disagreed.
 *
 * `makeReader` is a thunk rather than a reader so a latched reader from one case can never
 * leak into the next. Returns the failures; an empty array means conformant.
 */
export function checkCase(makeReader, testCase) {
  const failures = [];
  const reader = makeReader();
  const chunks = testCase.chunks ?? [];
  const pushExpectations = testCase.expect.push;

  if (pushExpectations.length !== chunks.length) {
    failures.push(
      `expect.push has ${pushExpectations.length} entries for ${chunks.length} chunk(s) — ` +
        "they are positionally parallel, so an unequal length means the case is malformed",
    );
    return failures;
  }

  for (let i = 0; i < chunks.length; i++) {
    const expected = pushExpectations[i];
    const bytes = expandChunk(chunks[i]);
    if (Array.isArray(expected)) {
      try {
        compareFrames(reader.push(bytes), expected.map(expandFrame), `push[${i}]`, failures);
      } catch (err) {
        failures.push(`push[${i}] threw unexpectedly: ${err instanceof Error ? err.message : err}`);
      }
      continue;
    }
    let threw = false;
    try {
      reader.push(bytes);
    } catch {
      threw = true;
    }
    if (!threw) {
      failures.push(`push[${i}] was expected to fail with ${expected.error} and did not`);
    }
  }

  const flushExpectation = testCase.expect.flush;
  if (flushExpectation === undefined) return failures;

  if ("error" in flushExpectation) {
    let threw = false;
    try {
      reader.flushFrames();
    } catch {
      threw = true;
    }
    if (!threw) {
      failures.push(`flush was expected to fail with ${flushExpectation.error} and did not`);
    }
    return failures;
  }

  try {
    const result = reader.flushFrames();
    compareFrames(result.frames, flushExpectation.frames.map(expandFrame), "flush", failures);
    if (result.truncated !== flushExpectation.truncated) {
      failures.push(
        `flush: expected truncated=${flushExpectation.truncated}, got ${result.truncated}`,
      );
    }
  } catch (err) {
    failures.push(`flush threw unexpectedly: ${err instanceof Error ? err.message : err}`);
  }

  return failures;
}
