//go:build e2e

package upload

import "os"

// A tagged acceptance build may sign and upload to an isolated local S3
// endpoint. Normal API and worker binaries never include this override.
func init() {
	if endpoint := os.Getenv("POSTIZ_E2E_R2_ENDPOINT"); endpoint != "" {
		r2Endpoint = func(string) string { return endpoint }
	}
}
