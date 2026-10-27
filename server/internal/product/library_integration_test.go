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

// Presets and brand kits: rename and archive act on every version of a name,
// names stay unique, and another workspace can touch neither.
func TestLibraryRenameAndArchive(t *testing.T) {
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
		for _, table := range []string{"creative_template", "brand_kit"} {
			_, _ = db.SQL.ExecContext(ctx, `DELETE FROM `+table+` WHERE "organizationId"=$1 OR "organizationId"=$2`, org, other)
		}
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1 OR id=$2`, org, other)
	})
	repo := NewConfiguration(db.Client)
	actor := Actor{OrganizationID: org, Kind: "service"}
	stranger := Actor{OrganizationID: other, Kind: "service"}
	definition := map[string]any{"kind": "design-preset"}

	first, err := repo.CreateCreativeTemplate(ctx, actor, CreateCreativeTemplateInput{Name: "Hero", Definition: definition})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateCreativeTemplate(ctx, actor, CreateCreativeTemplateInput{Name: "Hero", Definition: definition}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateCreativeTemplate(ctx, actor, CreateCreativeTemplateInput{Name: "Story", Definition: definition}); err != nil {
		t.Fatal(err)
	}

	renamed, err := repo.RenameCreativeTemplate(ctx, actor, first.ID, "  Launch hero ")
	if err != nil || renamed.Name != "Launch hero" || renamed.Version != 2 {
		t.Fatalf("renamed=%+v err=%v", renamed, err)
	}
	items, err := repo.ListCreativeTemplates(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.Name == "Hero" {
			t.Fatalf("a version kept the old name: %+v", item)
		}
	}
	if _, err := repo.RenameCreativeTemplate(ctx, actor, first.ID, "Story"); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("rename onto a taken name: %v", err)
	}
	if _, err := repo.RenameCreativeTemplate(ctx, stranger, first.ID, "Mine"); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("stranger rename: %v", err)
	}
	if err := repo.ArchiveCreativeTemplate(ctx, stranger, first.ID); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("stranger archive: %v", err)
	}
	if err := repo.ArchiveCreativeTemplate(ctx, actor, first.ID); err != nil {
		t.Fatal(err)
	}
	items, _ = repo.ListCreativeTemplates(ctx, actor)
	for _, item := range items {
		if (item.Name == "Launch hero") != (item.Status == "ARCHIVED") {
			t.Fatalf("archive touched the wrong versions: %+v", item)
		}
	}

	kitDefinition := map[string]any{
		"colors":     map[string]any{"accent": "#6d5dfc", "background": "#ffffff", "text": "#111111"},
		"typography": map[string]any{"headingFamily": "inter"},
	}
	kit, err := repo.CreateBrandKit(ctx, actor, CreateBrandKitInput{Name: "Acme", Definition: kitDefinition, Publish: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateBrandKit(ctx, actor, CreateBrandKitInput{Name: "Acme", Definition: kitDefinition, Publish: true}); err != nil {
		t.Fatal(err)
	}
	if renamed, err := repo.RenameBrandKit(ctx, actor, kit.ID, "Acme 2026"); err != nil || renamed.Version != 2 || renamed.Name != "Acme 2026" {
		t.Fatalf("renamed=%+v err=%v", renamed, err)
	}
	if err := repo.ArchiveBrandKit(ctx, stranger, kit.ID); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("stranger archive: %v", err)
	}
	if err := repo.ArchiveBrandKit(ctx, actor, kit.ID); err != nil {
		t.Fatal(err)
	}
	kits, _ := repo.ListBrandKits(ctx, org)
	for _, row := range kits {
		if row.Status != "ARCHIVED" {
			t.Fatalf("version left active: %+v", row)
		}
	}
}
