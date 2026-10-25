package product

import (
	"context"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaign"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
)

// calendarCampaigns projects only already authorized destination commitments.
// Campaign entries open their own approval/scheduling workflow; draft-only move
// commands are not exposed for a campaign's immutable publication snapshot.
func (c *Configuration) calendarCampaigns(ctx context.Context, actor Actor, posts []*ent.ScheduledPost) (map[string]CalendarPost, error) {
	result := map[string]CalendarPost{}
	ids := []string{}
	scheduled := map[string]*ent.ScheduledPost{}
	for _, post := range posts {
		if post.ContentDraftID == nil {
			ids = append(ids, post.ID)
			scheduled[post.ID] = post
		}
	}
	if len(ids) == 0 {
		return result, nil
	}
	linked, err := c.client.CampaignPost.Query().Where(campaignpost.OrganizationID(actor.OrganizationID), campaignpost.ScheduledPostIDIn(ids...)).All(ctx)
	if err != nil {
		return nil, err
	}
	campaignIDs := []string{}
	for _, post := range linked {
		campaignIDs = append(campaignIDs, post.CampaignID)
	}
	rows, err := c.client.Campaign.Query().Where(campaign.OrganizationID(actor.OrganizationID), campaign.IDIn(campaignIDs...)).All(ctx)
	if err != nil {
		return nil, err
	}
	names := map[string]string{}
	for _, row := range rows {
		names[row.ID] = row.Name
	}
	for _, post := range linked {
		name, ok := names[post.CampaignID]
		if !ok || post.ScheduledPostID == nil {
			continue
		}
		commitment := scheduled[*post.ScheduledPostID]
		if commitment == nil {
			continue
		}
		id := post.CampaignID
		result[commitment.ID] = CalendarPost{ContentDraftPost: contentDraftPost(commitment, commitment.Edges.ChannelConnection.Platform), CampaignID: &id, CampaignTitle: name, DraftTitle: name, SocialSetID: commitment.Edges.ChannelConnection.SocialSetID, TagIDs: []string{}}
	}
	return result, nil
}
