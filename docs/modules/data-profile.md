<!-- covers: data-profile/index -->

# `data-profile`

Structural profiling of CSV, JSON, JSONL, and Parquet — column names, column kinds, and a
row-count estimate. The profile it produces is **metadata only**.

## When you reach for it

When a connector indexes data files and you want the shape of a dataset searchable without
the dataset itself becoming searchable.

## Constraints that are load-bearing

- **The column extractors never return a value.** `parseCsvHeader`, `parseJsonColumns`,
  `parseJsonlColumns`, and `parquetColumnsFromMetadata` return names and kinds and nothing
  else; `jsKind` returns the *name* of a value's kind, never the value. That is the
  `data-profile` half of the [inclusion policy](../INCLUSION-POLICY.md)'s standing scope
  constraints — metadata only, never cell values.
- **`firstLineAndRows` is the exception, and handling it is on you.** It returns the file's
  first line **verbatim and unbounded**. For CSV that is the header row, which is metadata.
  **For JSONL it is a complete data record, cell values included** — it is exactly the input
  `parseJsonlColumns` needs, so pass it straight in and let the returned columns be the only
  thing that survives. Do not log it, do not put it in an error message, and do not store it
  on the item: the same policy forbids row or body data reaching anywhere a log could.
- **A column cap of 512 applies.** Profiling a pathological file yields a truncated column
  list rather than unbounded work.
- **`rowCountEstimate` is an estimate, and `null` when it cannot be one.** For text it is a
  newline count, so an embedded newline inside a quoted CSV field inflates it. The
  `truncated` flag exists so a partial read returns `null` rather than reporting a fraction
  of a file as an exact count.
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
  parseJsonlColumns,
} from "@nimbus-dev/sdk";

type Profile = { columns: DataColumn[]; rowCountEstimate: number | null };

/**
 * `truncated` tells the estimator it is not looking at the whole file.
 *
 * `firstLine` goes straight into the column parser and nowhere else. For JSONL it is a
 * real record — logging it, or attaching it to a thrown error, would leak row data.
 */
export function profileText(head: string, truncated: boolean, jsonl: boolean): Profile {
  const { firstLine, rowCountEstimate } = firstLineAndRows(head, truncated);
  const columns = jsonl ? parseJsonlColumns(firstLine) : parseCsvHeader(firstLine);
  return { columns, rowCountEstimate };
}

/** Parquet needs none of that: the footer metadata already carries the schema. */
export function profileParquet(meta: ParquetMetadataLike): Profile {
  return parquetColumnsFromMetadata(meta);
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct. `parseJsonColumns` is the whole-document counterpart to `parseJsonlColumns`: it
takes already-parsed JSON — an array of records, or a single record — and reads its keys,
so no line of raw text passes through the caller's hands at all.
