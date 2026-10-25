package product

import (
	"errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"testing"
)

func TestSharedImageRevocation(t *testing.T) {
	w, objects, assetID := downloadFixture(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	draft, err := w.repo.CreateContentDraft(w.ctx, w.owner, ContentDraftInput{PlainText: "Shared picture", AssetIDs: []string{assetID}})
	if err != nil {
		t.Fatal(err)
	}
	shared, err := w.repo.ShareContentDraft(w.ctx, w.owner, draft.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	token := *shared.ShareToken
	preview, err := w.repo.GetSharedContentDraft(w.ctx, token)
	if err != nil || preview.ImageAssetID == nil || *preview.ImageAssetID != assetID {
		t.Fatalf("missing image: %+v %v", preview, err)
	}
	body, mime, err := w.repo.ReadSharedDraftImage(w.ctx, token)
	if err != nil || string(body) != "private media" || mime != "image/png" {
		t.Fatalf("preview read: %s %s %v", body, mime, err)
	}
	objects.beforeRead = func() { w.exec(t, `UPDATE content_draft SET "shareToken"=NULL WHERE id=$1`, draft.ID) }
	if body, _, err := w.repo.ReadSharedDraftImage(w.ctx, token); !errors.Is(err, publishing.ErrNotFound) || len(body) > 0 {
		t.Fatal("revoked image escaped storage read", err)
	}
}
