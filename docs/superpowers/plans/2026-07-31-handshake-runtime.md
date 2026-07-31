# Handshake Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the handshake primitives both bindings already have into a runtime that performs the exchange, so a connector can complete a contract-version handshake in either language.

**Architecture:** One free function per binding — `performHandshake` / `perform_handshake` — that writes our hello, reads the peer's, negotiates, and returns a result. Streams are injected, so the package still performs no I/O. `NimbusExtensionServer` gains a thin delegating method; `start()` is untouched.

**Tech Stack:** TypeScript (Bun test, Biome, tsc strict), Python 3.11+ (pytest, ruff, mypy strict). No runtime dependencies in either.

**Spec:** `docs/superpowers/specs/2026-07-31-handshake-runtime-design.md`, committed on this branch. Read it first — especially *The result is a new type* and *TypeScript is async; Python is synchronous*.

## Global Constraints

- **Zero runtime dependencies**, both languages. Standard library and existing intra-package imports only.
- **The package performs no I/O.** `io` is injected. Nothing may touch `process.stdin`, `sys.stdin`, a file, or a socket — not in the runtime, not in a test helper.
- **Nothing calls `process.exit` / `sys.exit`.** A refusal is returned. `contract-version.md` §8: this package "owns no process to exit." The caller uses `CONTRACT_HANDSHAKE_EXIT`.
- **No timeout, and no timeout option.** §8 says the bound "belongs to whatever supervises the process" and that "no value is normative here". The caller wraps.
- **`NimbusExtensionServer.start()` must not change** — signature, synchronicity, or behaviour. It is called with no arguments in two published examples, `docs/modules/server.md`, and three tests. Changing it is a breaking change.
- **We write before we read.** `contract-version.md` §5: the first frame each peer writes MUST be a hello, and nothing may precede it. A runtime that reads first deadlocks against another doing the same.
- **TypeScript:** no `any`; strict; `noPropertyAccessFromIndexSignature`, so `Record<string, …>` needs bracket access. Biome `lineWidth: 100`.
- **Python:** ruff `line-length = 88`, `select = ["E","F","I","N","UP","B","A","C4","PT","RUF"]`; mypy `strict = true` over `src` and `tests`.
- **Never write a literal U+FEFF.** Use `\uFEFF`. This has gone wrong five times in this repo.
- **Two CI gates fire on a new TypeScript export**, both mandatory: regenerate `docs/api-surface.md` with `bun run api:surface`, and claim the new module in a `docs/modules/*.md` page's `<!-- covers: -->` comment. `docs/modules/ipc.md` currently reads `<!-- covers: ipc/ndjson-line-reader -->`; `ipc/handshake` goes there.
- Commit subjects are `feat:`-class for Tasks 1–3 (new exported surface, minor bump in both packages) and `test:` for Task 4.
- **Run all commands from the worktree** `C:\gitrep\nimbus-sdk\.claude\worktrees\handshake-runtime`.

**Baselines measured on this branch at `675f48d`:**

| Suite | Now | After T1 | After T2 | After T3 | After T4 |
|---|---|---|---|---|---|
| `bun run test` from `sdks/typescript/` | 1085 pass, 0 fail | +T1 tests | +T2 tests | 1085+ | + differential |
| `python -m pytest -q` from `sdks/python/` | 128 passed, 6 skipped | 128 | 128 | +T3 tests | + differential |

Exact post-task counts are not pinned, because the number of tests you write is yours to choose within each task's required cases. **What is pinned is `0 fail` and the specific behaviours listed per task.**

---

### Task 1: the TypeScript handshake primitive

**Files:**
- Create: `sdks/typescript/src/ipc/handshake.ts`
- Create: `sdks/typescript/src/ipc/handshake.test.ts`
- Modify: `sdks/typescript/src/ipc/index.ts` (add the exports)
- Modify: `docs/modules/ipc.md` (claim `ipc/handshake` in `<!-- covers: -->`, and document the function)
- Modify: `docs/api-surface.md` (regenerated, never hand-edited)

**Interfaces:**
- Consumes: `CONTRACT_VERSIONS` and `negotiateContractVersion` from `../contract-version.js`; `encodeHello`, `parseHello`, `HelloRefusalReason` from `./hello.js`; `NdjsonLineReader` from `./ndjson-line-reader.js`.
- Produces, for Tasks 2 and 4:
  - `type HandshakeRefusalReason = HelloRefusalReason | "no-common-version"`
  - `type HandshakeResult = { ok: true; version: string; pending: readonly string[] } | { ok: false; reason: HandshakeRefusalReason; pending: readonly string[] }`
  - `interface HandshakeIo { read(): Promise<Uint8Array | null>; write(chunk: Uint8Array): Promise<void> }`
  - `interface HandshakeOptions { readonly localVersions?: readonly string[]; readonly reader?: NdjsonLineReader }`
  - `performHandshake(io: HandshakeIo, options?: HandshakeOptions): Promise<HandshakeResult>`

- [ ] **Step 1: Write the failing tests**

