package instagramstandalone

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
)

// rewrite sends every request to the test server, recording the host it was
// meant for in X-Original-Host.
type rewrite struct {
	target *url.URL
	next   http.RoundTripper
}

func (r rewrite) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("X-Original-Host", req.URL.Host)
	req.URL.Scheme, req.URL.Host = r.target.Scheme, r.target.Host
	return r.next.RoundTrip(req)
}

func setup(t *testing.T, mux *http.ServeMux) *Provider {
	t.Helper()
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	target, _ := url.Parse(srv.URL)
	old := http.DefaultTransport
	http.DefaultTransport = rewrite{target: target, next: old}
	t.Cleanup(func() { http.DefaultTransport = old })
	p := New()
	p.ig.RetryDelay = 0
	return p
}

func TestPendingFlowOnInstagramHost(t *testing.T) {
	checks := 0
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v25.0/ig1/media", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Original-Host") != "graph.instagram.com" {
			t.Errorf("host %s", r.Header.Get("X-Original-Host"))
		}
		// audio is Facebook Login only
		if strings.Contains(r.URL.RawQuery, "audio_configuration") {
			t.Errorf("unexpected audio: %s", r.URL.RawQuery)
		}
		w.Write([]byte(`{"id":"c1"}`))
	})
	mux.HandleFunc("GET /v25.0/c1", func(w http.ResponseWriter, r *http.Request) {
		checks++
		if checks == 1 {
			w.Write([]byte(`{"status_code":"IN_PROGRESS"}`))
			return
		}
		w.Write([]byte(`{"status_code":"FINISHED"}`))
	})
	mux.HandleFunc("POST /v25.0/ig1/media_publish", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"id":"m1"}`))
	})
	mux.HandleFunc("GET /v25.0/m1", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"error":{"message":"(#100) boom","code":100}}`))
	})
	p := setup(t, mux)
	ctx := context.Background()
	profile := "me"
	integration := &ent.Integration{InternalID: "ig1", Profile: &profile}

	res, err := p.PostPending(ctx, "ig1", "tok", []integrations.PostDetails{{
		ID: "post", Settings: json.RawMessage(`{"post_type":"post","audio":{"id":"a1"}}`),
		Media: []integrations.MediaContent{{Path: "https://cdn/v.mp4"}},
	}}, integration)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(res[0].PendingData), `{"type":"graph.instagram.com","postType":"single"`) {
		t.Fatalf("%s", res[0].PendingData)
	}

	check, err := p.CheckPostStatus(ctx, "tok", res[0].PendingData, integration)
	if err != nil || check.Status != "pending" {
		t.Fatalf("%v %+v", err, check)
	}
	check, err = p.CheckPostStatus(ctx, "tok", check.PendingData, integration)
	if err != nil || check.Status != "ready" {
		t.Fatalf("%v %+v", err, check)
	}
	result, err := p.FinalizePost(ctx, "tok", check.PendingData, integration)
	if err != nil {
		t.Fatal(err)
	}
	// the permalink lookup failed: the live post still completes
	if result.Status != "completed" || result.PostID != "m1" || result.ReleaseURL != "https://www.instagram.com/me" {
		t.Fatalf("%+v", result)
	}
}

func TestAuthenticate(t *testing.T) {
	t.Setenv("INSTAGRAM_APP_ID", "app")
	t.Setenv("FRONTEND_URL", "http://localhost:4200")
	permissions := "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_insights"
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth/access_token", func(w http.ResponseWriter, r *http.Request) {
		if r.FormValue("redirect_uri") != "https://redirectmeto.com/http://localhost:4200/integrations/social/instagram-standalone" || r.FormValue("code") != "code1" {
			t.Errorf("form %v", r.Form)
		}
		json.NewEncoder(w).Encode(map[string]any{"access_token": "short", "user_id": 1, "permissions": permissions})
	})
	mux.HandleFunc("GET /access_token", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("access_token") != "short" {
			t.Errorf("exchange %s", r.URL.RawQuery)
		}
		w.Write([]byte(`{"access_token":"long","expires_in":5183944}`))
	})
	mux.HandleFunc("GET /v25.0/me", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"user_id":17841400000000001,"username":"acme","name":"Acme","profile_picture_url":"https://pic"}`))
	})
	p := setup(t, mux)
	details, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "code1"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if details.ID != "17841400000000001" || details.AccessToken != "long" || details.RefreshToken != "long" || details.Username != "acme" || details.ExpiresIn < 57*86400 {
		t.Fatalf("%+v", details)
	}

	permissions = "instagram_business_basic"
	_, err = p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "code1"}, nil)
	var scopesErr *integrations.NotEnoughScopes
	if !errors.As(err, &scopesErr) {
		t.Fatalf("expected NotEnoughScopes, got %v", err)
	}
}

func TestStandaloneSurface(t *testing.T) {
	var p integrations.Provider = New()
	if p.Functions() != nil || p.Tools() != nil {
		t.Fatal("standalone must not expose the instagram functions")
	}
	if _, ok := p.(integrations.PageInformationFetcher); ok {
		t.Fatal("standalone has no fetchPageInformation")
	}
	if got, _ := p.CheckValidity(context.Background(), [][]integrations.ValidityMedia{make([]integrations.ValidityMedia, 11)}, nil, nil); got != "" {
		t.Fatalf("standalone has no carousel cap: %q", got)
	}
}
