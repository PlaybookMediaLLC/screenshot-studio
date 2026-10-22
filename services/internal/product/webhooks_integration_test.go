package product

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/webhookdelivery"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/webhooks"
	"github.com/lucsky/cuid"
)

type publicResolver struct{}

func (publicResolver) LookupNetIP(context.Context, string, string) ([]netip.Addr, error) {
	return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
}

// receiver records signed deliveries and answers with status.
type receiver struct {
	mu       sync.Mutex
	status   int
	requests []map[string]string
}

func (r *receiver) ServeHTTP(w http.ResponseWriter, request *http.Request) {
	body, _ := io.ReadAll(request.Body)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.requests = append(r.requests, map[string]string{"body": string(body), "event": request.Header.Get("X-Shots-Event"),
		"id": request.Header.Get("X-Shots-Event-Id"), "signature": request.Header.Get("X-Shots-Signature"),
		"timestamp": request.Header.Get("X-Shots-Timestamp")})
	w.WriteHeader(r.status)
}

// RFC 043 acceptance 12: webhook creation validates the destination and the
// events; a real draft change produces a signed delivery that retries, stops
// for a manual replay, and keeps one event ID throughout.
func TestOutboundWebhookDelivery(t *testing.T) {
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	id := cuid.New()
	org, userID := "org_"+id, "user_"+id
	key := make([]byte, 32)
	repo := NewConfiguration(db.Client).WithMonthlyMeter(&recordingMonthlyMeter{}).WithWebhooks(key, publicResolver{})
	exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Owner',$2,true,now(),now())`, userID, userID+"@example.test")
	exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, org)
	exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`,
		"session_"+id, userID, org)
	exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,'owner',now())`, "member_"+id, org, userID)
	subscribe(t, ctx, repo, org, "pro")
	t.Cleanup(func() {
		for _, statement := range []string{`DELETE FROM webhook_subscription WHERE "organizationId"=$1`, `DELETE FROM outbox_event WHERE "organizationId"=$1`,
			`DELETE FROM content_draft WHERE "organizationId"=$1`, `DELETE FROM social_set WHERE "organizationId"=$1`, `DELETE FROM organization WHERE id=$1`} {
			_, _ = db.SQL.ExecContext(ctx, statement, org)
		}
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1`, userID)
	})
	owner := Actor{OrganizationID: org, UserID: userID, SessionID: "session_" + id, RequestID: "request_" + id}

	for _, input := range []WebhookInput{
		{Name: "No events", URL: "https://hooks.example.com/a"},
		{Name: "Bad event", URL: "https://hooks.example.com/a", Events: []string{"draft.exploded"}},
		{Name: "Plain HTTP", URL: "http://hooks.example.com/a", Events: []string{webhooks.DraftCreated}},
		{Name: "Credentials", URL: "https://me:pw@hooks.example.com/a", Events: []string{webhooks.DraftCreated}},
		{Name: "", URL: "https://hooks.example.com/a", Events: []string{webhooks.DraftCreated}},
	} {
		if _, err := repo.CreateWebhook(ctx, owner, input); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("%q was accepted: %v", input.Name, err)
		}
	}
	unconfigured := NewConfiguration(db.Client).WithWebhooks(nil, publicResolver{})
	if _, err := unconfigured.CreateWebhook(ctx, owner, WebhookInput{Name: "x", URL: "https://hooks.example.com/a",
		Events: []string{webhooks.DraftCreated}}); !errors.Is(err, ErrWebhooksUnavailable) {
		t.Fatalf("a server without a key stored a secret: %v", err)
	}
	created, err := repo.CreateWebhook(ctx, owner, WebhookInput{Name: "Zapier", URL: "https://hooks.example.com/shots",
		Events: []string{webhooks.DraftCreated, webhooks.DraftCreated, webhooks.DraftDeleted}})
	if err != nil || !strings.HasPrefix(created.Secret, "whsec_") || len(created.Webhook.Events) != 2 {
		t.Fatalf("created=%+v err=%v", created, err)
	}
	listed, err := repo.ListWebhooks(ctx, owner)
	if err != nil || len(listed) != 1 {
		t.Fatalf("list=%+v err=%v", listed, err)
	}
	if encoded, _ := json.Marshal(listed); strings.Contains(string(encoded), created.Secret) || strings.Contains(string(encoded), "whsec_") {
		t.Fatal("the secret appears in the list")
	}

	server := httptest.NewTLSServer(&receiver{status: http.StatusOK})
	t.Cleanup(server.Close)
	target := server.Listener.Addr().String()
	dispatcher := webhooks.NewDispatcher(db.SQL, key)
	dispatcher.HTTP = &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{
		// hooks.example.com "resolves" to the test server.
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, target)
		},
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // a local test server's certificate
	}}
	recorder := server.Config.Handler.(*receiver)

	// Replay schedules with the application clock; claiming uses PostgreSQL's
	// clock, which may lag slightly in the disposable VM. Wait for the actual
	// HTTP attempt instead of assuming the first worker tick is already due.
	deliver := func() {
		t.Helper()
		recorder.mu.Lock()
		before := len(recorder.requests)
		recorder.mu.Unlock()
		ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		for {
			if _, err := dispatcher.Deliver(ctx); err != nil {
				t.Fatal(err)
			}
			recorder.mu.Lock()
			delivered := len(recorder.requests) > before
			recorder.mu.Unlock()
			if delivered {
				return
			}
			select {
			case <-ctx.Done():
				t.Fatal("webhook attempt did not arrive", ctx.Err())
			case <-time.After(10 * time.Millisecond):
			}
		}
	}

	draft, err := repo.CreateContentDraft(ctx, owner, ContentDraftInput{Title: "Hello webhooks", PlainText: "secret body text"})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := dispatcher.Fanout(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if count, _ := db.Client.WebhookDelivery.Query().Where(webhookdelivery.SubscriptionID(created.Webhook.ID)).Count(ctx); count != 1 {
		t.Fatalf("fanout twice made %d deliveries", count)
	}
	deliver()
	if len(recorder.requests) != 1 {
		t.Fatalf("received %d requests", len(recorder.requests))
	}
	first := recorder.requests[0]
	if first["event"] != webhooks.DraftCreated || !webhooks.Verify(created.Secret, first["id"], first["timestamp"], []byte(first["body"]), first["signature"]) {
		t.Fatalf("delivery is not a verifiable draft.created: %+v", first)
	}
	var envelope webhooks.Envelope
	if err := json.Unmarshal([]byte(first["body"]), &envelope); err != nil || envelope.ID != first["id"] || envelope.WorkspaceID != org ||
		envelope.Resource.ID != draft.ID || envelope.SocialSetID == nil || envelope.SchemaVersion != 1 {
		t.Fatalf("envelope=%+v err=%v", envelope, err)
	}
	if strings.Contains(first["body"], "secret body text") {
		t.Fatal("the draft body leaked into the event")
	}

	// A failing endpoint: retried with backoff, then stopped, then replayed once.
	recorder.status = http.StatusInternalServerError
	if err := repo.DeleteContentDraft(ctx, owner, draft.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := dispatcher.Fanout(ctx); err != nil {
		t.Fatal(err)
	}
	deleted, err := db.Client.WebhookDelivery.Query().Where(webhookdelivery.SubscriptionID(created.Webhook.ID),
		webhookdelivery.EventType(webhooks.DraftDeleted)).Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 1; attempt <= webhooks.MaxAttempts; attempt++ {
		exec(`UPDATE webhook_delivery SET "nextAttemptAt"=now() WHERE id=$1`, deleted.ID)
		deliver()
		row, _ := db.Client.WebhookDelivery.Get(ctx, deleted.ID)
		if row.Attempts != attempt || *row.ResponseStatus != 500 || *row.ErrorClass != webhooks.ErrorHTTPStatus {
			t.Fatalf("attempt %d: %+v", attempt, row)
		}
		want := webhookdelivery.StatusPENDING
		if attempt == webhooks.MaxAttempts {
			want = webhookdelivery.StatusDEAD
		} else if !row.NextAttemptAt.After(time.Now()) {
			t.Fatalf("attempt %d has no backoff", attempt)
		}
		if row.Status != want {
			t.Fatalf("attempt %d status %s, want %s", attempt, row.Status, want)
		}
	}
	history, err := repo.ListWebhookDeliveries(ctx, owner, created.Webhook.ID)
	if err != nil || len(history) != 2 || len(history[0].History) != webhooks.MaxAttempts {
		t.Fatalf("history=%+v err=%v", history, err)
	}
	if _, err := repo.RetryWebhookDelivery(ctx, owner, history[1].ID); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("a delivered event was replayed: %v", err)
	}
	recorder.status = http.StatusNoContent
	if _, err := repo.RetryWebhookDelivery(ctx, owner, deleted.ID); err != nil {
		t.Fatal(err)
	}
	deliver()
	row, _ := db.Client.WebhookDelivery.Get(ctx, deleted.ID)
	ids := map[string]bool{}
	for _, request := range recorder.requests[1:] {
		ids[request["id"]] = true
	}
	if row.Status != webhookdelivery.StatusSUCCEEDED || len(ids) != 1 || !ids[deleted.EventID] {
		t.Fatalf("replay status=%s ids=%v", row.Status, ids)
	}

	// Rotation: both secrets sign for a day; the new one is shown once.
	rotated, err := repo.RotateWebhookSecret(ctx, owner, created.Webhook.ID)
	if err != nil || rotated.Secret == created.Secret || rotated.Webhook.PreviousSecretExpiresAt == nil {
		t.Fatalf("rotate=%+v err=%v", rotated, err)
	}
	if _, err := repo.TestWebhook(ctx, owner, created.Webhook.ID); err != nil {
		t.Fatal(err)
	}
	deliver()
	last := recorder.requests[len(recorder.requests)-1]
	if last["event"] != webhooks.Test || !webhooks.Verify(rotated.Secret, last["id"], last["timestamp"], []byte(last["body"]), last["signature"]) ||
		!webhooks.Verify(created.Secret, last["id"], last["timestamp"], []byte(last["body"]), last["signature"]) {
		t.Fatalf("test delivery after rotation: %+v", last)
	}
	if err := repo.DeleteWebhook(ctx, owner, created.Webhook.ID); err != nil {
		t.Fatal(err)
	}
}
