package conformance

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/ipc"
)

func framingCases(t *testing.T) []indexedCase {
	t.Helper()
	return corpusCases(t, "framing")
}

// octets builds a chunk's exact bytes from a case-schema descriptor.
//
// Four node types, each identified by its own distinctive key, so the checks are
// order-independent: a repeat node's top-level key is "repeat", never "utf8", even
// when the repeated unit is a string.
func octets(t *testing.T, node map[string]any) []byte {
	t.Helper()
	if v, ok := node["utf8"].(string); ok {
		return []byte(v)
	}
	if v, ok := node["base64"].(string); ok {
		raw, err := base64.StdEncoding.DecodeString(v)
		if err != nil {
			t.Fatalf("bad base64 %q: %v", v, err)
		}
		return raw
	}
	if parts, ok := node["concat"].([]any); ok {
		var out []byte
		for _, part := range parts {
			out = append(out, octets(t, part.(map[string]any))...)
		}
		return out
	}
	if r, ok := node["repeat"].(map[string]any); ok {
		var unit []byte
		if b, ok := numberOf(r["byte"]); ok {
			unit = []byte{byte(int(b))}
		} else {
			unit = []byte(r["utf8"].(string))
		}
		count64, _ := numberOf(r["count"])
		count := int(count64)
		return []byte(strings.Repeat(string(unit), count))
	}
	t.Fatalf("unrecognised chunk descriptor: %#v", node)
	return nil
}

// frameText is an expected frame: a literal string, or a repeat descriptor expanded.
//
// Every repeat descriptor in the corpus expands to well-formed UTF-8, and this refuses to
// guess what to do if one ever does not. The replacement rule is framing.md §4's, it lives
// in ipc.scanUTF8, and a second copy here would be free to drift from it — which is what
// the previous implementation did: it applied the per-octet count that §4 now forbids.
// TypeScript's expandFrame runs the same descriptor through TextDecoder and Python's
// _frame_text through bytes.decode("utf-8"), so all three now decline to reinterpret.
func frameText(t *testing.T, node any) string {
	t.Helper()
	if s, ok := node.(string); ok {
		return s
	}
	raw := octets(t, node.(map[string]any))
	if !utf8.Valid(raw) {
		t.Fatalf("an expected-frame descriptor expanded to ill-formed UTF-8; write the frame " +
			"as a literal string, or share ipc's decoder rather than reimplementing §4 here")
	}
	return string(raw)
}

// expectsError reports whether an expectation node is {"error": …}.
func expectsError(node any) bool {
	m, ok := node.(map[string]any)
	if !ok {
		return false
	}
	_, has := m["error"]
	return has
}

