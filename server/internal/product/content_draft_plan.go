package product

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
)

const advancedSchedulingFeature = "content:scheduling-advanced"

// Enforce advanced scheduling at commitment time, including defaults copied before a downgrade.
func (c *Configuration) requireDraftSchedulingPlan(ctx context.Context, actor Actor, draft *ent.ContentDraft, input ScheduleContentDraftInput) error {
	natural := draft.NaturalPostingTime
	if input.NaturalPostingTime != nil {
		natural = *input.NaturalPostingTime
	}
	advanced := input.Queue || natural
	for _, target := range input.Targets {
		advanced = advanced || (target.AutoActions != nil && !target.AutoActions.Empty())
	}
	if advanced {
		return c.requireWorkspaceFeature(ctx, actor.OrganizationID, advancedSchedulingFeature)
	}
	return nil
}
