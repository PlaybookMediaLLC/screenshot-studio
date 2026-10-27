package product

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/webhookdelivery"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/webhooks"
)

func TestDraftUpdatedWebhook(t *testing.T) {
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	key := make([]byte, 32)
	w.repo.WithWebhooks(key, publicResolver{})
	subscription, err := w.repo.CreateWebhook(w.ctx, w.owner, WebhookInput{Name: "Edits", URL: "https://hooks.example.com/edits", Events: []string{webhooks.DraftUpdated}})
	if err != nil {
		t.Fatal(err)
	}
	draft, err := w.repo.CreateContentDraft(w.ctx, w.owner, ContentDraftInput{PlainText: "Original"})
	if err != nil {
		t.Fatal(err)
	}
	text := "Secret edited text"
	updated, err := w.repo.UpdateContentDraft(w.ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: draft.Version, PlainText: &text})
	if err != nil {
		t.Fatal(err)
	}
	_, err = w.repo.UpdateContentDraft(w.ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: draft.Version, PlainText: &text})
	var conflict *ContentDraftVersionConflictError
	if !errors.As(err, &conflict) {
		t.Fatal("stale replay accepted", err)
	}
	// A no-op does not generate another content event.
	if _, err = w.repo.UpdateContentDraft(w.ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: updated.Version, PlainText: &text}); err != nil {
		t.Fatal(err)
	}
	query := w.db.Client.OutboxEvent.Query().Where(outboxevent.OrganizationID(w.org), outboxevent.Type("webhook.draft.updated"))
	events, err := query.All(w.ctx)
	if err != nil || len(events) != 1 {
		t.Fatalf("events=%d: %v", len(events), err)
	}
	encoded, _ := json.Marshal(events[0].Payload)
	if strings.Contains(string(encoded), text) || !strings.Contains(string(encoded), `"changed":["content"]`) {
		t.Fatalf("unsafe or incomplete payload: %s", encoded)
	}
	dispatcher := webhooks.NewDispatcher(w.db.SQL, key)
	for range 2 {
		if _, err := dispatcher.Fanout(w.ctx); err != nil {
			t.Fatal(err)
		}
	}
	deliveries, err := w.db.Client.WebhookDelivery.Query().Where(webhookdelivery.SubscriptionID(subscription.Webhook.ID)).All(w.ctx)
	if err != nil || len(deliveries) != 1 {
		t.Fatalf("fanout duplicated edit: %d %v", len(deliveries), err)
	}
	// Privacy can change while an event is queued. No external request is made.
	w.exec(t, `UPDATE social_set SET visibility='PRIVATE', "ownerUserId"=$2 WHERE id=$1`, *draft.SocialSetID, w.owner.UserID)
	w.exec(t, `UPDATE webhook_delivery SET "nextAttemptAt"=now() WHERE id=$1`, deliveries[0].ID)
	if _, err := dispatcher.Deliver(w.ctx); err != nil {
		t.Fatal(err)
	}
	delivery, err := w.db.Client.WebhookDelivery.Get(w.ctx, deliveries[0].ID)
	if err != nil || delivery.Status != webhookdelivery.StatusDEAD || delivery.ErrorClass == nil || *delivery.ErrorClass != webhooks.ErrorResourcePrivate {
		t.Fatalf("private delivery was not stopped: %+v %v", delivery, err)
	}
	current, err := w.repo.GetContentDraft(w.ctx, w.owner, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	text = "Private edit"
	if _, err := w.repo.UpdateContentDraft(w.ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: current.Version, PlainText: &text}); err != nil {
		t.Fatal(err)
	}
	if count, _ := query.Count(w.ctx); count != 1 {
		t.Fatal("private content emitted a workspace event")
	}
}
