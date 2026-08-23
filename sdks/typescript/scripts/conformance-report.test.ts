import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecorder } from "./conformance-report.ts";

let dir = "";
const previous = process.env["NIMBUS_CONFORMANCE_REPORT"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conformance-report-"));
  process.env["NIMBUS_CONFORMANCE_REPORT"] = dir;
});

afterEach(() => {
  if (previous === undefined) delete process.env["NIMBUS_CONFORMANCE_REPORT"];
  else process.env["NIMBUS_CONFORMANCE_REPORT"] = previous;
  rmSync(dir, { recursive: true, force: true });
});

describe("createRecorder", () => {
  test("writes one file named for the language, corpus and producer", () => {
    const recorder = createRecorder("framing", "guard");
    recorder.record("cases/b.json");
    recorder.record("cases/a.json");
    recorder.flush();
    expect(readdirSync(dir)).toEqual(["typescript.framing.guard.json"]);
  });

  test("the envelope carries the identity and a sorted, deduplicated executed set", () => {
    const recorder = createRecorder("framing", "guard");
    recorder.record("cases/b.json");
    recorder.record("cases/a.json");
    recorder.record("cases/b.json");
    recorder.flush();
    const written = JSON.parse(readFileSync(join(dir, "typescript.framing.guard.json"), "utf8"));
    expect(written).toEqual({
      language: "typescript",
      corpus: "framing",
      producer: "guard",
      executed: ["cases/a.json", "cases/b.json"],
    });
  });

  test("writes nothing when the variable is unset", () => {
    delete process.env["NIMBUS_CONFORMANCE_REPORT"];
    const recorder = createRecorder("framing", "guard");
    recorder.record("cases/a.json");
    recorder.flush();
    expect(readdirSync(dir)).toEqual([]);
  });

  test("flushing with nothing recorded still writes an empty report", () => {
    // An empty report is evidence the recorder ran and found nothing — which the reconciler
    // rejects. Writing no file at all would be indistinguishable from a leg that never ran.
    createRecorder("framing", "guard").flush();
    const written = JSON.parse(readFileSync(join(dir, "typescript.framing.guard.json"), "utf8"));
    expect(written.executed).toEqual([]);
  });
});
