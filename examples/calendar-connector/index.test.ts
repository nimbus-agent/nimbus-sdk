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
    const calendars = await listCalendarsHandler();
    expect(calendars).toEqual([
      { id: "personal", displayName: "Personal", timeZone: "UTC" },
      { id: "work", displayName: "Work", timeZone: "UTC" },
    ]);
  });

  test("proposing an event returns a valid HITL request rather than writing", async () => {
    const request = await proposeEventHandler({
      calendarId: "work",
      summary: "Design review",
      startsAt: "2026-08-01T10:00:00Z",
    });
    expect(isHitlRequest(request)).toBe(true);
    expect(request.actionId).toBe("calendar.event.create");
    expect(request.summary).toContain("Design review");
  });

  test("the audit trail records the action and no event content", async () => {
    const emitted = await auditedEmits(async (logger) => {
      await logger.log("calendar.list", { calendarCount: 2 });
    });
    expect(emitted).toEqual([
      { action: "calendar-connector:calendar.list", payload: { calendarCount: 2 } },
    ]);
  });
});
