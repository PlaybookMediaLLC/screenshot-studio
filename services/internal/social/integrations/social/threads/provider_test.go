package threads

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

func setup(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	old, oldLoaded, oldPoll := graphURL, loadedDelay, pollInterval
	graphURL, loadedDelay, pollInterval = srv.URL, 0, 0
	t.Cleanup(func() { graphURL, loadedDelay, pollInterval = old, oldLoaded, oldPoll })
}

func TestAuthenticate(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth/access_token":
			if r.URL.Query().Get("code") != "c" {
				t.Errorf("code %q", r.URL.Query().Get("code"))
			}
			w.Write([]byte(`{"access_token":"short"}`))
		case "/access_token":
			if r.URL.Query().Get("access_token") != "short" {
				t.Errorf("exchange %s", r.URL.RawQuery)
			}
			w.Write([]byte(`{"access_token":"long"}`))
		case "/v1.0/me":
			w.Write([]byte(`{"id":"u1","username":"bob","threads_profile_picture_url":"pic"}`))
		}
	})
	got, err := New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "u1" || got.Name != "bob" || got.Username != "bob" || got.AccessToken != "long" || got.RefreshToken != "long" || got.Picture != "pic" || got.ExpiresIn < 57*86400 {
		t.Fatalf("%+v", got)
	}
}

func TestPostText(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1.0/u1/threads":
			if err := r.ParseMultipartForm(1 << 20); err != nil || r.FormValue("media_type") != "TEXT" || r.FormValue("text") != "hello" || r.FormValue("access_token") != "tok" {
				t.Errorf("form %v %v", err, r.MultipartForm)
			}
			w.Write([]byte(`{"id":"c1"}`))
		case "/v1.0/c1":
			w.Write([]byte(`{"status":"FINISHED"}`))
		case "/v1.0/u1/threads_publish":
			if r.URL.Query().Get("creation_id") != "c1" {
				t.Errorf("publish %s", r.URL.RawQuery)
			}
			w.Write([]byte(`{"id":"t1"}`))
		case "/v1.0/t1":
			w.Write([]byte(`{"id":"t1","permalink":"https://threads.net/t/1"}`))
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	})
	got, err := New().Post(context.Background(), "u1", "tok", []integrations.PostDetails{{ID: "p1", Message: "hello"}}, &ent.Integration{InternalID: "u1"})
	if err != nil {
		t.Fatal(err)
	}
	if got[0].PostID != "t1" || got[0].Status != "success" || got[0].ReleaseURL != "https://threads.net/t/1" {
		t.Fatalf("%+v", got)
	}
}

func TestExpiredTokenIsRefreshToken(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":{"message":"Error validating access token: Session has expired"}}`))
	})
	_, err := New().PostPending(context.Background(), "u1", "tok", []integrations.PostDetails{{ID: "p1", Message: "hello"}}, nil)
	if temporalx.FailureType(err) != temporalx.TypeRefreshToken || temporalx.FailureMessage(err) != "Threads access token expired" {
		t.Fatalf("%v", err)
	}
}

func TestContainerErrorIsBadBody(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ERROR","error_message":"UNKNOWN"}`))
	})
	_, err := New().CheckPostStatus(context.Background(), "tok", json.RawMessage(`{"step":"container","containerId":"c1"}`), &ent.Integration{})
	if temporalx.FailureMessage(err) != "Threads could not process the media, please check the media format and try again" {
		t.Fatalf("%v", err)
	}
}

func TestCheckPostStatusPublishedCompletes(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"PUBLISHED"}`))
	})
	profile := "bob"
	got, err := New().CheckPostStatus(context.Background(), "tok", json.RawMessage(`{"step":"container","containerId":"c1"}`), &ent.Integration{Profile: &profile})
	if err != nil || got.Status != "completed" || got.PostID != "c1" || got.ReleaseURL != "https://www.threads.net/@bob" {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestCarouselFlow(t *testing.T) {
	children := 0
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1.0/u1/threads":
			q := r.URL.Query()
			if q.Get("media_type") == "CAROUSEL" {
				if q.Get("children") != "m0,m1" {
					t.Errorf("children %q", q.Get("children"))
				}
				w.Write([]byte(`{"id":"car"}`))
				return
			}
			if q.Get("is_carousel_item") != "true" || q.Get("image_url") == "" {
				t.Errorf("child %s", r.URL.RawQuery)
			}
			w.Write([]byte(`{"id":"m` + string(rune('0'+children)) + `"}`))
			children++
		default:
			w.Write([]byte(`{"status":"FINISHED"}`))
		}
	})
	p := New()
	integration := &ent.Integration{InternalID: "u1"}
	res, err := p.PostPending(context.Background(), "u1", "tok", []integrations.PostDetails{{ID: "p1", Message: "m", Media: []integrations.MediaContent{{Path: "https://x/a.png"}, {Path: "https://x/b.png"}}}}, integration)
	if err != nil {
		t.Fatal(err)
	}
	check, err := p.CheckPostStatus(context.Background(), "tok", res[0].PendingData, integration)
	if err != nil || check.Status != "ready" {
		t.Fatalf("%+v %v", check, err)
	}
	fin, err := p.FinalizePost(context.Background(), "tok", check.PendingData, integration)
	if err != nil || fin.Status != "pending" || string(fin.PendingData) != `{"step":"container","containerId":"car"}` {
		t.Fatalf("%+v %v", fin, err)
	}
}

func TestCapitalize(t *testing.T) {
	if capitalize("vIEWS") != "Views" || number(12.0) != "12" {
		t.Fatal(capitalize("vIEWS"), number(12.0))
	}
}

func TestPostAnalyticsFailureIsNotEmptySuccess(t *testing.T) {
	setup(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":{"message":"permission denied"}}`))
	})
	if _, err := New().PostAnalytics(context.Background(), "u1", "tok", "p1", 0); err == nil {
		t.Fatal("permission failure was hidden")
	}
}

func TestPostAnalyticsPreservesZeroAndMissing(t *testing.T) {
	setup(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"data":[{"name":"views","values":[{"value":0}]},{"name":"likes","values":[]}]}`))
	})
	got, err := New().PostAnalytics(context.Background(), "u1", "tok", "p1", 0)
	if err != nil || len(got) != 1 || got[0].Data[0].Total != "0" {
		t.Fatalf("counters=%+v error=%v", got, err)
	}
}
