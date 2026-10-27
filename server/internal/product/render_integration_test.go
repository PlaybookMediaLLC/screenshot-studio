package product

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
	"github.com/lucsky/cuid"
)

// Render reads see only the caller's workspace: its assets by id or object
// key, and the newest design rendered under a key.
func TestRenderReads(t *testing.T) {
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
	id := cuid.New()
	org, other := "org_"+id, "other_"+id
	for _, organization := range []string{org, other} {
		if _, err := db.SQL.ExecContext(ctx, `INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, organization); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM design WHERE "organizationId"=$1 OR "organizationId"=$2`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM asset WHERE "organizationId"=$1 OR "organizationId"=$2`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1 OR id=$2`, org, other)
	})
	newAsset := func(owner string, status asset.Status) string {
		t.Helper()
		assetID := uuid.NewString()
		width, height := 1200, 630
		if err := db.Client.Asset.Create().SetID(assetID).SetOrganizationID(owner).
			SetObjectKey("org/" + owner + "/export/" + assetID + "/1/design.png").SetMediaType("image/png").
			SetBytes(1).SetStatus(status).SetWidth(width).SetHeight(height).SetSha256("sha-" + assetID).Exec(ctx); err != nil {
			t.Fatal(err)
		}
		return assetID
	}
	uploaded, pending, foreign := newAsset(org, asset.StatusUPLOADED), newAsset(org, asset.StatusPENDING), newAsset(other, asset.StatusUPLOADED)
	repo := NewConfiguration(db.Client)
	actor := Actor{OrganizationID: org, Kind: "service"}

	found, err := repo.FindAssets(ctx, actor, []string{uploaded, pending, foreign}, "")
	if err != nil || len(found) != 2 {
		t.Fatalf("found=%+v err=%v", found, err)
	}
	for _, item := range found {
		if item.ID == foreign {
			t.Fatal("foreign asset leaked by id")
		}
		if item.ID == pending && item.Status != "PENDING" {
			t.Fatalf("pending asset status=%s", item.Status)
		}
	}
	byKey, err := repo.FindAssets(ctx, actor, nil, "org/"+org+"/export/"+uploaded+"/1/design.png")
	if err != nil || len(byKey) != 1 || byKey[0].ID != uploaded || byKey[0].SHA256 == nil {
		t.Fatalf("by key=%+v err=%v", byKey, err)
	}
	if leaked, err := repo.FindAssets(ctx, actor, nil, "org/"+other+"/export/"+foreign+"/1/design.png"); err != nil || len(leaked) != 0 {
		t.Fatalf("foreign object key leaked=%+v err=%v", leaked, err)
	}
	for _, invalid := range []struct {
		ids []string
		key string
	}{{nil, ""}, {[]string{uploaded}, "key"}, {[]string{"not-a-uuid"}, ""}} {
		if _, err := repo.FindAssets(ctx, actor, invalid.ids, invalid.key); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("lookup %+v accepted: %v", invalid, err)
		}
	}

	renderKey := strings.Repeat("ab", 32)
	if _, err := repo.FindDesignRender(ctx, actor, renderKey); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("render before any design: %v", err)
	}
	newer := newAsset(org, asset.StatusUPLOADED)
	for _, entry := range []struct {
		rendered *string
		age      time.Duration
	}{{&uploaded, 2 * time.Hour}, {&newer, time.Hour}, {nil, 0}} {
		create := db.Client.Design.Create().SetID(cuid.New()).SetOrganizationID(org).SetName("Design").
			SetDocument(map[string]any{"version": 1}).SetRenderKey(renderKey).SetUpdatedAt(time.Now().Add(-entry.age))
		if entry.rendered != nil {
			create.SetRenderedAssetID(*entry.rendered)
		}
		if err := create.Exec(ctx); err != nil {
			t.Fatal(err)
		}
	}
	hit, err := repo.FindDesignRender(ctx, actor, renderKey)
	if err != nil || hit.ID != newer || hit.MediaType != "image/png" || hit.Width == nil {
		t.Fatalf("render hit=%+v err=%v", hit, err)
	}
	if _, err := repo.FindDesignRender(ctx, Actor{OrganizationID: other, Kind: "service"}, renderKey); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("another workspace reused this render: %v", err)
	}
	if _, err := repo.FindDesignRender(ctx, actor, "short"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("malformed render key accepted: %v", err)
	}
}
