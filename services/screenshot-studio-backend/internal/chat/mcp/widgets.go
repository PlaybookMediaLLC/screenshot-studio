package mcp

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"strconv"
	"strings"
)

// MCP Apps (SEP-1865) widgets: single self-contained HTML documents rendered
// by the host inside a sandboxed iframe (chat/ui).

//go:embed ui/upload.html
var uploadWidget string

//go:embed ui/clipping.html
var clippingWidget string

// getMaxSize (custom.upload.validation) in megabytes.
const (
	imageMaxBytes = 10 * 1024 * 1024
	videoMaxBytes = 1024 * 1024 * 1024
)

func backendLiteral(backendURL string) string {
	// JSON.stringify: unlike json.Marshal it does not escape & and >
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(backendURL)
	return strings.ReplaceAll(strings.TrimSpace(buf.String()), "<", `<`)
}

// UploadWidgetHTML is uploadWidgetHtml(backendUrl).
func UploadWidgetHTML(backendURL string) string {
	return strings.NewReplacer(
		"{{BACKEND}}", backendLiteral(backendURL),
		"{{IMAGE_MB}}", strconv.Itoa(imageMaxBytes/1024/1024),
		"{{VIDEO_MB}}", strconv.Itoa(videoMaxBytes/1024/1024),
	).Replace(uploadWidget)
}

// ClippingWidgetHTML is clippingWidgetHtml(backendUrl).
func ClippingWidgetHTML(backendURL string) string {
	return strings.ReplaceAll(clippingWidget, "{{BACKEND}}", backendLiteral(backendURL))
}
