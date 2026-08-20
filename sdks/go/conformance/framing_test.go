package conformance

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/ipc"
	"github.com/nimbus-agent/nimbus-sdk/sdks/go/spec"
)

func framingCases(t *testing.T) []map[string]any {
	t.Helper()
	cases, err := spec.LoadCorpus("framing")
	if err != nil {
		t.Fatalf("LoadCorpus: %v", err)
	}
	return cases
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
		if b, ok := r["byte"].(float64); ok {
			unit = []byte{byte(int(b))}
		} else {
			unit = []byte(r["utf8"].(string))
		}
		count := int(r["count"].(float64))
		return []byte(strings.Repeat(string(unit), count))
	}
	t.Fatalf("unrecognised chunk descriptor: %#v", node)
	return nil
}

// frameText is an expected frame: a literal string, or a repeat descriptor decoded.
func frameText(t *testing.T, node any) string {
	t.Helper()
	if s, ok := node.(string); ok {
		return s
	}
	return string(octets(t, node.(map[string]any)))
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
		t.Run(describe(c), func(t *testing.T) {
			executed++
			chunks, _ := c["chunks"].([]any)
			expect, _ := c["expect"].(map[string]any)
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
	}

	// Subtests run to completion before the parent resumes, so this sees the real
	// total. It fails if any case was skipped without saying so.
	if executed != len(cases) {
		t.Errorf("executed %d subtests but the corpus lists %d cases", executed, len(cases))
	}
	t.Logf("measured: executed %d of %d framing cases", executed, len(cases))
}
