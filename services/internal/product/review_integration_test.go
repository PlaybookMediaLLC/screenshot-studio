package product

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type recordingReviewMailer struct{ sent []ReviewNotification }

func (m *recordingReviewMailer) SendReviewNotification(_ context.Context, message ReviewNotification) error {
	m.sent = append(m.sent, message)
	return nil
}

// Submitting posts emails the approvers; a decision emails the creator. An
// API key may submit with release:create and may never decide.
func TestReviewNotificationsAndMachineSubmit(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo := w.ctx, w.repo
	mailer := &recordingReviewMailer{}
	repo.WithReviewMailer(mailer)
	w.addMember(t, "approver", "approver")
	w.addMember(t, "creator", "creator")
	w.addMember(t, "viewer", "viewer")
	creator := w.actor("creator")
	created, err := repo.CreateCampaign(ctx, creator, CreateCampaignInput{Name: "Launch", Objective: "Adoption",
		Posts: []CampaignPostInput{{Channel: "x", Copy: "One"}, {Channel: "linkedin", Copy: "Two"}}})
	if err != nil {
		t.Fatal(err)
	}
	dispatch := func(kind string) {
		t.Helper()
		events := w.db.Client.OutboxEvent.Query().Where(outboxevent.OrganizationID(w.org), outboxevent.Type(kind),
			outboxevent.DeliveredAtIsNil()).AllX(ctx)
		if len(events) != 1 {
			t.Fatalf("%s events=%d", kind, len(events))
		}
		if handled, err := repo.HandleOutboxEvent(ctx, events[0].ID, w.org, kind, events[0].AggregateID); !handled || err != nil {
			t.Fatalf("handle %s: handled=%v err=%v", kind, handled, err)
		}
		w.db.Client.OutboxEvent.UpdateOneID(events[0].ID).SetDeliveredAt(events[0].CreatedAt).ExecX(ctx)
	}

	// The creator submits one post: the owner and approver hear, not the creator or viewer.
	if _, err := repo.TransitionCampaignPosts(ctx, creator, created.ID, CampaignPostDecision{Decision: "submit",
		PostIDs: []string{created.Posts[0].ID}}); err != nil {
		t.Fatal(err)
	}
	dispatch(EventCampaignPostsSubmitted)
	emails := []string{}
	for _, message := range mailer.sent {
		emails = append(emails, message.Email)
		if message.Decision != "submit" || message.PostCount != 1 || message.ActorName != "creator" || message.CampaignName != "Launch" {
			t.Fatalf("submit notification=%+v", message)
		}
	}
	slices.Sort(emails)
	if !slices.Equal(emails, []string{"approver-" + w.id + "@example.test", "owner-" + w.id + "@example.test"}) {
		t.Fatalf("submit recipients=%v", emails)
	}

	// The approver asks for changes: only the creator hears, with the note.
	mailer.sent = nil
	note := "Shorter, please"
	if _, err := repo.TransitionCampaignPosts(ctx, w.actor("approver"), created.ID, CampaignPostDecision{Decision: "request_changes", Note: &note}); err != nil {
		t.Fatal(err)
	}
	dispatch(EventCampaignPostsDecided)
	if len(mailer.sent) != 1 || mailer.sent[0].Email != "creator-"+w.id+"@example.test" || mailer.sent[0].Note != note ||
		mailer.sent[0].Decision != "request_changes" {
		t.Fatalf("decision notifications=%+v", mailer.sent)
	}

	// API keys: release:create may submit; another scope may not; none may approve.
	w.exec(t, `INSERT INTO apikey (id,"referenceId",key,enabled,permissions,"createdAt","updatedAt") VALUES ($1,$2,'hashed',true,$3,now(),now())`,
		"key_release_"+w.id, w.org, `{"release":["create"]}`)
	w.exec(t, `INSERT INTO apikey (id,"referenceId",key,enabled,permissions,"createdAt","updatedAt") VALUES ($1,$2,'hashed',true,$3,now(),now())`,
		"key_read_"+w.id, w.org, `{"artifact":["read"]}`)
	releaseKey := Actor{OrganizationID: w.org, Kind: "api_key", KeyID: "key_release_" + w.id, Display: "CI"}
	readKey := Actor{OrganizationID: w.org, Kind: "api_key", KeyID: "key_read_" + w.id}
	if _, err := repo.TransitionCampaignPosts(ctx, readKey, created.ID, CampaignPostDecision{Decision: "submit"}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("read-scoped key submitted: %v", err)
	}
	submitted, err := repo.TransitionCampaignPosts(ctx, releaseKey, created.ID, CampaignPostDecision{Decision: "submit"})
	if err != nil || len(submitted.PostIDs) != 2 || submitted.Status != "READY_FOR_REVIEW" {
		t.Fatalf("machine submit=%+v err=%v", submitted, err)
	}
	if _, err := repo.TransitionCampaignPosts(ctx, releaseKey, created.ID, CampaignPostDecision{Decision: "approve"}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("API key approved: %v", err)
	}
	mailer.sent = nil
	dispatch(EventCampaignPostsSubmitted)
	if len(mailer.sent) != 2 || mailer.sent[0].ActorName != "CI" {
		t.Fatalf("machine submit notifications=%+v", mailer.sent)
	}
}
