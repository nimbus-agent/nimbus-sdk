/**
 * A realistic Nimbus connector: metadata-only reads, a HITL-gated write, and an audit
 * trail that records what happened without recording what it contained.
 *
 * `NimbusExtensionServer.registerTool()` is currently a no-op — the MCP server loop lives
 * in the Nimbus gateway, not in this package. This file is a contract-valid connector the
 * gateway can drive; it does not serve traffic on its own.
 */

import {
  type AuditLogger,
  buildVEvent,
  createScopedAuditLogger,
  type ExtensionManifest,
  type HitlRequest,
  NimbusExtensionServer,
} from "@nimbus-dev/sdk";

export const manifest: ExtensionManifest = {
  id: "calendar-connector",
  displayName: "Calendar Connector",
  version: "0.1.0",
  description: "Lists calendars and proposes events behind a human-in-the-loop gate.",
  author: "Nimbus Contributors",
  entrypoint: "./index.ts",
  runtime: "bun",
  permissions: ["read", "write"],
  hitlRequired: ["write"],
  minNimbusVersion: "0.1.0",
};

/**
 * The registered tool surface, in the shape `assertNoRowDataTools` inspects.
 *
 * Names avoid the row-data segments that assertion rejects — `calendar_list`, not
 * `calendar_query`. A calendar connector indexes metadata; event bodies stay on the
 * server they came from.
 */
export const TOOLS = [
  { name: "calendar_list", description: "Lists calendars the account can see" },
  { name: "calendar_propose_entry", description: "Proposes an event for human approval" },
] as const;

export type CalendarSummary = {
  readonly id: string;
  readonly displayName: string;
  readonly timeZone: string;
};

export type ProposeEntryInput = {
  readonly calendarId: string;
  readonly summary: string;
  readonly startsAt: string;
  readonly endsAt: string;
};

/**
 * ISO 8601 (`2026-08-01T10:00:00Z`) to the RFC 5545 form (`20260801T100000Z`).
 *
 * `buildVEvent` writes the timestamps it is given verbatim — it parses no dates and reads
 * no clock — so converting them is the caller's job, here and for `DTSTAMP`.
 */
function toIcsTimestamp(iso: string): string {
  return iso.replace(/\.\d+/, "").replaceAll("-", "").replaceAll(":", "");
}

/**
 * Metadata only — no events, no attendees, no bodies.
 *
 * The logger is an explicit parameter, not a module-level singleton: hidden ambient
 * state is exactly what `docs/INCLUSION-POLICY.md`'s purity criterion forbids, and the
 * seam is what lets a test drive this handler with a capturing logger instead of the
 * real one.
 */
export async function listCalendarsHandler(logger: AuditLogger): Promise<CalendarSummary[]> {
  const calendars: CalendarSummary[] = [
    { id: "personal", displayName: "Personal", timeZone: "UTC" },
    { id: "work", displayName: "Work", timeZone: "UTC" },
  ];
  await logger.log("calendar.list", { calendarCount: calendars.length });
  return calendars;
}

/**
 * Returns a HITL request instead of performing the write.
 *
 * The manifest declares `hitlRequired: ["write"]`, so the gateway will not let this
 * connector mutate a calendar without approval. Returning the request — rather than
 * writing and logging that a write happened — is what makes the gate real.
 *
 * The `diff` is the real VEVENT, built by the SDK's `icalendar` battery: an approver should
 * be shown the exact thing that will be written, not a paraphrase of it. `now` is a
 * parameter because `buildVEvent` never reads the clock.
 *
 * The audit entry records which calendar was targeted and nothing else — not the `summary`,
 * and emphatically not the VEVENT. A `HitlRequest` is a return value shown to a human;
 * a log is not, and body content must never reach one.
 */
export async function proposeEventHandler(
  input: ProposeEntryInput,
  logger: AuditLogger,
  now: string,
): Promise<HitlRequest> {
  await logger.log("calendar.entry.propose", { calendarId: input.calendarId });

  const start = toIcsTimestamp(input.startsAt);
  const vevent = buildVEvent(
    {
      uid: `${manifest.id}-${input.calendarId}-${start}`,
      summary: input.summary,
      start,
      end: toIcsTimestamp(input.endsAt),
    },
    now,
  );

  return {
    actionId: "calendar.event.create",
    summary: `Create "${input.summary}" in ${input.calendarId} at ${input.startsAt}`,
    diff: vevent,
  };
}

/**
 * Test-side harness: run a block with a capturing audit logger and return everything
 * it emitted.
 *
 * The emit sink is a parameter rather than an ambient singleton, which is what lets a
 * test observe the audit trail a real handler produces without touching global state.
 */
export async function auditedEmits(
  block: (logger: AuditLogger) => Promise<void>,
): Promise<{ action: string; payload: Record<string, unknown> }[]> {
  const emitted: { action: string; payload: Record<string, unknown> }[] = [];
  const logger = createScopedAuditLogger(manifest.id, async (action, payload) => {
    emitted.push({ action, payload });
  });
  await block(logger);
  return emitted;
}

const server = new NimbusExtensionServer({ manifest });

// The gateway supplies the real audit sink at runtime; this stub only keeps the
// example runnable standalone (and `noConsole` forbids logging to stdout anyway).
const auditLogger = createScopedAuditLogger(manifest.id, async () => {});

server.registerTool(TOOLS[0].name, {
  description: TOOLS[0].description,
  inputSchema: { type: "object", properties: {} },
  handler: () => listCalendarsHandler(auditLogger),
});

server.registerTool(TOOLS[1].name, {
  description: TOOLS[1].description,
  inputSchema: {
    type: "object",
    required: ["calendarId", "summary", "startsAt", "endsAt"],
    properties: {
      calendarId: { type: "string" },
      summary: { type: "string" },
      startsAt: { type: "string", format: "date-time" },
      endsAt: { type: "string", format: "date-time" },
    },
  },
  // The clock is read here, at the edge, and injected — which is what keeps the handler and
  // `buildVEvent` beneath it deterministic under test.
  handler: (input: ProposeEntryInput) =>
    proposeEventHandler(input, auditLogger, toIcsTimestamp(new Date().toISOString())),
});

server.start();
