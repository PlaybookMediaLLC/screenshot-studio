// Package ssrfguard exposes the SSRF guard (internal/ssrf) to platform
// packages outside screenshot-studio-backend, which Go's internal rule would
// otherwise keep from it. Every outbound fetch of a user-supplied URL uses it.
package ssrfguard

import (
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ssrf"
)

// ErrBlocked is returned when a request would reach a private address.
var ErrBlocked = ssrf.ErrBlocked

// Client returns the SSRF-safe client. It checks every dialed address, so DNS
// rebinding and redirect hops are covered; it has no timeout or redirect cap,
// so callers copy it and set their own.
func Client() *http.Client { return ssrf.Client() }
