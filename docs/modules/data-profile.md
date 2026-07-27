<!-- covers: data-profile/index -->

# `data-profile`

Structural profiling of CSV, JSON, JSONL, and Parquet — column names, column kinds, and a
row-count estimate. Everything it reads is structural: keys, schema names, and the *kinds*
of values. The one place that can hand you a value back is `parseCsvHeader`, and the first
constraint below is about exactly that.

## When you reach for it

When a connector indexes data files and you want the shape of a dataset searchable without
the dataset itself becoming searchable.

## Constraints that are load-bearing

- **Three of the four extractors read keys; `parseCsvHeader` reads a line.**
  `parseJsonColumns`, `parseJsonlColumns`, and `parquetColumnsFromMetadata` take their names
  from object keys or from Parquet schema elements and their `type` from `jsKind`, which
  returns the *name* of a value's kind and never the value. Those three cannot leak a cell.
  `parseCsvHeader` is structurally different: it splits the single line it is handed on
  commas, strips surrounding quotes, and returns every field as a column `name`. **It does
  no header detection** — it cannot, because it is given one line and nothing to compare it
  against. Hand it a headerless CSV and up to 512 cell values come back labelled as column
  names. Deciding that the file has a header row is the caller's job; nothing in this module
  does it for you.
- **`firstLineAndRows` returns the line verbatim, and handling it is on you.** It hands back
  the file's first line **unbounded**. For a CSV that really does have a header, that line is
  metadata. **For JSONL it is a complete data record, cell values included.** Do not log it,
  do not put it in an error message, and do not store it on the item: the
  [inclusion policy](../INCLUSION-POLICY.md)'s standing scope constraint is that row and body
  data never reaches anywhere a log could.
- **Whether the returned columns are safe residue depends on the format being identified
  correctly, and the two paths fail in opposite directions.** `parseJsonlColumns` fails
  *closed*: a line that is not a JSON object — a CSV header row, say — returns `[]`, so a
  wrong guess yields nothing rather than the wrong thing. `parseCsvHeader` fails *open*: a
  JSONL record routed to it by a mistaken format guess is split on its commas and returned as
  "column names", and those fragments are row data. Establish the format, and for CSV the
  presence of a header, before you treat the output as metadata you may keep. Where you
  cannot establish it, treat the names with the same care as the line they came from.
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
 *
 * `jsonl` is load-bearing, and this signature makes it the caller's problem on purpose. A
 * JSONL file called CSV here reaches `parseCsvHeader`, which splits the record on its
 * commas and returns the fragments as column names. A headerless CSV does the same without
 * any misrouting at all — so a caller that cannot vouch for the header must not treat these
 * columns as metadata.
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
