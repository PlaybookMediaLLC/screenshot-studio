package product

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaign"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

type ScheduleCampaignPostInput struct {
	ChannelConnectionID string     `json:"channelConnectionId"`
	ScheduledAt         *time.Time `json:"scheduledAt"`
}

type ScheduleCampaignPostResult struct {
	Post          CampaignPostItem   `json:"post"`
	ScheduledPost *ent.ScheduledPost `json:"-"`
}

func nextCampaignPublishTime(now time.Time, timeZone, publishTime string) (time.Time, error) {
	zone, err := time.LoadLocation(timeZone)
	if err != nil {
		return time.Time{}, ErrInvalidInput
	}
	parsed, err := time.Parse("15:04", publishTime)
	if err != nil {
		return time.Time{}, ErrInvalidInput
	}
	local := now.In(zone)
	result := time.Date(local.Year(), local.Month(), local.Day(), parsed.Hour(), parsed.Minute(), 0, 0, zone)
	if !result.After(now) {
		result = time.Date(local.Year(), local.Month(), local.Day()+1, parsed.Hour(), parsed.Minute(), 0, 0, zone)
	}
	return result.UTC(), nil
}

func (c *Configuration) ScheduleCampaignPost(ctx context.Context, actor Actor, campaignID, postID string,
	input ScheduleCampaignPostInput) (*ScheduleCampaignPostResult, error) {
	if err := c.authorizeRoles(ctx, actor,
		"owner", "admin", "publisher"); err != nil {
		return nil, err
	}
	if input.ChannelConnectionID == "" {
		return nil, ErrInvalidInput
	}
	owned, err := c.client.Campaign.Query().Where(campaign.ID(campaignID), campaign.OrganizationID(actor.OrganizationID)).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if !owned {
		return nil, publishing.ErrNotFound
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	post, err := tx.CampaignPost.Query().Where(campaignpost.ID(postID), campaignpost.CampaignID(campaignID),
		campaignpost.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if post.Status == campaignpost.StatusSCHEDULED && post.ScheduledPostID != nil {
		scheduled, err := tx.ScheduledPost.Query().Where(scheduledpost.ID(*post.ScheduledPostID),
			scheduledpost.OrganizationID(actor.OrganizationID)).Only(ctx)
		if err != nil {
			return nil, err
		}
		if scheduled.ChannelConnectionID != input.ChannelConnectionID {
			return nil, publishing.ErrConflict
		}
		return &ScheduleCampaignPostResult{Post: campaignPostItem(post), ScheduledPost: scheduled}, nil
	}
	if post.Status != campaignpost.StatusAPPROVED || post.CreativeVariantID == nil ||
		utf8.RuneCountInString(post.Copy) > 3000 || strings.TrimSpace(post.Copy) == "" {
		return nil, publishing.ErrConflict
	}
	scheduledAt := time.Time{}
	if input.ScheduledAt != nil {
		scheduledAt = input.ScheduledAt.UTC()
	} else {
		settings, err := tx.WorkspaceSettings.Get(ctx, actor.OrganizationID)
		if err != nil && !ent.IsNotFound(err) {
			return nil, err
		}
		zone, publishTime := "UTC", "09:00"
		if settings != nil {
			zone, publishTime = settings.TimeZone, settings.DefaultPublishTime
		}
		scheduledAt, err = nextCampaignPublishTime(time.Now(), zone, publishTime)
		if err != nil {
			return nil, err
		}
	}
	if !scheduledAt.After(time.Now()) {
		return nil, ErrInvalidInput
	}
	eligible, err := c.auth.IsEligible(ctx, actor.OrganizationID, *post.CreativeVariantID, input.ChannelConnectionID)
	if err != nil {
		return nil, err
	}
	if !eligible {
		return nil, publishing.ErrNotEligible
	}
	refund, err := c.ChargeMonthlyQuota(ctx, actor.OrganizationID, QuotaPosts, 1)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			refund()
		}
	}()
	scheduled, err := tx.ScheduledPost.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
		SetVariantID(*post.CreativeVariantID).SetChannelConnectionID(input.ChannelConnectionID).
		SetScheduledFor(scheduledAt).SetStatus(scheduledpost.StatusSCHEDULED).
		SetCaption(post.Copy).SetIdempotencyKey("campaign-post:" + postID).Save(ctx)
	if err != nil {
		if ent.IsConstraintError(err) {
			return nil, publishing.ErrConflict
		}
		return nil, err
	}
	count, err := tx.CampaignPost.Update().Where(campaignpost.ID(postID), campaignpost.CampaignID(campaignID),
		campaignpost.OrganizationID(actor.OrganizationID), campaignpost.StatusEQ(campaignpost.StatusAPPROVED),
		campaignpost.ScheduledPostIDIsNil()).SetStatus(campaignpost.StatusSCHEDULED).
		SetScheduledAt(scheduledAt).SetScheduledPostID(scheduled.ID).Save(ctx)
	if err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, publishing.ErrConflict
	}
	for _, event := range []struct {
		action, entityType, entityID string
		metadata                     map[string]any
	}{
		{"post.scheduled", "scheduled_post", scheduled.ID, nil},
		{"product.campaign_post_scheduled", "campaign_post", postID,
			map[string]any{"campaignId": campaignID, "scheduledPostId": scheduled.ID}},
	} {
		if err := appendConfigurationAudit(ctx, tx, actor, event.action, event.entityType, event.entityID, event.metadata); err != nil {
			return nil, err
		}
	}
	updated, err := tx.CampaignPost.Get(ctx, postID)
	if err != nil {
		return nil, err
	}
	result := &ScheduleCampaignPostResult{Post: campaignPostItem(updated), ScheduledPost: scheduled}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	result.ScheduledPost = scheduled.Unwrap()
	return result, nil
}
