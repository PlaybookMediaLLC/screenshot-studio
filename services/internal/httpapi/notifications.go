package httpapi

import (
	"errors"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
)

func (s *Server) registerNotifications(mux *http.ServeMux) {
	for _, pattern := range []string{
		"GET /v1/workspace/notifications", "PUT /v1/workspace/notifications/policy", "PUT /v1/workspace/notifications/preferences",
		"POST /v1/workspace/notifications/test", "GET /v1/workspace/notifications/resolve/{id}", "GET /v1/workspace/notifications/inbox", "GET /v1/workspace/notifications/count", "POST /v1/workspace/notifications/seen",
		"POST /v1/workspace/notifications/state",
		"POST /v1/workspace/notifications/slack/connect", "POST /v1/workspace/notifications/slack/callback", "GET /v1/workspace/notifications/slack/channels",
		"DELETE /v1/workspace/notifications/slack/{id}", "GET /v1/workspace/notifications/deliveries", "GET /v1/workspace/notifications/deliveries/{id}", "POST /v1/workspace/notifications/deliveries/{id}/recover",
	} {
		mux.Handle(pattern, s.authenticateProduct(http.HandlerFunc(s.workspaceNotifications)))
	}
}
func (s *Server) workspaceNotifications(w http.ResponseWriter, r *http.Request) {
	provider, ok := s.configuration.(interface{ NotificationService() *notifications.Service })
	if !ok || provider.NotificationService() == nil {
		writeError(w, http.StatusServiceUnavailable, "workspace notifications unavailable")
		return
	}
	service := provider.NotificationService()
	a := workspaceActor(r)
	p := notifications.Principal{OrganizationID: a.OrganizationID, UserID: a.UserID, SessionID: a.SessionID, Kind: a.Kind}
	var result any
	var err error
	switch r.Pattern {
	case "GET /v1/workspace/notifications":
		result, err = service.Settings(r.Context(), p)
	case "PUT /v1/workspace/notifications/policy":
		var input notifications.Policy
		if err = decodeJSON(r, &input); err == nil {
			result, err = service.SavePolicy(r.Context(), p, input)
		} else {
			err = notifications.ErrInvalid
		}
	case "PUT /v1/workspace/notifications/preferences":
		var input notifications.Preferences
		if err = decodeJSON(r, &input); err == nil {
			result, err = service.SavePreferences(r.Context(), p, input)
		} else {
			err = notifications.ErrInvalid
		}
	case "GET /v1/workspace/notifications/resolve/{id}":
		var href string
		href, err = service.Resolve(r.Context(), p, r.PathValue("id"))
		result = map[string]string{"href": href}
	case "POST /v1/workspace/notifications/test":
		var input struct {
			Channel string `json:"channel"`
			Key     string `json:"key"`
		}
		if err = decodeJSON(r, &input); err == nil {
			var id string
			id, err = service.Test(r.Context(), p, input.Channel, input.Key)
			result = map[string]string{"deliveryId": id}
		} else {
			err = notifications.ErrInvalid
		}
	case "GET /v1/workspace/notifications/inbox":
		view := r.URL.Query().Get("view")
		if view == "" {
			view = "all"
		}
		result, err = service.ListFeed(r.Context(), p, view, r.URL.Query().Get("cursor"))
	case "POST /v1/workspace/notifications/state":
		var input notifications.StateInput
		if err = decodeJSON(r, &input); err == nil {
			result, err = service.ChangeState(r.Context(), p, input)
		} else {
			err = notifications.ErrInvalid
		}
	case "GET /v1/workspace/notifications/count":
		var count int
		count, err = service.Count(r.Context(), p)
		result = map[string]int{"unseenCount": count}
	case "POST /v1/workspace/notifications/seen":
		var input struct {
			IDs []string `json:"ids"`
			All bool     `json:"all"`
			Key string   `json:"key"`
		}
		if err = decodeJSON(r, &input); err == nil {
			result, err = service.Seen(r.Context(), p, input.IDs, input.All, input.Key)
		} else {
			err = notifications.ErrInvalid
		}
	case "POST /v1/workspace/notifications/slack/connect":
		var input struct {
			Purpose      string `json:"purpose"`
			ConnectionID string `json:"connectionId"`
		}
		if err = decodeJSON(r, &input); err == nil {
			var redirect string
			redirect, err = service.Connect(r.Context(), p, input.Purpose, input.ConnectionID)
			result = map[string]string{"url": redirect}
		} else {
			err = notifications.ErrInvalid
		}
	case "POST /v1/workspace/notifications/slack/callback":
		var input struct {
			State string `json:"state"`
			Code  string `json:"code"`
		}
		if err = decodeJSON(r, &input); err == nil {
			result, err = service.Callback(r.Context(), p, input.State, input.Code)
		} else {
			err = notifications.ErrInvalid
		}
	case "GET /v1/workspace/notifications/slack/channels":
		result, err = service.Channels(r.Context(), p, r.URL.Query().Get("connectionId"), r.URL.Query().Get("cursor"))
	case "DELETE /v1/workspace/notifications/slack/{id}":
		err = service.Disconnect(r.Context(), p, r.PathValue("id"))
		result = map[string]bool{"disconnected": err == nil}
	case "GET /v1/workspace/notifications/deliveries/{id}":
		result, err = service.DeliveryStatus(r.Context(), p, r.PathValue("id"))
	case "GET /v1/workspace/notifications/deliveries":
		var deliveries []notifications.Delivery
		deliveries, err = service.Deliveries(r.Context(), p)
		result = map[string]any{"deliveries": deliveries}
	case "POST /v1/workspace/notifications/deliveries/{id}/recover":
		var input struct {
			Action string `json:"action"`
		}
		if err = decodeJSON(r, &input); err == nil {
			err = service.Recover(r.Context(), p, r.PathValue("id"), input.Action)
			result = map[string]bool{"recovered": err == nil}
		} else {
			err = notifications.ErrInvalid
		}
	}
	if err != nil {
		if message := notifications.SlackFailureMessage(err); message != "" {
			writeError(w, 400, message)
			return
		}
		switch {
		case errors.Is(err, notifications.ErrInvalid):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, notifications.ErrUnavailable):
			writeError(w, http.StatusServiceUnavailable, "Configure the notification provider in the backend.")
		case errors.Is(err, notifications.ErrRateLimit):
			writeError(w, http.StatusTooManyRequests, err.Error())
		default:
			writeStoreError(w, err)
		}
		return
	}
	writeJSON(w, http.StatusOK, result)
}