Create `sdks/typescript/src/ipc/handshake.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { CONTRACT_VERSIONS } from "../contract-version.js";
import { type HandshakeIo, performHandshake } from "./handshake.js";

/** A scripted peer: hands back queued chunks, records everything written. */
function scriptedPeer(chunks: (string | null)[]): HandshakeIo & { written: string[] } {
  const queue = [...chunks];
  const written: string[] = [];
  return {
    written,
    read: async (): Promise<Uint8Array | null> => {
      if (queue.length === 0) {
        return null;
      }
      const next = queue.shift();
      return next === null || next === undefined ? null : new TextEncoder().encode(next);
    },
    write: async (chunk: Uint8Array): Promise<void> => {
      written.push(new TextDecoder().decode(chunk));
    },
  };
}

describe("performHandshake", () => {
  test("agrees when both peers declare the same major", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["1"]}\n']);
    expect(await performHandshake(io)).toEqual({ ok: true, version: "1", pending: [] });
  });

  test("writes our hello BEFORE reading anything", async () => {
    // §5: the first frame each peer writes MUST be a hello, and a peer MUST NOT write
    // anything before it. Both peers announce unprompted — a runtime that waited for the
    // peer before writing would deadlock against another runtime doing the same.
    const order: string[] = [];
    const io: HandshakeIo = {
      read: async () => {
        order.push("read");
        return new TextEncoder().encode('{"nimbus":"hello","contractVersions":["1"]}\n');
      },
      write: async () => {
        order.push("write");
      },
    };
    await performHandshake(io);
    expect(order[0]).toBe("write");
  });

  test("the frame it writes is a well-formed hello for our declared set", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["1"]}\n']);
    await performHandshake(io);
    expect(io.written.join("")).toBe(
      `{"nimbus":"hello","contractVersions":${JSON.stringify([...CONTRACT_VERSIONS])}}\n`,
    );
  });

  test("a frame split across reads is assembled before parsing", async () => {
    const io = scriptedPeer(['{"nimbus":"hello",', '"contractVersions":["1"]}\n']);
    expect(await performHandshake(io)).toEqual({ ok: true, version: "1", pending: [] });
  });

  test("surfaces the parseHello reason rather than collapsing it", async () => {
    // The whole reason HandshakeResult exists: ContractNegotiationResult could not
    // carry these, and flattening them would discard what §5 names.
    const cases: [string, string][] = [
      ["{oops\n", "not-json"],
      ["null\n", "not-object"],
      ['{"nimbus":"goodbye","contractVersions":["1"]}\n', "wrong-message"],
      ['{"nimbus":"hello"}\n', "missing-versions"],
      ['{"nimbus":"hello","contractVersions":[]}\n', "empty-versions"],
      ['{"nimbus":"hello","contractVersions":["01"]}\n', "invalid-version"],
      ['{"nimbus":"hello","contractVersions":["1","1"]}\n', "duplicate-version"],
    ];
    for (const [frame, reason] of cases) {
      expect(await performHandshake(scriptedPeer([frame]))).toEqual({ ok: false, reason, pending: [] });
    }
  });

  test("refuses no-common-version when the sets are disjoint", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["2"]}\n']);
    expect(await performHandshake(io)).toEqual({ ok: false, reason: "no-common-version", pending: [] });
  });

  test("refuses when the stream ends before any frame arrives", async () => {
    // §7.3 makes an absent hello a refusal. There is no reason token for "silence",
    // so it lands on no-common-version — we never learned a set to intersect with.
    expect(await performHandshake(scriptedPeer([]))).toEqual({
      ok: false,
      reason: "no-common-version",
    });
  });

  test("accepts a final frame that end-of-stream delivered without its newline", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["1"]}']);
    expect(await performHandshake(io)).toEqual({ ok: true, version: "1", pending: [] });
  });

  test("honours an explicit localVersions over the SDK default", async () => {
    const io = scriptedPeer(['{"nimbus":"hello","contractVersions":["2","3"]}\n']);
    expect(await performHandshake(io, { localVersions: ["2", "3"] })).toEqual({
      ok: true,
      version: "3",
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd sdks/typescript && bun test src/ipc/handshake.test.ts
```

Expected: **failure to resolve `./handshake.js`** — the module does not exist yet, so the file fails to load and no test runs.

- [ ] **Step 3: Write `handshake.ts`**

Create `sdks/typescript/src/ipc/handshake.ts`:

```ts
/**
 * The handshake — the one exchange this package can perform end to end.
 *
 * Normative documents: `docs/spec/negotiation/v1/contract-version.md` §5 (the frame and the
 * order it is written in) and §6 (the algorithm), over `docs/spec/wire/v1/framing.md` §3.
 *
 * Streams are **injected**, never opened. This package performs no I/O, and a runtime that
 * owned its own would be untestable without spawning a process — which §8 says it cannot do.
 */

import { CONTRACT_VERSIONS, negotiateContractVersion } from "../contract-version.js";
import { encodeHello, type HelloRefusalReason, parseHello } from "./hello.js";
import { NdjsonLineReader } from "./ndjson-line-reader.js";

/**
 * Why a handshake failed.
 *
 * Wider than `ContractNegotiationResult`'s reason, deliberately: the exchange can fail at the
 * frame layer for any of the seven §5 reasons before negotiation is ever reached, and
 * collapsing those into `no-common-version` would discard what §5 went to the trouble of
 * naming. `"invalid-version"` is already a `HelloRefusalReason`, so the union needs no special
 * case for the one reason both layers produce.
 */
export type HandshakeRefusalReason = HelloRefusalReason | "no-common-version";

export type HandshakeResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly reason: HandshakeRefusalReason };

/**
 * The byte stream, supplied by the caller.
 *
 * `read` resolves `null` at end of stream. Neither method is given a timeout: §8 puts that
 * bound on "whatever supervises the process" and makes no value normative, so a caller who
 * wants one wraps this call.
 */
export interface HandshakeIo {
  read(): Promise<Uint8Array | null>;
  write(chunk: Uint8Array): Promise<void>;
}

export interface HandshakeOptions {
  /** Defaults to {@link CONTRACT_VERSIONS} — what this SDK speaks. */
  readonly localVersions?: readonly string[];
  /**
   * The reader to draw frames through. **Supply one to keep the session's bytes.**
   *
   * A peer announces unprompted (§5), so its hello and its first request very often arrive
   * in a single read. A reader created here and dropped on return would destroy whatever
   * followed the hello — complete frames and a half-buffered one alike — and nothing would
   * indicate it had happened. Passing your own keeps both.
   *
   * Omitting it is fine when nothing follows the handshake, such as in a test.
   */
  readonly reader?: NdjsonLineReader;
}

/**
 * Announce, listen, agree — or refuse.
 *
 * Returns the refusal rather than exiting. The caller owns the process and the exit code;
 * `CONTRACT_HANDSHAKE_EXIT` is exported for it.
 */
export async function performHandshake(
  io: HandshakeIo,
  options: HandshakeOptions = {},
): Promise<HandshakeResult> {
  const local = options.localVersions ?? CONTRACT_VERSIONS;

  // §5, and the order is load-bearing: our hello goes out before we read a single byte.
  // Both peers announce unprompted, so waiting for theirs first would deadlock two runtimes
  // against each other.
  await io.write(new TextEncoder().encode(`${encodeHello(local)}\n`));

  const reader = options.reader ?? new NdjsonLineReader();
  const pending: string[] = [];
  let peerFrame: string | undefined;

  while (peerFrame === undefined) {
    const chunk = await io.read();
    if (chunk === null) {
      // End of stream. A peer that stopped mid-frame may still have left a complete hello
      // without its terminating newline, so drain before giving up.
      peerFrame = reader.flushFrames().frames[0];
      break;
    }
    peerFrame = reader.push(chunk)[0];
  }

  if (peerFrame === undefined) {
    // §7.3: an absent hello is a refusal. There is no token for silence, and we never
    // learned a set to intersect with, so this is the empty intersection.
    return { ok: false, reason: "no-common-version" };
  }

  const parsed = parseHello(peerFrame);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }

  const negotiated = negotiateContractVersion(local, parsed.contractVersions);
  if (!negotiated.ok) {
    return { ok: false, reason: negotiated.reason };
  }
  return { ok: true, version: negotiated.version };
}
```

