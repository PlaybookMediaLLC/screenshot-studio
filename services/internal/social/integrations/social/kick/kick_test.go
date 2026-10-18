package kick

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func setup(t *testing.T, h http.HandlerFunc) {
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	oldID, oldAPI := idURL, apiURL
	idURL, apiURL = srv.URL, srv.URL
	t.Cleanup(func() { idURL, apiURL = oldID, oldAPI })
}

func TestPost(t *testing.T) {
	var got map[string]any
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&got)
		io.WriteString(w, `{"data":{"message_id":"m1","is_sent":true}}`)
	})
	res, err := New().Post(t.Context(), "42", "tok", []integrations.PostDetails{{ID: "p1", Message: strings.Repeat("é", 600)}}, &ent.Integration{})
	if err != nil {
		t.Fatal(err)
	}
	if got["broadcaster_user_id"] != float64(42) || len([]rune(got["content"].(string))) != 500 || got["type"] != "user" {
		t.Fatalf("body %v", got)
	}
	if res[0].PostID != "m1" || res[0].Status != "posted" || res[0].ReleaseURL != "https://kick.com/channel" {
		t.Fatalf("%+v", res)
	}
}

func TestRefreshTokenUnauthorized(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.PostForm.Get("grant_type") != "refresh_token" || r.PostForm.Get("refresh_token") != "rt" {
			t.Errorf("form %v", r.PostForm)
		}
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"error":"invalid"}`)
	})
	_, err := New().RefreshToken(t.Context(), "rt")
	if temporalx.FailureType(err) != temporalx.TypeRefreshToken {
		t.Fatalf("err %v", err)
	}
}

func TestParseInt(t *testing.T) {
	if parseInt("12abc") != float64(12) || parseInt("abc") != nil {
		t.Fatal("parseInt")
	}
}
