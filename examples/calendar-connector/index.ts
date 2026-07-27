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
};

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
 * The audit entry records which calendar was targeted, never the proposed content:
 * no `summary`, no `diff`. Body content must never reach a log.
 */
export async function proposeEventHandler(
  input: ProposeEntryInput,
  logger: AuditLogger,
): Promise<HitlRequest> {
  await logger.log("calendar.entry.propose", { calendarId: input.calendarId });
  return {
    actionId: "calendar.event.create",
    summary: `Create "${input.summary}" in ${input.calendarId} at ${input.startsAt}`,
    diff: `+ ${input.startsAt}  ${input.summary}`,
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
    required: ["calendarId", "summary", "startsAt"],
    properties: {
      calendarId: { type: "string" },
      summary: { type: "string" },
      startsAt: { type: "string", format: "date-time" },
    },
  },
  handler: (input: ProposeEntryInput) => proposeEventHandler(input, auditLogger),
});

server.start();