- [ ] **Step 4: Export from the `./ipc` barrel**

In `sdks/typescript/src/ipc/index.ts`, add a block **before** the `./hello.js` block so the exports stay alphabetical by module path:

```ts
export {
  type HandshakeIo,
  type HandshakeOptions,
  type HandshakeRefusalReason,
  type HandshakeResult,
  performHandshake,
} from "./handshake.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd sdks/typescript && bun test src/ipc/handshake.test.ts
```

Expected: **9 pass, 0 fail**.

- [ ] **Step 6: Prove the write-before-read rule is load-bearing, by mutation**

In `handshake.ts`, move the `await io.write(...)` line to *after* the read loop, so the runtime reads first. Re-run:

```bash
cd sdks/typescript && bun test src/ipc/handshake.test.ts
```

Expected: **1 fail** — `writes our hello BEFORE reading anything`, because `order[0]` is now `"read"`. Every other test still passes, which confirms the failure is that assertion rather than collateral damage — and shows that without this test, a reads-first runtime would look completely correct.

Restore the write to the top and re-run: **9 pass, 0 fail**. Confirm with `git diff` that no probe remains.

- [ ] **Step 7: Satisfy both documentation gates**

First claim the module. `docs/modules/ipc.md` line 1 currently reads:

```
<!-- covers: ipc/ndjson-line-reader -->
```

Change it to:

```
<!-- covers: ipc/ndjson-line-reader, ipc/handshake -->
```

Then add a section to that page documenting `performHandshake`, matching the file's existing voice and depth. It must state: that streams are injected and the package opens none; that our hello is written first per §5; that a refusal is returned rather than exited, with `CONTRACT_HANDSHAKE_EXIT` for the caller; and that there is no timeout, per §8. Include a short usage example wiring the two callbacks.

Then regenerate the surface — **never hand-edit it**:

```bash
cd sdks/typescript && bun run build && bun run api:surface
```

- [ ] **Step 8: Run the full gate**

```bash
cd sdks/typescript && bun run typecheck && bun run lint && bun run test
```

Expected: typecheck clean, lint clean, **0 fail**, and the total up by 9 from 1085.

- [ ] **Step 9: Commit**

```bash
git add sdks/typescript/src/ipc/ docs/modules/ipc.md docs/api-surface.md
git commit -m "feat(ipc): perform the contract-version handshake

Adds performHandshake: write our hello, read the peer's, negotiate, return
agreement or refusal. Turns the primitives sub-project C added into the one
exchange this package can carry out end to end.

Streams are injected rather than opened, so the package still performs no
I/O and the runtime is testable without spawning a process — which section
8 says it otherwise cannot be.

Returns HandshakeResult rather than ContractNegotiationResult. The
exchange can fail at the frame layer for any of the seven section 5
reasons before negotiation is reached, and that union cannot hold them;
collapsing them into no-common-version would discard what section 5 names.

Writes before reading, per section 5. Both peers announce unprompted, so a
runtime that waited would deadlock against another doing the same — proved
by mutation: reading first fails exactly the ordering test and nothing else.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: wire it to `NimbusExtensionServer`

**Files:**
- Modify: `sdks/typescript/src/server.ts`
- Modify: `sdks/typescript/src/server.test.ts` (append)
- Modify: `docs/modules/server.md`
- Modify: `docs/api-surface.md` (regenerated)

**Interfaces:**
- Consumes from Task 1: `performHandshake`, `HandshakeIo`, `HandshakeResult` from `./ipc/handshake.js`.
- Produces: `NimbusExtensionServer.handshake(io: HandshakeIo): Promise<HandshakeResult>`.

- [ ] **Step 1: Write the failing tests**

Append to `sdks/typescript/src/server.test.ts`:

```ts
describe("NimbusExtensionServer.handshake", () => {
  const manifest: ExtensionManifest = {
    id: "handshake-fixture",
    displayName: "Handshake Fixture",
    version: "0.1.0",
    description: "Exercises the handshake delegation.",
    author: "Nimbus Contributors",
    entrypoint: "./index.ts",
    runtime: "bun",
    permissions: ["read"],
    hitlRequired: [],
    minNimbusVersion: "0.1.0",
  };

  test("delegates to performHandshake and returns its result", async () => {
    const server = new NimbusExtensionServer({ manifest });
    const written: string[] = [];
    let sent = false;
    const result = await server.handshake({
      read: async () => {
        if (sent) {
          return null;
        }
        sent = true;
        return new TextEncoder().encode('{"nimbus":"hello","contractVersions":["1"]}\n');
      },
      write: async (chunk) => {
        written.push(new TextDecoder().decode(chunk));
      },
    });
    expect(result).toEqual({ ok: true, version: "1", pending: [] });
    expect(written.join("")).toContain('"nimbus":"hello"');
  });

  test("returns the refusal rather than throwing or exiting", async () => {
    const server = new NimbusExtensionServer({ manifest });
    const result = await server.handshake({
      read: async () => null,
      write: async () => {},
    });
    expect(result).toEqual({ ok: false, reason: "no-common-version", pending: [] });
  });

  test("start() is unchanged — still synchronous, still takes no arguments", () => {
    // Guards the compatibility promise this sub-project made. If start() ever grows a
    // required parameter or becomes async, this fails and the package needs a major.
    const server = new NimbusExtensionServer({ manifest });
    expect(server.start()).toBeUndefined();
    expect(NimbusExtensionServer.prototype.start.length).toBe(0);
  });
});
```

If `ExtensionManifest` is not already imported in that file, add it to the existing import from `./types.js`.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd sdks/typescript && bun test src/server.test.ts
```

