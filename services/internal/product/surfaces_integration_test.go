package product

import (
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
)

// Surfaces get unique slugs; agent and manual captures supersede; the
// feature lookup ranks and labels its fallback.
func TestSurfaceCapturesAndFeatureLookup(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo, owner := w.ctx, w.repo, w.owner
	create := func(name, url string, tags ...string) string {
		t.Helper()
		surface, err := repo.CreateProductSurface(ctx, owner, CreateProductSurfaceInput{Environment: "production", Name: name,
			FeatureTags: append([]string{}, tags...), ScreenshotAssetIDs: []string{}, URL: url})
		if err != nil {
			t.Fatal(err)
		}
		return surface.ID
	}
	home := create("Home", "https://acme.test/")
	approvals := create("Invoice approvals", "https://acme.test/invoices/approvals", "approvals")
	create("Billing!", "https://acme.test/billing")
	second := create("Billing?", "https://acme.test/billing/plans")
	if row := w.db.Client.ProductSurface.GetX(ctx, second); row.Slug != "billing-2" {
		t.Fatalf("second billing slug=%q", row.Slug)
	}

	shot := func(org string) string {
		id := uuid.NewString()
		w.exec(t, `INSERT INTO asset (id,"organizationId","objectKey","mediaType",bytes,status,"createdAt","updatedAt") VALUES ($1,$2,$3,'image/png',1,'UPLOADED',now(),now())`,
			id, org, "captures/"+id)
		return id
	}
	first, latest := shot(w.org), shot(w.org)
	if _, err := repo.RecordSurfaceCapture(ctx, owner, approvals, RecordSurfaceCaptureInput{AssetID: first, Source: "agent"}); err != nil {
		t.Fatal(err)
	}
	runID := "run_1"
	if _, err := repo.RecordSurfaceCapture(ctx, owner, approvals, RecordSurfaceCaptureInput{AssetID: latest, Source: "manual", SourceID: &runID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.RecordSurfaceCapture(ctx, owner, approvals, RecordSurfaceCaptureInput{AssetID: latest, Source: "deployment"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("deployment source accepted from a caller: %v", err)
	}
	if _, err := repo.RecordSurfaceCapture(ctx, owner, approvals, RecordSurfaceCaptureInput{AssetID: uuid.NewString(), Source: "agent"}); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("unknown asset accepted: %v", err)
	}
	w.addMember(t, "viewer", "viewer")
	if _, err := repo.RecordSurfaceCapture(ctx, w.actor("viewer"), approvals, RecordSurfaceCaptureInput{AssetID: latest, Source: "agent"}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("viewer recorded a capture: %v", err)
	}
	captures, err := repo.ListSurfaceCaptures(ctx, w.actor("viewer"), approvals)
	if err != nil || len(captures) != 2 || captures[0].AssetID != latest || captures[0].SupersededAt != nil || captures[1].SupersededAt == nil {
		t.Fatalf("captures=%+v err=%v", captures, err)
	}
	if _, err := repo.ListSurfaceCaptures(ctx, owner, "missing"); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("missing surface captures: %v", err)
	}

	matches, err := repo.FindSurfacesForFeature(ctx, owner, FindSurfacesInput{Feature: "market the approvals feature"})
	if err != nil || len(matches) != 1 || matches[0].Surface.ID != approvals || matches[0].Reason != SurfaceMatchTag ||
		matches[0].CurrentCaptureAssetID == nil || *matches[0].CurrentCaptureAssetID != latest {
		t.Fatalf("approvals lookup=%+v err=%v", matches, err)
	}
	matches, err = repo.FindSurfacesForFeature(ctx, owner, FindSurfacesInput{Feature: "billing plans"})
	if err != nil || len(matches) != 2 || matches[0].Surface.ID != second || matches[0].Score <= matches[1].Score {
		t.Fatalf("billing lookup=%+v err=%v", matches, err)
	}
	matches, err = repo.FindSurfacesForFeature(ctx, owner, FindSurfacesInput{Feature: "dark mode"})
	if err != nil || len(matches) != 1 || matches[0].Surface.ID != home || matches[0].Reason != SurfaceMatchFallback || matches[0].Score != 0 {
		t.Fatalf("fallback lookup=%+v err=%v", matches, err)
	}
	if _, err := repo.FindSurfacesForFeature(ctx, owner, FindSurfacesInput{}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty lookup: %v", err)
	}
}
