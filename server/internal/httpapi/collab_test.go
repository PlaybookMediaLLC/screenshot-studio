package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

type collabFake struct {
	fakeConfiguration
	documentName, token string
	organizations       []string
}

func (f *collabFake) CollabEpochs(_ context.Context, organizations []string) (int64, map[string]int64, error) {
	f.organizations = organizations
	counts := map[string]int64{}
	for i, id := range organizations {
		counts[id] = int64(i + 2)
	}
	return 7, counts, nil
}

func (f *collabFake) AuthorizeCollab(_ context.Context, token, documentName string) (*product.CollabGrant, error) {
	f.token, f.documentName = token, documentName
	return &product.CollabGrant{Access: "write", DraftID: "d1"}, nil
}

// Only the collaboration credential reaches the collab routes; the web's
// service token does not, and an unset credential fails closed.
func TestCollabRoutesTakeOnlyTheCollabCredential(t *testing.T) {
	request := func(handler http.Handler, bearer string) int {
		r := httptest.NewRequest(http.MethodPost, "/v1/collab/authorize",
			strings.NewReader(`{"documentName":"content-draft:d1","token":"t"}`))
		r.Header.Set("Authorization", "Bearer "+bearer)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Code
	}
	t.Setenv("COLLAB_SERVICE_TOKEN", "")
	unset := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", &collabFake{})
	if code := request(unset, ""); code != http.StatusServiceUnavailable {
		t.Fatalf("unset credential status=%d", code)
	}
	t.Setenv("COLLAB_SERVICE_TOKEN", "collab-secret")
	config := &collabFake{}
	handler := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", config)
	if code := request(handler, "secret"); code != http.StatusUnauthorized {
		t.Fatalf("web service token status=%d", code)
	}
	if code := request(handler, "collab-secret"); code != http.StatusOK || config.token != "t" || config.documentName != "content-draft:d1" {
		t.Fatalf("collab credential status=%d config=%+v", code, config)
	}
}

// The collaboration server polls the access counts with its own credential.
func TestCollabEpochsReportsGlobalAndWorkspaceCounts(t *testing.T) {
	t.Setenv("COLLAB_SERVICE_TOKEN", "collab-secret")
	config := &collabFake{}
	handler := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", config)
	r := httptest.NewRequest(http.MethodGet, "/v1/collab/epochs?organizationId=o1&organizationId=o2", nil)
	r.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("web service token status=%d", w.Code)
	}
	r.Header.Set("Authorization", "Bearer collab-secret")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if strings.Join(config.organizations, ",") != "o1,o2" {
		t.Fatalf("organizations=%v", config.organizations)
	}
	if body := strings.TrimSpace(w.Body.String()); body != `{"global":7,"organizations":{"o1":2,"o2":3}}` {
		t.Fatalf("body=%s", body)
	}
}
