package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

type projectFake struct {
	fakeConfiguration
	write product.ProjectDocumentWrite
}

func (f *projectFake) UpdateProjectDocument(_ context.Context, _ product.Actor, _ string, input product.ProjectDocumentWrite) (*product.ProjectWriteResult, error) {
	f.write = input
	return nil, &product.ProjectRevisionConflictError{Current: 7}
}

// A stale document write answers 409 with the revision the client must load.
func TestStaleProjectWriteReturnsCurrentRevision(t *testing.T) {
	config := &projectFake{}
	handler := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", config)
	response := configurationRequest(handler, http.MethodPut, "/v1/projects/c123456789012345678901234/document",
		`{"baseRevision":3,"document":{"version":2,"image":{"src":null}}}`)
	var body struct {
		Code            string `json:"code"`
		CurrentRevision int    `json:"currentRevision"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusConflict || body.Code != "project_revision_conflict" || body.CurrentRevision != 7 ||
		config.write.BaseRevision != 3 {
		t.Fatalf("status=%d body=%+v write=%+v", response.Code, body, config.write)
	}
	if invalid := configurationRequest(handler, http.MethodGet, "/v1/projects/not-an-id", ""); invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid project ID status=%d", invalid.Code)
	}
}
