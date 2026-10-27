package notifications

import (
	"context"
	"testing"
	"time"
)

func TestFanoutSkipsWorkspaceMutationAndRecovers(t *testing.T) {
	f := notificationFixture(t)
	event := f.event(t, "generation.completed", f.creator.UserID)
	execFixture(t, f, `UPDATE outbox_event SET "createdAt"='1900-01-01' WHERE id=$1`, event)
	tx, err := f.s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT id FROM organization WHERE id=$1 FOR UPDATE`, f.owner.OrganizationID); err != nil {
		t.Fatal(err)
	}
	// A concurrent policy/seat/deletion transaction owns the organization first.
	// Fanout must neither wait on it nor hold a recipient lock in the meantime.
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err = f.s.fanout(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.ExecContext(ctx, `SELECT id FROM member WHERE "organizationId"=$1 FOR UPDATE`, f.owner.OrganizationID); err != nil {
		t.Fatal(err)
	}
	var fanned bool
	if err = tx.QueryRow(`SELECT notification_fanned FROM outbox_event WHERE id=$1`, event).Scan(&fanned); err != nil || fanned {
		t.Fatalf("busy workspace was projected: %t %v", fanned, err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err = f.s.fanout(ctx); err != nil {
		t.Fatal(err)
	}
	if err = f.s.DB.QueryRow(`SELECT notification_fanned FROM outbox_event WHERE id=$1`, event).Scan(&fanned); err != nil || !fanned {
		t.Fatalf("released workspace not projected: %t %v", fanned, err)
	}
	var before, after int
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_delivery WHERE event_id=$1`, event).Scan(&before); err != nil || before == 0 {
		t.Fatal("missing decisions", before, err)
	}
	if _, err = f.s.fanout(ctx); err != nil {
		t.Fatal(err)
	}
	if err = f.s.DB.QueryRow(`SELECT count(*) FROM platform_notification_delivery WHERE event_id=$1`, event).Scan(&after); err != nil || before != after {
		t.Fatal("duplicate decisions", before, after, err)
	}
}
