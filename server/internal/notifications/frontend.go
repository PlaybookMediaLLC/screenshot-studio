package notifications

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
	fd "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/frontenddeploy"
)

// Personal recipients have already passed current resource authorization.
// Shared Slack continues to receive only the existing coarse catalogue text.
func personalDescription(def activity.Definition, row map[string]any) string {
	if !strings.HasPrefix(def.ID, "frontend.") {
		return def.Label
	}
	if def.ID == "frontend.connection_attention" {
		return fmt.Sprintf("%s · %s / %s · %s", def.Label, textValue(row, "provider"), textValue(row, "projectId"), textValue(row, "health"))
	}
	raw, err := json.Marshal(row["snapshot"])
	if err != nil {
		return def.Label
	}
	var o fd.Observation
	if json.Unmarshal(raw, &o) != nil {
		return def.Label
	}
	description := fmt.Sprintf("%s · %s / %s · %s · revision %s · %s", def.Label, o.Provider, o.ProjectID, o.Environment, o.Revision, o.OccurredAt.UTC().Format("2006-01-02 15:04 MST"))
	if o.ActivationObservedAt != nil {
		description += " · production change observed " + o.ActivationObservedAt.UTC().Format("2006-01-02 15:04 MST")
	}
	return description
}
