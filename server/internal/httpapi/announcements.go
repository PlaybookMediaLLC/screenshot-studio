package httpapi

import (
	"net/http"
	"strconv"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

func (s *Server) registerAnnouncements(mux *http.ServeMux) {
	mux.Handle("GET /v1/announcements", s.authenticateProduct(http.HandlerFunc(s.listAnnouncements)))
	mux.Handle("POST /v1/announcements", s.authenticateProduct(http.HandlerFunc(s.scheduleAnnouncement)))
	mux.Handle("POST /v1/announcements/{id}/cancel", s.authenticateProduct(http.HandlerFunc(s.cancelAnnouncement)))
	mux.Handle("GET /v1/audience/reach", s.authenticateProduct(http.HandlerFunc(s.getAudienceReach)))
	mux.Handle("GET /v1/audience/subscribers", s.authenticateProduct(http.HandlerFunc(s.listAudienceSubscribers)))
	mux.Handle("POST /v1/audience/subscribers", s.authenticateProduct(http.HandlerFunc(s.addAudienceSubscribers)))
	// The web verified a signed unsubscribe link. Service authentication skips
	// the operational-workspace check so the opt-out is recorded even while a
	// workspace deletion is pending; the store requires a service principal.
	mux.Handle("POST /v1/audience/unsubscribe", s.authenticateService(http.HandlerFunc(s.unsubscribeAudienceMember)))
}

// queryLimit reads an optional ?limit= between 1 and max.
func queryLimit(r *http.Request, fallback, max int) (int, bool) {
	if !r.URL.Query().Has("limit") {
		return fallback, true
	}
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	return limit, err == nil && limit >= 1 && limit <= max
}

func (s *Server) listAnnouncements(w http.ResponseWriter, r *http.Request) {
	limit, ok := queryLimit(r, 50, 100)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid announcement limit")
		return
	}
	items, err := s.configuration.ListAnnouncements(r.Context(), workspaceActor(r), limit)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"announcements": items})
}

func (s *Server) scheduleAnnouncement(w http.ResponseWriter, r *http.Request) {
	var input product.ScheduleAnnouncementInput
	if err := decodeJSON(r, &input); err != nil || !resourceIDPattern.MatchString(input.ReleaseDocumentID) {
		writeError(w, http.StatusBadRequest, "invalid announcement request")
		return
	}
	result, err := s.configuration.ScheduleAnnouncement(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	status := http.StatusOK
	if result.Created {
		status = http.StatusCreated
	}
	writeJSON(w, status, result)
}

func (s *Server) cancelAnnouncement(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid announcement ID")
		return
	}
	cancelled, err := s.configuration.CancelAnnouncement(r.Context(), workspaceActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"cancelled": cancelled})
}

func (s *Server) getAudienceReach(w http.ResponseWriter, r *http.Request) {
	reach, err := s.configuration.GetAudienceReach(r.Context(), workspaceActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"reach": reach})
}

func (s *Server) listAudienceSubscribers(w http.ResponseWriter, r *http.Request) {
	limit, ok := queryLimit(r, 100, 500)
	include := false
	if raw := r.URL.Query().Get("includeUnsubscribed"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		include, ok = parsed, ok && err == nil
	}
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid audience query")
		return
	}
	items, err := s.configuration.ListAudienceSubscribers(r.Context(), workspaceActor(r), include, limit)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscribers": items})
}

func (s *Server) addAudienceSubscribers(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Subscribers []product.AudienceSubscriberInput `json:"subscribers"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid audience request")
		return
	}
	result, err := s.configuration.AddAudienceSubscribers(r.Context(), workspaceActor(r), input.Subscribers)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) unsubscribeAudienceMember(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid unsubscribe request")
		return
	}
	if err := s.configuration.UnsubscribeAudienceMember(r.Context(), requestActor(r), input.Email); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"unsubscribed": true})
}
