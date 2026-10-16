package product

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/apikey"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaign"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type CampaignTransition struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type CampaignPostDecision struct {
	Decision string   `json:"decision"`
	Note     *string  `json:"note"`
	PostIDs  []string `json:"postIds"`
}

type CampaignPostTransition struct {
	PostIDs []string `json:"postIds"`
	Status  string   `json:"status"`
}

// apiKeyAllows reports whether the actor's API key was issued with
// resource:action (apiKeyScopePermissions in lib/auth/api-key-scopes.ts).
// Better Auth stores the permissions as a JSON object of action lists.
func (c *Configuration) apiKeyAllows(ctx context.Context, actor Actor, resource, action string) (bool, error) {
	key, err := c.client.Apikey.Query().Where(apikey.ID(actor.KeyID), apikey.ReferenceID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return false, nil
	}
	if err != nil || key.Permissions == nil {
		return false, err
	}
	var permissions map[string][]string
	if json.Unmarshal([]byte(*key.Permissions), &permissions) != nil {
		return false, nil
	}
	return slices.Contains(permissions[resource], action), nil
}

func campaignTransitionRoles(from, to campaign.Status) []string {
	if from == to {
		return nil
	}
	switch from {
	case campaign.StatusDRAFT:
		if to == campaign.StatusARCHIVED || to == campaign.StatusREADY_FOR_REVIEW {
			return []string{"owner", "admin", "creator"}
		}
	case campaign.StatusREADY_FOR_REVIEW:
		if to == campaign.StatusAPPROVED {
			return []string{"owner", "admin", "approver"}
		}
		if to == campaign.StatusARCHIVED || to == campaign.StatusDRAFT {
			return []string{"owner", "admin", "creator"}
		}
	case campaign.StatusAPPROVED:
		if to == campaign.StatusARCHIVED || to == campaign.StatusDRAFT {
			return []string{"owner", "admin", "creator"}
		}
	case campaign.StatusARCHIVED:
		if to == campaign.StatusDRAFT {
			return []string{"owner", "admin", "creator"}
		}
	}
	return nil
}

