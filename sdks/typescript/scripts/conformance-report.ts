/**
 * Record which conformance cases this binding actually executed.
 *
 * Off unless `NIMBUS_CONFORMANCE_REPORT` names a directory, so a local `bun run test`
 * behaves exactly as it did before. That default carries the NIMBUS_SPEC_DRIFT hazard — a
 * silent no-op looks like a pass — which is closed at the other end: the reconciler treats
 * an empty or absent report as a failure, so the CI job that sets the variable cannot go
 * green without evidence.
 *
 * One file per (corpus, producer), never a shared append target. A corpus can have more than
 * one runner in a language: `framing` is driven under Bun by framing-guard.test.ts and again
 * under plain Node by framing-node.mjs. The reconciler unions them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Recorder = {
  /** Note that `file` — an index `file` identity, verbatim — executed and passed. */
  record(file: string): void;
  /** Write the report. Call once, in an `afterAll`. */
  flush(): void;
};

export function createRecorder(corpus: string, producer: string): Recorder {
  const executed = new Set<string>();
  return {
    record(file: string): void {
      executed.add(file);
    },
    flush(): void {
      const dir = process.env["NIMBUS_CONFORMANCE_REPORT"];
      if (dir === undefined || dir === "") return;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `typescript.${corpus}.${producer}.json`),
        JSON.stringify({
          language: "typescript",
          corpus,
          producer,
          executed: [...executed].sort(),
        }),
        "utf8",
      );
    },
  };
}
