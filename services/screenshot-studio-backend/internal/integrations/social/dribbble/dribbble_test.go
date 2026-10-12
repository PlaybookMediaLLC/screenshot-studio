package dribbble

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

func setup(t *testing.T, shots http.HandlerFunc) string {
	mux := http.NewServeMux()
	mux.HandleFunc("/img.png", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "PNGDATA") })
	mux.HandleFunc("/v2/shots", shots)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	old := apiURL
	apiURL = srv.URL
	t.Cleanup(func() { apiURL = old })
	return srv.URL
}

func post(t *testing.T, base string) ([]integrations.PostResponse, error) {
	return New().Post(t.Context(), "id", "tok", []integrations.PostDetails{{
		ID: "p1", Message: "desc", Settings: json.RawMessage(`{"title":"Shot"}`),
		Media: []integrations.MediaContent{{Type: "image", Path: base + "/img.png"}},
	}}, nil)
}

func TestPost(t *testing.T) {
	base := setup(t, func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
		}
		file, header, _ := r.FormFile("image")
		data, _ := io.ReadAll(file)
		if string(data) != "PNGDATA" || header.Filename != "img.png" || header.Header.Get("Content-Type") != "image/png" ||
			r.FormValue("title") != "Shot" || r.FormValue("description") != "desc" || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("bad upload %v %v", header.Header, r.MultipartForm.Value)
		}
		w.Header().Set("Location", "https://api.dribbble.com/v2/shots/123")
		w.WriteHeader(http.StatusAccepted)
	})
	res, err := post(t, base)
	if err != nil {
		t.Fatal(err)
	}
	if res[0].PostID != "123" || res[0].ReleaseURL != "https://dribbble.com/shots/123" || res[0].Status != "completed" {
		t.Fatalf("%+v", res)
	}
}

func TestPostRejected(t *testing.T) {
	base := setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		io.WriteString(w, `{"message":"Validation failed"}`)
	})
	_, err := post(t, base)
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "Validation failed" {
		t.Fatalf("err %v", err)
	}
}

func TestValidate(t *testing.T) {
	if got := (&DribbbleDto{}).Validate(); len(got) != 3 || got[1] != "Title is required" {
		t.Fatal(got)
	}
	title, team := "x", "not a url"
	if got := (&DribbbleDto{Title: &title, Team: &team}).Validate(); len(got) != 1 || got[0] != "team must be a URL address" {
		t.Fatal(got)
	}
	team = "https://dribbble.com/team"
	if got := (&DribbbleDto{Title: &title, Team: &team}).Validate(); len(got) != 0 {
		t.Fatal(got)
	}
}

// Dribbble tokens never expire and have no refresh grant: refreshToken must
// not call any token endpoint (upstream called Pinterest's sandbox) and
// returns the empty details the refresh flow treats as "refresh needed".
func TestRefreshTokenIsNoop(t *testing.T) {
	t.Setenv("PINTEREST_CLIENT_ID", "should-not-be-used")
	got, err := New().RefreshToken(t.Context(), "anything")
	if err != nil || got == nil || got.AccessToken != "" || got.RefreshToken != "" || got.ID != "" || got.ExpiresIn != 0 {
		t.Fatalf("got %+v, %v", got, err)
	}
}
