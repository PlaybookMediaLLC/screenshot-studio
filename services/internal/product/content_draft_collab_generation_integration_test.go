package product

import (
	"bytes"
	"errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"strings"
	"testing"
)

func TestContentDraftReplacementInvalidatesCollaboration(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo := w.ctx, w.repo.WithCollabKey([]byte(strings.Repeat("s", 32)))
	subscribe(t, ctx, repo, w.org, "pro")
	draft, err := repo.CreateContentDraft(ctx, w.owner, ContentDraftInput{Title: "External replacement"})
	if err != nil {
		t.Fatal(err)
	}
	old, err := repo.IssueContentDraftCollabToken(ctx, w.owner, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.StoreCollabState(ctx, old.Token, draft.ID, []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	body := []any{map[string]any{"type": "p", "children": []any{map[string]any{"text": "New API content"}}}}
	replaced, err := repo.UpdateContentDraft(ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: draft.Version, Body: &body})
	if err != nil || replaced.CollabGeneration != 1 {
		t.Fatalf("replacement: %+v %v", replaced, err)
	}
	if _, err = repo.AuthorizeCollab(ctx, old.Token, old.DocumentName); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("old admission: %v", err)
	}
	if _, err = repo.LoadCollabState(ctx, old.Token, draft.ID); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("old load: %v", err)
	}
	if err = repo.StoreCollabState(ctx, old.Token, draft.ID, []byte{9}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("old store: %v", err)
	}
	stale := 0
	if _, err = repo.UpdateContentDraft(ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: replaced.Version, Body: &body, CollabGeneration: &stale}); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("stale projection: %v", err)
	}
	fresh, err := repo.IssueContentDraftCollabToken(ctx, w.owner, draft.ID)
	if err != nil || fresh.DocumentName != old.DocumentName+":1" {
		t.Fatalf("new room: %+v %v", fresh, err)
	}
	if state, err := repo.LoadCollabState(ctx, fresh.Token, draft.ID); err != nil || state != nil {
		t.Fatalf("old state survived: %v %v", state, err)
	}
	if err = repo.StoreCollabState(ctx, fresh.Token, draft.ID, []byte{4, 5}); err != nil {
		t.Fatal(err)
	}
	current := 1
	body = []any{map[string]any{"type": "p", "children": []any{map[string]any{"text": "Live editor update"}}}}
	live, err := repo.UpdateContentDraft(ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: replaced.Version, Body: &body, CollabGeneration: &current})
	if err != nil || live.CollabGeneration != 1 {
		t.Fatalf("live projection: %+v %v", live, err)
	}
	// Idempotent body saves and metadata-only edits retain the room.
	same, err := repo.UpdateContentDraft(ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: live.Version, Body: &body})
	if err != nil || same.CollabGeneration != 1 {
		t.Fatalf("same body: %+v %v", same, err)
	}
	title := "New title"
	metadata, err := repo.UpdateContentDraft(ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: same.Version, Title: &title})
	if err != nil || metadata.CollabGeneration != 1 {
		t.Fatalf("metadata: %+v %v", metadata, err)
	}
	if state, err := repo.LoadCollabState(ctx, fresh.Token, draft.ID); err != nil || !bytes.Equal(state, []byte{4, 5}) {
		t.Fatalf("live state reset: %v %v", state, err)
	}
}
