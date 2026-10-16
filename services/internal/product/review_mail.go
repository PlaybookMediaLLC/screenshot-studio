package product

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net/url"
	"os"
	"slices"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaign"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/user"
	"github.com/lucsky/cuid"
)

// Review notifications (docs/rfcs/019-approval-workflow.md, refinement 4):
// submitting posts emails the workspace's approvers, and a decision emails
// the campaign's creator. TransitionCampaignPosts writes the outbox event in
// its transaction; the maintenance worker hands it back here.
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

// EnvReviewMailer sends through the invitation email transport, and does
// nothing when no transport is configured: review still works in the app.
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
		return nil
	}
	return err
}

// WithReviewMailer replaces the review notification transport.
func (c *Configuration) WithReviewMailer(mailer ReviewMailer) *Configuration {
	c.reviews = mailer
	return c
}

// reviewEvent queues the notification for a post transition.
func reviewEvent(ctx context.Context, tx *ent.Tx, actor Actor, campaignID, decision string, postIDs []string, note *string) error {
	kind := EventCampaignPostsDecided
	if decision == "submit" {
		kind = EventCampaignPostsSubmitted
	}
	payload := map[string]any{"decision": decision, "postIds": postIDs, "actorUserId": actor.UserID, "actorDisplay": actor.Display}
	if note != nil && strings.TrimSpace(*note) != "" && decision != "approve" && decision != "submit" {
		payload["note"] = strings.TrimSpace(*note)
	}
	id := cuid.New()
	return tx.OutboxEvent.Create().SetID(id).SetOrganizationID(actor.OrganizationID).SetType(kind).
		SetAggregateType("campaign").SetAggregateID(campaignID).SetPayload(payload).
		SetIdempotencyKey(kind + ":" + id).Exec(ctx)
}

// notifyReview emails the people a transition concerns. The actor is never
// emailed about their own action.
// ponytail: one failed recipient retries the whole event, so the others may
// get a duplicate; record per-recipient delivery if that becomes noise.
func (c *Configuration) notifyReview(ctx context.Context, eventID, organizationID, campaignID string) error {
	event, err := c.client.OutboxEvent.Query().Where(outboxevent.ID(eventID), outboxevent.OrganizationID(organizationID)).Only(ctx)
	if err != nil {
		return err
	}
	row, err := c.client.Campaign.Query().Where(campaign.ID(campaignID), campaign.OrganizationID(organizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	decision, _ := event.Payload["decision"].(string)
	actorID, _ := event.Payload["actorUserId"].(string)
	note, _ := event.Payload["note"].(string)
	postIDs, _ := event.Payload["postIds"].([]any)
	actorName, _ := event.Payload["actorDisplay"].(string)
	if actorID != "" {
		if person, err := c.client.User.Get(ctx, actorID); err == nil {
			actorName = person.Name
		}
	}
	if actorName == "" {
		actorName = "An automation"
	}
	var recipients []string
	if decision == "submit" {
		members, err := c.client.Member.Query().Where(member.OrganizationID(organizationID),
			member.RoleIn(launchApproveRoles...)).All(ctx)
		if err != nil {
			return err
		}
		for _, row := range members {
			recipients = append(recipients, row.UserID)
		}
	} else if row.CreatedByUserID != nil {
		recipients = []string{*row.CreatedByUserID}
	}
	recipients = slices.DeleteFunc(recipients, func(id string) bool { return id == actorID })
	if len(recipients) == 0 {
		return nil
	}
	people, err := c.client.User.Query().Where(user.IDIn(recipients...)).All(ctx)
	if err != nil {
		return err
	}
	link := ""
	if base, err := url.Parse(strings.TrimSpace(os.Getenv("BETTER_AUTH_URL"))); err == nil && base.Scheme != "" && base.Host != "" {
		base.Path = "/campaigns/" + url.PathEscape(row.ID) + "/copy"
		link = base.String()
	}
	var failed error
	for _, person := range people {
		if err := c.reviews.SendReviewNotification(ctx, ReviewNotification{ActorName: actorName, CampaignName: row.Name,
			CampaignURL: link, Decision: decision, Email: person.Email, Note: note, PostCount: len(postIDs)}); err != nil {
			failed = err
		}
	}
	return failed
}
