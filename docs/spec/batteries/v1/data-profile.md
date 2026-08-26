# Nimbus data-profile battery contract v1

**Status:** normative. **Contract version:** `v1`.

This document specifies the `data-profile` battery: the pure functions that extract a
tabular file's **column names and kinds** from its header or first record, without ever
reading a cell value.

Read [`./README.md`](./README.md) first — its rules §R1–§R7 apply here and are not repeated.
The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is
[`sdks/typescript/src/data-profile/index.ts`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/sdks/typescript/src/data-profile/index.ts),
published from the `.` entry point. The executable form of this document is the corpus at
[`../../conformance/v1/data-profile/`](../../conformance/v1/data-profile/). Where prose and
corpus appear to disagree, the corpus is the tiebreaker.

## §1 Scope

Six functions, and one shape.

```
DataColumn = { name: string, type: string | null }

jsKind(value)                        -> string
parseCsvHeader(firstLine)            -> DataColumn[]
parseJsonlColumns(firstLine)         -> DataColumn[]
parseJsonColumns(parsed)             -> { columns: DataColumn[], rowCountEstimate: number | null }
parquetColumnsFromMetadata(meta)     -> { columns: DataColumn[], rowCountEstimate: number | null }
firstLineAndRows(text, truncated)    -> { firstLine: string, rowCountEstimate: number | null }
```

`DataColumn.type` is `null` when the kind is not knowable from what was read — which for CSV
is always, since a header line carries names and nothing else.

**The scope constraint is a security property, not a performance one.** These functions MUST
NOT read, retain, or return a cell value, a row sample, or a first-N-row preview. They read
keys, kinds and structural metadata. A binding that returns a value from a data row does not
conform, however convenient the result.

### §1.1 The column cap

Every function that produces columns stops at **512** columns and discards the rest. The cap
is a private constant in the reference implementation, so it is stated here as a number: a
binding cannot read it from the module and MUST NOT choose its own.

Truncation is silent — there is no flag and no error. A caller that needs to know whether a
file had more than 512 columns cannot learn it from this battery.

## §2 The kind vocabulary

`jsKind(value)` returns a string drawn from JavaScript's `typeof`, corrected for two cases
`typeof` gets wrong for this purpose:

- `null` yields `"null"`, not `"object"`;
- an array yields `"array"`, not `"object"`.

Otherwise the result is `typeof value`.

Per §R4 the resulting vocabulary MUST be treated as a **closed, enumerated set**, not as a
call to a host operation:

```
"null"  "array"  "object"  "string"  "number"  "boolean"
"undefined"  "function"  "symbol"  "bigint"
```

### §2.1 What a binding can actually produce

Every caller-facing entry point in this battery derives its kinds from **parsed JSON**. Only
six members of the set are reachable that way:

| Kind | Reached from |
|---|---|
| `"null"` | a JSON `null` |
| `"array"` | a JSON array |
| `"object"` | a JSON object |
| `"string"` | a JSON string |
| `"number"` | a JSON number |
| `"boolean"` | a JSON `true` / `false` |

A conformant binding MUST produce exactly these six for JSON input, and the conformance
corpus asserts each of them at least once.

The remaining four — `"undefined"`, `"function"`, `"symbol"`, `"bigint"` — are reachable
only by calling `jsKind` directly with a non-JSON JavaScript value. They correspond to
nothing a JSON document can express, and Python and Go have no faithful counterpart for
`"function"` or `"symbol"` at all. **They are therefore undefined for non-JavaScript
bindings under §R3**: no corpus case pins them, and a binding MUST NOT invent a mapping and
document it as conformant.

This is the case §R4 was written for. Specifying the vocabulary as "whatever `typeof`
returns" would have made a Python binding's behaviour unanswerable; enumerating it makes the
answerable part precise and the unanswerable part explicitly out of scope.

## §3 CSV header parsing

`parseCsvHeader(firstLine)` returns one `DataColumn` per comma-separated field, each with
`type: null`.

1. If the line ends with a single carriage return, that carriage return is removed. Only a
   trailing `\r` is removed, and only one.
2. If what remains is empty after trimming per §R7, the result is `[]`.
3. Otherwise the line is split on every `,`, and at most 512 fields are kept (§1.1).
4. Each field is then, in order: trimmed per §R7; stripped of **one** pair of surrounding
   double-quote characters, if and only if the field both begins and ends with one; and
   trimmed again.

Step 4's second trim is not redundant — `" a "` yields `a`, because the quotes are removed
before the inner whitespace is.

### §3.1 This is a heuristic, and says so

The split is on every comma, with no quote-awareness. A header field containing a quoted
comma — `"last, first"` — is split into two columns. This is **specified behaviour, not a
defect**: the function extracts column *names* for profiling, the failure mode is a
mis-named column rather than a leaked value, and the §1 scope constraint is what actually
matters here. A binding MUST reproduce the naive split rather than improve on it, because a
binding that implements RFC 4180 quoting would return different columns from the same file.

