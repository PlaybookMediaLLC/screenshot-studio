package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

func (s *Server) listAuditLogs(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	input := product.AuditLogQuery{
		Action: strings.TrimSpace(query.Get("action")), ActorUserID: strings.TrimSpace(query.Get("actorUserId")),
		Cursor: strings.TrimSpace(query.Get("cursor")), EntityType: strings.TrimSpace(query.Get("entityType")),
		Outcome: strings.TrimSpace(query.Get("outcome")), Search: strings.TrimSpace(query.Get("search")), Limit: 50,
		IPHash: r.Header.Get("X-Audit-IP-Hash"), UserAgentSummary: r.Header.Get("X-Audit-User-Agent-Summary"),
	}
	if query.Has("limit") {
		parsed, err := strconv.Atoi(query.Get("limit"))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid audit log limit")
			return
		}
		input.Limit = parsed
	}
	if input.Limit < 1 || input.Limit > 100 || len(input.Action) > 120 || len(input.ActorUserID) > 128 ||
		len(input.Cursor) > 128 || len(input.EntityType) > 120 || len(input.Search) > 200 ||
		len(input.IPHash) > 128 || len(input.UserAgentSummary) > 300 ||
		(input.Outcome != "" && input.Outcome != "SUCCEEDED" && input.Outcome != "FAILED" && input.Outcome != "DENIED") {
		writeError(w, http.StatusBadRequest, "invalid audit log query")
		return
	}
	for _, date := range []struct {
		name   string
		target **time.Time
	}{
		{"startDate", &input.StartDate}, {"endDate", &input.EndDate},
	} {
		if !query.Has(date.name) {
			continue
		}
		parsed, err := time.Parse(time.RFC3339Nano, query.Get(date.name))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid audit log date")
			return
		}
		*date.target = &parsed
	}
	if input.StartDate != nil && input.EndDate != nil && input.StartDate.After(*input.EndDate) {
		writeError(w, http.StatusBadRequest, "invalid audit log date range")
		return
	}
	page, err := s.configuration.ListAuditLogs(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
