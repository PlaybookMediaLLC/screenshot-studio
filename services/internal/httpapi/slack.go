package httpapi

import (
	"context"
	"errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"net/http"
)

type slackDesignStore interface {
	SlackAvailable(context.Context, product.Actor) (bool, error)
	SlackDesignChannels(context.Context, product.Actor, string) ([]notifications.SlackChannel, error)
	DeliverSlackDesign(context.Context, product.Actor, string, product.SlackDesignInput) error
}

func (s *Server) slackDesign(w http.ResponseWriter, r *http.Request) {
	store, ok := s.configuration.(slackDesignStore)
	if !ok {
		writeError(w, 503, "Slack is unavailable")
		return
	}
	var result any
	var err error
	switch r.Pattern {
	case "GET /v1/integrations/slack/setup":
		var ready bool
		ready, err = store.SlackAvailable(r.Context(), workspaceActor(r))
		result = map[string]bool{"ready": ready}
	case "GET /v1/integrations/{id}/slack/channels":
		var channels []notifications.SlackChannel
		channels, err = store.SlackDesignChannels(r.Context(), workspaceActor(r), r.PathValue("id"))
		result = map[string]any{"channels": channels}
	case "POST /v1/integrations/{id}/slack/deliver":
		var input product.SlackDesignInput
		if decodeJSON(r, &input) != nil {
			writeError(w, 400, "Invalid Slack delivery")
			return
		}
		err = store.DeliverSlackDesign(r.Context(), workspaceActor(r), r.PathValue("id"), input)
		result = map[string]any{"label": "Slack", "url": nil}
	}
	if err != nil {
		if errors.Is(err, notifications.ErrUnavailable) {
			writeError(w, 503, "Configure Slack in the backend.")
			return
		}
		if message := notifications.SlackFailureMessage(err); message != "" {
			writeError(w, 400, message)
			return
		}
		writeStoreError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