func TestFramingCorpus(t *testing.T) {
	cases := framingCases(t)
	if len(cases) < 20 {
		t.Fatalf("corpus holds %d cases; every assertion here would be near-vacuous", len(cases))
	}

	// Counted inside the subtest, so the total reflects what actually ran rather
	// than what the loop iterated over. A counter incremented beside t.Run can
	// never disagree with len(cases) and would assert nothing.
	executed := 0
	for _, c := range cases {
		c := c
		ran := t.Run(describe(c.Body), func(t *testing.T) {
			executed++
			// Checked rather than comma-ok'd away: a case with a mistyped "chunks" or
			// "expect" key would otherwise run vacuously — both assertions yield nil,
			// len(nil) == len(nil) passes the malformed check below, and the push loop
			// iterates zero times while the subtest reports PASS. TypeScript's runner
			// is protected from that by validating each case against case.schema.json;
			// Go has no equivalent, so the runner names the two keys it cannot work
			// without. An empty "chunks": [] is a real case (empty-stream.json) and
			// unmarshals to a non-nil []any, so it still passes.
			chunks, ok := c.Body["chunks"].([]any)
			if !ok {
				t.Fatalf("case is malformed: no \"chunks\" array (got %#v)", c.Body["chunks"])
			}
			expect, ok := c.Body["expect"].(map[string]any)
			if !ok {
				t.Fatalf("case is malformed: no \"expect\" object (got %#v)", c.Body["expect"])
			}
			pushExpect, _ := expect["push"].([]any)
			if len(pushExpect) != len(chunks) {
				t.Fatalf("case is malformed: %d chunks but %d push expectations",
					len(chunks), len(pushExpect))
			}

			var r ipc.LineReader
			failed := false
			for i, raw := range chunks {
				got, err := r.Push(octets(t, raw.(map[string]any)))
				if expectsError(pushExpect[i]) {
					if !errors.Is(err, ipc.ErrFrameTooLong) {
						t.Fatalf("push %d: err = %v, want ErrFrameTooLong", i, err)
					}
					// framing.md §7: "A reader MUST NOT emit frames it parsed before
					// detecting the violation." In TypeScript and Python a thrown
					// exception makes partial delivery structurally impossible; in Go
					// an error travels beside a slice, so the MUST needs asserting or
					// nothing in the suite covers it. limit-violation-latches.json is
					// the case that bites: its first chunk is "good\n" ahead of the
					// oversized frame, so a reader returning `out, r.latch()` instead
					// of `nil, r.latch()` would hand "good" to the consumer here and
					// still satisfy every other assertion in the corpus.
					if len(got) != 0 {
						t.Fatalf("push %d violates framing.md §7: reader delivered %d frame(s) %q "+
							"alongside ErrFrameTooLong; frames parsed before a limit violation "+
							"must not be emitted", i, len(got), got)
					}
					failed = true
					// Do not stop here: a latched reader is expected to keep
					// rejecting every later push, and limit-violation-latches.json
					// exists specifically to pin that a second push still errors
					// rather than resuming. Continuing lets the loop check it.
					continue
				}
				if err != nil {
					t.Fatalf("push %d: unexpected error %v", i, err)
				}
				want, _ := pushExpect[i].([]any)
				if len(got) != len(want) {
					t.Fatalf("push %d emitted %d frames, want %d", i, len(got), len(want))
				}
				for j := range want {
					if w := frameText(t, want[j]); got[j] != w {
						t.Errorf("push %d frame %d = %q, want %q", i, j, got[j], w)
					}
				}
			}

			flushExpect, hasFlush := expect["flush"]
			if !hasFlush {
				// Absent only when the case ended in an error, which makes flush
				// unreachable. If the case did NOT fail, the corpus and the runner
				// disagree and that is worth failing over.
				if !failed {
					t.Fatal("case omits flush but no push failed")
				}
				return
			}
			// flush is checked whenever the key is present, regardless of whether a
			// push failed: every case in the corpus today carries expect.flush,
			// including the error cases, where it pins that the latch persists
			// through Flush() too.

			res, err := r.Flush()
			if expectsError(flushExpect) {
				if !errors.Is(err, ipc.ErrFrameTooLong) {
					t.Fatalf("flush: err = %v, want ErrFrameTooLong", err)
				}
				// §7 again, on the other exit: a latched Flush must return no frame
				// beside its error, for the same reason and with the same blind spot.
				if len(res.Frames) != 0 {
					t.Fatalf("flush violates framing.md §7: reader delivered %d frame(s) %q "+
						"alongside ErrFrameTooLong; frames parsed before a limit violation "+
						"must not be emitted", len(res.Frames), res.Frames)
				}
				return
			}
			if err != nil {
				t.Fatalf("flush: unexpected error %v", err)
			}
			want, _ := flushExpect.(map[string]any)
			wantFrames, _ := want["frames"].([]any)
			wantTruncated, _ := want["truncated"].(bool)
			if len(res.Frames) != len(wantFrames) {
				t.Fatalf("flush emitted %d frames, want %d", len(res.Frames), len(wantFrames))
			}
			for j := range wantFrames {
				if w := frameText(t, wantFrames[j]); res.Frames[j] != w {
					t.Errorf("flush frame %d = %q, want %q", j, res.Frames[j], w)
				}
			}
			if res.Truncated != wantTruncated {
				t.Errorf("flush truncated = %v, want %v", res.Truncated, wantTruncated)
			}
		})
		if ran {
			recordCase("framing", c.File)
		}
	}

	// Subtests run to completion before the parent resumes, so this sees the real
	// total. It fails if any case was skipped without saying so.
	if executed != len(cases) {
		t.Errorf("executed %d subtests but the corpus lists %d cases", executed, len(cases))
	}
	t.Logf("measured: executed %d of %d framing cases", executed, len(cases))
}

// numberOf reads a JSON number from a corpus case.
//
// LoadCorpus decodes with UseNumber, so every corpus number is a json.Number rather than
// a float64 — without which the diagnostics corpus cannot be loaded at all. A float64
// type assertion on corpus data is therefore always wrong now, and the comma-ok form of
// one is worse than the bare form: it yields 0 silently instead of panicking.
func numberOf(value any) (float64, bool) {
	n, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	f, err := n.Float64()
	return f, err == nil
}