Expected: **typecheck/runtime failure** — `server.handshake is not a function`. The `start()` test should already pass.

- [ ] **Step 3: Add the method**

In `sdks/typescript/src/server.ts`, add the import and the method. **Do not touch `start()` or `registerTool()`.**

```ts
import { type HandshakeIo, type HandshakeResult, performHandshake } from "./ipc/handshake.js";
```

and inside the class, after `start()`:

```ts
  /**
   * Perform the contract-version handshake over a caller-supplied stream.
   *
   * A thin delegate to {@link performHandshake}: the logic lives in a free function so both
   * language bindings can be held to it identically, and so this class does not become the
   * only way to reach it.
   *
   * Deliberately **not** part of {@link start}. `start()` is called with no arguments in the
   * published examples and in `docs/modules/server.md`; giving it a required parameter would
   * be a breaking change to a package whose value is being stable.
   *
   * Stores nothing. There is no other operation to gate — `registerTool` is still a stub —
   * and the caller holds the result, which is the only thing that needs it.
   */
  handshake(io: HandshakeIo): Promise<HandshakeResult> {
    return performHandshake(io, { localVersions: this._options.manifest.contractVersions });
  }
```

**Check before writing that last line:** if `ExtensionManifest` has no `contractVersions` field, or it is optional and may be `undefined`, pass `undefined` through — `performHandshake` already defaults to `CONTRACT_VERSIONS`. Confirm with `grep -n "contractVersions" src/types.ts`; the field is optional per `contract-version.md` §4, so the type must allow `undefined` here.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd sdks/typescript && bun test src/server.test.ts
```

Expected: all pass, **0 fail**.

- [ ] **Step 5: Document and regenerate**

Add a section to `docs/modules/server.md` for `handshake(io)`, in that page's existing voice. It must say that `start()` is unchanged and why, that the result is returned rather than exited, and link the `ipc` page for `HandshakeIo`.

```bash
cd sdks/typescript && bun run build && bun run api:surface
```

- [ ] **Step 6: Run the full gate and commit**

```bash
cd sdks/typescript && bun run typecheck && bun run lint && bun run test
```

Expected: clean, **0 fail**.

```bash
git add sdks/typescript/src/server.ts sdks/typescript/src/server.test.ts docs/modules/server.md docs/api-surface.md
git commit -m "feat(server): delegate the handshake from NimbusExtensionServer

Adds handshake(io), a thin delegate to performHandshake. The logic stays in
the free function so both bindings can be held to it identically.

start() is deliberately untouched: it is called with no arguments in two
published examples, a module doc and three tests, so giving it a required
parameter would take the package to 2.0.0 for a feature that works just as
well alongside. A test now pins that promise.

The method stores nothing. There is no other operation to gate while
registerTool remains a stub, and the caller holds the result.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: the Python handshake primitive

**Files:**
- Create: `sdks/python/src/nimbus_sdk/ipc/handshake.py`
- Create: `sdks/python/tests/test_handshake.py`
- Modify: `sdks/python/src/nimbus_sdk/ipc/__init__.py` (imports and `__all__`)

**Interfaces:**
- Consumes: `CONTRACT_VERSIONS`, `negotiate_contract_version`, `NegotiationRefused` from `nimbus_sdk.contract`; `encode_hello`, `parse_hello`, `HelloRefused` from `nimbus_sdk.ipc.hello`; `NdjsonLineReader` from `nimbus_sdk.ipc.ndjson`.
- Produces, for Task 4: `HandshakeIO` (Protocol), `HandshakeOk(version: str)`, `HandshakeRefused(reason: str)`, `HandshakeResult`, `perform_handshake(io, *, local_versions=CONTRACT_VERSIONS)`.

**Do not add an `ok` field to the Python dataclasses.** It would make `if result.ok:` read the same in both languages, but it does not work and it breaks precedent. A plain `ok: bool` **does not narrow the union under `mypy --strict`**, so `if result.ok: print(result.version)` fails to typecheck — the suggestion produces code that looks portable and does not compile. `HandshakeOk(version="1", ok=False)` would also be constructible and meaningless. `isinstance` is the Python idiom, narrows correctly, and is what `contract.py`'s existing `NegotiationOk` / `NegotiationRefused` already use — neither carries an `ok` field. (`Literal[True]` / `Literal[False]` *would* narrow, but applying that to one result family and not the other is worse than either extreme.)

**Note the deliberate asymmetry:** this function is **synchronous**, where TypeScript's is async. Python's standard streams block, and a startup handshake has nothing to overlap with; `async def` would drag every Python connector into an event loop for no gain. The behaviour is identical — only the calling convention differs.

