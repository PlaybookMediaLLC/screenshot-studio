package product

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// Content drafts: version-checked writes, workspace isolation, ownership of
// attached assets and channels, and the plan gate.
func TestContentDrafts(t *testing.T) {
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
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	id := cuid.New()
	org, other, unpaid := "org_"+id, "other_"+id, "unpaid_"+id
	for _, organization := range []string{org, other, unpaid} {
		exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, organization)
	}
	for _, organization := range []string{org, other} {
		exec(`INSERT INTO workspace_entitlement ("organizationId",plan,status,"updatedAt") VALUES ($1,'pro','active',now())`, organization)
	}
	ownAsset, foreignAsset := cuid.New(), cuid.New()
	exec(`INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'image/png',1,'UPLOADED',now(),now())`,
		ownAsset, org, org+"/"+ownAsset)
	exec(`INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'image/png',1,'UPLOADED',now(),now())`,
		foreignAsset, other, other+"/"+foreignAsset)
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM content_draft WHERE "organizationId" IN ($1,$2,$3)`, org, other, unpaid)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM asset WHERE "organizationId" IN ($1,$2)`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id IN ($1,$2,$3)`, org, other, unpaid)
	})
	repo := NewConfiguration(db.Client)
	actor := Actor{OrganizationID: org, Kind: "service"}
	stranger := Actor{OrganizationID: other, Kind: "service"}

	body := []any{map[string]any{"type": "p", "children": []any{map[string]any{"text": "Hello"}}}}
	created, err := repo.CreateContentDraft(ctx, actor, ContentDraftInput{
		AssetIDs: []string{ownAsset, ownAsset}, Body: body, PlainText: "Hello", Title: "  Launch post  ",
	})
	if err != nil || created.Version != 1 || created.Title != "Launch post" || created.Status != "draft" ||
		len(created.AssetIDs) != 1 || len(created.ChannelConnectionIDs) != 0 {
		t.Fatalf("created=%+v err=%v", created, err)
	}
	if untitled, err := repo.CreateContentDraft(ctx, actor, ContentDraftInput{}); err != nil || untitled.Title != contentDraftUntitledTitle {
		t.Fatalf("untitled=%+v err=%v", untitled, err)
	}

	t.Run("a stale write is refused with the current version", func(t *testing.T) {
		title := "Second"
		saved, err := repo.UpdateContentDraft(ctx, actor, created.ID, ContentDraftUpdate{BaseVersion: 1, Title: &title})
		if err != nil || saved.Version != 2 || saved.Title != "Second" || saved.PlainText != "Hello" {
			t.Fatalf("saved=%+v err=%v", saved, err)
		}
		stale := "Stale"
		_, err = repo.UpdateContentDraft(ctx, actor, created.ID, ContentDraftUpdate{BaseVersion: 1, Title: &stale})
		var conflict *ContentDraftVersionConflictError
		if !errors.As(err, &conflict) || conflict.Current != 2 || !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("stale write err=%v", err)
		}
	})

	t.Run("attachments must belong to the workspace", func(t *testing.T) {
		foreign := []string{foreignAsset}
		if _, err := repo.UpdateContentDraft(ctx, actor, created.ID, ContentDraftUpdate{BaseVersion: 2, AssetIDs: &foreign}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("foreign asset accepted: %v", err)
		}
		channels := []string{cuid.New()}
		if _, err := repo.CreateContentDraft(ctx, actor, ContentDraftInput{ChannelConnectionIDs: channels}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("unknown channel accepted: %v", err)
		}
		scheduled := "scheduled"
		if _, err := repo.UpdateContentDraft(ctx, actor, created.ID, ContentDraftUpdate{BaseVersion: 2, Status: &scheduled}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("status scheduled set by hand: %v", err)
		}
	})

	t.Run("another workspace sees nothing", func(t *testing.T) {
		if _, err := repo.GetContentDraft(ctx, stranger, created.ID); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("get err=%v", err)
		}
		title := "Hijack"
		if _, err := repo.UpdateContentDraft(ctx, stranger, created.ID, ContentDraftUpdate{BaseVersion: 2, Title: &title}); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("update err=%v", err)
		}
		if err := repo.DeleteContentDraft(ctx, stranger, created.ID); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("delete err=%v", err)
		}
		if page, err := repo.ListContentDrafts(ctx, stranger, ContentDraftListQuery{}); err != nil || len(page.Items) != 0 {
			t.Fatalf("stranger page=%+v err=%v", page, err)
		}
	})

	t.Run("a workspace without the plan is refused", func(t *testing.T) {
		_, err := repo.CreateContentDraft(ctx, Actor{OrganizationID: unpaid, Kind: "service"}, ContentDraftInput{})
		var gate *FeatureNotEntitledError
		if !errors.As(err, &gate) || gate.Feature != contentDraftFeature {
			t.Fatalf("unpaid err=%v", err)
		}
	})

	t.Run("lists page newest first and hide archived drafts", func(t *testing.T) {
		archived := "archived"
		if _, err := repo.UpdateContentDraft(ctx, actor, created.ID, ContentDraftUpdate{BaseVersion: 2, Status: &archived}); err != nil {
			t.Fatal(err)
		}
		page, err := repo.ListContentDrafts(ctx, actor, ContentDraftListQuery{Limit: 1})
		if err != nil || len(page.Items) != 1 || page.Items[0].Title != contentDraftUntitledTitle {
			t.Fatalf("page=%+v err=%v", page, err)
		}
		if page.NextCursor != nil {
			if next, err := repo.ListContentDrafts(ctx, actor, ContentDraftListQuery{Cursor: *page.NextCursor, Limit: 1}); err != nil || len(next.Items) != 0 {
				t.Fatalf("archived draft listed: %+v err=%v", next, err)
			}
		}
		if only, err := repo.ListContentDrafts(ctx, actor, ContentDraftListQuery{Status: "archived"}); err != nil || len(only.Items) != 1 {
			t.Fatalf("archived=%+v err=%v", only, err)
		}
	})

	t.Run("delete removes the draft", func(t *testing.T) {
		if err := repo.DeleteContentDraft(ctx, actor, created.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.GetContentDraft(ctx, actor, created.ID); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("deleted draft err=%v", err)
		}
	})
}