func (c *Configuration) TransitionCampaign(ctx context.Context, actor Actor, id, status string) (*CampaignTransition, error) {
	to := campaign.Status(status)
	// Approving is a decision only a person makes.
	if to == campaign.StatusAPPROVED && !actor.IsSession() {
		return nil, publishing.ErrForbidden
	}
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	if to != campaign.StatusDRAFT && to != campaign.StatusREADY_FOR_REVIEW &&
		to != campaign.StatusAPPROVED && to != campaign.StatusARCHIVED {
		return nil, ErrInvalidInput
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	current, err := tx.Campaign.Query().Where(campaign.ID(id), campaign.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	roles := campaignTransitionRoles(current.Status, to)
	if len(roles) == 0 {
		return nil, publishing.ErrConflict
	}
	if err := c.authorizeRoles(ctx, actor, roles...); err != nil {
		return nil, err
	}
	if to == campaign.StatusREADY_FOR_REVIEW {
		posts, err := tx.CampaignPost.Query().Where(campaignpost.CampaignID(id),
			campaignpost.OrganizationID(actor.OrganizationID)).Count(ctx)
		if err != nil {
			return nil, err
		}
		if posts == 0 {
			return nil, publishing.ErrConflict
		}
	}
	count, err := tx.Campaign.Update().Where(campaign.ID(id), campaign.OrganizationID(actor.OrganizationID),
		campaign.StatusEQ(current.Status)).SetStatus(to).Save(ctx)
	if err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, publishing.ErrConflict
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.campaign_status_changed", "campaign", id,
		map[string]any{"from": string(current.Status), "to": status}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &CampaignTransition{ID: id, Status: status}, nil
}

func postDecision(decision string) (from []campaignpost.Status, to campaignpost.Status, roles []string, ok bool) {
	switch decision {
	case "submit":
		return []campaignpost.Status{campaignpost.StatusDRAFT, campaignpost.StatusNEEDS_CHANGES},
			campaignpost.StatusREADY_FOR_REVIEW, []string{"owner", "admin", "creator"}, true
	case "approve":
		return []campaignpost.Status{campaignpost.StatusREADY_FOR_REVIEW},
			campaignpost.StatusAPPROVED, []string{"owner", "admin", "approver"}, true
	case "reject":
		return []campaignpost.Status{campaignpost.StatusREADY_FOR_REVIEW},
			campaignpost.StatusREJECTED, []string{"owner", "admin", "approver"}, true
	case "request_changes":
		return []campaignpost.Status{campaignpost.StatusREADY_FOR_REVIEW},
			campaignpost.StatusNEEDS_CHANGES, []string{"owner", "admin", "approver"}, true
	default:
		return nil, "", nil, false
	}
}

func (c *Configuration) TransitionCampaignPosts(ctx context.Context, actor Actor, campaignID string, input CampaignPostDecision) (*CampaignPostTransition, error) {
	from, to, roles, ok := postDecision(input.Decision)
	if !ok || len(input.PostIDs) > 100 || (input.Note != nil && len(*input.Note) > 1000) {
		return nil, ErrInvalidInput
	}
	// Approve, reject, and request changes are a person's decisions. Submit
	// is open to automation: an API key needs the release:create scope.
	authorize := c.authorizeDecision
	if input.Decision == "submit" {
		authorize = c.authorizeRoles
	}
	if err := authorize(ctx, actor, roles...); err != nil {
		return nil, err
	}
	if input.Decision == "submit" && actor.Kind == "api_key" {
		allowed, err := c.apiKeyAllows(ctx, actor, "release", "create")
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, forbidden("This API key needs the release:create scope to submit posts for review.")
		}
	}
	seen := make(map[string]bool, len(input.PostIDs))
	for _, id := range input.PostIDs {
		if seen[id] {
			return nil, ErrInvalidInput
		}
		seen[id] = true
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	owned, err := tx.Campaign.Query().Where(campaign.ID(campaignID), campaign.OrganizationID(actor.OrganizationID)).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if !owned {
		return nil, publishing.ErrNotFound
	}
	query := tx.CampaignPost.Query().Where(campaignpost.CampaignID(campaignID),
		campaignpost.OrganizationID(actor.OrganizationID), campaignpost.StatusIn(from...))
	if input.PostIDs != nil {
		query = query.Where(campaignpost.IDIn(input.PostIDs...))
	}
	rows, err := query.All(ctx)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 || (input.PostIDs != nil && len(rows) != len(input.PostIDs)) {
		return nil, publishing.ErrConflict
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	update := tx.CampaignPost.Update().Where(campaignpost.IDIn(ids...), campaignpost.CampaignID(campaignID),
		campaignpost.OrganizationID(actor.OrganizationID), campaignpost.StatusIn(from...)).SetStatus(to)
	if input.Decision == "approve" {
		update.ClearReviewNote().SetApprovedAt(time.Now().UTC()).SetApprovedByUserID(actor.UserID)
	} else if input.Decision == "reject" || input.Decision == "request_changes" {
		update.ClearApprovedAt().ClearApprovedByUserID()
		if input.Note != nil && strings.TrimSpace(*input.Note) != "" {
			update.SetReviewNote(strings.TrimSpace(*input.Note))
		}
	}
	count, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	if count != len(ids) {
		return nil, publishing.ErrConflict
	}
	if err := reviewEvent(ctx, tx, actor, campaignID, input.Decision, ids, input.Note); err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.campaign_post_status_changed", "campaign", campaignID,
		map[string]any{"decision": input.Decision, "noted": input.Note != nil && strings.TrimSpace(*input.Note) != "" && input.Decision != "approve",
			"postCount": len(ids)}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &CampaignPostTransition{PostIDs: ids, Status: string(to)}, nil
}
