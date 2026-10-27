package notifications

import (
	"context"
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

func TestNotificationCategoriesSeparateCollaborationFromOperations(t *testing.T) {
	for _, tc := range []struct{ kind, category string }{
		{"comment.created", "inbox"}, {"member.mentioned", "inbox"}, {"draft.review_requested", "inbox"},
		{"post.published", "activity"}, {"post.publish_failed", "activity"}, {"integration.reconnect_required", "activity"},
	} {
		def, ok := activity.Lookup(tc.kind)
		if !ok || notificationCategory(def) != tc.category {
			t.Fatalf("%s category=%s", tc.kind, notificationCategory(def))
		}
	}
}

func TestInboxReadArchiveRestorePersistAndPreserveDelivery(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	event := f.event(t, "generation.completed", f.creator.UserID)
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	page, err := f.s.ListFeed(ctx, f.owner, "activity", "")
	if err != nil || len(page.Items) != 1 || page.Items[0].ReadAt != nil || page.Items[0].ArchivedAt != nil {
		t.Fatalf("initial=%+v err=%v", page, err)
	}
	id := page.Items[0].ID
	for _, tc := range []struct {
		action, view, resultView string
		read, archived           bool
		count                    int
	}{
		{"read", "activity", "activity", true, false, 0},
		{"unread", "activity", "activity", false, false, 1},
		{"archive", "activity", "archive", false, true, 0},
		{"read", "archive", "archive", true, true, 0},
		{"restore", "archive", "activity", true, false, 0},
	} {
		input := StateInput{Action: tc.action, View: tc.view, IDs: []string{id}, Key: cuid.New()}
		result, err := f.s.ChangeState(ctx, f.owner, input)
		if err != nil || result.Changed != 1 || result.UnseenCount != tc.count {
			t.Fatalf("%s=%+v err=%v", tc.action, result, err)
		}
		// Repeat completion exactly; it is a receipt, not another state transition.
		result, err = f.s.ChangeState(ctx, f.owner, input)
		if err != nil || result.Changed != 1 || result.UnseenCount != tc.count {
			t.Fatalf("replay %s=%+v err=%v", tc.action, result, err)
		}
		page, err = f.s.ListFeed(ctx, f.owner, tc.resultView, "")
		if err != nil || len(page.Items) != 1 || (page.Items[0].ReadAt != nil) != tc.read || (page.Items[0].ArchivedAt != nil) != tc.archived {
			t.Fatalf("persisted %s=%+v err=%v", tc.action, page, err)
		}
		input.Action = "unread"
		if tc.action != "unread" {
			if _, err = f.s.ChangeState(ctx, f.owner, input); !errors.Is(err, ErrInvalid) {
				t.Fatalf("key reused for another operation: %v", err)
			}
		}
	}
	var deliveries, events int
	err = f.s.DB.QueryRow(`SELECT (SELECT count(*) FROM platform_notification_delivery WHERE id=$1 AND status='SUCCEEDED'),(SELECT count(*) FROM outbox_event WHERE id=$2)`, id, event).Scan(&deliveries, &events)
	if err != nil || deliveries != 1 || events != 1 {
		t.Fatalf("immutable source/delivery lost: %d %d %v", deliveries, events, err)
	}
	if _, err = f.s.DB.Exec(`UPDATE outbox_event SET notification_fanned=false WHERE id=$1`, event); err != nil {
		t.Fatal(err)
	}
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	page, err = f.s.ListFeed(ctx, f.owner, "activity", "")
	if err != nil || len(page.Items) != 1 || page.Items[0].ReadAt == nil || page.UnseenCount != 0 {
		t.Fatalf("replay reset state: %+v %v", page, err)
	}
}

func TestInboxCursorIsolationBulkSnapshotAndRevocation(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	for range 25 {
		f.event(t, "generation.completed", f.creator.UserID)
	}
	if err := f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	// Identical timestamps still have a stable, unique ordering by receipt ID.
	if _, err := f.s.DB.Exec(`UPDATE platform_notification_inbox SET created_at='2026-10-01T00:00:00Z' WHERE "organizationId"=$1`, f.owner.OrganizationID); err != nil {
		t.Fatal(err)
	}
	first, err := f.s.ListFeed(ctx, f.owner, "activity", "")
	if err != nil || len(first.Items) != 20 || first.NextCursor == "" {
		t.Fatalf("first=%+v %v", first, err)
	}
	second, err := f.s.ListFeed(ctx, f.owner, "activity", first.NextCursor)
	if err != nil || len(second.Items) != 5 || second.NextCursor != "" {
		t.Fatalf("second=%+v %v", second, err)
	}
	seen := map[string]bool{}
	for _, item := range append(first.Items, second.Items...) {
		if seen[item.ID] {
			t.Fatal("duplicate receipt across pages")
		}
		seen[item.ID] = true
	}
	for _, cursor := range []string{first.NextCursor, "malformed"} {
		if _, err = f.s.ListFeed(ctx, f.creator, "activity", cursor); !errors.Is(err, ErrInvalid) {
			t.Fatalf("foreign cursor: %v", err)
		}
	}
	if _, err = f.s.ListFeed(ctx, f.owner, "archive", first.NextCursor); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cursor crossed feeds: %v", err)
	}
	foreign := f.owner
	foreign.OrganizationID = f.otherOrg
	input := StateInput{Action: "archive", View: "activity", IDs: []string{first.Items[0].ID}, Key: cuid.New()}
	if _, err = f.s.ChangeState(ctx, foreign, input); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("cross-workspace write: %v", err)
	}
	result, err := f.s.ChangeState(ctx, f.creator, input)
	if err != nil || result.Changed != 0 {
		t.Fatalf("cross-recipient write: %+v %v", result, err)
	}
	bulk := StateInput{Action: "archive", View: "activity", All: true, Key: cuid.New()}
	result, err = f.s.ChangeState(ctx, f.owner, bulk)
	if err != nil || result.Changed != 25 || result.UnseenCount != 0 {
		t.Fatalf("bulk=%+v %v", result, err)
	}
	f.event(t, "generation.completed", f.creator.UserID)
	if err = f.s.Process(ctx); err != nil {
		t.Fatal(err)
	}
	result, err = f.s.ChangeState(ctx, f.owner, bulk)
	if err != nil || result.Changed != 25 || result.UnseenCount != 1 {
		t.Fatalf("retry consumed new arrival: %+v %v", result, err)
	}
	// Revoking resource access redacts old summaries and disables navigation.
	if _, err = f.s.DB.Exec(`DELETE FROM campaign WHERE id=$1`, f.campaign); err != nil {
		t.Fatal(err)
	}
	page, err := f.s.ListFeed(ctx, f.owner, "archive", "")
	if err != nil || len(page.Items) != 20 || page.Items[0].Description != "This activity is no longer available." || page.Items[0].Href != "" {
		t.Fatalf("revoked resource leaked: %+v %v", page, err)
	}
	if _, err = f.s.DB.Exec(`DELETE FROM member WHERE "organizationId"=$1 AND "userId"=$2`, f.owner.OrganizationID, f.owner.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err = f.s.ChangeState(ctx, f.owner, bulk); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("revoked recipient can mutate: %v", err)
	}
}
