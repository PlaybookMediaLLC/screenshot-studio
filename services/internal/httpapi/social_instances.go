package httpapi

import (
	"errors"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/instances"
)

func (s *Server) previewMastodonInstance(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	if len(query) != 1 || len(query["server"]) != 1 {
		writeError(w, http.StatusBadRequest, "choose one Mastodon server")
		return
	}
	preview, err := instances.Mastodon(r.Context(), query.Get("server"))
	if errors.Is(err, instances.ErrInvalidOrigin) {
		writeError(w, http.StatusBadRequest, instances.ErrInvalidOrigin.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, instances.ErrUnavailable.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, preview)
}
