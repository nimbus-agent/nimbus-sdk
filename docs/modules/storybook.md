<!-- covers: storybook/index -->

# `storybook`

Parses a Storybook `index.json` / `stories.json` manifest into story records.

## When you reach for it

When a connector indexes a design system's stories and needs their ids, titles, and import
paths as data.

## Constraints that are load-bearing

- **Both manifest shapes are handled.** Storybook v7+ emits `{ entries: {…} }` and v6 emits
  `{ stories: {…} }`; one call covers both, so a connector does not sniff the version.
  `entries` wins when a manifest somehow carries both. Two more v6 fallbacks work the same
  way per entry: `title` falls back to v6's `kind`, and `name` to v6's `story`.
- **An unrecognised shape returns `[]` silently.** A root that is not an object, or one
  carrying neither `entries` nor `stories`, yields an empty array rather than throwing — so
  an empty result does not distinguish "a manifest with no stories" from "not a Storybook
  manifest". If that difference matters to you, check the input before parsing it.
- **An entry without a usable `id` is dropped, not defaulted.** `id` is the one required
  field; an entry whose `id` is missing, empty, or not a string is skipped, so the returned
  list can be shorter than the manifest's entry map with nothing said about the difference.
- **Absent fields become `null`, not `undefined` and not a guess.** Storybook manifests are
  inconsistent across versions; `title`, `name`, `importPath`, and `entryType` are all
  nullable for that reason.
- **Takes already-parsed JSON, typed `unknown`.** The caller reads and parses the file, and
  this narrows it — no I/O, and no `any` crossing the boundary. See the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).

## Example

```ts
import { parseStorybookIndex, type StorybookStory } from "@nimbus-dev/sdk";

export function storyIds(indexJson: string): string[] {
  const parsed: unknown = JSON.parse(indexJson);
  const stories: StorybookStory[] = parseStorybookIndex(parsed);
  return stories.filter((story) => story.entryType !== "docs").map((story) => story.id);
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
