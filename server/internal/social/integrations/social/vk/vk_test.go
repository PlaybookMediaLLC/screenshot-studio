package vk

import (
	"context"
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

func setup(t *testing.T, handler http.HandlerFunc) (*Provider, string) {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	t.Setenv("VK_ID", "app1")
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	oldID, oldAPI := idURL, apiURL
	idURL, apiURL = srv.URL, srv.URL
	t.Cleanup(func() { idURL, apiURL = oldID, oldAPI })
	p := New()
	p.RetryDelay = 0
	return p, srv.URL
}

func TestPostWithPhoto(t *testing.T) {
	var srvURL string
	p, url := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/img/a.jpg":
			w.Write([]byte("jpg"))
		case "/method/photos.getWallUploadServer":
			if r.URL.Query().Get("owner_id") != "42" {
				t.Error("owner_id")
			}
			w.Write([]byte(`{"response":{"upload_url":"` + srvURL + `/upload"}}`))
		case "/upload":
			f, h, err := r.FormFile("photo")
			if err != nil || h.Filename != "a.jpg" || h.Header.Get("Content-Type") != "image/jpeg" {
				t.Errorf("upload %v %v", err, h)
				return
			}
			data, _ := io.ReadAll(f)
			if string(data) != "jpg" {
				t.Error("bytes")
			}
			w.Write([]byte(`{"photo":"[x]","server":123,"hash":"h"}`))
		case "/method/photos.saveWallPhoto":
			if r.FormValue("server") != "123" || r.FormValue("hash") != "h" {
				t.Error("save form")
			}
			w.Write([]byte(`{"response":[{"id":777}]}`))
		case "/method/wall.post":
			if r.FormValue("attachments") != "photo42_777" || r.FormValue("message") != "hello" || r.URL.Query().Get("client_id") != "app1" {
				t.Errorf("wall form %v", r.Form)
			}
			w.Write([]byte(`{"response":{"post_id":9}}`))
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	})
	srvURL = url
	out, err := p.Post(context.Background(), "42", "tok", []integrations.PostDetails{{
		ID: "p1", Message: "hello", Media: []integrations.MediaContent{{Path: srvURL + "/img/a.jpg"}},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].PostID != "9" || out[0].ReleaseURL != "https://vk.com/feed?w=wall42_9" {
		t.Fatalf("got %+v", out[0])
	}
}

func TestPostAPIErrors(t *testing.T) {
	code := "5"
	p, _ := setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"error":{"error_code":` + code + `,"error_msg":"User authorization failed"}}`))
	})
	_, err := p.Post(context.Background(), "1", "t", []integrations.PostDetails{{Message: "x"}}, nil)
	if temporalx.FailureType(err) != temporalx.TypeRefreshToken || temporalx.FailureMessage(err) != "User authorization failed" {
		t.Fatalf("got %v", err)
	}
	code = "6"
	_, err = p.Post(context.Background(), "1", "t", []integrations.PostDetails{{Message: "x"}}, nil)
	if err == nil || temporalx.FailureType(err) != "" {
		t.Fatalf("rate limit must stay retryable, got %v", err)
	}
	code = "100"
	_, err = p.Post(context.Background(), "1", "t", []integrations.PostDetails{{Message: "x"}}, nil)
	if temporalx.FailureType(err) != temporalx.TypeBadBody {
		t.Fatalf("got %v", err)
	}
}

func TestAuthenticate(t *testing.T) {
	p, _ := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth2/auth":
			if r.FormValue("device_id") != "dev" || r.FormValue("code") != "c0de" || !strings.HasSuffix(r.FormValue("redirect_uri"), "/integrations/social/vk") {
				t.Errorf("form %v", r.Form)
			}
			w.Write([]byte(`{"access_token":"at","refresh_token":"rt","expires_in":3600}`))
		case "/oauth2/user_info":
			w.Write([]byte(`{"user":{"user_id":"11","first_name":"Ivan","last_name":"P","avatar":"a"}}`))
		}
	})
	got, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c0de&&&&dev", CodeVerifier: "v"}, nil)
	if err != nil || got.ID != "11" || got.RefreshToken != "rt&&&&dev" || got.Username != "ivan" || got.ExpiresIn != 3600 {
		t.Fatalf("got %+v %v", got, err)
	}
}
