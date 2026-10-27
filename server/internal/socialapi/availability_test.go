package socialapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func TestConnectionAvailabilityRequiresOriginalTenantAndCompleteResponse(t *testing.T) {
	t.Setenv("SOCIAL_API_KEY_TEST", "disposable-service-token")
	catalog := socialidentity.ConnectionAvailability{Version: 1}
	for _, id := range socialidentity.ConnectionProviders() {
		catalog.Providers = append(catalog.Providers, socialidentity.ProviderAvailability{Provider: id, Status: "disabled"})
	}
	calls, status := 0, 200
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("Authorization") != "disposable-service-token" {
			t.Error("wrong availability request")
		}
		switch r.URL.Path {
		case "/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"organization": map[string]string{"id": "original-go-org"}})
		case "/connection-availability":
			calls++
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(catalog)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := New(server.URL, server.Client(), nil)
	if result, err := client.ConnectionAvailability(context.Background(), "original-go-org", "SOCIAL_API_KEY_TEST"); err != nil || result.Validate() != nil || calls != 1 {
		t.Fatal("valid catalog unavailable")
	}
	if _, err := client.ConnectionAvailability(context.Background(), "different-go-org", "SOCIAL_API_KEY_TEST"); err == nil || calls != 1 {
		t.Fatal("foreign organization reached catalog")
	}
	if _, err := client.ConnectionAvailability(context.Background(), "original-go-org", "literal-token"); err == nil || calls != 1 {
		t.Fatal("literal token accepted")
	}
	for _, code := range []int{404, 503} {
		status = code
		if _, err := client.ConnectionAvailability(context.Background(), "original-go-org", "SOCIAL_API_KEY_TEST"); err == nil {
			t.Fatal("unavailable adapter assumed ready")
		}
	}
	status = 200
	catalog.Providers = catalog.Providers[:1]
	if _, err := client.ConnectionAvailability(context.Background(), "original-go-org", "SOCIAL_API_KEY_TEST"); err == nil {
		t.Fatal("partial catalog accepted")
	}
}
