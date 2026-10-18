package skool

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
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
	t.Setenv("JWT_SECRET", "secret")
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	old := apiURL
	apiURL = srv.URL
	t.Cleanup(func() { apiURL = old })
	p := New()
	p.RetryDelay = 0
	return p
}

func encrypted(t *testing.T) *ent.Integration {
	t.Helper()
	value, err := helpers.FixedEncryption(`{"client_id":"cid","auth_token":"tok"}`)
	if err != nil {
		t.Fatal(err)
	}
	return &ent.Integration{CustomInstanceDetails: &value}
}

func TestAuthenticate(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Cookie") != "auth_token=tok; client_id=cid" {
			t.Errorf("cookie %q", r.Header.Get("Cookie"))
		}
		w.Write([]byte(`{"id":"u1","first_name":"Ada","last_name":"L","name":"ada","metadata":{"picture_profile":"pic"}}`))
	})
	code := base64.StdEncoding.EncodeToString([]byte(`{"client_id":"cid","auth_token":"tok"}`))
	got, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: code}, nil)
	if err != nil || got.ID != "u1" || got.Name != "Ada L" || got.Picture != "pic" || got.Username != "ada" {
		t.Fatalf("got %+v %v", got, err)
	}
	if plain, _ := helpers.FixedDecryption(got.AccessToken); plain != `{"client_id":"cid","auth_token":"tok"}` {
		t.Fatalf("token %q", plain)
	}

	code = base64.StdEncoding.EncodeToString([]byte(`{"client_id":"cid"}`))
	_, err = p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: code}, nil)
	if err == nil || err.Error() != "Missing required cookies: auth_token" {
		t.Fatalf("got %v", err)
	}
	_, err = p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "!!"}, nil)
	if err == nil || err.Error() != "Invalid cookie data" {
		t.Fatalf("got %v", err)
	}
}

func TestPostWithMedia(t *testing.T) {
	var srvURL string
	var postBody map[string]any
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/m/a.png":
			w.Header().Set("Content-Type", "image/png")
			w.Header().Set("Content-Length", "3")
			if r.Method == http.MethodGet {
				w.Write([]byte("abc"))
			}
		case "/files":
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			if body["content_type"] != "image/png" || body["content_length"] != float64(3) || body["owner_id"] != "user1" {
				t.Errorf("file body %v", body)
			}
			w.Write([]byte(`{"write_url":"` + srvURL + `/s3","content_type":"image/png","acl":"public-read","file":{"id":"f1"}}`))
		case "/s3":
			data, _ := io.ReadAll(r.Body)
			if string(data) != "abc" || r.Header.Get("x-amz-acl") != "public-read" {
				t.Errorf("bad put")
			}
		case "/posts":
			json.NewDecoder(r.Body).Decode(&postBody)
			w.Write([]byte(`{"id":"p77","name":"my-post"}`))
		}
	})
	srvURL = apiURL
	out, err := p.Post(context.Background(), "user1", "", []integrations.PostDetails{{
		ID: "x", Message: "hi", Settings: json.RawMessage(`{"group":"g1","label":"none","title":"T"}`),
		Media: []integrations.MediaContent{{Path: srvURL + "/m/a.png"}},
	}}, encrypted(t))
	if err != nil {
		t.Fatal(err)
	}
	if out[0].ID != "p77" || out[0].PostID != "p77" || out[0].ReleaseURL != "https://www.skool.com/g1/my-post" {
		t.Fatalf("got %+v", out[0])
	}
	meta := postBody["metadata"].(map[string]any)
	if meta["attachments"] != "f1" || meta["labels"] != nil || meta["title"] != "T" || postBody["group_id"] != "g1" {
		t.Fatalf("body %v", postBody)
	}
}

func TestPostClassifiesErrors(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"must be admin or level 3"}`))
	})
	_, err := p.Post(context.Background(), "u", "", []integrations.PostDetails{{Settings: json.RawMessage(`{"group":"g"}`)}}, encrypted(t))
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "You can't post to this channel" {
		t.Fatalf("got %v", err)
	}
}

func TestLegacyJWTCookiesAndLabels(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/groups/g1":
			w.Write([]byte(`{"metadata":{"labels":"l1,l2"}}`))
		case "/labels/l1":
			w.Write([]byte(`{"id":1,"metadata":{"display_name":"One"}}`))
		case "/labels/l2":
			w.Write([]byte(`{"id":2,"metadata":{"display_name":"Two"}}`))
		}
	})
	token, _ := helpers.SignJWT(map[string]any{"client_id": "cid", "auth_token": "tok"})
	got := p.Label(context.Background(), "g1", &ent.Integration{CustomInstanceDetails: &token})
	if len(got) != 2 || got[0].ID != "1" || got[1].Name != "Two" {
		t.Fatalf("got %+v", got)
	}
}
