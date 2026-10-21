package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

func TestInstancePreviewRejectsUnauthorizedAndInvalidRequests(t *testing.T) {
	config := &fakeConfiguration{}
	handler := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", config)
	path := "/v1/social-instances/mastodon"
	for _, query := range []string{"", "?server=", "?server=127.0.0.1", "?server=https://user:secret@social.example", "?server=social.example&server=other.example", "?server=social.example&extra=value"} {
		response := configurationRequest(handler, http.MethodGet, path+query, "")
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", query, response.Code, response.Body.String())
		}
	}
	request := httptest.NewRequest(http.MethodGet, path+"?server=social.example", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status %d", response.Code)
	}
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("X-Organization-ID", "org-1")
	request.Header.Set("X-Principal-Kind", "api_key")
	request.Header.Set("X-API-Key-ID", "key-1")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("API key status %d", response.Code)
	}
	config.authorizationError = publishing.ErrForbidden
	response = configurationRequest(handler, http.MethodGet, path+"?server=social.example", "")
	if response.Code != http.StatusForbidden {
		t.Fatalf("forbidden member status %d", response.Code)
	}
}
