package reddit

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func setup(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	oldWWW, oldOAuth := wwwURL, oauthURL
	wwwURL, oauthURL = srv.URL, srv.URL
	t.Cleanup(func() { wwwURL, oauthURL = oldWWW, oldOAuth })
}

func TestAuthenticate(t *testing.T) {
	t.Setenv("REDDIT_CLIENT_ID", "id")
	t.Setenv("REDDIT_CLIENT_SECRET", "secret")
	t.Setenv("FRONTEND_URL", "https://app.test")
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/access_token":
			if r.Header.Get("Authorization") != "Basic aWQ6c2VjcmV0" {
				t.Errorf("auth header %q", r.Header.Get("Authorization"))
			}
			body, _ := io.ReadAll(r.Body)
			form, _ := url.ParseQuery(string(body))
			if form.Get("code") != "c" || form.Get("redirect_uri") != "https://app.test/integrations/social/reddit" {
				t.Errorf("form %s", body)
			}
			w.Write([]byte(`{"access_token":"at","refresh_token":"rt","expires_in":3600,"scope":"read identity submit flair"}`))
		case "/api/v1/me":
			w.Write([]byte(`{"name":"bob","id":"u1","icon_img":"https://img/x.png?a=b"}`))
		}
	})
	got, err := New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "u1" || got.Username != "bob" || got.AccessToken != "at" || got.RefreshToken != "rt" || got.Picture != "https://img/x.png" || got.ExpiresIn != 3600 {
		t.Fatalf("%+v", got)
	}
}

func TestPostSelf(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/submit" {
			t.Fatalf("unexpected %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(body))
		if form.Get("sr") != "golang" || form.Get("kind") != "self" || form.Get("title") != "Hello" || form.Get("flair_id") != "f1" || form.Get("text") != "msg" {
			t.Errorf("form %s", body)
		}
		w.Write([]byte(`{"json":{"errors":[],"data":{"id":"abc","url":"https://www.reddit.com/r/golang/comments/abc"}}}`))
	})
	settings := `{"subreddit":[{"value":{"subreddit":"/r/GoLang/","title":"Hello","type":"self","is_flair_required":true,"flair":{"id":"f1","name":"F"}}}]}`
	got, err := New().Post(context.Background(), "i", "tok", []integrations.PostDetails{{ID: "p1", Message: "msg", Settings: json.RawMessage(settings)}}, &ent.Integration{})
	if err != nil {
		t.Fatal(err)
	}
	if got[0].PostID != "abc" || got[0].Status != "published" || got[0].ReleaseURL != "https://www.reddit.com/r/golang/comments/abc" {
		t.Fatalf("%+v", got)
	}
}

func TestFinalizeRejected(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"json":{"errors":[["SUBREDDIT_NOEXIST","that subreddit doesn't exist","sr"]]}}`))
	})
	data := `{"subreddits":[{"value":{"subreddit":"r/nope","title":"t","type":"self"}}],"message":"m","cursor":0,"results":[],"armed":{"sr":"nope","title":"t","armedAt":1,"media":false,"submitted":false,"lookups":0}}`
	_, err := New().FinalizePost(context.Background(), "tok", json.RawMessage(data), nil)
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "Reddit rejected the post to r/nope: that subreddit doesn't exist" {
		t.Fatalf("%v", err)
	}
}

func TestFinalizeRateLimitDisarms(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"json":{"errors":[["RATELIMIT","slow down","ratelimit"]]}}`))
	})
	data := `{"subreddits":[{"value":{"subreddit":"r/a","title":"t","type":"self"}}],"message":"m","cursor":0,"results":[],"armed":{"sr":"a","title":"t","armedAt":1,"media":false,"submitted":false,"lookups":0}}`
	got, err := New().FinalizePost(context.Background(), "tok", json.RawMessage(data), nil)
	if err != nil || got.Status != "pending" || strings.Contains(string(got.PendingData), "armed") {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestCheckPostStatusRecoversFromListing(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/user/bob/submitted" {
			t.Fatalf("unexpected %s", r.URL.Path)
		}
		w.Write([]byte(`{"data":{"children":[{"data":{"id":"x1","subreddit":"Pics","title":"t","created_utc":9999999999,"permalink":"/r/pics/comments/x1"}}]}}`))
	})
	profile := "bob"
	data := `{"subreddits":[{"value":{"subreddit":"r/pics","title":"t","type":"media"}}],"message":"m","cursor":0,"results":[],"armed":{"sr":"pics","title":"t","armedAt":1000,"media":true,"submitted":true,"lookups":0}}`
	got, err := New().CheckPostStatus(context.Background(), "tok", json.RawMessage(data), &ent.Integration{Profile: &profile})
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "completed" || got.PostID != "x1" || got.ReleaseURL != "https://www.reddit.com/r/pics/comments/x1" {
		t.Fatalf("%+v", got)
	}
}

