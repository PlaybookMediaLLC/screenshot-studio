package twitch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
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
	t.Setenv("TWITCH_CLIENT_ID", "cid")
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	oldID, oldAPI, oldDelay := idURL, apiURL, postDelay
	idURL, apiURL, postDelay = srv.URL, srv.URL, 0
	t.Cleanup(func() { idURL, apiURL, postDelay = oldID, oldAPI, oldDelay })
	p := New()
	p.RetryDelay = 0
	return p
}

func TestCommentChatReply(t *testing.T) {
	var body map[string]string
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Client-Id") != "cid" {
			t.Error("client id")
		}
		json.NewDecoder(r.Body).Decode(&body)
		w.Write([]byte(`{"data":[{"message_id":"m1","is_sent":true}]}`))
	})
	profile := "streamer"
	out, err := p.Comment(context.Background(), "b1", "post1", "", "tok", []integrations.PostDetails{{ID: "c", Message: "hey"}}, &ent.Integration{Profile: &profile})
	if err != nil {
		t.Fatal(err)
	}
	if out[0].PostID != "m1" || out[0].Status != "posted" || out[0].ReleaseURL != "https://twitch.tv/streamer" {
		t.Fatalf("got %+v", out[0])
	}
	if body["reply_parent_message_id"] != "post1" || body["sender_id"] != "b1" {
		t.Fatalf("body %v", body)
	}
}

func TestAnnouncementAndErrors(t *testing.T) {
	var path string
	fail := false
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path + "?" + r.URL.RawQuery
		if fail {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"Unauthorized"}`))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	integration := &ent.Integration{ProviderIdentifier: "twitch"}
	out, err := p.Post(context.Background(), "b1", "tok", []integrations.PostDetails{{ID: "a", Message: "big", Settings: json.RawMessage(`{"messageType":"announcement"}`)}}, integration)
	if err != nil || out[0].Status != "posted" || len(out[0].PostID) != 10 || out[0].ReleaseURL != "https://twitch.tv/twitch" {
		t.Fatalf("got %+v %v", out, err)
	}
	if path != "/helix/chat/announcements?broadcaster_id=b1&moderator_id=b1" {
		t.Fatalf("path %s", path)
	}
	fail = true
	_, err = p.Post(context.Background(), "b1", "tok", []integrations.PostDetails{{ID: "a", Message: "x"}}, integration)
	if temporalx.FailureType(err) != temporalx.TypeRefreshToken {
		t.Fatalf("got %v", err)
	}
}
