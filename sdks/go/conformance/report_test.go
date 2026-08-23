// Record which conformance cases this binding actually executed.
//
// Off unless NIMBUS_CONFORMANCE_REPORT names a directory, so a local `go test ./...` behaves
// exactly as it did before. It is for FULL-SUITE runs: set it and then pass -run and the
// report is truthful but partial, which the reconciler rejects.
//
// spec.LoadCorpus returns case bodies and drops the index's File entry, and it is published
// surface that does not change for a CI concern. This package reads the index itself: it
// cannot use spec's embedded fs.FS, which is unexported and stays that way, and go:embed
// cannot reach a path outside its own package directory. ../spec/data is committed, ships in
// the module zip, and spec/drift_test.go holds it equal to docs/spec.
//
// Every wiring site records from INSIDE the subtest, out of a t.Cleanup guarded on the
// subtest's own Failed/Skipped state — because t.Run's boolean is not a pass signal.
// Measured on go1.27: a subtest that calls t.Skip returns true, so a case nothing ran would
// be recorded; a subtest that calls t.Parallel() returns true IMMEDIATELY, before the body
// runs, so a FAILING case would be recorded as executed. TypeScript and Python cannot record
// a non-passing case at all — their record call sits after the assertions — and this makes
// Go match. t.Cleanup runs after the subtest finishes, parallel subtests included, so the
// guard is correct under both hazards.
//
// The map is mutex-guarded, unlike the Python and TypeScript recorders. No test here calls
// t.Parallel() today, but Go is the only one of the three where the next person to add it
// gets "fatal error: concurrent map writes" — a process-level panic that takes the package
// down and reads as unrelated to the change that caused it, with no -race job to catch it.
package conformance

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/spec"
)

// indexedCase pairs a case body with its index identity.
//
// The identity is carried rather than derived from loop position, and that is not optional:
// runKind filters by kind, so a case's position in the filtered loop is not its position in
// the index.
type indexedCase struct {
	File string
	Body map[string]any
}

var (
	recordMu sync.Mutex
	recorded = map[string]map[string]struct{}{}
)

func recordCase(corpus, file string) {
	recordMu.Lock()
	defer recordMu.Unlock()
	files, ok := recorded[corpus]
	if !ok {
		files = map[string]struct{}{}
		recorded[corpus] = files
	}
	files[file] = struct{}{}
}

// corpusIndexFiles reads the case identities the corpus's index lists, in index order.
func corpusIndexFiles(name string) ([]string, error) {
	raw, err := os.ReadFile(filepath.Join("..", "spec", "data", "conformance", "v1", name, "index.json"))
	if err != nil {
		return nil, err
	}
	var index struct {
		Cases []struct {
			File string `json:"file"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &index); err != nil {
		return nil, err
	}
	files := make([]string, 0, len(index.Cases))
	for _, entry := range index.Cases {
		files = append(files, entry.File)
	}
	return files, nil
}

// corpusCases loads a corpus and pairs each case with its index identity.
func corpusCases(t *testing.T, name string) []indexedCase {
	t.Helper()
	bodies, err := spec.LoadCorpus(name)
	if err != nil {
		t.Fatalf("LoadCorpus(%q): %v", name, err)
	}
	files, err := corpusIndexFiles(name)
	if err != nil {
		t.Fatalf("reading the %q index: %v", name, err)
	}
	if len(files) != len(bodies) {
		t.Fatalf("the %q index lists %d cases but LoadCorpus returned %d", name, len(files), len(bodies))
	}
	cases := make([]indexedCase, 0, len(bodies))
	for i, body := range bodies {
		cases = append(cases, indexedCase{File: files[i], Body: body})
	}
	return cases
}

func flushReports() {
	dir := os.Getenv("NIMBUS_CONFORMANCE_REPORT")
	if dir == "" {
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		panic(err)
	}
	recordMu.Lock()
	defer recordMu.Unlock()
	for corpus, files := range recorded {
		executed := make([]string, 0, len(files))
		for file := range files {
			executed = append(executed, file)
		}
		sort.Strings(executed)
		payload := struct {
			Language string   `json:"language"`
			Corpus   string   `json:"corpus"`
			Producer string   `json:"producer"`
			Executed []string `json:"executed"`
		}{"go", corpus, "suite", executed}
		raw, err := json.Marshal(payload)
		if err != nil {
			panic(err)
		}
		target := filepath.Join(dir, "go."+corpus+".suite.json")
		if err := os.WriteFile(target, raw, 0o644); err != nil {
			panic(err)
		}
	}
}

func TestMain(m *testing.M) {
	code := m.Run()
	flushReports()
	os.Exit(code)
}

func TestCorpusCasesPairsEveryCaseWithItsIdentity(t *testing.T) {
	cases := corpusCases(t, "url-resolution")
	if len(cases) < 28 {
		t.Fatalf("url-resolution has %d cases, want at least 28", len(cases))
	}
	for _, c := range cases {
		if c.File == "" || c.Body == nil {
			t.Fatalf("case %q is not fully paired: %+v", c.File, c)
		}
	}
}

func TestRecordCaseDeduplicates(t *testing.T) {
	recordCase("test-only-corpus", "cases/a.json")
	recordCase("test-only-corpus", "cases/a.json")
	recordMu.Lock()
	defer recordMu.Unlock()
	if got := len(recorded["test-only-corpus"]); got != 1 {
		t.Fatalf("recorded %d entries, want 1", got)
	}
	delete(recorded, "test-only-corpus")
}