**An asyncio caller wraps it:** `await asyncio.to_thread(perform_handshake, io)`. The handshake runs once at startup, before the connector serves anything, so in practice there is nothing on the loop for it to block — but a connector that has already started other tasks should use `to_thread` rather than calling it directly. **Say so in the module docstring**, since a blocked event loop is invisible until it bites. An `async` sibling is additive if a real caller ever needs one; adding it now would double the surface with no caller, which is the situation this whole sub-project exists to correct.

- [ ] **Step 1: Write the failing tests**

Create `sdks/python/tests/test_handshake.py`:

```python
"""The handshake runtime, driven by scripted peers.

Synchronous by design: Python's standard streams block, so an async variant would buy
nothing at connector startup. See the design doc for why this does not count as a
divergence from the TypeScript binding.
"""

from __future__ import annotations

import pytest

from nimbus_sdk import CONTRACT_VERSIONS
from nimbus_sdk.ipc import HandshakeOk, HandshakeRefused, perform_handshake


class ScriptedPeer:
    """Hands back queued chunks, records everything written."""

    def __init__(self, chunks: list[bytes]) -> None:
        self._queue = list(chunks)
        self.written: list[bytes] = []
        self.order: list[str] = []

    def read(self) -> bytes | None:
        self.order.append("read")
        return self._queue.pop(0) if self._queue else None

    def write(self, chunk: bytes) -> None:
        self.order.append("write")
        self.written.append(chunk)


def test_agrees_when_both_declare_the_same_major() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["1"]}\n'])
    assert perform_handshake(peer) == HandshakeOk(version="1", pending=())


def test_writes_our_hello_before_reading_anything() -> None:
    # Section 5: the first frame each peer writes MUST be a hello, and both peers announce
    # unprompted — so a runtime that waited for the peer would deadlock against another
    # runtime doing the same.
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["1"]}\n'])
    perform_handshake(peer)
    assert peer.order[0] == "write"


def test_the_frame_written_is_a_hello_for_our_declared_set() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["1"]}\n'])
    perform_handshake(peer)
    sent = b"".join(peer.written).decode("utf-8")
    assert sent.startswith('{"nimbus":"hello"')
    assert sent.endswith("\n")
    for version in CONTRACT_VERSIONS:
        assert f'"{version}"' in sent


def test_a_frame_split_across_reads_is_assembled_before_parsing() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello",', b'"contractVersions":["1"]}\n'])
    assert perform_handshake(peer) == HandshakeOk(version="1", pending=())


@pytest.mark.parametrize(
    ("frame", "reason"),
    [
        (b"{oops\n", "not-json"),
        (b"null\n", "not-object"),
        (b'{"nimbus":"goodbye","contractVersions":["1"]}\n', "wrong-message"),
        (b'{"nimbus":"hello"}\n', "missing-versions"),
        (b'{"nimbus":"hello","contractVersions":[]}\n', "empty-versions"),
        (b'{"nimbus":"hello","contractVersions":["01"]}\n', "invalid-version"),
        (b'{"nimbus":"hello","contractVersions":["1","1"]}\n', "duplicate-version"),
    ],
)
def test_surfaces_the_parse_hello_reason(frame: bytes, reason: str) -> None:
    # Why HandshakeRefused exists rather than reusing NegotiationRefused: five of these
    # reasons describe a frame that never reached negotiation at all.
    assert perform_handshake(ScriptedPeer([frame])) == HandshakeRefused(reason=reason, pending=())


def test_refuses_no_common_version_when_sets_are_disjoint() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["2"]}\n'])
    assert perform_handshake(peer) == HandshakeRefused(reason="no-common-version", pending=())


def test_refuses_when_the_stream_ends_before_any_frame() -> None:
    # Section 7.3 makes an absent hello a refusal. No token exists for silence, and we
    # never learned a set to intersect with.
    assert perform_handshake(ScriptedPeer([])) == HandshakeRefused(reason="no-common-version", pending=())


def test_accepts_a_final_frame_delivered_without_its_newline() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["1"]}'])
    assert perform_handshake(peer) == HandshakeOk(version="1", pending=())


def test_honours_explicit_local_versions() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["2","3"]}\n'])
    assert perform_handshake(peer, local_versions=("2", "3")) == HandshakeOk(version="3", pending=())


def test_it_never_exits_the_process() -> None:
    # Section 8: this package owns no process to exit. A refusal is a value.
    peer = ScriptedPeer([b"{oops\n"])
    result = perform_handshake(peer)
    assert isinstance(result, HandshakeRefused)
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd sdks/python && python -m pytest tests/test_handshake.py -q
```

Expected: **collection error** — `ImportError: cannot import name 'HandshakeOk' from 'nimbus_sdk.ipc'`.

- [ ] **Step 3: Write `handshake.py`**

Create `sdks/python/src/nimbus_sdk/ipc/handshake.py`:

