package product

import (
	"context"
	"errors"
	"fmt"
	"html"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/lucsky/cuid"
)

// Review notifications (docs/rfcs/012-approval-workflow.md, refinement 4):
// submitting posts emails the workspace's approvers, and a decision emails
// the campaign's creator. TransitionCampaignPosts writes the outbox event in
// its transaction; the notification service dispatches per-recipient jobs.
const (
	EventCampaignPostsSubmitted = "campaign_posts.submitted"
	EventCampaignPostsDecided   = "campaign_posts.decided"
)

// ReviewNotification is one review email to one person.
type ReviewNotification struct {
	ActorName    string
	CampaignName string
	CampaignURL  string
	Decision     string
	Email        string
	Note         string
	PostCount    int
}

// ReviewMailer delivers review notifications.
type ReviewMailer interface {
	SendReviewNotification(context.Context, ReviewNotification) error
}

// EnvReviewMailer renders the legacy review format; activity dispatch is recipient-owned.
type EnvReviewMailer struct{}

func (EnvReviewMailer) SendReviewNotification(ctx context.Context, message ReviewNotification) error {
	posts := fmt.Sprintf("%d posts", message.PostCount)
	if message.PostCount == 1 {
		posts = "1 post"
	}
	var subject, text string
	switch message.Decision {
	case "submit":
		subject = posts + " to review in " + message.CampaignName
		text = fmt.Sprintf("%s submitted %s in %s for review.", message.ActorName, posts, message.CampaignName)
	case "approve":
		subject = posts + " approved in " + message.CampaignName
		text = fmt.Sprintf("%s approved %s in %s.", message.ActorName, posts, message.CampaignName)
	case "reject":
		subject = posts + " rejected in " + message.CampaignName
		text = fmt.Sprintf("%s rejected %s in %s.", message.ActorName, posts, message.CampaignName)
	default:
		subject = "Changes requested in " + message.CampaignName
		text = fmt.Sprintf("%s asked for changes to %s in %s.", message.ActorName, posts, message.CampaignName)
	}
	htmlBody := "<p>" + html.EscapeString(text) + "</p>"
	if message.Note != "" {
		text += "\n\n" + message.Note
		htmlBody += "<blockquote>" + html.EscapeString(message.Note) + "</blockquote>"
	}
	if message.CampaignURL != "" {
		text += "\n\nOpen the campaign: " + message.CampaignURL
		htmlBody += fmt.Sprintf(`<p><a href="%s">Open the campaign</a></p>`, html.EscapeString(message.CampaignURL))
	}
	err := deliverEmail(ctx, message.Email, subject, text, htmlBody)
	if errors.Is(err, errEmailNotConfigured) {
		return errEmailNotConfigured
	}
	return err
}

// WithReviewMailer replaces the review notification transport.
func (c *Configuration) WithReviewMailer(mailer ReviewMailer) *Configuration {
	c.reviews = mailer
	return c
}

// reviewEvent queues the notification for a post transition.
func reviewEvent(ctx context.Context, tx *ent.Tx, actor Actor, campaignID, decision string, postIDs []string, note *string, idempotencyKey string) error {
	kind := EventCampaignPostsDecided
	if decision == "submit" {
		kind = EventCampaignPostsSubmitted
	}
	payload := map[string]any{"decision": decision, "postIds": postIDs, "actorUserId": actor.UserID, "actorDisplay": actor.Display}
	if note != nil && strings.TrimSpace(*note) != "" && decision != "approve" && decision != "submit" {
		payload["note"] = strings.TrimSpace(*note)
	}
	id := cuid.New()
	key := kind + ":" + id
	if idempotencyKey != "" {
		key = "campaign-review:" + campaignID + ":" + idempotencyKey
	}
	return tx.OutboxEvent.Create().SetID(id).SetOrganizationID(actor.OrganizationID).SetType(kind).
		SetAggregateType("campaign").SetAggregateID(campaignID).SetPayload(payload).
		SetIdempotencyKey(key).Exec(ctx)
}
