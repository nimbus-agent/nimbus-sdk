/**
 * Replace `globalThis.fetch` for the duration of a test, and put the real one back.
 *
 * Three suites under `connector-kit/` each carried their own copy of the same dance — capture
 * `globalThis.fetch`, `afterEach` restore it, assign a cast handler — differing only in
 * whether the assignment was wrapped in a local helper. One shared pair keeps the restore
 * attached to the stub: the failure mode of the copied version is a suite that stubs and
 * forgets to restore, which leaks a fake `fetch` into every file that runs after it, since
 * `bun test` runs the whole suite in one process.
 *
 * The real `fetch` is captured once at module load — before any test body has run — so
 * `restoreGlobalFetch` can only ever reinstate the genuine one, never another suite's stub.
 *
 * Test-only. Not exported from any entry point, and excluded from `tsconfig.build.json`, so
 * it neither reaches `dist/` nor appears in the published API surface.
 */

/** What a stubbed `fetch` does with the call it intercepted. */
export type StubbedFetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const REAL_FETCH = globalThis.fetch;

/**
 * Install `handler` as `globalThis.fetch`. Pair every call with a `restoreGlobalFetch()` in
 * an `afterEach`, not at the end of the test body: a failing assertion skips the rest of the
 * body, and an unrestored stub then fails a later file instead of this one.
 */
export function stubGlobalFetch(handler: StubbedFetchHandler): void {
  globalThis.fetch = (async (url: string, init?: RequestInit) =>
    handler(url, init)) as typeof fetch;
}

/** Reinstate the real `fetch`. Safe to call when nothing was stubbed. */
export function restoreGlobalFetch(): void {
  globalThis.fetch = REAL_FETCH;
}
