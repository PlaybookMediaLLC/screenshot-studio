package lemmy

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"go.temporal.io/sdk/temporal"
)

type fakeLemmy struct {
	*httptest.Server
	mu    sync.Mutex
	posts []map[string]any
}

func newFakeLemmy(t *testing.T) *fakeLemmy {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	t.Setenv("JWT_SECRET", "secret")
	f := &fakeLemmy{}
	nextID := 100
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		body, _ := io.ReadAll(r.Body)
		var in map[string]any
		_ = json.Unmarshal(body, &in)
		switch r.URL.Path {
		case "/api/v3/user/login":
			switch in["password"] {
			case "pw":
				_, _ = w.Write([]byte(`{"jwt":"j"}`))
			case "unauthorized":
				w.WriteHeader(401)
			default:
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"error":"incorrect_login"}`))
			}
		case "/api/v3/user":
			if r.Header.Get("Authorization") != "Bearer j" || r.URL.Query().Get("username") != "me" {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"person_view":{"person":{"id":7,"name":"me","display_name":null,"avatar":"https://a/b.png"}}}`))
		case "/api/v3/post":
			if in["community_id"] == 99.0 {
				w.WriteHeader(404)
				_, _ = w.Write([]byte(`{"error":"couldnt_find_community"}`))
				return
			}
			f.posts = append(f.posts, in)
			nextID++
			_, _ = w.Write([]byte(`{"post_view":{"post":{"id":` + itoa(nextID) + `}}}`))
		case "/api/v3/comment":
			f.posts = append(f.posts, in)
			_, _ = w.Write([]byte(`{"comment_view":{"comment":{"id":` + itoa(int(in["post_id"].(float64))+1000) + `}}}`))
		case "/api/v3/search":
			// "" (no word) lists every community; "undefined" would be a real search
			q := r.URL.Query()
			if !q.Has("q") || (q.Get("q") != "go lang" && q.Get("q") != "") || q.Get("type_") != "Communities" {
				w.WriteHeader(400)
				return
			}
			_, _ = w.Write([]byte(`{"communities":[{"community":{"id":3,"title":"Golang"}}]}`))
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(f.Close)
	return f
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

func (f *fakeLemmy) integration(t *testing.T, password string) *ent.Integration {
	details, _ := json.Marshal(credentials{Service: f.URL, Identifier: "me", Password: password})
	encrypted, err := helpers.FixedEncryption(string(details))
	if err != nil {
		t.Fatal(err)
	}
	return &ent.Integration{CustomInstanceDetails: &encrypted}
}

func code(f *fakeLemmy, password string) string {
	data, _ := json.Marshal(credentials{Service: f.URL, Identifier: "me", Password: password})
	return base64.StdEncoding.EncodeToString(data)
}

func TestAuthenticate(t *testing.T) {
	f := newFakeLemmy(t)
	auth, err := New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: code(f, "pw")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if auth.ID != "7" || auth.Name != "me" || auth.AccessToken != "j" || auth.RefreshToken != "j" || auth.Username != "me" || auth.Picture != "https://a/b.png" {
		t.Fatalf("unexpected %+v", auth)
	}
	_, err = New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: code(f, "unauthorized")}, nil)
	if msg, ok := err.(integrations.AuthMessage); !ok || msg != "Invalid credentials" {
		t.Fatalf("want Invalid credentials, got %v", err)
	}
}

func TestPostToCommunitiesAndComment(t *testing.T) {
	f := newFakeLemmy(t)
	p := New()
	settings := `{"subreddit":[{"value":{"subreddit":"golang","id":"5","title":"First","url":"example.com"}},{"value":{"subreddit":"rust","id":"6","title":"Second"}}]}`
	res, err := p.Post(context.Background(), "", "", []integrations.PostDetails{{
		ID: "p1", Message: "body", Settings: json.RawMessage(settings),
		Media: []integrations.MediaContent{{Path: "https://cdn/x.png"}},
	}}, f.integration(t, "pw"))
	if err != nil {
		t.Fatal(err)
	}
	if res[0].PostID != "101,102" || res[0].ReleaseURL != f.URL+"/post/101,"+f.URL+"/post/102" || res[0].Status != "published" {
		t.Fatalf("unexpected %+v", res[0])
	}
	first := f.posts[0]
	if first["community_id"] != 5.0 || first["name"] != "First" || first["url"] != "https://example.com" || first["custom_thumbnail"] != "https://cdn/x.png" || first["nsfw"] != false {
		t.Fatalf("unexpected body %v", first)
	}
	if _, ok := f.posts[1]["url"]; ok {
		t.Fatalf("url should be omitted: %v", f.posts[1])
	}

	res, err = p.Comment(context.Background(), "", "101,102", "", "", []integrations.PostDetails{{ID: "c1", Message: "hi"}}, f.integration(t, "pw"))
	if err != nil {
		t.Fatal(err)
	}
	if res[0].PostID != "1101,1102" || res[0].ReleaseURL != f.URL+"/comment/1101,"+f.URL+"/comment/1102" {
		t.Fatalf("unexpected %+v", res[0])
	}
}

