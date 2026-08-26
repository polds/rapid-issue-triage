// Package webui embeds the built frontend (web/dist) into the binary.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:web/dist
var dist embed.FS

// Dist returns the frontend filesystem rooted at the build output.
func Dist() (fs.FS, error) {
	return fs.Sub(dist, "web/dist")
}
