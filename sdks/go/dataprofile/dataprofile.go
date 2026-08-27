package dataprofile

import (
	"encoding/json"
	"fmt"
	"strings"
)

// §1.1. Unexported, exactly as TypeScript's and Python's are: a binding cannot read it
// from the module, so the specification states the number in prose instead.
const maxColumns = 512

// normativeWhitespace is preamble §R7's set, enumerated. NOT unicode.IsSpace and NOT
// strings.TrimSpace: both strip U+0085, which this set excludes, and neither strips
// U+FEFF, which it includes. Enumerated rather than derived because ECMA-262 defines
// WhiteSpace partly by Unicode category Zs, which is version-dependent.
var normativeWhitespace = map[rune]struct{}{
	0x0009: {}, 0x000A: {}, 0x000B: {}, 0x000C: {}, 0x000D: {},
	0x0020: {}, 0x00A0: {}, 0x1680: {},
	0x2000: {}, 0x2001: {}, 0x2002: {}, 0x2003: {}, 0x2004: {}, 0x2005: {},
	0x2006: {}, 0x2007: {}, 0x2008: {}, 0x2009: {}, 0x200A: {},
	0x2028: {}, 0x2029: {}, 0x202F: {}, 0x205F: {}, 0x3000: {}, 0xFEFF: {},
}

// trim removes preamble §R7's whitespace from both ends of s.
func trim(s string) string {
	runes := []rune(s)
	start, end := 0, len(runes)
	for start < end {
		if _, ok := normativeWhitespace[runes[start]]; !ok {
			break
		}
		start++
	}
	for end > start {
		if _, ok := normativeWhitespace[runes[end-1]]; !ok {
			break
		}
		end--
	}
	return string(runes[start:end])
}

// DataColumn is a parsed column: its name, and its kind. Type is empty and Known is false
// when the kind is not knowable from what was read — which for CSV is always, since a
// header line carries names and nothing else.
type DataColumn struct {
	Name string
	// Type is the §2 kind for a JSON field, or the physical type for a Parquet leaf.
	Type string
	// Known distinguishes a genuinely absent type from the empty string. Go has no
	// nullable string, and §3 requires every CSV column to report an absent type.
	Known bool
}

// column builds a DataColumn with a known type.
func column(name, kind string) DataColumn {
	return DataColumn{Name: name, Type: kind, Known: true}
}

// The six §2.1 kind names reachable from JSON. The other four members of §2's closed set —
// undefined, function, symbol, bigint — correspond to nothing a JSON document can express
// and nothing Go has, and are UNDEFINED for this binding under preamble §R3.
const (
	kindNull    = "null"
	kindArray   = "array"
	kindObject  = "object"
	kindString  = "string"
	kindNumber  = "number"
	kindBoolean = "boolean"
)

// JSKind reports the §2 kind of an already-decoded JSON value.
//
// The value must have been decoded with a decoder in UseNumber mode, so a number arrives
// as json.Number. A float64 is accepted too, for a caller that decoded without it.
func JSKind(value any) string {
	switch value.(type) {
	case nil:
		return kindNull
	case []any:
		return kindArray
	case bool:
		return kindBoolean
	case string:
		return kindString
	case json.Number, float64, int, int64:
		return kindNumber
	}
	return kindObject
}

// ParseCSVHeader returns one column per comma-separated field of a CSV header line, each
// with an absent type. It never reads a data row.
//
// §3.1: the split is on every comma with no quote awareness, so a quoted comma splits one
// field into two. Specified behaviour rather than a defect — a binding implementing RFC
// 4180 quoting would return different columns from the same file.
func ParseCSVHeader(firstLine string) []DataColumn {
	line := strings.TrimSuffix(firstLine, "\r")
	if trim(line) == "" {
		return nil
	}
	fields := strings.Split(line, ",")
	if len(fields) > maxColumns {
		fields = fields[:maxColumns]
	}
	columns := make([]DataColumn, 0, len(fields))
	for _, raw := range fields {
		field := trim(raw)
		if len(field) >= 2 && strings.HasPrefix(field, `"`) && strings.HasSuffix(field, `"`) {
			field = field[1 : len(field)-1]
		}
		// The second trim is not redundant: the quotes come off before the inner
		// whitespace, so `" a "` yields `a`.
		columns = append(columns, DataColumn{Name: trim(field)})
	}
	return columns
}

