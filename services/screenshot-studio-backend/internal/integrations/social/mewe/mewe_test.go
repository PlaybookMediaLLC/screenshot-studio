package mewe

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
)

func setup(t *testing.T, h http.HandlerFunc) {
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	t.Setenv("MEWE_HOST", srv.URL)
	t.Setenv("MEWE_APP_ID", "app")
	t.Setenv("MEWE_API_KEY", "key")
}

func TestPostTimeline(t *testing.T) {
	var got map[string]any
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/dev/me/post" || r.Header.Get("X-App-Id") != "app" || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("unexpected request %s %v", r.URL.Path, r.Header)
		}
		json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusNoContent)
	})
	profile := "jane"
	res, err := New().Post(t.Context(), "id", "tok", []integrations.PostDetails{{ID: "p1", Message: "hi", Settings: json.RawMessage(`{"postType":"timeline"}`)}}, &ent.Integration{Profile: &profile})
	if err != nil {
		t.Fatal(err)
	}
	if got["text"] != "hi" || res[0].ReleaseURL != "https://mewe.com/jane/posts" || res[0].Status != "success" || len(res[0].PostID) != 12 {
		t.Fatalf("got %v %+v", got, res)
	}
}

func TestPostForbidden(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/dev/group/g1/post" {
			t.Errorf("path %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusForbidden)
		io.WriteString(w, "Forbidden")
	})
	_, err := New().Post(t.Context(), "id", "tok", []integrations.PostDetails{{ID: "p1", Message: "hi", Settings: json.RawMessage(`{"group":"g1"}`)}}, &ent.Integration{})
	if err == nil || err.Error() != "Insufficient permissions for this action" {
		t.Fatalf("err %v", err)
	}
}

func TestAuthenticate(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/dev/token":
			if r.URL.Query().Get("loginRequestToken") != "code" {
				t.Errorf("query %s", r.URL.RawQuery)
			}
			io.WriteString(w, `{"apiToken":"api"}`)
		case "/api/dev/me":
			io.WriteString(w, `{"userId":"u1","firstName":"Jane","lastName":"Doe","handle":"jd"}`)
		}
	})
	details, err := New().Authenticate(t.Context(), integrations.AuthenticateParams{Code: "code"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if details.ID != "u1" || details.Name != "Jane Doe" || details.AccessToken != "api" || details.Username != "jd" || details.ExpiresIn < 2500000 {
		t.Fatalf("%+v", details)
	}
	if _, err := New().Authenticate(t.Context(), integrations.AuthenticateParams{}, nil); err == nil || !strings.Contains(err.Error(), "No login request token") {
		t.Fatalf("err %v", err)
	}
}

func TestValidate(t *testing.T) {
	empty := ""
	got := (&MeweDto{PostType: "group", Group: &empty}).Validate()
	if len(got) != 1 || got[0] != "group must be longer than or equal to 1 characters" {
		t.Fatal(got)
	}
	if got := (&MeweDto{}).Validate(); len(got) != 1 || got[0] != "postType must be one of the following values: timeline, group" {
		t.Fatal(got)
	}
}