func TestErrors(t *testing.T) {
	f := newFakeLemmy(t)
	p := New()
	p.RetryDelay = time.Millisecond

	// the rebuilt login failure never carries the stored password
	_, _, err := p.getJWTAndService(context.Background(), f.integration(t, "secret-password"))
	if temporalx.FailureType(err) != temporalx.TypeRefreshToken || temporalx.FailureMessage(err) != "Lemmy session is no longer valid, please reconnect the channel" {
		t.Fatalf("want refresh_token, got %v", err)
	}
	var app *temporal.ApplicationError
	var d temporalx.FailureDetails
	if !errors.As(err, &app) || app.Details(&d) != nil || strings.Contains(d.Body+d.JSON, "secret-password") || d.Body != "{}" || !strings.Contains(d.JSON, "incorrect_login") {
		t.Fatalf("details %+v", d)
	}

	_, err = p.Post(context.Background(), "", "", []integrations.PostDetails{{ID: "p", Settings: json.RawMessage(`{"subreddit":[{"value":{"id":"99","title":"x"}}]}`)}}, f.integration(t, "pw"))
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "The selected Lemmy community no longer exists, please pick another one" {
		t.Fatalf("want bad_body, got %v", err)
	}
}

func TestSubreddits(t *testing.T) {
	f := newFakeLemmy(t)
	out, err := New().Subreddits(context.Background(), json.RawMessage(`{"word":"go lang"}`), f.integration(t, "pw"))
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(out)
	if string(data) != `[{"title":"Golang","name":"Golang","id":3}]` {
		t.Fatalf("got %s", data)
	}

	// No word: search with an empty q, not the literal "undefined".
	if _, err := New().Subreddits(context.Background(), json.RawMessage(`{}`), f.integration(t, "pw")); err != nil {
		t.Fatalf("missing word: %v", err)
	}
}

func TestValidate(t *testing.T) {
	var dto SettingsDTO
	if got := dto.Validate(); !reflect.DeepEqual(got, []string{"subreddit must contain at least 1 elements"}) {
		t.Fatalf("empty: %v", got)
	}
	_ = json.Unmarshal([]byte(`{"subreddit":[{"value":{"subreddit":"g","id":"1","url":"not a url"}},{}]}`), &dto)
	want := []string{
		"subreddit must be longer than or equal to 2 characters",
		"title should not be null or undefined",
		"title must be longer than or equal to 2 characters",
		"title must be a string",
		"url must be a URL address",
		"value should not be null or undefined",
	}
	if got := dto.Validate(); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v", got)
	}
	dto = SettingsDTO{}
	_ = json.Unmarshal([]byte(`{"subreddit":[{"value":{"subreddit":"golang","id":"1","title":"ok","url":"https://lemmy.world/c/x"}}]}`), &dto)
	if got := dto.Validate(); len(got) != 0 {
		t.Fatalf("valid dto: %v", got)
	}
}

func TestCheckValidity(t *testing.T) {
	msg, _ := New().CheckValidity(context.Background(), [][]integrations.ValidityMedia{{{Path: "a.mp4"}}}, nil, nil)
	if msg != "You can set only one picture for a cover" {
		t.Fatalf("got %q", msg)
	}
	msg, _ = New().CheckValidity(context.Background(), [][]integrations.ValidityMedia{{{Path: "a.jpg"}}}, nil, nil)
	if msg != "" {
		t.Fatalf("got %q", msg)
	}
}
