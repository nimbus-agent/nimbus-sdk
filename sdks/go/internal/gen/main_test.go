package main

import (
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
