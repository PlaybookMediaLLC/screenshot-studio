package product

import (
	"context"
	"fmt"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaign"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/design"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// Lock and touch the parent in the same transaction as its mutation. Archiving
// and editing serialize here, so an edit cannot commit after an archive.
func mutableCampaign(ctx context.Context, tx *ent.Tx, actor Actor, id string) error {
	count, err := tx.Campaign.Update().Where(campaign.ID(id), campaign.OrganizationID(actor.OrganizationID),
		campaign.StatusNEQ(campaign.StatusARCHIVED)).SetUpdatedAt(time.Now().UTC()).Save(ctx)
	if err != nil {
		return err
	}
	if count == 1 {
		return nil
	}
	exists, err := tx.Campaign.Query().Where(campaign.ID(id), campaign.OrganizationID(actor.OrganizationID)).Exist(ctx)
	if err != nil {
		return err
	}
	if !exists {
		return publishing.ErrNotFound
	}
	return conflict("Restore this archived campaign before making changes.")
}

func mutableReleaseCampaigns(ctx context.Context, tx *ent.Tx, actor Actor, releaseID string) error {
	rows, err := tx.Campaign.Query().Where(campaign.ReleaseID(releaseID), campaign.OrganizationID(actor.OrganizationID)).Order(ent.Asc(campaign.FieldID)).All(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := mutableCampaign(ctx, tx, actor, row.ID); err != nil {
			return err
		}
	}
	return nil
}

func validateCampaignPostReview(post *ent.CampaignPost) error {
	length, limit := campaignPostLength(post.Copy, optionalText(post.CallToAction)), campaignChannelLimit(post.Channel)
	if length > limit {
		return conflict(fmt.Sprintf("This %s post is %d characters with the call to action; the limit is %d. Shorten it before review.", post.Channel, length, limit))
	}
	return nil
}

func mutableDesignCampaign(ctx context.Context, tx *ent.Tx, actor Actor, id string) error {
	row, err := tx.Design.Query().Where(design.ID(id), design.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return publishing.ErrNotFound
	}
	if err != nil {
		return err
	}
	if row.CampaignID != nil {
		return mutableCampaign(ctx, tx, actor, *row.CampaignID)
	}
	return nil
}
