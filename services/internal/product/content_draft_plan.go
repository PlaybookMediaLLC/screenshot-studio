package product

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
)

const advancedSchedulingFeature = "content:scheduling-advanced"

// Enforce the basic plan at commitment time, including defaults copied before a downgrade.
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
		if err := c.requireWorkspaceFeature(ctx, actor.OrganizationID, advancedSchedulingFeature); err != nil {
			return err
		}
	}
	row, err := c.client.WorkspaceEntitlement.Get(ctx, actor.OrganizationID)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	plan, _, _ := evaluateBootstrapEntitlement(row, time.Now().UTC())
	if plan != "free" {
		return nil
	}
	channels, err := c.client.ChannelConnection.Query().Where(channelconnection.OrganizationID(actor.OrganizationID), channelconnection.StatusEQ(channelconnection.StatusACTIVE)).Count(ctx)
	if err != nil {
		return err
	}
	seats, err := c.client.Member.Query().Where(member.OrganizationID(actor.OrganizationID)).Count(ctx)
	if err != nil {
		return err
	}
	if channels > 1 || seats > 1 || len(input.Targets) > 1 {
		return conflict("Free scheduling includes one seat and one connected account. Remove extra members/accounts or upgrade before scheduling.")
	}
	return nil
}