```python
"""The handshake — the one exchange this package can perform end to end.

Normative documents: ``docs/spec/negotiation/v1/contract-version.md`` §5 (the frame, and
the order it is written in) and §6 (the algorithm), over ``docs/spec/wire/v1/framing.md``
§3.

Streams are **injected**, never opened: this package performs no I/O, and a runtime that
owned its own would be untestable without spawning a process, which §8 says it cannot do.

Synchronous, where the TypeScript binding is async. Python's standard streams block and a
startup handshake has nothing to overlap with, so ``async def`` would drag every connector
into an event loop for nothing. The behaviour is identical; only the calling convention
differs.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from nimbus_sdk.contract import (
    CONTRACT_VERSIONS,
    NegotiationRefused,
    negotiate_contract_version,
)
from nimbus_sdk.ipc.hello import HelloRefused, encode_hello, parse_hello
from nimbus_sdk.ipc.ndjson import NdjsonLineReader


class HandshakeIO(Protocol):
    """The byte stream, supplied by the caller.

    Structural: any object with these two methods satisfies it, with nothing to inherit.
    ``read`` returns ``None`` at end of stream. Neither method is given a timeout — §8
    puts that bound on whatever supervises the process and makes no value normative, so a
    caller who wants one wraps this call.
    """

    def read(self) -> bytes | None: ...

    def write(self, chunk: bytes) -> None: ...


@dataclass(frozen=True, slots=True)
class HandshakeOk:
    """Agreement on a contract major.

    ``pending`` holds any complete frames the peer sent after its hello. A caller MUST
    process these before reading further: a peer announces unprompted (§5), so its hello
    and its first request often arrive in one read, and dropping them silently loses the
    first message of the session.
    """

    version: str
    pending: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class HandshakeRefused:
    """A refusal, carrying one of the §5 frame reasons or ``no-common-version``.

    Also carries ``pending`` so every return path has the same shape; on a refusal the
    caller exits 20 and will not use it.

    Not :class:`NegotiationRefused`, whose ``reason`` would accept these without
    complaint: five of them describe a frame that never reached negotiation, and
    ``NegotiationRefused(reason="not-json")`` would claim one happened.
    """

    reason: str
    pending: tuple[str, ...] = ()


HandshakeResult = HandshakeOk | HandshakeRefused


def perform_handshake(
    io: HandshakeIO,
    *,
    local_versions: Sequence[str] = CONTRACT_VERSIONS,
    reader: NdjsonLineReader | None = None,
) -> HandshakeResult:
    """Announce, listen, agree — or refuse.

    Returns the refusal rather than exiting. The caller owns the process and the exit
    code; :data:`CONTRACT_HANDSHAKE_EXIT` is exported for it.
    """
    # §5, and the order is load-bearing: our hello goes out before we read a single byte.
    # Both peers announce unprompted, so waiting for theirs would deadlock two runtimes.
    io.write(f"{encode_hello(local_versions)}\n".encode())

    reader = reader if reader is not None else NdjsonLineReader()
    peer_frame: str | None = None

    while peer_frame is None:
        chunk = io.read()
        if chunk is None:
            # End of stream. A peer that stopped mid-frame may still have left a complete
            # hello without its terminating newline, so drain before giving up.
            drained = reader.flush_frames().frames
            peer_frame = drained[0] if drained else None
            break
        frames = reader.push(chunk)
        if frames:
            peer_frame = frames[0]

    if peer_frame is None:
        # §7.3: an absent hello is a refusal. There is no token for silence, and we never
        # learned a set to intersect with.
        return HandshakeRefused(reason="no-common-version", pending=())

    parsed = parse_hello(peer_frame)
    if isinstance(parsed, HelloRefused):
        return HandshakeRefused(reason=parsed.reason, pending=tuple(pending))

    negotiated = negotiate_contract_version(local_versions, parsed.contract_versions)
    if isinstance(negotiated, NegotiationRefused):
        return HandshakeRefused(reason=negotiated.reason, pending=tuple(pending))
    return HandshakeOk(version=negotiated.version, pending=tuple(pending))
```

- [ ] **Step 4: Export from the `ipc` package**

In `sdks/python/src/nimbus_sdk/ipc/__init__.py`, add the import block and merge the names into `__all__`, keeping it in the order ruff's `RUF022` wants (run `python -m ruff check --fix .` and accept its sort rather than arguing with it):

```python
from nimbus_sdk.ipc.handshake import (
    HandshakeIO,
    HandshakeOk,
    HandshakeRefused,
    HandshakeResult,
    perform_handshake,
)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd sdks/python && python -m pytest tests/test_handshake.py -q
```

Expected: **17 passed** (10 plain tests + 7 parametrised reason cases).

- [ ] **Step 6: Prove the write-before-read rule is load-bearing, by mutation**

In `handshake.py`, move the `io.write(...)` line to just before the `return` statements — i.e. after the read loop. Re-run:

```bash
cd sdks/python && python -m pytest tests/test_handshake.py -q
```

Expected: **1 failed** — `test_writes_our_hello_before_reading_anything`, because `peer.order[0]` is now `"read"`. Restore the write to the top and re-run: **17 passed**. Confirm with `git diff` that no probe remains.

- [ ] **Step 7: Run the full gate and commit**

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

Expected: all clean; **145 passed, 6 skipped** (128 + 17).