// decoderFor returns a UseNumber decoder over s. Every decode in this package goes
// through it, so §6.1's wide integers never pass through float64 except where §6.1
// deliberately converts them.
func decoderFor(s string) *json.Decoder {
	dec := json.NewDecoder(strings.NewReader(s))
	dec.UseNumber()
	return dec
}

// objectKinds reads an already-opened JSON object and returns its keys in DOCUMENT order,
// each paired with the §2 kind of its value. The values themselves are never retained.
func objectKinds(dec *json.Decoder) ([]DataColumn, error) {
	columns := []DataColumn{}
	for dec.More() {
		keyToken, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key, ok := keyToken.(string)
		if !ok {
			return nil, fmt.Errorf("object key is not a string: %#v", keyToken)
		}
		valueToken, err := dec.Token()
		if err != nil {
			return nil, err
		}
		kind, err := kindOfToken(valueToken, dec)
		if err != nil {
			return nil, err
		}
		// Cap like the other bindings' slice(0, maxColumns): keep the first maxColumns,
		// but keep CONSUMING, or the decoder is left mid-object.
		if len(columns) < maxColumns {
			columns = append(columns, column(key, kind))
		}
	}
	_, err := dec.Token() // the closing '}'
	return columns, err
}

// kindOfToken reports a value's kind from its first token, skipping a composite whole.
func kindOfToken(token json.Token, dec *json.Decoder) (string, error) {
	switch v := token.(type) {
	case json.Delim:
		switch v {
		case '{':
			return kindObject, skipComposite(dec)
		case '[':
			return kindArray, skipComposite(dec)
		}
		return "", fmt.Errorf("unexpected delimiter %v", v)
	case nil:
		return kindNull, nil
	case string:
		return kindString, nil
	case bool:
		return kindBoolean, nil
	case json.Number:
		return kindNumber, nil
	}
	return "", fmt.Errorf("unexpected token type %T", token)
}

// skipComposite consumes tokens until the currently-open object or array closes.
//
// Depth counting over TOKENS, not over braces in the raw text: a brace inside a string
// literal — `{"k":"}{"}`  — defeats a hand-rolled scanner and does not defeat this,
// because Token is a real JSON tokenizer.
func skipComposite(dec *json.Decoder) error {
	for depth := 1; depth > 0; {
		token, err := dec.Token()
		if err != nil {
			return err
		}
		if d, ok := token.(json.Delim); ok {
			switch d {
			case '{', '[':
				depth++
			case '}', ']':
				depth--
			}
		}
	}
	return nil
}

// ParseJSONLColumns returns field names and value kinds from the first JSONL record, in
// key order. A line that is not valid JSON, or that parses to anything other than an
// object, yields no columns (§R6).
func ParseJSONLColumns(firstLine string) []DataColumn {
	dec := decoderFor(firstLine)
	opening, err := dec.Token()
	if err != nil {
		return nil
	}
	if delim, ok := opening.(json.Delim); !ok || delim != '{' {
		return nil
	}
	columns, err := objectKinds(dec)
	if err != nil {
		return nil
	}
	return columns
}

// ParseJSONColumns returns columns and a row-count estimate from a JSON document.
//
// The document is supplied as raw JSON text rather than a decoded value, because §4 and §5
// need its key ORDER and a decoded map has none.
//
// All four §5 branches are normative, including the asymmetry: an array whose first
// element is not an object yields no columns but still carries the array's length.
func ParseJSONColumns(document string) ([]DataColumn, *float64) {
	dec := decoderFor(document)
	opening, err := dec.Token()
	if err != nil {
		return nil, nil
	}
	delim, isComposite := opening.(json.Delim)
	if !isComposite {
		return nil, nil
	}

	switch delim {
	case '{':
		columns, err := objectKinds(dec)
		if err != nil {
			return nil, nil
		}
		return columns, nil
	case '[':
		return arrayColumns(dec)
	}
	return nil, nil
}

