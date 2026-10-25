package product

import (
	"errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"sync"
	"testing"
)

func TestDraftImportReceipts(t *testing.T) {
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	input := ContentDraftInput{ImportKey: "repeatable-import-1", Title: "Imported", PlainText: "hello"}
	var wg sync.WaitGroup
	ids := make(chan string, 8)
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			row, err := w.repo.CreateContentDraft(w.ctx, w.owner, input)
			if err == nil {
				ids <- row.ID
			}
			errs <- err
		}()
	}
	wg.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	id := ""
	for got := range ids {
		if id != "" && id != got {
			t.Fatal("concurrent import created duplicates")
		}
		id = got
	}
	changed := input
	changed.PlainText = "different"
	if _, err := w.repo.CreateContentDraft(w.ctx, w.owner, changed); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("changed retry accepted: %v", err)
	}
	if err := w.repo.DeleteContentDraft(w.ctx, w.owner, id); err != nil {
		t.Fatal(err)
	}
	if _, err := w.repo.CreateContentDraft(w.ctx, w.owner, input); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("deleted import recreated: %v", err)
	}
	foreign := newTestWorkspace(t)
	subscribe(t, foreign.ctx, foreign.repo, foreign.org, "pro")
	other, err := w.repo.CreateContentDraft(w.ctx, foreign.owner, input)
	if err != nil || other.ID == id {
		t.Fatalf("receipt crossed workspace: %v", err)
	}
}
