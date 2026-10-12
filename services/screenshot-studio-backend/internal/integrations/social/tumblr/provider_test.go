package tumblr

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

func setup(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	old := apiURL
	apiURL = srv.URL
	t.Cleanup(func() { apiURL = old })
}

func TestAuthenticate(t *testing.T) {
	t.Setenv("TUMBLR_CLIENT_ID", "cid")
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth2/token":
			r.ParseForm()
			if r.PostForm.Get("client_id") != "cid" || r.PostForm.Get("grant_type") != "authorization_code" || r.Header.Get("User-Agent") != userAgent {
				t.Errorf("token form %v", r.PostForm)
			}
			w.Write([]byte(`{"access_token":"at","refresh_token":"rt","expires_in":2520,"scope":"write offline_access"}`))
		case "/user/info":
			w.Write([]byte(`{"response":{"user":{"name":"bob","blogs":[{"name":"b1","title":"B1"},{"name":"b2","primary":true}]}}}`))
		}
	})
	got, err := New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "bob" || got.Name != "bob" || got.RefreshToken != "rt" || got.ExpiresIn != 2520 || !strings.HasSuffix(got.Picture, "/blog/b2.tumblr.com/avatar/128") {
		t.Fatalf("%+v", got)
	}
}

func TestPostJSON(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/blog/b1/posts" || r.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("unexpected %s %s", r.URL.Path, r.Header.Get("Content-Type"))
		}
		body, _ := io.ReadAll(r.Body)
		want := `{"content":[{"type":"text","subtype":"heading1","text":"T"},{"type":"text","text":"one"},{"type":"text","text":"two"},{"type":"link","url":"https://x.com"}],"state":"published","tags":"a,b"}`
		if string(body) != want {
			t.Errorf("body %s", body)
		}
		w.Write([]byte(`{"response":{"id":123,"id_string":"123"}}`))
	})
	profile := "b1.tumblr.com/"
	settings := `{"title":"T","link":"x.com","tags":"a,b"}`
	got, err := New().Post(context.Background(), "b1", "tok", []integrations.PostDetails{{ID: "p1", Message: "one\n\n\ntwo ", Settings: json.RawMessage(settings)}}, &ent.Integration{Profile: &profile})
	if err != nil {
		t.Fatal(err)
	}
	if got[0].PostID != "123" || got[0].ReleaseURL != "https://b1.tumblr.com/post/123" || got[0].Status != "completed" {
		t.Fatalf("%+v", got)
	}
}

func TestErrorCodeClassification(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"errors":[{"code":8001,"title":"Bad Request"}]}`))
	})
	_, err := New().Post(context.Background(), "b1", "tok", []integrations.PostDetails{{ID: "p1", Message: "x"}}, &ent.Integration{})
	if temporalx.FailureType(err) != temporalx.TypeBadBody || temporalx.FailureMessage(err) != "Tumblr rejected the post content format." {
		t.Fatalf("%v", err)
	}
}

func TestHandleErrors(t *testing.T) {
	if h := handleErrors(`{}`, 401); h.Type != "refresh-token" {
		t.Fatal(h)
	}
	if h := handleErrors(`{"code":8009}`, 400); h.Type != "retry" || h.Value != "Tumblr had a video upload error." {
		t.Fatal(h)
	}
	if h := handleErrors(`{"code":80011}`, 400); h != nil {
		t.Fatal(h)
	}
}

func TestPagesAndFetchPageInformation(t *testing.T) {
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"response":{"user":{"name":"bob","blogs":[{"name":"b1","followers":3}]}}}`))
	})
	info, err := New().FetchPageInformation(context.Background(), "tok", json.RawMessage(`{"id":"b1"}`))
	if err != nil || info.Name != "b1" || info.Username != "https://b1.tumblr.com/" || info.AccessToken != "tok" {
		t.Fatalf("%+v %v", info, err)
	}
	if _, err := New().FetchPageInformation(context.Background(), "tok", json.RawMessage(`{"id":"zz"}`)); err == nil || err.Error() != "Tumblr blog not found" {
		t.Fatal(err)
	}
}

func TestValidateAndChunks(t *testing.T) {
	var dto TumblrDTO
	json.Unmarshal([]byte(`{"title":"","link":"nope"}`), &dto)
	if msgs := dto.Validate(); len(msgs) != 2 || msgs[0] != "title must be longer than or equal to 1 characters" || msgs[1] != "Invalid URL" {
		t.Fatal(msgs)
	}
	if got := chunkText(strings.Repeat("é", 4097)); len(got) != 2 || len([]rune(got[1])) != 1 {
		t.Fatal(len(got))
	}
}

func TestPostMultipartStreamsMedia(t *testing.T) {
	var img bytes.Buffer
	png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 3, 2)))
	var base string
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/media/a.png" {
			http.ServeContent(w, r, "a.png", time.Time{}, bytes.NewReader(img.Bytes()))
			return
		}
		if r.ContentLength <= 0 {
			t.Errorf("content length %d", r.ContentLength)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(r.FormValue("json"), `"media":[{"type":"image/png","identifier":"media-0","width":3,"height":2}]`) {
			t.Errorf("json %s", r.FormValue("json"))
		}
		f, h, err := r.FormFile("media-0")
		if err != nil || h.Filename != "a.png" || h.Header.Get("Content-Type") != "image/png" {
			t.Fatalf("%v %+v", err, h)
		}
		data, _ := io.ReadAll(f)
		if !bytes.Equal(data, img.Bytes()) {
			t.Error("media bytes differ")
		}
		w.Write([]byte(`{"response":{"id_string":"9"}}`))
	})
	base = apiURL
	got, err := New().Post(context.Background(), "b1", "tok", []integrations.PostDetails{{ID: "p1", Message: "x", Media: []integrations.MediaContent{{Type: "image", Path: base + "/media/a.png"}}}}, &ent.Integration{})
	if err != nil {
		t.Fatal(err)
	}
	if got[0].PostID != "9" || got[0].ReleaseURL != "https://www.tumblr.com/b1/post/9" {
		t.Fatalf("%+v", got)
	}
}
