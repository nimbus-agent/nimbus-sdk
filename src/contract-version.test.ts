import { describe, expect, test } from "bun:test";
import {
  CONTRACT_HANDSHAKE_EXIT,
  CONTRACT_VERSIONS,
  declaredVersionsMatch,
  manifestContractVersions,
  negotiateContractVersion,
} from "./contract-version.js";

describe("CONTRACT_VERSIONS", () => {
  test("is exactly the majors this SDK's spec directories publish", () => {
    expect(CONTRACT_VERSIONS).toEqual(["1"]);
  });

  test("the reserved refusal exit code is 20", () => {
    expect(CONTRACT_HANDSHAKE_EXIT).toBe(20);
  });
});

describe("manifestContractVersions", () => {
  test("an absent field defaults to v1 only", () => {
    expect(manifestContractVersions({ id: "x" })).toEqual(["1"]);
  });

  test("a declared array is returned as declared, unfiltered", () => {
    expect(manifestContractVersions({ contractVersions: ["2", "01"] })).toEqual(["2", "01"]);
  });

  test("a non-array is wrapped, so the invalid value reaches the algorithm", () => {
    // Not dropped and not defaulted: dropping would silently turn a malformed manifest into a
    // valid v1 one, which is the failure this function exists to avoid.
    expect(manifestContractVersions({ contractVersions: "1" })).toEqual(["1"]);
    expect(manifestContractVersions({ contractVersions: 1 })).toEqual([1]);
  });

  test("a non-object manifest defaults, rather than throwing", () => {
    expect(manifestContractVersions(null)).toEqual(["1"]);
    expect(manifestContractVersions("nope")).toEqual(["1"]);
  });

  test("an explicitly empty array is preserved, not defaulted", () => {
    expect(manifestContractVersions({ contractVersions: [] })).toEqual([]);
  });
});

describe("negotiateContractVersion", () => {
  test("agrees on the single shared major", () => {
    expect(negotiateContractVersion(["1"], ["1"])).toEqual({ ok: true, version: "1" });
  });

  test("picks the largest common member, not the first", () => {
    expect(negotiateContractVersion(["1", "3", "2"], ["2", "3"])).toEqual({
      ok: true,
      version: "3",
    });
  });

  test('"10" is greater than "9" — length before character comparison', () => {
    expect(negotiateContractVersion(["9", "10"], ["10", "9"])).toEqual({
      ok: true,
      version: "10",
    });
  });

  test("a 25-digit major compares exactly, with no number parsing", () => {
    // Number("1234567890123456789012345") loses precision; a binding that parses to a float
    // would answer this wrongly while passing every short-major case.
    const long = "1234567890123456789012345";
    const alsoLong = "1234567890123456789012344";
    expect(negotiateContractVersion([long, alsoLong], [alsoLong, long])).toEqual({
      ok: true,
      version: long,
    });
  });

  test("order within either set does not matter", () => {
    expect(negotiateContractVersion(["1", "2"], ["2", "1"])).toEqual({ ok: true, version: "2" });
    expect(negotiateContractVersion(["2", "1"], ["1", "2"])).toEqual({ ok: true, version: "2" });
  });

  test("disjoint sets refuse", () => {
    expect(negotiateContractVersion(["1"], ["2"])).toEqual({
      ok: false,
      reason: "no-common-version",
    });
  });

  test("an empty set on either side refuses", () => {
    expect(negotiateContractVersion([], ["1"])).toEqual({
      ok: false,
      reason: "no-common-version",
    });
    expect(negotiateContractVersion(["1"], [])).toEqual({
      ok: false,
      reason: "no-common-version",
    });
  });

  test("a malformed member refuses as invalid, from either side", () => {
    for (const bad of ["01", "", "1.0", "١", " 1", "0"]) {
      expect(negotiateContractVersion([bad], ["1"]), `local ${JSON.stringify(bad)}`).toEqual({
        ok: false,
        reason: "invalid-version",
      });
      expect(negotiateContractVersion(["1"], [bad]), `remote ${JSON.stringify(bad)}`).toEqual({
        ok: false,
        reason: "invalid-version",
      });
    }
  });

  test("a non-string member refuses as invalid rather than throwing", () => {
    expect(negotiateContractVersion([1], ["1"])).toEqual({
      ok: false,
      reason: "invalid-version",
    });
    expect(negotiateContractVersion([null], ["1"])).toEqual({
      ok: false,
      reason: "invalid-version",
    });
  });

  test("invalid-version wins over no-common-version", () => {
    // Validation precedes intersection: otherwise two malformed disjoint sets report the wrong
    // reason, and a binding could pass by never validating at all.
    expect(negotiateContractVersion(["01"], ["2"])).toEqual({
      ok: false,
      reason: "invalid-version",
    });
  });
});

describe("declaredVersionsMatch", () => {
  test("equal sets match regardless of order", () => {
    expect(declaredVersionsMatch(["1", "2"], ["2", "1"])).toBe(true);
  });

  test("a hello superset does not match", () => {
    expect(declaredVersionsMatch(["1"], ["1", "2"])).toBe(false);
  });

  test("a hello subset does not match", () => {
    expect(declaredVersionsMatch(["1", "2"], ["1"])).toBe(false);
  });

  test("the manifest default participates like any other set", () => {
    expect(declaredVersionsMatch(manifestContractVersions({}), ["1"])).toBe(true);
    expect(declaredVersionsMatch(manifestContractVersions({}), ["1", "2"])).toBe(false);
  });

  test("a manifest whose members are malformed never matches", () => {
    expect(declaredVersionsMatch(["01"], ["1"])).toBe(false);
    expect(declaredVersionsMatch([1], ["1"])).toBe(false);
  });

  test("a duplicate in the announced set is collapsed, not refused", () => {
    // Set equality: {"1"} is {"1"} however many times the frame said it. The duplicate is
    // parseHello's business, one layer earlier — this pins the documented precondition rather
    // than leaving the behavior to be discovered.
    expect(declaredVersionsMatch(["1"], ["1", "1"])).toBe(true);
    expect(declaredVersionsMatch(["1", "2"], ["1", "1"])).toBe(false);
  });
});
