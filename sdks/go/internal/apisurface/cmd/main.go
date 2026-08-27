// Command apisurface writes the module's public API snapshot to
// docs/api-surface-go.md.
//
// Run it from the module root: go -C sdks/go run ./internal/apisurface/cmd
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/internal/apisurface"
)

// Packages is every non-internal package of the module, in the order the
// snapshot lists them. A new published package must be added here in the same
// change that creates it — an omission would silently shrink the guard.
var packages = []string{"connectorkit", "contract", "dataprofile", "diagnostics", "distributionchannel", "ipc", "spec"}

const header = `# Go public API surface

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with ` + "`go -C sdks/go run ./internal/apisurface/cmd`" + `.
     A diff in this file is a change to the published contract and must carry the
     matching semver bump — see docs/ROADMAP.md#7-versioning--compatibility. -->

Every exported declaration of every non-internal package in
` + "`github.com/nimbus-agent/nimbus-sdk/sdks/go`" + `, as written in the source — which
is not everything: doc comments, the value of a ` + "`const`" + ` or ` + "`var`" + ` that declares
its own type, and the members an *unexported* embedded type promotes onto an
exported one are all outside what this file records.

An interface that renders as ` + "`interface {}`" + ` is sealed: its only method is
unexported, so no package other than the one that declares it can implement it —
not even another package inside this module.

`

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "apisurface:", err)
		os.Exit(1)
	}
}

func run() error {
	body, err := Render()
	if err != nil {
		return err
	}
	// Written relative to the module root, which is where `go -C sdks/go run` lands.
	return os.WriteFile(filepath.Join("..", "..", "docs", "api-surface-go.md"), []byte(body), 0o644)
}

// Render builds the whole document. Exported so the golden test can rebuild it
// in memory without writing to disk.
func Render() (string, error) {
	var b strings.Builder
	b.WriteString(header)
	for i, pkg := range packages {
		section, err := apisurface.RenderPackage(pkg)
		if err != nil {
			return "", err
		}
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString(section)
	}
	return b.String(), nil
}
