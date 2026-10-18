package whop

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

var (
	_ integrations.Provider  = (*Provider)(nil)
	_ integrations.Commenter = (*Provider)(nil)
)

func setup(t *testing.T, handler http.HandlerFunc) *Provider {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	old := apiURL
	apiURL = srv.URL
	t.Cleanup(func() { apiURL = old })
	p := New()
	p.RetryDelay = 0
	return p
}

func TestPostWithMedia(t *testing.T) {
	var srvURL string
	var forumBody map[string]any
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/media/pic.png" && r.Method == http.MethodHead:
			w.Header().Set("Content-Length", "3")
		case r.URL.Path == "/media/pic.png":
			w.Write([]byte("abc"))
		case r.URL.Path == "/api/v1/files" && r.Method == http.MethodPost:
			w.Write([]byte(`{"id":"file_1","upload_url":"` + srvURL + `/upload","upload_headers":{"x-test":"1"}}`))
		case r.URL.Path == "/upload":
			data, _ := io.ReadAll(r.Body)
			if string(data) != "abc" || r.Header.Get("x-test") != "1" || r.ContentLength != 3 {
				t.Errorf("bad upload %q %v", data, r.Header)
			}
		case r.URL.Path == "/api/v1/files/file_1":
			w.Write([]byte(`{"upload_status":"ready"}`))
		case r.URL.Path == "/api/v1/forum_posts":
			json.NewDecoder(r.Body).Decode(&forumBody)
			w.Write([]byte(`{"id":"post_9"}`))
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL)
		}
	})
	srvURL = apiURL
	out, err := p.Post(context.Background(), "int", "tok", []integrations.PostDetails{{
		ID: "p1", Message: "hello", Settings: json.RawMessage(`{"company":"c","experience":"exp_1","title":"T"}`),
		Media: []integrations.MediaContent{{Type: "image", Path: srvURL + "/media/pic.png"}},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].PostID != "post_9" || out[0].ReleaseURL != "https://whop.com/experiences/exp_1/post_9" || out[0].Status != "success" {
		t.Fatalf("unexpected %+v", out[0])
	}
	if forumBody["experience_id"] != "exp_1" || forumBody["title"] != "T" || forumBody["attachments"] == nil {
		t.Fatalf("unexpected body %v", forumBody)
	}
}

func TestPostClassifiesErrors(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"not_found"}`))
	})
	_, err := p.Post(context.Background(), "int", "tok", []integrations.PostDetails{{ID: "p1", Settings: json.RawMessage(`{"experience":"x"}`)}}, nil)
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "Forum or experience not found" {
		t.Fatalf("got %v", err)
	}
}

func TestAuthenticate(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/token":
			var body map[string]string
			json.NewDecoder(r.Body).Decode(&body)
			if body["code"] == "bad" {
				w.Write([]byte(`{"error":"invalid_grant","error_description":"expired"}`))
				return
			}
			w.Write([]byte(`{"access_token":"at","refresh_token":"rt"}`))
		case "/oauth/userinfo":
			if r.Header.Get("Authorization") != "Bearer at" {
				t.Error("missing bearer")
			}
			w.Write([]byte(`{"sub":"u1","preferred_username":"neo"}`))
		}
	})
	got, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c"}, nil)
	if err != nil || got.ID != "u1" || got.Name != "neo" || got.ExpiresIn != 3600 || got.RefreshToken != "rt" {
		t.Fatalf("got %+v %v", got, err)
	}
	_, err = p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "bad"}, nil)
	if err == nil || err.Error() != "Authentication failed: expired" {
		t.Fatalf("got %v", err)
	}
}

func TestValidate(t *testing.T) {
	empty := ""
	got := (&SettingsDTO{Experience: &empty}).Validate()
	want := []string{
		"company should not be null or undefined", "company must be a string",
		"company must be longer than or equal to 1 characters",
		"experience must be longer than or equal to 1 characters",
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got %v", got)
	}
}
