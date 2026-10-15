package httpapi

import (
	"errors"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

func (s *Server) consumeWorkspaceQuota(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Amount int    `json:"amount"`
		Quota  string `json:"quota"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid quota request")
		return
	}
	if input.Amount == 0 {
		input.Amount = 1
	}
	remaining, err := s.configuration.ConsumeWorkspaceQuota(r.Context(), workspaceActor(r), input.Quota, input.Amount)
	var exceeded *product.QuotaExceededError
	if errors.As(err, &exceeded) {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{
			"error": exceeded.Error(), "limit": exceeded.Limit, "quota": exceeded.Quota,
			"resetAt": exceeded.ResetAt.UnixMilli(),
		})
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"remaining": remaining})
}
