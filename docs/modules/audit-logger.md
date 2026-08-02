<!-- covers: audit-logger -->

# `audit-logger`

> **Deprecated.** The free-form `payload: Record<string, unknown>` this module accepts is
> exactly the shape that lets a secret slip into an audit entry — there is nowhere to put
> one in the redaction-structural envelope. `@nimbus-dev/sdk/diagnostics` is the
> replacement, export for export: `createScopedAuditLogger` → `createEmitter`,
> `AuditLogger` → `DiagnosticEmitter`, and `AuditEmit` → `DiagnosticEmit` (the callback
> `createEmitter` consumes). See [its module page](./diagnostics.md). All three are marked
> `@deprecated` as of 1.16.0 and will not be removed before **2.0.0**, per the
> [deprecation policy](../DEPRECATION-POLICY.md).

A scoped audit logger. You give it your extension id and a way to emit; it gives you a
`log(action, payload)` that cannot forge another extension's identity.

## When you reach for it

Whenever a connector performs a write or a delete. The audit trail is what makes a
human-in-the-loop approval meaningful after the fact.

## Constraints that are load-bearing

- **The scope prefix is added for you, and you cannot bypass it.**
  `log("note.updated", { itemId })` emits `acme-notes:note.updated`. An action containing a
  colon is rejected, so a connector cannot write an entry that appears to come from a
  different extension.
- **An unattributable entry is refused, but in two different ways, and only one of them
  trims.** An empty or whitespace-only `extensionId` throws **synchronously** from
  `createScopedAuditLogger` — it is trimmed before the check, and you find out at wiring
  time. An empty `action` **rejects the promise** `log()` returns, because `log` is async; a
  call site that does not `await` will drop that on the floor as an unhandled rejection.
  `action` is *not* trimmed, so `log("   ", …)` is accepted and emits `acme-notes:   `.
- **The emit is a seam, not an implementation.** `createScopedAuditLogger` performs no I/O
  itself — you supply the `AuditEmit`, so tests substitute a collector. See the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
- **The payload is yours to keep clean.** Nothing here redacts for you: do not put secrets,
  tokens, or document bodies into it.

## Example

```ts
import { type AuditEmit, type AuditLogger, createScopedAuditLogger } from "@nimbus-dev/sdk";

const emit: AuditEmit = async (action, payload) => {
  await fetch("https://audit.internal/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
};

const audit: AuditLogger = createScopedAuditLogger("acme-notes", emit);

export async function recordUpdate(itemId: string): Promise<void> {
  // Emitted as "acme-notes:note.updated" — the prefix is not yours to choose.
  await audit.log("note.updated", { itemId });
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
