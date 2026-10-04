import { describe, expect, test } from "bun:test";
import { type HitlRequest, isHitlRequest } from "./hitl-request.js";

const VALID: HitlRequest = { actionId: "delete", summary: "Delete one file" };

describe("isHitlRequest", () => {
  test("accepts the two required members, with or without a string diff", () => {
    expect(isHitlRequest(VALID)).toBe(true);
    expect(isHitlRequest({ ...VALID, diff: "- a\n+ b" })).toBe(true);
    // `diff` carries no non-empty rule: an empty string is still a present string.
    expect(isHitlRequest({ ...VALID, diff: "" })).toBe(true);
  });

  // `typeof null` is "object", so the first half of the guard lets `null` through and the
  // second half is what refuses it — reading a member off it would throw instead.
  test("rejects null and every value that is not an object", () => {
    for (const value of [null, undefined, "delete", 1, true, Symbol("hitl"), () => VALID]) {
      expect(isHitlRequest(value)).toBe(false);
    }
  });

  test("rejects a missing, empty or non-string actionId", () => {
    expect(isHitlRequest({ summary: VALID.summary })).toBe(false);
    expect(isHitlRequest({ ...VALID, actionId: "" })).toBe(false);
    expect(isHitlRequest({ ...VALID, actionId: 7 })).toBe(false);
  });

  test("rejects a missing, empty or non-string summary", () => {
    expect(isHitlRequest({ actionId: VALID.actionId })).toBe(false);
    expect(isHitlRequest({ ...VALID, summary: "" })).toBe(false);
    expect(isHitlRequest({ ...VALID, summary: ["Delete one file"] })).toBe(false);
  });

  test("rejects a diff that is present but not a string", () => {
    for (const diff of [null, 0, false, { patch: "- a" }]) {
      expect(isHitlRequest({ ...VALID, diff })).toBe(false);
    }
  });

  // What `{ ...spread }` produces for an absent optional member. It must read as absent,
  // not as a `diff` that is present and not a string.
  test("treats an explicit undefined diff as absent", () => {
    expect(isHitlRequest({ ...VALID, diff: undefined })).toBe(true);
  });

  test("rejects an array, which is an object carrying neither member", () => {
    expect(isHitlRequest([VALID.actionId, VALID.summary])).toBe(false);
  });
});
