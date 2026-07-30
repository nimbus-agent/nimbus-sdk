import { describe, expect, test } from "bun:test";
import {
  assertNoRowDataTools,
  createScopedAuditLogger,
  isHitlRequest,
  parseICalendar,
  runContractTests,
} from "@nimbus-dev/sdk";
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
        {
          calendarId: "work",
          summary: "Design review",
          startsAt: "2026-08-01T10:00:00Z",
          endsAt: "2026-08-01T11:00:00Z",
        },
        logger,
        "20260715T120000Z",
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

  test("the diff is the VEVENT the approver is agreeing to, built by the icalendar battery", async () => {
    const request = await proposeEventHandler(
      {
        calendarId: "work",
        summary: "Design review",
        startsAt: "2026-08-01T10:00:00Z",
        endsAt: "2026-08-01T11:00:00Z",
      },
      createScopedAuditLogger(manifest.id, async () => {}),
      "20260715T120000Z",
    );

    // Whole VEVENT, in the RFC 5545 form `buildVEvent` emits — CRLF line endings included.
    expect(request.diff).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:calendar-connector-work-20260801T100000Z",
        "DTSTAMP:20260715T120000Z",
        "DTSTART:20260801T100000Z",
        "DTEND:20260801T110000Z",
        "SUMMARY:Design review",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );

    // `now` is injected, so the DTSTAMP is the one the caller chose and nothing reads a clock.
    expect(request.diff).toContain("DTSTAMP:20260715T120000Z");
  });

  test("a proposal parses back out of its own diff", async () => {
    const request = await proposeEventHandler(
      {
        calendarId: "personal",
        summary: "Dentist; bring, forms",
        startsAt: "2026-09-01T09:00:00Z",
        endsAt: "2026-09-01T09:30:00Z",
      },
      createScopedAuditLogger(manifest.id, async () => {}),
      "20260815T080000Z",
    );

    // The `;` and `,` are escaped on the way out and unescaped on the way back, so the
    // approver's VEVENT is a real one, not a string that only looks like one.
    const events = parseICalendar(request.diff ?? "");
    expect(events).toHaveLength(1);
    expect(events[0]?.summary).toBe("Dentist; bring, forms");
    expect(events[0]?.start).toBe("20260901T090000Z");
    expect(events[0]?.end).toBe("20260901T093000Z");
  });

  test("the audit trail for a proposal never records its summary or its VEVENT", async () => {
    let diff: string | undefined;
    const emitted = await auditedEmits(async (logger) => {
      const request = await proposeEventHandler(
        {
          calendarId: "personal",
          summary: "Secret plans",
          startsAt: "2026-09-01T09:00:00Z",
          endsAt: "2026-09-01T10:00:00Z",
        },
        logger,
        "20260815T080000Z",
      );
      diff = request.diff;
    });
    expect(emitted).toEqual([
      {
        action: "calendar-connector:calendar.entry.propose",
        payload: { calendarId: "personal" },
      },
    ]);

    // The content exists — it is in the returned request, which a human is shown.
    expect(diff).toContain("Secret plans");

    // It just never reaches the log: not the summary, and not the calendar payload the
    // battery now builds around it.
    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain("Secret plans");
    expect(serialized).not.toContain("BEGIN:VEVENT");
  });
});