// arrayColumns walks an already-opened array: it takes columns from the first element when
// that element is an object, and counts every element either way.
func arrayColumns(dec *json.Decoder) ([]DataColumn, *float64) {
	var columns []DataColumn
	count := 0
	for dec.More() {
		token, err := dec.Token()
		if err != nil {
			return nil, nil
		}
		if count == 0 {
			if d, ok := token.(json.Delim); ok && d == '{' {
				columns, err = objectKinds(dec)
				if err != nil {
					return nil, nil
				}
				count++
				continue
			}
		}
		if d, ok := token.(json.Delim); ok && (d == '{' || d == '[') {
			if err := skipComposite(dec); err != nil {
				return nil, nil
			}
		}
		count++
	}
	length := float64(count)
	return columns, &length
}

// ParquetMetadata is the footer metadata this battery reads. Nothing else in a Parquet
// file is inspected — not a row group, not a page, not any data.
type ParquetMetadata struct {
	Schema  []ParquetSchemaElement
	NumRows any // int64, float64, json.Number, or absent
}

// ParquetSchemaElement is one entry of the footer's schema list. Name and Type are `any`
// because §6 requires an element whose Name is not a string to be SKIPPED rather than
// coerced, which a typed field could not express.
type ParquetSchemaElement struct {
	Name any
	Type any
}

// ParquetColumnsFromMetadata returns the leaf columns and the row count from Parquet
// footer metadata.
//
// An element contributes a column only when its Name is a string and its Type is present.
// Root and group elements carry no Type and are skipped by that rule, which is what makes
// the result the leaf columns.
func ParquetColumnsFromMetadata(meta ParquetMetadata) ([]DataColumn, *float64) {
	columns := []DataColumn{}
	for _, element := range meta.Schema {
		name, ok := element.Name.(string)
		if !ok || element.Type == nil {
			continue
		}
		columns = append(columns, column(name, fmt.Sprintf("%v", element.Type)))
		if len(columns) >= maxColumns {
			break
		}
	}
	return columns, rowCount(meta.NumRows)
}

// rowCount converts a footer's num_rows to §6.1's IEEE-754 double, or reports its absence.
//
// Inexact above 2^53-1 BY SPECIFICATION: 2^53+1 becomes 2^53, matching what
// Number(bigint) does in TypeScript and float(int) does in Python. Returning the exact
// integer would preserve more information and fail the corpus for doing so.
func rowCount(value any) *float64 {
	var n float64
	switch v := value.(type) {
	case nil:
		return nil
	case bool:
		// Excluded explicitly: JavaScript's `typeof true` is not "number", so a boolean
		// must yield an absence in every binding.
		return nil
	case json.Number:
		parsed, err := v.Float64()
		if err != nil {
			return nil
		}
		n = parsed
	case float64:
		n = v
	case int:
		n = float64(v)
	case int64:
		n = float64(v)
	case uint64:
		n = float64(v)
	default:
		return nil
	}
	if n != n { // NaN
		return nil
	}
	return &n
}

// FirstLineAndRows returns the first line of already-read text, and an estimate of how
// many lines it holds.
//
// A trailing carriage return is NOT removed here; §3 removes it, and only for CSV.
func FirstLineAndRows(text string, truncated bool) (string, *float64) {
	firstLine := text
	if index := strings.IndexByte(text, '\n'); index != -1 {
		firstLine = text[:index]
	}
	if truncated {
		// A count over a partial read would be a wrong number rather than an estimate.
		return firstLine, nil
	}
	// §7.1: an empty input has zero lines. The TypeScript reference returned 1 here until
	// the conformance corpus caught it; see RFC-0017 §6.1.
	if text == "" {
		zero := 0.0
		return firstLine, &zero
	}
	newlines := strings.Count(text, "\n")
	if !strings.HasSuffix(text, "\n") {
		newlines++
	}
	count := float64(newlines)
	return firstLine, &count
}
