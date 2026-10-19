package product

import (
	"context"
	"encoding/base64"
	"errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
	"slices"
	"strings"
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
	t.Setenv("RESEND_API_KEY", "fixture-only")
	t.Setenv("BETTER_AUTH_URL", "https://app.example.test")
	t.Setenv("PLATFORM_NOTIFICATION_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	notify := notifications.New(w.db.SQL, w.db.Client)
	messages := []notifications.Envelope{}
	notify.Send = func(_ context.Context, d notifications.Delivery, e notifications.Envelope) (notifications.Outcome, error) {
		if d.OrganizationID == w.org {
			messages = append(messages, e)
		}
		return notifications.Outcome{Status: "SUCCEEDED", Receipt: d.ID}, nil
	}
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
		for batch := 0; batch < 100; batch++ {
			if err := notify.Process(ctx); err != nil {
				t.Fatal(err)
			}
			var done bool
			if err := w.db.SQL.QueryRow(`SELECT notification_fanned AND NOT EXISTS(SELECT 1 FROM platform_notification_delivery d WHERE d.event_id=e.id AND d.status IN ('PENDING','CLAIMED')) FROM outbox_event e WHERE e.id=$1`, events[0].ID).Scan(&done); err != nil {
				t.Fatal(err)
			}
			if done {
				return
			}
		}
		t.Fatal("review event was not dispatched within 100 bounded batches")
	}

	// The creator submits one post: the owner and approver hear, not the creator or viewer.
	if _, err := repo.TransitionCampaignPosts(ctx, creator, created.ID, CampaignPostDecision{Decision: "submit",
		PostIDs: []string{created.Posts[0].ID}}); err != nil {
		t.Fatal(err)
	}
	dispatch(EventCampaignPostsSubmitted)
	emails := []string{}
	for _, message := range messages {
		emails = append(emails, message.To)
		if !strings.Contains(message.Text, "creator") || !strings.Contains(message.Subject, "Launch") {
			t.Fatalf("submit notification=%+v", message)
		}
	}
	slices.Sort(emails)
	if !slices.Equal(emails, []string{"approver-" + w.id + "@example.test", "owner-" + w.id + "@example.test"}) {
		t.Fatalf("submit recipients=%v", emails)
	}

	// The approver asks for changes: only the creator hears, with the note.
	messages = nil
	note := "Shorter, please"
	if _, err := repo.TransitionCampaignPosts(ctx, w.actor("approver"), created.ID, CampaignPostDecision{Decision: "request_changes", Note: &note}); err != nil {
		t.Fatal(err)
	}
	dispatch(EventCampaignPostsDecided)
	if len(messages) != 1 || messages[0].To != "creator-"+w.id+"@example.test" || !strings.Contains(messages[0].Text, note) {
		t.Fatalf("decision notifications=%+v", messages)
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
	messages = nil
	dispatch(EventCampaignPostsSubmitted)
	if len(messages) != 2 || !strings.Contains(messages[0].Text, "CI") {
		t.Fatalf("machine submit notifications=%+v", messages)
	}
}
