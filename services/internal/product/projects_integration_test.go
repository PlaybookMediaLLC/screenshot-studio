package product

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/projectversion"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

func projectTestDocument(headline string) map[string]any {
	return map[string]any{
		"version": float64(2),
		"image":   map[string]any{"src": "/demo/notion-showcase.webp"},
		"texts":   []any{map[string]any{"text": headline, "fontSize": 0.04, "position": map[string]any{"x": 50.0, "y": 8.0}}},
	}
}

func projectHeadline(document map[string]any) string {
	texts, _ := document["texts"].([]any)
	if len(texts) == 0 {
		return ""
	}
	text, _ := texts[0].(map[string]any)
	value, _ := text["text"].(string)
	return value
}

// Projects: revision-checked writes, workspace isolation, autosave pruning,
// and restore.
func TestProjects(t *testing.T) {
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
		// The audit log is append-only, so the audited organization stays behind.
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM project WHERE "organizationId"=$1 OR "organizationId"=$2`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1 OR id=$2`, org, other)
	})
	repo := NewConfiguration(db.Client)
	actor := Actor{OrganizationID: org, Kind: "service"}
	stranger := Actor{OrganizationID: other, Kind: "service"}

	created, err := repo.CreateProject(ctx, actor, "  Launch hero  ", projectTestDocument("v1"))
	if err != nil || created.Revision != 1 || created.Name != "Launch hero" || created.DocumentVersion != 2 {
		t.Fatalf("created=%+v err=%v", created, err)
	}
	if versions, err := repo.ListProjectVersions(ctx, actor, created.ID); err != nil || len(versions) != 1 ||
		versions[0].Revision != 1 || versions[0].Name == nil || *versions[0].Name != "Project created" {
		t.Fatalf("starting point not kept: versions=%+v err=%v", versions, err)
	}
	if _, err := repo.CreateProject(ctx, actor, "Local image", map[string]any{
		"version": float64(2), "image": map[string]any{"src": "blob:http://localhost/x"},
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("local source accepted: %v", err)
	}

	t.Run("a stale write is refused with the current revision", func(t *testing.T) {
		saved, err := repo.UpdateProjectDocument(ctx, actor, created.ID, ProjectDocumentWrite{BaseRevision: 1, Document: projectTestDocument("v2")})
		if err != nil || saved.Revision != 2 {
			t.Fatalf("saved=%+v err=%v", saved, err)
		}
		_, err = repo.UpdateProjectDocument(ctx, actor, created.ID, ProjectDocumentWrite{BaseRevision: 1, Document: projectTestDocument("stale")})
		var stale *ProjectRevisionConflictError
		if !errors.As(err, &stale) || stale.Current != 2 || !errors.Is(err, publishing.ErrConflict) {
			t.Fatalf("stale write err=%v", err)
		}
		current, err := repo.GetProject(ctx, actor, created.ID)
		if err != nil || projectHeadline(current.Document) != "v2" || current.Revision != 2 {
			t.Fatalf("stale write changed the project: %+v err=%v", current, err)
		}
	})

	t.Run("another workspace sees nothing", func(t *testing.T) {
		if _, err := repo.GetProject(ctx, stranger, created.ID); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("get err=%v", err)
		}
		if _, err := repo.UpdateProjectDocument(ctx, stranger, created.ID, ProjectDocumentWrite{BaseRevision: 2, Document: projectTestDocument("x")}); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("update err=%v", err)
		}
		if _, err := repo.RenameProject(ctx, stranger, created.ID, "Mine now"); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("rename err=%v", err)
		}
		if _, err := repo.DuplicateProject(ctx, stranger, created.ID, nil); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("duplicate err=%v", err)
		}
		if err := repo.DeleteProject(ctx, stranger, created.ID); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("delete err=%v", err)
		}
		if _, err := repo.ListProjectVersions(ctx, stranger, created.ID); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("versions err=%v", err)
		}
		if _, err := repo.CreateProjectVersion(ctx, stranger, created.ID, "Theirs"); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("named version err=%v", err)
		}
		page, err := repo.ListProjects(ctx, stranger, ProjectListQuery{})
		if err != nil || len(page.Items) != 0 {
			t.Fatalf("stranger list=%+v err=%v", page, err)
		}
	})

	t.Run("old autosaves are pruned and named versions kept", func(t *testing.T) {
		named, err := repo.CreateProjectVersion(ctx, actor, created.ID, "Approved layout")
		if err != nil || named.Kind != "named" || named.Revision != 2 {
			t.Fatalf("named=%+v err=%v", named, err)
		}
		// Age the named version past every autosave, so a prune by age alone would take it.
		if _, err := db.SQL.ExecContext(ctx, `UPDATE project_version SET "createdAt"=$1 WHERE id=$2`, time.Now().Add(-72*time.Hour), named.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.SQL.ExecContext(ctx, `UPDATE project_version SET "createdAt"=$1 WHERE "projectId"=$2 AND kind='autosave'`,
			time.Now().Add(-time.Hour), created.ID); err != nil {
			t.Fatal(err)
		}
		for index := 0; index < projectAutosaveLimit+5; index++ {
			if err := db.Client.ProjectVersion.Create().SetID(cuid.New()).SetProjectID(created.ID).SetOrganizationID(org).
				SetRevision(2).SetKind(projectversion.KindAutosave).SetDocument(projectTestDocument("old")).
				SetCreatedAt(time.Now().Add(-time.Duration(index+20) * time.Minute)).Exec(ctx); err != nil {
				t.Fatal(err)
			}
		}
		saved, err := repo.UpdateProjectDocument(ctx, actor, created.ID, ProjectDocumentWrite{BaseRevision: 2, Document: projectTestDocument("v3")})
		if err != nil || saved.Revision != 3 {
			t.Fatalf("saved=%+v err=%v", saved, err)
		}
		autosaves, err := db.Client.ProjectVersion.Query().Where(projectversion.ProjectID(created.ID),
			projectversion.KindEQ(projectversion.KindAutosave)).All(ctx)
		if err != nil || len(autosaves) != projectAutosaveLimit {
			t.Fatalf("autosaves=%d err=%v", len(autosaves), err)
		}
		newest := false
		for _, version := range autosaves {
			newest = newest || version.Revision == 3
		}
		if !newest {
			t.Fatal("the new checkpoint was pruned")
		}
		if kept, err := db.Client.ProjectVersion.Query().Where(projectversion.ID(named.ID)).Exist(ctx); err != nil || !kept {
			t.Fatalf("named version pruned: kept=%v err=%v", kept, err)
		}
		// A write right after a checkpoint records none.
		if _, err := repo.UpdateProjectDocument(ctx, actor, created.ID, ProjectDocumentWrite{BaseRevision: 3, Document: projectTestDocument("v4")}); err != nil {
			t.Fatal(err)
		}
		if count, err := db.Client.ProjectVersion.Query().Where(projectversion.ProjectID(created.ID),
			projectversion.KindEQ(projectversion.KindAutosave)).Count(ctx); err != nil || count != projectAutosaveLimit {
			t.Fatalf("autosaves after a quick write=%d err=%v", count, err)
		}
	})

	t.Run("restore brings a version back as a new revision", func(t *testing.T) {
		versions, err := repo.ListProjectVersions(ctx, actor, created.ID)
		if err != nil {
			t.Fatal(err)
		}
		var namedID string
		for _, version := range versions {
			if version.Kind == "named" {
				namedID = version.ID
			}
			if version.Document != nil {
				t.Fatal("version lists carry documents")
			}
		}
		if _, err := repo.RestoreProjectVersion(ctx, actor, created.ID, namedID, 1); !errors.As(err, new(*ProjectRevisionConflictError)) {
			t.Fatalf("stale restore err=%v", err)
		}
		if _, err := repo.RestoreProjectVersion(ctx, stranger, created.ID, namedID, 4); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("foreign restore err=%v", err)
		}
		restored, err := repo.RestoreProjectVersion(ctx, actor, created.ID, namedID, 4)
		if err != nil || restored.Revision != 5 || projectHeadline(restored.Document) != "v2" {
			t.Fatalf("restored=%+v err=%v", restored, err)
		}
		after, err := repo.ListProjectVersions(ctx, actor, created.ID)
		if err != nil {
			t.Fatal(err)
		}
		var restoreVersion, before *ProjectVersionRecord
		for index := range after {
			version := &after[index]
			if version.Kind == "restore" {
				restoreVersion = version
			}
			if version.Name != nil && *version.Name == "Before restore" {
				before = version
			}
		}
		if restoreVersion == nil || restoreVersion.Name == nil || *restoreVersion.Name != "Restored from Approved layout" || restoreVersion.Revision != 5 {
			t.Fatalf("restore version=%+v", restoreVersion)
		}
		// Revision 4 had no version; the restore kept it first.
		if before == nil || before.Revision != 4 {
			t.Fatalf("pre-restore document not kept: %+v", before)
		}
		kept, err := repo.GetProjectVersion(ctx, actor, created.ID, before.ID)
		if err != nil || projectHeadline(kept.Document) != "v4" {
			t.Fatalf("kept=%+v err=%v", kept, err)
		}
	})

	t.Run("list, search, duplicate, rename, and delete", func(t *testing.T) {
		copied, err := repo.DuplicateProject(ctx, actor, created.ID, nil)
		if err != nil || copied.Name != "Launch hero copy" || copied.Revision != 1 || projectHeadline(copied.Document) != "v2" {
			t.Fatalf("copied=%+v err=%v", copied, err)
		}
		if _, err := repo.RenameProject(ctx, actor, copied.ID, "Pricing banner"); err != nil {
			t.Fatal(err)
		}
		found, err := repo.ListProjects(ctx, actor, ProjectListQuery{Search: "PRICING"})
		if err != nil || len(found.Items) != 1 || found.Items[0].ID != copied.ID {
			t.Fatalf("search=%+v err=%v", found, err)
		}
		first, err := repo.ListProjects(ctx, actor, ProjectListQuery{Limit: 1})
		if err != nil || len(first.Items) != 1 || first.NextCursor == nil || first.Items[0].ID != copied.ID {
			t.Fatalf("first page=%+v err=%v", first, err)
		}
		second, err := repo.ListProjects(ctx, actor, ProjectListQuery{Cursor: *first.NextCursor, Limit: 1})
		if err != nil || len(second.Items) != 1 || second.Items[0].ID != created.ID || second.NextCursor != nil {
			t.Fatalf("second page=%+v err=%v", second, err)
		}
		byName, err := repo.ListProjects(ctx, actor, ProjectListQuery{Sort: "name", Limit: 1})
		if err != nil || len(byName.Items) != 1 || byName.Items[0].ID != created.ID {
			t.Fatalf("by name=%+v err=%v", byName, err)
		}
		if err := repo.DeleteProject(ctx, actor, copied.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.GetProject(ctx, actor, copied.ID); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("deleted project err=%v", err)
		}
		if orphans, err := db.Client.ProjectVersion.Query().Where(projectversion.ProjectID(copied.ID)).Count(ctx); err != nil || orphans != 0 {
			t.Fatalf("versions outlived their project: %d err=%v", orphans, err)
		}
	})
}
