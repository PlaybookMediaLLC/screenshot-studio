package product

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaign"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
)

// PendingApproval is a campaign post waiting for a reviewer's decision.
type PendingApproval struct {
	Campaign PendingApprovalCampaign `json:"campaign"`
	Post     CampaignPostItem        `json:"post"`
}

// PendingApprovalCampaign names the campaign a pending post belongs to.
type PendingApprovalCampaign struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// ApprovalPage is one page of the review queue, oldest post first.
type ApprovalPage struct {
	Items      []PendingApproval `json:"items"`
	NextCursor *string           `json:"nextCursor"`
}

// ListPendingApprovals returns the workspace's posts in READY_FOR_REVIEW. The
// cursor is the last post ID of the previous page. Reading the queue needs any
// role; deciding stays with a person (TransitionCampaignPosts).
func (c *Configuration) ListPendingApprovals(ctx context.Context, actor Actor, limit int, cursor string) (*ApprovalPage, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 || len(cursor) > 64 {
		return nil, ErrInvalidInput
	}
	query := c.client.CampaignPost.Query().Where(campaignpost.OrganizationID(actor.OrganizationID),
		campaignpost.StatusEQ(campaignpost.StatusREADY_FOR_REVIEW))
	if cursor != "" {
		query = query.Where(campaignpost.IDGT(cursor))
	}
	posts, err := query.Order(ent.Asc(campaignpost.FieldID)).Limit(limit + 1).All(ctx)
	if err != nil {
		return nil, err
	}
	page := &ApprovalPage{Items: []PendingApproval{}}
	if len(posts) > limit {
		posts = posts[:limit]
		next := posts[limit-1].ID
		page.NextCursor = &next
	}
	ids := make([]string, 0, len(posts))
	for _, post := range posts {
		ids = append(ids, post.CampaignID)
	}
	campaigns, err := c.client.Campaign.Query().Where(campaign.IDIn(ids...),
		campaign.OrganizationID(actor.OrganizationID)).All(ctx)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]*ent.Campaign, len(campaigns))
	for _, row := range campaigns {
		byID[row.ID] = row
	}
	for _, post := range posts {
		owner := byID[post.CampaignID]
		if owner == nil {
			continue
		}
		page.Items = append(page.Items, PendingApproval{
			Campaign: PendingApprovalCampaign{ID: owner.ID, Name: owner.Name, Status: string(owner.Status)},
			Post:     campaignPostItem(post),
		})
	}
	return page, nil
}
