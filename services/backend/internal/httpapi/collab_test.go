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
