package product

import (
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

func TestAssetDiscoveryRetainsProvenanceAndTenantFilters(t *testing.T) {
	w, foreign := newTestWorkspace(t), newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	objects := &recordingAssetObjects{}
	w.repo.WithObjectStore(objects)
	owner := w.owner
	owner.Display = "QA Owner"
	project, err := w.repo.CreateProject(w.ctx, owner, "Launch hero", projectTestDocument("source"))
	if err != nil {
		t.Fatal(err)
	}
	upload := AssetUploadInput{Bytes: 32, ContentType: "image/png", Classification: "export", FileName: "launch-hero.png", ProjectID: project.ID}
	signed, err := w.repo.SignAssetUpload(w.ctx, owner, upload)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Client.Asset.UpdateOneID(signed.Asset.ID).SetStatus(asset.StatusUPLOADED).Save(w.ctx); err != nil {
		t.Fatal(err)
	}
	original := upload
	original.ProjectID, original.Classification, original.FileName = "", "input", "original.png"
	raw, err := w.repo.SignAssetUpload(w.ctx, owner, original)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.db.Client.Asset.UpdateOneID(raw.Asset.ID).SetStatus(asset.StatusUPLOADED).Save(w.ctx); err != nil {
		t.Fatal(err)
	}
	page, err := w.repo.ListAssets(w.ctx, owner, AssetListOptions{Limit: 1, Search: "LAUNCH-HERO", Classification: "export"})
	if err != nil || len(page.Assets) != 1 {
		t.Fatalf("search=%+v %v", page, err)
	}
	item := page.Assets[0]
	if item.ID != signed.Asset.ID || item.FileName != upload.FileName || item.ProjectID != project.ID || item.ProjectName != project.Name || item.UploadedBy != owner.Display || item.Classification != "export" || page.NextCursor != nil {
		t.Fatalf("provenance=%+v", item)
	}
	page, err = w.repo.ListAssets(w.ctx, owner, AssetListOptions{Limit: 10, Classification: "input"})
	if err != nil || len(page.Assets) != 1 || page.Assets[0].ID != raw.Asset.ID {
		t.Fatalf("originals=%+v %v", page, err)
	}
	page, err = w.repo.ListAssets(w.ctx, foreign.owner, AssetListOptions{Limit: 10, Search: "launch"})
	if err != nil || len(page.Assets) != 0 {
		t.Fatalf("foreign search=%+v %v", page, err)
	}
	foreignProject, err := foreign.repo.CreateProject(foreign.ctx, foreign.owner, "Private", projectTestDocument("private"))
	if err != nil {
		t.Fatal(err)
	}
	upload.ProjectID = foreignProject.ID
	if _, err := w.repo.SignAssetUpload(w.ctx, owner, upload); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("foreign lineage=%v", err)
	}
}

func TestWorkspaceCreationPersistsChosenTimeZone(t *testing.T) {
	w := newTestWorkspace(t)
	for _, zone := range []string{"America/New_York", "", "Asia/Kolkata"} {
		suffix := map[string]string{"America/New_York": "ny", "": "default", "Asia/Kolkata": "india"}[zone]
		created, err := w.repo.CreateWorkspace(w.ctx, w.owner, CreateWorkspaceInput{Name: "Time zone", Slug: "qa-" + suffix + "-" + w.id, TimeZone: zone})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _, _ = w.db.SQL.ExecContext(w.ctx, `DELETE FROM organization WHERE id=$1`, created.ID) })
		expected := zone
		if expected == "" {
			expected = "UTC"
		}
		saved, err := w.repo.GetWorkspace(w.ctx, created.ID)
		if err != nil || saved.WorkspaceSettings == nil || saved.WorkspaceSettings.TimeZone != expected {
			t.Fatalf("zone=%+v %v", saved, err)
		}
	}
	if _, err := w.repo.CreateWorkspace(w.ctx, w.owner, CreateWorkspaceInput{Name: "Invalid", Slug: "qa-invalid-" + w.id, TimeZone: "Mars/Olympus"}); err == nil {
		t.Fatal("invalid zone accepted")
	}
}