func TestCheckPostStatusSubmittedGrace(t *testing.T) {
	data := `{"subreddits":[{"value":{"subreddit":"r/pics","title":"t","type":"media"}}],"message":"m","cursor":0,"results":[],"armed":{"sr":"pics","title":"t","armedAt":1000,"media":true,"submitted":true,"lookups":9}}`
	got, err := New().CheckPostStatus(context.Background(), "tok", json.RawMessage(data), &ent.Integration{})
	if err != nil || got.Status != "completed" || got.ReleaseURL != "https://www.reddit.com/r/pics" || got.PostID != "" {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestSubredditsExactFirst(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/r/golang/about":
			w.Write([]byte(`{"kind":"t5","data":{"subreddit_type":"public","submission_type":"any","title":"Go","url":"/r/golang/","id":"g"}}`))
		case "/subreddits/search":
			if r.URL.Query().Get("q") != "golang" {
				t.Errorf("q=%q", r.URL.Query().Get("q"))
			}
			w.Write([]byte(`{"data":{"children":[{"data":{"subreddit_type":"public","submission_type":"any","title":"Go","url":"/r/golang/","id":"g"}},{"data":{"subreddit_type":"public","submission_type":"self","title":"Go2","url":"/r/go2/","id":"h"}},{"data":{"subreddit_type":"private","title":"P","url":"/r/p/","id":"p"}}]}}`))
		}
	})
	got, err := New().Subreddits(context.Background(), "tok", json.RawMessage(`{"word":"https://reddit.com/r/golang"}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != "g" || got[1].ID != "h" {
		t.Fatalf("%+v", got)
	}
}

func TestCheckValidity(t *testing.T) {
	p := New()
	msg, _ := p.CheckValidity(context.Background(), [][]integrations.ValidityMedia{{}}, json.RawMessage(`{"subreddit":[{"value":{"type":"media"}}]}`), nil)
	if msg != "When posting a media post, you must attached exactly one media file." {
		t.Fatal(msg)
	}
	msg, _ = p.CheckValidity(context.Background(), [][]integrations.ValidityMedia{{{Path: "a.mp4"}}}, nil, nil)
	if msg != "You must attach a thumbnail to your video post." {
		t.Fatal(msg)
	}
}

func TestValidate(t *testing.T) {
	cases := map[string]string{
		`{}`:                 "subreddit must contain at least 1 elements",
		`{"subreddit":[{}]}`: "value should not be null or undefined",
		`{"subreddit":[{"value":{"title":"ab","type":"self","is_flair_required":false}}]}`:                                               "subreddit should not be null or undefined",
		`{"subreddit":[{"value":{"subreddit":"r/a","title":"ab","type":"x","is_flair_required":false}}]}`:                                "type must be one of the following values: self, link, media",
		`{"subreddit":[{"value":{"subreddit":"r/a","title":"ab","type":"link","url":"nope","is_flair_required":false}}]}`:                "Invalid URL",
		`{"subreddit":[{"value":{"subreddit":"r/a","title":"ab","type":"self","is_flair_required":true}}]}`:                              "flair should not be null or undefined",
		`{"subreddit":[{"value":{"subreddit":"r/a","title":"ab","type":"link","url":"https://www.x.com/a","is_flair_required":false}}]}`: "",
	}
	for input, want := range cases {
		var dto RedditSettingsDTO
		if err := json.Unmarshal([]byte(input), &dto); err != nil {
			t.Fatal(err)
		}
		got := ""
		if msgs := dto.Validate(); len(msgs) > 0 {
			got = msgs[0]
		}
		if got != want {
			t.Errorf("%s: got %q want %q", input, got, want)
		}
	}
}

func TestFinalizeMediaUploadsToS3(t *testing.T) {
	var host string
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/media/a.png":
			http.ServeContent(w, r, "a.png", time.Time{}, strings.NewReader("PNGDATA"))
		case "/api/media/asset":
			if err := r.ParseMultipartForm(1 << 20); err != nil || r.FormValue("filepath") != "a.png" || r.FormValue("mimetype") != "image/png" {
				t.Errorf("asset form %v", err)
			}
			w.Write([]byte(`{"args":{"action":"//` + host + `/s3","fields":[{"name":"key","value":"k1"}]}}`))
		case "/s3":
			if r.ContentLength <= 0 {
				t.Errorf("content length %d", r.ContentLength)
			}
			if err := r.ParseMultipartForm(1 << 20); err != nil || r.FormValue("key") != "k1" {
				t.Fatalf("s3 form %v", err)
			}
			f, _, _ := r.FormFile("file")
			data, _ := io.ReadAll(f)
			if string(data) != "PNGDATA" {
				t.Errorf("file %q", data)
			}
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`<PostResponse><Location>https://cdn/k1</Location></PostResponse>`))
		case "/api/submit":
			body, _ := io.ReadAll(r.Body)
			form, _ := url.ParseQuery(string(body))
			if form.Get("url") != "https://cdn/k1" || form.Get("kind") != "image" {
				t.Errorf("submit %s", body)
			}
			w.Write([]byte(`{"json":{"errors":[],"data":{"websocket_url":"wss://x"}}}`))
		}
	})
	host = strings.TrimPrefix(oauthURL, "http://")
	old := uploadScheme
	uploadScheme = "http:"
	t.Cleanup(func() { uploadScheme = old })

	data := `{"subreddits":[{"value":{"subreddit":"r/pics","title":"t","type":"media"}}],"message":"m","mediaPath":"` + oauthURL + `/media/a.png","cursor":0,"results":[],"armed":{"sr":"pics","title":"t","armedAt":1,"media":true,"submitted":false,"lookups":0}}`
	got, err := New().FinalizePost(context.Background(), "tok", json.RawMessage(data), nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "pending" || !strings.Contains(string(got.PendingData), `"submitted":true`) {
		t.Fatalf("%+v %s", got, got.PendingData)
	}
}
