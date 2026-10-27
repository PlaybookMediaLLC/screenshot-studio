package publicapi

import (
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

func (h *controller) connectionAvailability(c *httpx.Ctx) (any, error) {
	if h.Manager == nil {
		return nil, msg(http.StatusServiceUnavailable, "Social connections are unavailable")
	}
	c.W.Header().Set("Cache-Control", "no-store")
	return h.Manager.ConnectionAvailability(), nil
}