### §3.2 The BOM

A UTF-8 BOM decodes to U+FEFF, which §R7's set includes, so a BOM-prefixed header's first
column is named without it. This is the case §R7 exists for: a binding delegating to
`str.strip()` or `strings.TrimSpace` names that column U+FEFF + `id` and does not conform.

## §4 JSONL columns

`parseJsonlColumns(firstLine)` parses the line as JSON and returns:

- `[]` if the text is not valid JSON;
- `[]` if it parses to anything other than a non-null, non-array object — a bare number, a
  string, `null`, or an array all yield `[]` (§R6);
- otherwise one `DataColumn` per own enumerable key, **in the object's key order**, with
  `type` set to the §2 kind of that key's value, capped at 512 (§1.1).

## §5 JSON columns

`parseJsonColumns(parsed)` takes an already-parsed JSON value and returns both columns and a
row-count estimate. Four branches, and all four are normative:

| `parsed` | `columns` | `rowCountEstimate` |
|---|---|---|
| An array whose first element is a non-null, non-array object | that element's entries, in key order, `type` per §2, capped at 512 | the array's length |
| Any other array — empty, or a first element that is not an object | `[]` | the array's length |
| A non-null, non-array object | its entries, in key order, `type` per §2, capped at 512 | `null` |
| Anything else | `[]` | `null` |

The second row is the asymmetry worth noting: an empty column list is still returned
**alongside a row count**. A binding that short-circuits to `{[], null}` whenever it produces
no columns does not conform.

## §6 Parquet columns from metadata

`parquetColumnsFromMetadata(meta)` reads a Parquet **footer's** metadata. It MUST NOT read a
row group, a page, or any data.

`meta.schema` is a list of schema elements. An element contributes a column when **all** of:

- it is a non-null object;
- its `name` is a string;
- its `type` is neither `null` nor `undefined`.

The column's `name` is that string, and its `type` is `meta.schema[i].type` converted to a
string. Root and group elements carry no `type` and are skipped by the third condition, which
is what makes the result the *leaf* columns. Collection stops once 512 columns are held
(§1.1). If `meta.schema` is absent or is not a list, the result is `[]`.

### §6.1 The row count is the one wide integer here

`rowCountEstimate` derives from `meta.num_rows`:

- an integer type wider than the JSON safe range (`bigint` in JavaScript) is converted to a
  number;
- a number is used only if it is **finite** — `NaN` and both infinities yield `null`;
- any other type, or absence, yields `null`.

A Parquet file's row count routinely exceeds 2⁵³−1, so this is the one field in this battery
where a binding decoding into a JSON-number type can lose precision. A binding MUST decode it
in a way that preserves the value up to its own integer width. This is the same hazard
`spec.LoadCorpus`'s `UseNumber` decision exists for in the Go binding.

## §7 First line and row estimate

`firstLineAndRows(text, truncated)` splits already-read text into its first line and an
estimate of how many lines the text holds.

- `firstLine` is everything before the first `\n`, or the whole text when there is no `\n`.
  A trailing `\r` is **not** removed here; §3 removes it, and only for CSV.
- If `truncated` is true — the caller stopped reading at a peek cap — `rowCountEstimate` is
  `null`. A count over a partial read would be a wrong number rather than an estimate.
- Otherwise `rowCountEstimate` is the number of `\n` in the text, plus one if the text does
  not end with `\n`.
- **If `text` is empty, `rowCountEstimate` is `0`.**

### §7.1 The empty-input rule corrects the reference implementation

Per §R2, this section states the correct behaviour and the implementation moves.

The reference implementation returns `1` for the empty string. Its count is `nl + 1` whenever
the text does not end with `\n`, and the empty string satisfies that; the `Math.max(0, …)`
floor around the expression cannot help, because the sum is never negative. An empty input
has zero lines, and every other input this function accepts yields a count equal to its line
count, so `1` is not a defensible edge convention — it is an off-by-one that no caller can
distinguish from a one-line file.

**A conformant binding returns `0`.** The correction to the TypeScript reference is
registered in [RFC-0017 §6.1](../../../rfcs/0017-battery-specifications.md) and lands with
this battery's corpus, which fails the current implementation until it does.

Note that `truncated` is checked first: `firstLineAndRows("", true)` is `null`, not `0`.

## §8 Divergences a binding must handle

**Object key order is not free.** §4 and §5 return columns in the parsed object's key order.
Go's `encoding/json` decodes an object into a `map[string]any`, which has no insertion order
and whose iteration order is deliberately randomised — so a Go binding MUST decode into an
order-preserving structure for these two functions. Decoding into a map and sorting the keys
is **also** non-conformant: sorted order is not input order. The same hazard is recorded for
`connector-kit` in
[`docs/modules/connector-kit.md`](../../../modules/connector-kit.md).

**Numbers.** §6.1 covers `num_rows`. Elsewhere, a JSON number's *kind* is all this battery
reports, so a binding's numeric decoding cannot affect a `DataColumn`.
