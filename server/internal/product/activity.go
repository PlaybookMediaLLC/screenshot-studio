package product

import (
	"context"
	"maps"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
)

// recordProductActivity is called only by committed business transitions, never audit replay.
func recordProductActivity(ctx context.Context, tx *ent.Tx, actor Actor, event, action, resourceType, id string, metadata ...map[string]any) error {
	payload := map[string]any{}
	if len(metadata) > 0 {
		maps.Copy(payload, metadata[0])
	}
	human := ""
	if actor.IsSession() {
		human = actor.UserID
	}
	if err := activity.Emit(ctx, tx, actor.OrganizationID, event, resourceType, id, human, "", payload); err != nil {
		return err
	}
	return appendConfigurationAudit(ctx, tx, actor, action, resourceType, id, metadata...)
}
