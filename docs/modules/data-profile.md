<!-- covers: data-profile/index -->

# `data-profile`

Structural profiling of CSV, JSON, JSONL, and Parquet — column names, column kinds, and a
row-count estimate. **Metadata only.**

## When you reach for it

When a connector indexes data files and you want the shape of a dataset searchable without
the dataset itself becoming searchable.

## Constraints that are load-bearing

- **Never reads cell values, row samples, or first-N-row previews.** Only keys, types, and
  structural metadata are extracted. This is a hard scope constraint named in the
  [inclusion policy](../INCLUSION-POLICY.md), not a default you may override: `jsKind`
  returns the *name* of a value's kind and never the value.
- **A column count cap applies.** Profiling a pathological file yields a truncated column
  list rather than unbounded work.
- **`rowCountEstimate` is an estimate, and `null` when it cannot be one.** `firstLineAndRows`
  takes a `truncated` flag precisely so a partial read cannot be reported as an exact count.
- **`type` is `null` when unknown.** CSV carries no types; saying `"string"` would be a
  guess presented as a fact.
- **No I/O.** Reading the file — and deciding how many bytes of it to read — stays with the
  caller.

## Example

```ts
import {
  type DataColumn,
  firstLineAndRows,
  parquetColumnsFromMetadata,
  type ParquetMetadataLike,
  parseCsvHeader,
} from "@nimbus-dev/sdk";

/** `truncated` tells the estimator it is not looking at the whole file. */
export function profileCsv(head: string, truncated: boolean): {
  columns: DataColumn[];
  rowCountEstimate: number | null;
} {
  const { firstLine, rowCountEstimate } = firstLineAndRows(head, truncated);
  return { columns: parseCsvHeader(firstLine), rowCountEstimate };
}

/** Parquet carries its own footer metadata — no row group is ever decoded. */
export function profileParquet(meta: ParquetMetadataLike): DataColumn[] {
  return parquetColumnsFromMetadata(meta).columns;
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct. `parseJsonColumns` and `parseJsonlColumns` are the JSON and JSONL counterparts of
`parseCsvHeader`.
