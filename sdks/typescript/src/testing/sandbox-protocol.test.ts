import { describe, expect, test } from "bun:test";

import {
  FS_DENIED_CODES,
  fsDeniedExit,
  NETWORK_BLOCKED_CODES,
  networkBlockedExit,
  SANDBOX_PROBE_EXIT,
  SANDBOX_PROBES,
} from "./sandbox-protocol.js";

describe("the sandbox probe protocol table (RFC-0004 §1)", () => {
  test("names the four exit codes the protocol defines", () => {
    expect(SANDBOX_PROBE_EXIT).toEqual({
      pass: 0,
      unexpected: 2,
      fsDenied: 10,
      networkBlocked: 11,
    });
  });

  test("names the three probes, in the order the harness runs them", () => {
    expect(SANDBOX_PROBES).toEqual(["network-listed", "network-unlisted", "fs-denied"]);
  });
});

describe("networkBlockedExit (RFC-0004 §2)", () => {
  test.each(["ECONNREFUSED", "EPERM", "EHOSTUNREACH", "ENETUNREACH"])(
    "%s means the sandbox blocked the connection",
    (code) => {
      expect(networkBlockedExit(code)).toBe(SANDBOX_PROBE_EXIT.networkBlocked);
    },
  );

  test.each(["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EACCES", "EBUSY"])(
    "%s is NOT a block, and is reported as unexpected",
    (code) => {
      expect(networkBlockedExit(code)).toBe(SANDBOX_PROBE_EXIT.unexpected);
    },
  );

  test("an error carrying no code at all is unexpected, not a block", () => {
    expect(networkBlockedExit(undefined)).toBe(SANDBOX_PROBE_EXIT.unexpected);
  });

  test("the accepted set is exactly the one the protocol publishes", () => {
    expect([...NETWORK_BLOCKED_CODES].sort()).toEqual([
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "EPERM",
    ]);
  });
});

describe("fsDeniedExit (RFC-0004 §2)", () => {
  test.each(["EACCES", "EPERM", "EBUSY"])("%s means the read was denied as expected", (code) => {
    expect(fsDeniedExit(code)).toBe(SANDBOX_PROBE_EXIT.fsDenied);
  });

  test.each(["ENOENT", "EISDIR", "ECONNREFUSED", "EHOSTUNREACH"])(
    "%s is NOT a denial, and is reported as unexpected",
    (code) => {
      expect(fsDeniedExit(code)).toBe(SANDBOX_PROBE_EXIT.unexpected);
    },
  );

  test("an error carrying no code at all is unexpected, not a denial", () => {
    // This is the case that made the Bun.file defect silent: a ReferenceError has no
    // `code`, so it fell through to `unexpected` and looked like a sandbox failure.
    expect(fsDeniedExit(undefined)).toBe(SANDBOX_PROBE_EXIT.unexpected);
  });

  test("the accepted set is exactly the one the protocol publishes", () => {
    expect([...FS_DENIED_CODES].sort()).toEqual(["EACCES", "EBUSY", "EPERM"]);
  });
});

describe("the two errno sets overlap only where the protocol says they do", () => {
  test("EPERM is the sole member of both", () => {
    const both = [...NETWORK_BLOCKED_CODES].filter((c) => FS_DENIED_CODES.has(c));
    expect(both).toEqual(["EPERM"]);
  });
});
