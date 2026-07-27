import { describe, expect, test } from "bun:test";
import { assertNoRowDataTools, isHitlRequest, runContractTests } from "@nimbus-dev/sdk";
import {
  auditedEmits,
  listCalendarsHandler,
  manifest,
  proposeEventHandler,
  TOOLS,
} from "./index.ts";

describe("calendar connector", () => {
  test("its manifest passes the contract tests", async () => {
    await runContractTests(manifest);
  });

  test("it declares HITL for the mutating permission it asks for", () => {
    expect(manifest.permissions).toContain("write");
    expect(manifest.hitlRequired).toContain("write");
  });

  test("its tool surface holds no row-data fetcher", () => {
    assertNoRowDataTools(TOOLS, "calendar-connector");
  });

  test("listing calendars returns metadata, never event bodies", async () => {
    const calendars = await auditedEmits(async (logger) => {
      expect(await listCalendarsHandler(logger)).toEqual([
        { id: "personal", displayName: "Personal", timeZone: "UTC" },
        { id: "work", displayName: "Work", timeZone: "UTC" },
      ]);
    });
    expect(calendars).toEqual([
      { action: "calendar-connector:calendar.list", payload: { calendarCount: 2 } },
    ]);
  });

  test("proposing an event returns a valid HITL request rather than writing", async () => {
    const emitted = await auditedEmits(async (logger) => {
      const request = await proposeEventHandler(
        { calendarId: "work", summary: "Design review", startsAt: "2026-08-01T10:00:00Z" },
        logger,
      );
      expect(isHitlRequest(request)).toBe(true);
      expect(request.actionId).toBe("calendar.event.create");
      expect(request.summary).toContain("Design review");
    });
    expect(emitted).toEqual([
      {
        action: "calendar-connector:calendar.entry.propose",
        payload: { calendarId: "work" },
      },
    ]);
  });

  test("the audit trail for a proposal never records its summary or diff", async () => {
    const emitted = await auditedEmits(async (logger) => {
      await proposeEventHandler(
        { calendarId: "personal", summary: "Secret plans", startsAt: "2026-09-01T09:00:00Z" },
        logger,
      );
    });
    expect(emitted).toEqual([
      {
        action: "calendar-connector:calendar.entry.propose",
        payload: { calendarId: "personal" },
      },
    ]);
    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain("Secret plans");
  });
});
