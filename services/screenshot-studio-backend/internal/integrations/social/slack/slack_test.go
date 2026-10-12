package slack

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

var (
	_ integrations.Provider              = (*Provider)(nil)
	_ integrations.Commenter             = (*Provider)(nil)
	_ integrations.NicknameChanger       = (*Provider)(nil)
	_ integrations.ProfilePictureChanger = (*Provider)(nil)
)

func fake(t *testing.T, handler http.HandlerFunc) *Provider {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	srv := httptest.NewServer(handler)
	old := apiBase
	apiBase = srv.URL
	t.Cleanup(func() { apiBase = old; srv.Close() })
	return New()
}

func TestPost(t *testing.T) {
	var posted string
	p := fake(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch r.URL.Path {
		case "/api/conversations.join":
			_, _ = io.WriteString(w, `{"ok":true}`)
		case "/api/chat.postMessage":
			posted = string(body)
			_, _ = io.WriteString(w, `{"ok":true,"ts":"1.2","channel":"C1"}`)
		case "/api/chat.getPermalink":
			if r.URL.Query().Get("message_ts") != "1.2" {
				w.WriteHeader(400)
			}
			_, _ = io.WriteString(w, `{"ok":true,"permalink":"https://x.slack.com/p12"}`)
		}
	})
	res, err := p.Post(context.Background(), "", "tok", []integrations.PostDetails{{
		ID: "p", Message: "hello", Settings: json.RawMessage(`{"channel":"C1"}`),
		Media: []integrations.MediaContent{{Path: "https://cdn/a.png"}},
	}}, &ent.Integration{Name: "Bot"})
	if err != nil {
		t.Fatal(err)
	}
	if res[0].PostID != "1.2" || res[0].ReleaseURL != "https://x.slack.com/p12" || res[0].Status != "posted" {
		t.Fatalf("%+v", res[0])
	}
	want := `{"channel":"C1","username":"Bot","icon_url":null,"blocks":[{"text":{"text":"hello","type":"mrkdwn"},"type":"section"},{"alt_text":"","image_url":"https://cdn/a.png","type":"image"}]}`
	if posted != want {
		t.Fatalf("posted %s", posted)
	}
}

func TestPostAPIErrors(t *testing.T) {
	answer := `{"ok":false,"error":"channel_not_found"}`
	p := fake(t, func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, answer) })
	post := []integrations.PostDetails{{Settings: json.RawMessage(`{"channel":"C1"}`)}}
	_, err := p.Post(context.Background(), "", "tok", post, &ent.Integration{})
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "channel_not_found" {
		t.Fatalf("bad body: %v", err)
	}
	answer = `{"ok":false,"error":"invalid_auth"}`
	if _, err = p.Post(context.Background(), "", "tok", post, &ent.Integration{}); temporalx.FailureType(err) != temporalx.TypeRefreshToken {
		t.Fatalf("refresh: %v", err)
	}
	answer = `{"ok":false,"error":"ratelimited","errors":["slow down"]}`
	if _, err = p.Comment(context.Background(), "", "1", "", "tok", post, &ent.Integration{}); err == nil || temporalx.FailureType(err) != "" || err.Error() != "ratelimited: slow down" {
		t.Fatalf("ratelimited: %v", err)
	}
}

func TestAuthenticate(t *testing.T) {
	t.Setenv("FRONTEND_URL", "http://localhost:4200")
	var redirect string
	p := fake(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/oauth.v2.access":
			_ = r.ParseForm()
			redirect = r.PostForm.Get("redirect_uri")
			_, _ = io.WriteString(w, `{"access_token":"xoxb","team":{"id":"T1"},"bot_user_id":"U1","scope":"channels:read,chat:write,users:read,groups:read,channels:join,chat:write.customize"}`)
		case "/api/users.info":
			_, _ = io.WriteString(w, `{"user":{"name":"bot","real_name":"Bot","profile":{"image_original":"pic"}}}`)
		}
	})
	auth, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c", Refresh: "r1"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if auth.ID != "T1" || auth.Name != "Bot" || auth.RefreshToken != "null" || auth.ExpiresIn < 3e9 {
		t.Fatalf("%+v", auth)
	}
	if redirect != "https://redirectmeto.com/http://localhost:4200/integrations/social/slack?refresh=r1" {
		t.Fatalf("redirect %s", redirect)
	}
	link, _ := p.GenerateAuthURL(context.Background(), nil)
	if !strings.Contains(link.URL, "redirect_uri=https%3A%2F%2Fredirectmeto.com%2Fhttp%3A%2F%2Flocalhost%3A4200%2Fintegrations%2Fsocial%2Fslack&scope=") {
		t.Fatalf("url %s", link.URL)
	}
}

func TestCheckValidity(t *testing.T) {
	msg, _ := New().CheckValidity(context.Background(), [][]integrations.ValidityMedia{{{Path: "a.png"}}, {{Path: "b.mp4"}}}, nil, nil)
	if msg != "No video support for Slack, only images" {
		t.Fatal(msg)
	}
}
