package mastodon

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

type fakeInstance struct {
	*httptest.Server
	mu         sync.Mutex
	statuses   []http.Header
	forms      []map[string][]string
	mediaPolls int
}

func newFakeInstance(t *testing.T) *fakeInstance {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	f := &fakeInstance{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case r.URL.Path == "/oauth/token":
			_ = r.ParseMultipartForm(1 << 20)
			if r.FormValue("code") != "good" || r.FormValue("grant_type") != "authorization_code" || r.FormValue("scope") != "write:statuses profile write:media" {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"tok"}`))
		case r.URL.Path == "/api/v1/accounts/verify_credentials":
			if r.Header.Get("Authorization") != "Bearer tok" {
				w.WriteHeader(401)
				return
			}
			_, _ = w.Write([]byte(`{"id":"42","display_name":"","acct":"me@social","avatar":"https://a/b.png","username":"me"}`))
		case r.URL.Path == "/files/pic.png":
			_, _ = w.Write([]byte("PNGDATA"))
		case r.URL.Path == "/api/v1/media" && r.Method == http.MethodPost:
			body, _ := io.ReadAll(r.Body)
			if int64(len(body)) != r.ContentLength {
				w.WriteHeader(400)
				return
			}
			r.Body = io.NopCloser(strings.NewReader(string(body)))
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				w.WriteHeader(400)
				return
			}
			file, header, err := r.FormFile("file")
			if err != nil || header.Filename != "pic.png" {
				w.WriteHeader(400)
				return
			}
			data, _ := io.ReadAll(file)
			if string(data) != "PNGDATA" || r.FormValue("description") != "alt text" {
				w.WriteHeader(422)
				return
			}
			w.WriteHeader(202)
			_, _ = w.Write([]byte(`{"id":"m1"}`))
		case r.URL.Path == "/api/v1/media/m1":
			f.mediaPolls++
			if f.mediaPolls == 1 {
				w.WriteHeader(206)
				return
			}
			_, _ = w.Write([]byte(`{"id":"m1"}`))
		case r.URL.Path == "/api/v1/media/expired":
			w.WriteHeader(422)
			_, _ = w.Write([]byte(`{"error":"gone"}`))
		case r.URL.Path == "/api/v1/statuses":
			_ = r.ParseMultipartForm(1 << 20)
			if r.FormValue("status") == "disabled" {
				w.WriteHeader(403)
				_, _ = w.Write([]byte(`{"error":"Your login is currently disabled"}`))
				return
			}
			f.statuses = append(f.statuses, r.Header.Clone())
			f.forms = append(f.forms, r.MultipartForm.Value)
			_, _ = w.Write([]byte(`{"id":"s1"}`))
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(f.Close)
	pollInterval = time.Millisecond
	return f
}

func TestGenerateAuthURL(t *testing.T) {
	t.Setenv("MASTODON_URL", "https://example.social")
	t.Setenv("MASTODON_CLIENT_ID", "cid")
	t.Setenv("FRONTEND_URL", "https://app.example.com")
	res, err := New().GenerateAuthURL(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	want := "https://example.social/oauth/authorize?client_id=cid&response_type=code&redirect_uri=https%3A%2F%2Fapp.example.com%2Fintegrations%2Fsocial%2Fmastodon&scope=write:statuses+profile+write:media&state=" + res.State
	if res.URL != want || len(res.State) != 6 || len(res.CodeVerifier) != 10 {
		t.Fatalf("got %+v", res)
	}
	if got := EncodeURIComponent("a b!'()*~é"); got != "a%20b!'()*~%C3%A9" {
		t.Fatalf("EncodeURIComponent = %s", got)
	}
}

func TestAuthenticate(t *testing.T) {
	f := newFakeInstance(t)
	t.Setenv("MASTODON_URL", f.URL)
	auth, err := New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: "good"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if auth.ID != "42" || auth.Name != "me@social" || auth.AccessToken != "tok" || auth.RefreshToken != "" || auth.Username != "me" {
		t.Fatalf("unexpected %+v", auth)
	}
}

func TestDynamicPostWaitsForMediaThenPublishes(t *testing.T) {
	f := newFakeInstance(t)
	res, err := New().DynamicPost(context.Background(), "", "tok", f.URL, []integrations.PostDetails{{
		ID: "post1", Message: "hello",
		Media: []integrations.MediaContent{{Path: f.URL + "/files/pic.png", Alt: "alt text"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if res[0].PostID != "s1" || res[0].ReleaseURL != f.URL+"/statuses/s1" || res[0].Status != "completed" {
		t.Fatalf("unexpected %+v", res[0])
	}
	if f.mediaPolls != 2 || len(f.statuses) != 1 {
		t.Fatalf("polls=%d statuses=%d", f.mediaPolls, len(f.statuses))
	}
	if key := f.statuses[0].Get("Idempotency-Key"); !strings.HasPrefix(key, "post1-") || len(key) != len("post1-")+5 {
		t.Fatalf("idempotency key %q", key)
	}
	form := f.forms[0]
	if form["status"][0] != "hello" || form["visibility"][0] != "public" || form["media_ids[]"][0] != "m1" {
		t.Fatalf("form %v", form)
	}
}

func TestCheckAndFinalizeErrors(t *testing.T) {
	f := newFakeInstance(t)
	p := New()
	ctx := context.Background()

	pending, _ := json.Marshal(PendingData{URL: f.URL, MediaIDs: []string{"expired"}})
	_, err := p.CheckPostStatus(ctx, "tok", pending, nil)
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "The uploaded media expired before the post was published, please post again" {
		t.Fatalf("want expired bad_body, got %v", err)
	}

	pending, _ = json.Marshal(PendingData{URL: f.URL, Message: "disabled", MediaIDs: []string{}})
	_, err = p.FinalizePost(ctx, "tok", pending, nil)
	if temporalx.FailureType(err) != temporalx.TypeRefreshToken || temporalx.FailureMessage(err) != "Your login is currently disabled" {
		t.Fatalf("want refresh_token, got %v", err)
	}
}