```bash
git add sdks/python/src/nimbus_sdk/ipc/ sdks/python/tests/test_handshake.py
git commit -m "feat(python): perform the contract-version handshake

Mirrors the TypeScript runtime: write our hello, read the peer's,
negotiate, return agreement or refusal. Streams are injected, so the
package still performs no I/O.

Synchronous where TypeScript is async. Python's standard streams block and
a startup handshake has nothing to overlap with, so async def would drag
every connector into an event loop for nothing. Behaviour is identical;
only the calling convention differs.

HandshakeRefused rather than NegotiationRefused, whose untyped reason
would have accepted these without complaint: five of the seven describe a
frame that never reached negotiation, and claiming one happened would be a
type that lies quietly.

Write-before-read proved by mutation: reading first fails exactly the
ordering test.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: the cross-binding differential test

**Files:**
- Create: `sdks/python/tests/test_handshake_differential.py`
- Create: `sdks/typescript/scripts/handshake-differential.test.ts`

**Interfaces:**
- Consumes: `perform_handshake` / `performHandshake` and their result types from Tasks 1 and 3.
- Produces: nothing.

**Why this exists.** Sub-project C found three real cross-binding divergences that the conformance corpora could not see, all by comparing the two bindings against each other on adversarial input rather than against fixtures. The handshake composes four pinned primitives, but *the composition itself* is pinned by nothing. This is that check.

**The shape is constrained by CI.** `build-test` and `python` are **separate jobs on separate runners** (`.github/workflows/ci.yml` lines 17 and 131), so one test cannot write a file another reads — they never meet. Instead a **committed fixture** holds the expected result per exchange, and *both* suites assert against it independently. If the bindings ever disagree, at least one job goes red; if someone edits the fixture to silence one, the other breaks.

- [ ] **Step 1: Create the shared fixture**

Create `docs/fixtures/handshake-exchanges.json`. **Deliberately outside `docs/spec/`.** RFC-0007 established `conformance/` as a governed space where a corpus is normative and changing one needs an RFC. This is a test fixture, not a corpus, so putting it there would undermine a boundary that RFC just drew. `docs/` is already language-neutral and already holds non-spec material (`modules/`, `rfcs/`, `superpowers/`), and both suites reach it through their existing repo-root helpers.

Each entry gives the chunks the peer delivers and the single result both bindings must produce, encoded as `ok:<version>` or `refused:<reason>`:

| name | chunks | expect |
|---|---|---|
| `agree-on-1` | one complete hello for `["1"]` | `ok:1` |
| `split-frame` | that hello cut after `"nimbus":"hello",` | `ok:1` |
| `no-newline-at-eof` | that hello with no trailing LF | `ok:1` |
| `silence` | none — immediate end of stream | `refused:no-common-version` |
| `empty-chunk-then-frame` | `""` then the hello | `ok:1` |
| `disjoint` | a hello for `["2"]` | `refused:no-common-version` |
| `not-json` | `{oops` + LF | `refused:not-json` |
| `not-object` | `null` + LF | `refused:not-object` |
| `wrong-message` | `"nimbus":"goodbye"` | `refused:wrong-message` |
| `missing-versions` | `{"nimbus":"hello"}` | `refused:missing-versions` |
| `empty-versions` | `contractVersions: []` | `refused:empty-versions` |
| `invalid-version` | `contractVersions: ["01"]` | `refused:invalid-version` |
| `duplicate-version` | `contractVersions: ["1","1"]` | `refused:duplicate-version` |
| `blank-lines-before-frame` | two bare LFs, then the hello | `ok:1` |
| `crlf-terminated` | the hello ending `\r\n` | `ok:1` |
| `second-frame-returned` | two hellos in one chunk, `["1"]` then `["2"]` | `ok:1`, and the second frame in `pending` |
| `hello-plus-two-frames` | a hello then `{"a":1}` and `{"b":2}` in one chunk | `ok:1`, both in `pending`, in order |

Write it as JSON with a `_comment` key stating that it must never be edited to make a test pass, and an `exchanges` object keyed by the names above, each holding `chunks` (an array of strings) and `expect`.

`crlf-terminated` is **not** a guess, and needs no extra reader tests. `single-frame-crlf` in the framing corpus already pins that "a CRLF sender and an LF sender produce identical frames", and both bindings execute that corpus. Verified end to end before writing this: a CRLF-terminated hello yields the frame with its CR stripped, which then parses to `HelloOk(contract_versions=('1',))`.

**The fixture must compare `pending`, not only the result.** Each entry carries a `pending` array alongside `expect`, and both runners assert both. Without it the differential is blind to the field that took two fix rounds to get right: a regression hardcoding `pending` to empty would pass every fixture case, because `ok:1` is unchanged by it. A task-3 reviewer found exactly that hole and it is why `second-frame-returned` and `hello-plus-two-frames` are here.

**`blank-lines-before-frame` remains a prediction, not an observation** — it assumes zero-length frames are dropped before the hello arrives, and the specification is silent. If a run disproves it, **correct the fixture to match reality and say so in the report**; what matters is that the two bindings agree, not that they match my guess. If the two bindings disagree with *each other*, that is the finding this task exists for.

- [ ] **Step 2: Write the Python side**

Create `sdks/python/tests/test_handshake_differential.py`:

```python
"""Every scripted exchange, asserted against the shared cross-binding fixture.

Its TypeScript twin asserts against the same file. CI runs the two suites in separate
jobs, so they cannot hand data to each other — the committed fixture is what correlates
them. The corpora pin the four primitives the handshake composes; nothing pinned the
composition, which is where sub-project C found three divergences no corpus could see.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nimbus_sdk.ipc import HandshakeOk, perform_handshake

FIXTURE = Path(__file__).parents[3] / "docs" / "fixtures" / "handshake-exchanges.json"
EXCHANGES: dict[str, dict[str, object]] = json.loads(
    FIXTURE.read_text(encoding="utf-8")
)["exchanges"]


class _Peer:
    """Hands back queued chunks; discards writes."""

    def __init__(self, chunks: list[str]) -> None:
        self._queue = [chunk.encode("utf-8") for chunk in chunks]

    def read(self) -> bytes | None:
        return self._queue.pop(0) if self._queue else None

    def write(self, chunk: bytes) -> None:
        return None


def test_the_fixture_is_not_empty() -> None:
    # An empty fixture would make every parametrised case below vanish silently.
    assert len(EXCHANGES) > 10


@pytest.mark.parametrize("name", sorted(EXCHANGES))
def test_exchange_matches_the_shared_fixture(name: str) -> None:
    case = EXCHANGES[name]
    chunks = case["chunks"]
    assert isinstance(chunks, list)
    result = perform_handshake(_Peer([str(chunk) for chunk in chunks]))
    actual = (
        f"ok:{result.version}"
        if isinstance(result, HandshakeOk)
        else f"refused:{result.reason}"
    )
    assert list(result.pending) == case.get("pending", []), (
        f"{name}: pending mismatch. This is the field a regression would empty silently "
        f"while every result string stayed identical."
    )
    assert actual == case["expect"], (
        f"{name}: Python produced {actual!r}. If the TypeScript suite agrees with the "
        f"fixture and this does not, the two bindings have diverged."
    )
```

Note `Path(__file__).parents[3]` — from `sdks/python/tests/` that is the repository root. Verify it resolves before relying on it; if the count is wrong the fixture read fails loudly at collection, which is the right failure.

- [ ] **Step 3: Run it**

```bash
cd sdks/python && python -m pytest tests/test_handshake_differential.py -q
```

Expected: **17 passed** — one non-empty check plus sixteen exchanges.

**If one fails, read it before touching anything.** A wrong prediction in the fixture is fixed in the fixture; a genuine bug in `perform_handshake` is fixed in the runtime. Decide which against `contract-version.md` §5–§7 and `framing.md` §3, and record the decision in the report.

- [ ] **Step 4: Write the TypeScript twin**

Create `sdks/typescript/scripts/handshake-differential.test.ts`:

```ts
/**
 * Every scripted exchange, asserted against the shared cross-binding fixture — the same
 * file `sdks/python/tests/test_handshake_differential.py` reads.
 *
 * CI runs the two suites in separate jobs, so they cannot hand data to each other; the
 * committed fixture is what correlates them. If the bindings disagree, at least one job
 * goes red, and editing the fixture to silence one breaks the other.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { performHandshake } from "../src/ipc/handshake.ts";
import { repoRoot } from "./paths.ts";

interface Exchange {
  readonly chunks: string[];
  readonly expect: string;
  /** Complete frames the peer sent after its hello. Absent means none. */
  readonly pending?: string[];
}

const FIXTURE_PATH = join(repoRoot, "docs/fixtures/handshake-exchanges.json");
const EXCHANGES = (
  JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { exchanges: Record<string, Exchange> }
).exchanges;

async function run(
  chunks: string[],
): Promise<{ outcome: string; pending: readonly string[] }> {
  const queue = [...chunks];
  const result = await performHandshake({
    read: async () => {
      const next = queue.shift();
      return next === undefined ? null : new TextEncoder().encode(next);
    },
    write: async () => {},
  });
  return {
    outcome: result.ok ? `ok:${result.version}` : `refused:${result.reason}`,
    pending: result.pending,
  };
}

describe("the handshake agrees with the shared fixture", () => {
  test("the fixture is not empty — an empty one would pass vacuously forever", () => {
    expect(Object.keys(EXCHANGES).length).toBeGreaterThan(10);
  });

  test("every exchange produces the recorded result", async () => {
    const disagreed: string[] = [];
    for (const [name, exchange] of Object.entries(EXCHANGES)) {
      const { outcome, pending } = await run(exchange.chunks);
      if (outcome !== exchange.expect) {
        disagreed.push(`${name}: expected ${exchange.expect}, got ${outcome}`);
      }
      const wantPending = exchange.pending ?? [];
      if (JSON.stringify(pending) !== JSON.stringify(wantPending)) {
        disagreed.push(
          `${name}: pending expected ${JSON.stringify(wantPending)}, got ${JSON.stringify(pending)}`,
        );
      }
    }
    expect(
      disagreed,
      "TypeScript disagrees with the shared handshake fixture. If the Python suite agrees " +
        "with it and this does not, the two bindings have diverged — which is exactly what " +
        "this test exists to catch. Do not edit the fixture to make this pass.",
    ).toEqual([]);
  });
});
```

- [ ] **Step 5: Run it, then prove it can fail**

```bash
cd sdks/typescript && bun test scripts/handshake-differential.test.ts
```

Expected: **2 pass, 0 fail**.

Then prove the check discriminates. Temporarily change one `expect` in the fixture — `not-json` to `refused:not-object` — and run **both** suites:

```bash
cd sdks/typescript && bun test scripts/handshake-differential.test.ts
cd sdks/python && python -m pytest tests/test_handshake_differential.py -q
```

Expected: TypeScript **1 fail** naming `not-json`; Python **1 failed** on the same exchange. Revert the fixture and re-run both: **2 pass** and **17 passed**.

That both suites reject the same corrupted fixture is what makes this a cross-binding check rather than two unrelated ones — and it is the only way to see that, since the two jobs never meet in CI.

- [ ] **Step 6: Run both full suites and commit**

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
cd sdks/typescript && bun run build && bun run typecheck && bun run lint && bun run test
```

Expected: both clean, **0 fail** in each.

```bash
git add docs/fixtures/handshake-exchanges.json sdks/python/tests/test_handshake_differential.py sdks/typescript/scripts/handshake-differential.test.ts
git commit -m "test: check the handshake agrees across both bindings

Sixteen scripted exchanges, asserted independently by both suites against
one committed fixture. CI runs the Python and TypeScript jobs on separate
runners, so they cannot hand results to each other; a shared fixture both
sides check is what correlates them, and editing it to silence one breaks
the other.

The corpora pin the four primitives the handshake composes. The
composition was pinned by nothing, which is where sub-project C found
three divergences no corpus could see.

Lives in docs/fixtures rather than docs/spec/conformance: RFC-0007 made
the conformance tree a governed space, and a test fixture is not a corpus.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Final verification before the PR

- [ ] `git status --porcelain` empty; no mutation probes survive in either language.
- [ ] Both suites green: TypeScript **0 fail**, Python **0 failed**.
- [ ] `start()` is unchanged: `git diff origin/main -- sdks/typescript/src/server.ts` shows an added import and an added method, and **no edit inside `start()` or `registerTool()`**.
- [ ] Neither binding performs I/O: this must print nothing.
  ```bash
  grep -rnE "process\.stdin|process\.stdout|sys\.stdin|sys\.stdout|open\(" sdks/typescript/src/ipc/handshake.ts sdks/python/src/nimbus_sdk/ipc/handshake.py
  ```
- [ ] Neither exits: `grep -rn "process.exit\|sys.exit" sdks/typescript/src/ipc/handshake.ts sdks/python/src/nimbus_sdk/ipc/handshake.py` prints nothing.
- [ ] `docs/api-surface.md` regenerated, not hand-edited — re-run `bun run api:surface` and confirm `git diff` is empty afterwards.
- [ ] `docs/modules/ipc.md` claims `ipc/handshake` in its `<!-- covers: -->` comment.
- [ ] **PR title `feat:`-class** — e.g. `feat: perform the contract-version handshake in both bindings`. This cuts a minor in both packages, which is intended: new exported surface, nothing removed.
