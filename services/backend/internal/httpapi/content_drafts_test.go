package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

type contentDraftFake struct {
	fakeConfiguration
	update product.ContentDraftUpdate
}

func (f *contentDraftFake) UpdateContentDraft(_ context.Context, _ product.Actor, _ string, input product.ContentDraftUpdate) (*product.ContentDraftRecord, error) {
	f.update = input
	return nil, &product.ContentDraftVersionConflictError{Current: 5}
}

// A stale draft write answers 409 with the version the client must load.
func TestStaleContentDraftWriteReturnsCurrentVersion(t *testing.T) {
	config := &contentDraftFake{}
	handler := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", config)
	response := configurationRequest(handler, http.MethodPatch, "/v1/content-drafts/c123456789012345678901234",
		`{"baseVersion":3,"title":"New"}`)
	var body struct {
		Code           string `json:"code"`
		CurrentVersion int    `json:"currentVersion"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusConflict || body.Code != "content_draft_version_conflict" || body.CurrentVersion != 5 ||
		config.update.BaseVersion != 3 || config.update.Title == nil || *config.update.Title != "New" {
		t.Fatalf("status=%d body=%+v update=%+v", response.Code, body, config.update)
	}
	if invalid := configurationRequest(handler, http.MethodGet, "/v1/content-drafts/not-an-id!", ""); invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid draft ID status=%d", invalid.Code)
	}
	if unknown := configurationRequest(handler, http.MethodPatch, "/v1/content-drafts/c123456789012345678901234",
		`{"baseVersion":3,"organizationId":"other"}`); unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status=%d", unknown.Code)
	}
}
