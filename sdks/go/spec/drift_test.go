package spec

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// upstream is docs/spec, three levels up from sdks/go/spec.
const upstream = "../../../docs/spec"

// requireEnv makes an absent upstream a failure rather than a skip. CI sets it; a
// consumer running `go test ./...` on the published module does not.
const requireEnv = "NIMBUS_SPEC_DRIFT"

func TestEmbeddedSpecMatchesUpstream(t *testing.T) {
	info, err := os.Stat(upstream)
	if err != nil || !info.IsDir() {
		if os.Getenv(requireEnv) == "required" {
			t.Fatalf("%s=required but %s is not readable: %v", requireEnv, upstream, err)
		}
		t.Skipf("%s absent — not a repository checkout", upstream)
	}

	embedded := map[string][]byte{}
	err = fs.WalkDir(data, "data", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, readErr := data.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		rel, relErr := filepath.Rel("data", filepath.FromSlash(p))
		if relErr != nil {
			return relErr
		}
		embedded[filepath.ToSlash(rel)] = b
		return nil
	})
	if err != nil {
		t.Fatalf("walking the embed: %v", err)
	}

	seen := map[string]bool{}
	err = filepath.WalkDir(upstream, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, relErr := filepath.Rel(upstream, p)
		if relErr != nil {
			return relErr
		}
		key := filepath.ToSlash(rel)
		seen[key] = true

		want, readErr := os.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		got, ok := embedded[key]
		if !ok {
			t.Errorf("%s exists upstream but is not embedded — run `go generate ./...` in sdks/go", key)
			return nil
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s differs from upstream — run `go generate ./...` in sdks/go", key)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking upstream: %v", err)
	}

	for key := range embedded {
		if !seen[key] {
			t.Errorf("%s is embedded but was deleted upstream — run `go generate ./...` in sdks/go", key)
		}
	}
}

// The guard above is only worth having if it can fail. This asserts the embed is not
// empty, so a broken embed directive cannot make every comparison vacuously pass.
func TestTheEmbedIsNotEmpty(t *testing.T) {
	count := 0
	err := fs.WalkDir(data, "data", func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			count++
		}
		return err
	})
	if err != nil {
		t.Fatalf("walking the embed: %v", err)
	}
	if count < 100 {
		t.Errorf("embed holds %d files; the spec has hundreds — the go:embed directive is not matching", count)
	}
}
