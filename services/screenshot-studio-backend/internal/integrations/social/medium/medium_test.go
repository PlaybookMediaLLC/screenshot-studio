package medium

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
)

func setup(t *testing.T, h http.HandlerFunc) {
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	old := apiURL
	apiURL = srv.URL
	t.Cleanup(func() { apiURL = old })
}

func TestPostPublication(t *testing.T) {
	var got map[string]any
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/publications/pub/posts" || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("request %s", r.URL.Path)
		}
		json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusCreated)
		io.WriteString(w, `{"data":{"id":"m1","url":"https://medium.com/p/m1"}}`)
	})
	settings := json.RawMessage(`{"title":"T","subtitle":"S","publication":"pub","tags":[{"value":"go","label":"Go"}]}`)
	res, err := New().Post(t.Context(), "u1", "tok", []integrations.PostDetails{{ID: "p1", Message: "body", Settings: settings}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got["publishStatus"] != "draft" || got["contentFormat"] != "markdown" || got["tags"].([]any)[0] != "go" || got["content"] != "body" {
		t.Fatalf("body %v", got)
	}
	if _, ok := got["canonicalUrl"]; ok {
		t.Fatal("canonicalUrl should be omitted")
	}
	if res[0].PostID != "m1" || res[0].ReleaseURL != "https://medium.com/p/m1" {
		t.Fatalf("%+v", res)
	}
}

func TestAuthenticateInvalid(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"errors":[{"message":"Token was invalid."}]}`)
	})
	// base64 of {"apiKey":"key"}
	_, err := New().Authenticate(t.Context(), integrations.AuthenticateParams{Code: "eyJhcGlLZXkiOiJrZXkifQ=="}, nil)
	if err == nil || err.Error() != "Invalid credentials" {
		t.Fatalf("err %v", err)
	}
}

func TestValidate(t *testing.T) {
	title := "T"
	got := (&MediumSettingsDto{Title: &title}).Validate()
	if len(got) != 4 || got[0] != "title must be longer than or equal to 2 characters" || got[1] != "subtitle should not be null or undefined" {
		t.Fatal(got)
	}
}
