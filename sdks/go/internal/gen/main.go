// Command gen copies docs/spec into sdks/go/spec/data so it can be embedded.
//
// go:embed refuses paths outside the module directory and `go build` never runs a
// generator, so the copy is committed rather than produced at build time. The drift
// guard in package spec is what keeps it honest.
package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

func main() {
	// Run from sdks/go: the source is three levels up, the destination is local.
	if err := sync(filepath.Join("..", "..", "docs", "spec"), filepath.Join("spec", "data")); err != nil {
		fmt.Fprintln(os.Stderr, "gen:", err)
		os.Exit(1)
	}
}

// sync rebuilds dst as a byte-for-byte copy of src.
//
// The destination is removed first rather than merged into: a file deleted upstream
// must disappear here too, or the embed would carry data the spec no longer has.
func sync(src, dst string) error {
	if err := os.RemoveAll(dst); err != nil {
		return err
	}
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}
