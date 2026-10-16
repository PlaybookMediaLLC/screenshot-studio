package httpapi

import (
	"errors"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

func (s *Server) consumeWorkspaceQuota(w http.ResponseWriter, r *http.Request) {
	var input struct {
		// Amount defaults to 1 when absent; an explicit 0 reads the quota.
		Amount *int   `json:"amount"`
		Quota  string `json:"quota"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid quota request")
		return
	}
	amount := 1
	if input.Amount != nil {
		amount = *input.Amount
	}
	remaining, err := s.configuration.ConsumeWorkspaceQuota(r.Context(), workspaceActor(r), input.Quota, amount)
	var exceeded *product.QuotaExceededError
	if errors.As(err, &exceeded) {
		writeQuotaExceeded(w, exceeded)
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"remaining": remaining})
}
