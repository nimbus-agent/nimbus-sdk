package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestSyncCopiesTreeVerbatim(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "data")

	if err := os.MkdirAll(filepath.Join(src, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "top.json"), []byte(`{"a":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "nested", "deep.md"), []byte("# hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := sync(src, dst); err != nil {
		t.Fatalf("sync: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(dst, "nested", "deep.md"))
	if err != nil {
		t.Fatalf("nested file not copied: %v", err)
	}
	if string(got) != "# hi\n" {
		t.Errorf("content = %q, want %q", got, "# hi\n")
	}
}

func TestSyncRemovesFilesDeletedUpstream(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "data")

	if err := os.WriteFile(filepath.Join(src, "keep.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := sync(src, dst); err != nil {
		t.Fatal(err)
	}
	// A file that sync did not put there must not survive the next run.
	if err := os.WriteFile(filepath.Join(dst, "stale.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := sync(src, dst); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dst, "stale.json")); !os.IsNotExist(err) {
		t.Error("stale.json survived a re-sync; the destination is not rebuilt from scratch")
	}
}

// A source tree that is not there is an error, not an empty copy: the destination has
// already been cleared, and reporting success would leave the embed with no spec at all.
func TestSyncFailsWhenTheSourceIsMissing(t *testing.T) {
	dst := filepath.Join(t.TempDir(), "data")
	if err := os.MkdirAll(dst, 0o755); err != nil {
		t.Fatal(err)
	}
	err := sync(filepath.Join(t.TempDir(), "absent"), dst)
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("sync = %v, want the missing source reported as not existing", err)
	}
}

// A file that cannot be read fails the copy rather than being skipped, which would leave
// the embed silently short of one case. A dangling symlink is a file the walk visits and
// cannot read; where the platform will not create one, the case cannot be built here.
func TestSyncFailsOnAFileItCannotRead(t *testing.T) {
	src := t.TempDir()
	if err := os.Symlink(filepath.Join(src, "absent.json"), filepath.Join(src, "dangling.json")); err != nil {
		t.Skipf("cannot create a symlink on this platform: %v", err)
	}
	err := sync(src, filepath.Join(t.TempDir(), "data"))
	var pathErr *fs.PathError
	if !errors.As(err, &pathErr) || filepath.Base(pathErr.Path) != "dangling.json" {
		t.Fatalf("sync = %v, want an error naming the unreadable dangling.json", err)
	}
}
