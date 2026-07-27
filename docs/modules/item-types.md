<!-- covers: item-types -->

# `item-types`

The item-type vocabulary the gateway writes to the `item` table's `type` column, plus the
guard that tells you whether a string is in it.

## When you reach for it

When you are choosing the `itemType` for a `NimbusItem` and want autocomplete, or when you
are deciding how to display an item whose type you may not recognize.

## Constraints that are load-bearing

- **This is an open enum, not a validation whitelist.** The list was derived by enumerating
  the connector mapping modules that call the gateway's single item writer, and it drifts
  as connectors are added. Rejecting an item because its type is absent here will break on
  the next connector.
- **Never rewrite an unrecognized type to a recognized one.** That is data corruption, and
  it is the exact bug this module exists to remove. Fall through to a generic rendering
  instead.
- **Pure.** No I/O, no clock, no ambient state — see the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).

## Example

```ts
import { isKnownItemType, KNOWN_ITEM_TYPES, type KnownItemType } from "@nimbus-dev/sdk";

/** Narrow for display purposes only — an unknown type is still a valid item. */
export function iconFor(itemType: string): string {
  if (!isKnownItemType(itemType)) return "generic";
  const known: KnownItemType = itemType;
  return known === "incident" ? "alert" : known;
}

export const vocabularySize = KNOWN_ITEM_TYPES.length;
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
