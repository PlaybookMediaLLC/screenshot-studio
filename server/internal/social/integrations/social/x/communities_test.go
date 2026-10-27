package x

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCommunitySearchUsesAuthorizedEndpointAndPreservesDenial(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	t.Setenv("X_API_KEY", "fixture-key")
	t.Setenv("X_API_SECRET", "fixture-secret")
	denied := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/2/communities/search" || r.URL.Query().Get("query") != "design & art" || r.URL.Query().Get("max_results") != "25" || !strings.HasPrefix(r.Header.Get("Authorization"), "OAuth ") {
			t.Errorf("unexpected lookup: %s", r.URL)
		}
		if denied {
			w.WriteHeader(403)
			_, _ = w.Write([]byte(`{"detail":"Not authorized"}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"123","name":"Design"},{"id":"invalid","name":"Invalid"}]}`))
	}))
	defer server.Close()
	old := apiBase
	apiBase = server.URL
	defer func() { apiBase = old }()
	items, err := New().SearchCommunities(context.Background(), "token:secret", "design & art")
	if err != nil || len(items) != 1 || items[0].ID != "123" || items[0].Label != "Design" {
		t.Fatalf("items=%+v err=%v", items, err)
	}
	denied = true
	if _, err := New().SearchCommunities(context.Background(), "token:secret", "design & art"); err == nil {
		t.Fatal("provider denial became empty success")
	}
}
