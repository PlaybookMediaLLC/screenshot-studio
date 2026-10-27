package autodm

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/lucsky/cuid"
)

func durableFixture(t *testing.T) (SQLLedger, Campaign, Recipient, time.Time) {
	t.Helper()
	uri := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if uri == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", uri)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var name string
	if err = db.QueryRow(`SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	c, r, now := fixture()
	id := cuid.New()
	c.ID = id
	c.OrganizationID = "autodm-" + id
	c.AccountID = "account-" + id
	_, err = db.Exec(`INSERT INTO organization(id,name,slug,"createdAt") VALUES($1,$1,$1,now())`, c.OrganizationID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(`DELETE FROM platform_auto_dm_opt_out WHERE account_id=$1`, c.AccountID)
		_, _ = db.Exec(`DELETE FROM organization WHERE id=$1`, c.OrganizationID)
	})
	l := SQLLedger{DB: db}
	if err = l.Register(context.Background(), c, now, ProductLimits); err != nil {
		t.Fatal(err)
	}
	if err = l.RecordRecipient(context.Background(), c, r, now); err != nil {
		t.Fatal(err)
	}
	return l, c, r, now
}

func TestDurableClaimsSurviveConcurrencyRestartAndUnknownOutcome(t *testing.T) {
	l, c, r, now := durableFixture(t)
	ctx := context.Background()
	sender := &testSender{fail: true}
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() { defer wg.Done(); _ = Deliver(ctx, c, r, now, true, ProductLimits, l, sender) }()
	}
	wg.Wait()
	if sender.count != 1 {
		t.Fatalf("sent %d duplicate messages", sender.count)
	}
	// A new ledger instance uses persisted receipts, never a process-local lock.
	again := SQLLedger{DB: l.DB}
	if err := Deliver(ctx, c, r, now.Add(time.Hour), true, ProductLimits, again, sender); err != nil || sender.count != 1 {
		t.Fatalf("restart resend: %d %v", sender.count, err)
	}
	var status string
	if err := l.DB.QueryRow(`SELECT status FROM platform_auto_dm_delivery WHERE campaign_id=$1`, c.ID).Scan(&status); err != nil || status != "unknown" {
		t.Fatalf("status=%s err=%v", status, err)
	}
	if err := l.Complete(ctx, c, r, "confirmed-remote", "sent"); err != nil {
		t.Fatal(err)
	}
	if err := l.Complete(ctx, c, r, "different-id", "sent"); err == nil {
		t.Fatal("replaced confirmed receipt")
	}
}

func TestDurableConsentOptOutCancellationAndTenantIsolation(t *testing.T) {
	for _, state := range []string{"opt-out", "cancelled", "removed", "expired", "unpersisted consent", "changed message", "foreign organization", "foreign account", "old event"} {
		t.Run(state, func(t *testing.T) {
			l, c, r, now := durableFixture(t)
			ctx := context.Background()
			var err error
			switch state {
			case "opt-out":
				err = l.OptOut(ctx, c.AccountID, r.ID, "stop-event", now)
			case "cancelled":
				err = l.Stop(ctx, c.OrganizationID, c.AccountID, c.ID, false)
			case "removed":
				err = l.Stop(ctx, c.OrganizationID, c.AccountID, c.ID, true)
			case "expired":
				now = c.PublishedAt.Add(Window)
			case "unpersisted consent":
				r.ConsentEvidenceID = "guessed-evidence"
			case "changed message":
				c.Config.Message = "Changed after consent"
			case "foreign organization":
				c.OrganizationID = "foreign"
			case "foreign account":
				c.AccountID = "foreign"
			case "old event":
				revoked := r
				revoked.OptedOut = true
				err = l.RecordRecipient(ctx, c, revoked, now.Add(time.Second))
				if err == nil {
					err = l.RecordRecipient(ctx, c, r, now)
				}
				now = now.Add(2 * time.Second)
			}
			if err != nil {
				t.Fatal(err)
			}
			sender := &testSender{}
			if err = Deliver(ctx, c, r, now, true, ProductLimits, l, sender); err != nil || sender.count != 0 {
				t.Fatalf("unsafe send: %d %v", sender.count, err)
			}
		})
	}
}

func TestDurableRollingQuotasIncludeUncertainReservations(t *testing.T) {
	l, c, r, now := durableFixture(t)
	ctx := context.Background()
	limits := Limits{PerMinute: 1, PerHour: 2, PerDay: 3, ActiveCampaigns: 3}
	claim := func(id string, at time.Time, want bool) {
		t.Helper()
		r.ID = id
		if err := l.RecordRecipient(ctx, c, r, at); err != nil {
			t.Fatal(err)
		}
		got, err := l.Claim(ctx, c, r, at, limits)
		if err != nil || got != want {
			t.Fatalf("recipient=%s at=%s claimed=%t want=%t err=%v", id, at, got, want, err)
		}
	}
	claim("one", now, true)
	claim("two", now, false)
	claim("two", now.Add(time.Minute), true)
	claim("three", now.Add(2*time.Minute), false)
	claim("three", now.Add(time.Hour), true)
	claim("four", now.Add(2*time.Hour), false)
	claim("four", now.Add(24*time.Hour), true)
}

func TestDurableCampaignLimitAndImmutableOffer(t *testing.T) {
	l, c, r, now := durableFixture(t)
	ctx := context.Background()
	if err := l.Register(ctx, c, now, ProductLimits); err != nil {
		t.Fatal("idempotent register", err)
	}
	changed := c
	changed.Config.Message = "new offer"
	if err := l.Register(ctx, changed, now, ProductLimits); err == nil {
		t.Fatal("mutated consent offer")
	}
	for i := 2; i <= 4; i++ {
		next := c
		next.ID = fmt.Sprintf("%s-%d", c.ID, i)
		next.PostID = fmt.Sprint(123 + i)
		err := l.Register(ctx, next, now, ProductLimits)
		if (err == nil) != (i <= 3) {
			t.Fatalf("campaign %d err=%v", i, err)
		}
	}
	if err := l.OptOut(ctx, c.AccountID, r.ID, "STOP", now); err != nil {
		t.Fatal(err)
	}
	// A later opt-in snapshot does not clear an account-level STOP.
	r.ConsentEvidenceID = "new-opt-in"
	r.ConsentAt = now.Add(time.Second)
	if err := l.RecordRecipient(ctx, c, r, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if got, err := l.Claim(ctx, c, r, now.Add(time.Second), ProductLimits); err != nil || got {
		t.Fatalf("STOP reset: %t %v", got, err)
	}
}

type verifiedFixture struct {
	event VerifiedEvent
	err   error
}

func (v verifiedFixture) Verify(context.Context, Campaign, []byte) (VerifiedEvent, error) {
	return v.event, v.err
}

type grantFixture struct{ grant Authorization }

func (g grantFixture) Authorize(context.Context, Campaign) (Authorization, error) {
	return g.grant, nil
}

func TestVerifiedEventProcessorDeniesUnapprovedAndForgedEventsAndHonorsSTOPAfterRevocation(t *testing.T) {
	l, c, r, now := durableFixture(t)
	ctx := context.Background()
	sender := &testSender{}
	event := VerifiedEvent{EvidenceID: r.ConsentEvidenceID, AccountID: c.AccountID, CampaignID: c.ID, Kind: "consent", Recipient: r, ObservedAt: now}
	grant := Authorization{OrganizationID: c.OrganizationID, AccountID: c.AccountID, Messaging: true, Events: true, OptOutReceiver: true, ExpiresAt: now.Add(time.Hour), Limits: ProductLimits}
	p := EventProcessor{Ledger: l, Verifier: verifiedFixture{event: event}, Authorizer: grantFixture{grant: grant}, Sender: sender, Now: func() time.Time { return now }}
	for _, change := range []func(*Authorization){func(a *Authorization) { a.Messaging = false }, func(a *Authorization) { a.Events = false }, func(a *Authorization) { a.OptOutReceiver = false }, func(a *Authorization) { a.ExpiresAt = now }, func(a *Authorization) { a.OrganizationID = "other" }, func(a *Authorization) { a.Limits.PerDay = 0 }} {
		denied := grant
		change(&denied)
		p.Authorizer = grantFixture{grant: denied}
		if err := p.Handle(ctx, c, nil); err == nil || sender.count != 0 {
			t.Fatalf("permission bypass: %v", err)
		}
	}
	p.Authorizer = grantFixture{grant: grant}
	forged := event
	forged.AccountID = "other"
	p.Verifier = verifiedFixture{event: forged}
	if err := p.Handle(ctx, c, nil); err == nil || sender.count != 0 {
		t.Fatal("unrelated event accepted")
	}
	p.Verifier = verifiedFixture{event: event}
	if err := p.Handle(ctx, c, nil); err != nil || sender.count != 1 {
		t.Fatalf("authorized event failed: %v", err)
	}
	if err := p.Handle(ctx, c, nil); err != nil || sender.count != 1 {
		t.Fatalf("event replay resent: %v", err)
	}
	stop := event
	stop.Kind = "opt_out"
	stop.EvidenceID = "stop-after-revocation"
	stop.Recipient.ID = "next-recipient"
	p.Authorizer = grantFixture{}
	p.Verifier = verifiedFixture{event: stop}
	if err := p.Handle(ctx, c, nil); err != nil {
		t.Fatal("revocation blocked STOP", err)
	}
	r.ID = "next-recipient"
	event.Recipient = r
	p.Verifier = verifiedFixture{event: event}
	p.Authorizer = grantFixture{grant: grant}
	if err := p.Handle(ctx, c, nil); err != nil || sender.count != 1 {
		t.Fatalf("later campaign ignored STOP: %v", err)
	}
}
