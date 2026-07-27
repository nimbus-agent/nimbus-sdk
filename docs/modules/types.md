<!-- covers: types -->

# `types`

The two shapes every connector touches: `ExtensionManifest`, which declares what a
connector is and what it may do, and `NimbusItem`, the single record shape the gateway
indexes.

## When you reach for it

Whenever you emit anything the gateway will store, or when you write the manifest that
describes your connector.

## Constraints that are load-bearing

- **`permissions` and `hitlRequired` are declarations, not requests.** The sandbox enforces
  the first; the human-in-the-loop gate enforces the second. Declaring less than you use
  fails at runtime, not at build time — and **no automated check in this repo catches it.**
  `runContractTests` validates the manifest's shape, not your tools' behavior; the sandbox
  probe reads a different permissions schema entirely. See [`testing.md`](./testing.md) for
  what those two do and do not cover.
- **`itemType` is an open enum.** `ItemType` accepts any string so a gateway that ships a
  new type does not break a client that has not upgraded. See
  [`item-types.md`](./item-types.md) for the vocabulary and why you must never rewrite an
  unrecognized type into a recognized one.
- **`rawMeta` is metadata, not content.** It is a place for identifiers and structural
  hints, not for the body of the thing you indexed.

## Example

```ts
import type { ExtensionManifest, ItemType, NimbusItem } from "@nimbus-dev/sdk";

const manifest: ExtensionManifest = {
  id: "acme-notes",
  displayName: "Acme Notes",
  version: "1.0.0",
  description: "Indexes notes from Acme.",
  author: "Acme",
  entrypoint: "./dist/index.js",
  runtime: "bun",
  permissions: ["read", "write"],
  hitlRequired: ["write"],
  minNimbusVersion: "1.0.0",
};

const itemType: ItemType = "obsidian_note";

export const items: NimbusItem[] = [
  {
    id: "note-1",
    service: manifest.id,
    itemType,
    name: "Weekly plan",
    modifiedAt: 1_750_000_000_000,
    url: "https://acme.example.com/notes/note-1",
  },
];
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
