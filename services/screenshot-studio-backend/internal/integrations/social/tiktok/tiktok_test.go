package tiktok

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	"go.temporal.io/sdk/temporal"
)

func TestChunkPlan(t *testing.T) {
	const mb = 1024 * 1024
	cases := []struct{ size, chunk, count int64 }{
		{5 * mb, 5 * mb, 1},
		{64 * mb, 64 * mb, 1},
		{64*mb + 1, 10 * mb, 6},
		{105 * mb, 10 * mb, 10}, // last chunk carries 15MB
	}
	for _, c := range cases {
		chunk, count := ChunkPlan(c.size)
		if chunk != c.chunk || count != c.count {
			t.Errorf("ChunkPlan(%d) = %d,%d want %d,%d", c.size, chunk, count, c.chunk, c.count)
		}
	}
}

func setup(t *testing.T, handler http.HandlerFunc) *Provider {
	t.Helper()
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	old := apiURL
	apiURL = srv.URL
	t.Cleanup(func() { apiURL = old })
	p := New()
	p.RetryDelay = 0
	return p
}

func profilePtr(s string) *ent.Integration { return &ent.Integration{Profile: &s} }

func TestPostPendingChunkedVideoAndStatusFlow(t *testing.T) {
	oldSingle, oldChunk := maxSingleChunk, chunkSize
	maxSingleChunk, chunkSize = 64, 10
	t.Cleanup(func() { maxSingleChunk, chunkSize = oldSingle, oldChunk })

	video := bytes.Repeat([]byte("0123456789abcdef"), 6)[:95] // 9 chunks, last carries 15 bytes
	path := filepath.Join(t.TempDir(), "clip.mp4")
	if err := os.WriteFile(path, video, 0o600); err != nil {
		t.Fatal(err)
	}

	var (
		mu       sync.Mutex
		uploaded []byte
		ranges   []string
		initBody map[string]any
		statuses = []string{`{"data":{"status":"PROCESSING_UPLOAD"}}`, `{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7234567890123456789]}}`}
	)
	var srvURL string
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/v2/post/publish/video/init/":
			if r.Header.Get("Authorization") != "Bearer tok" {
				t.Errorf("bad auth header %q", r.Header.Get("Authorization"))
			}
			_ = json.NewDecoder(r.Body).Decode(&initBody)
			io.WriteString(w, `{"data":{"publish_id":"v_pub_file~1","upload_url":"`+srvURL+`/upload"}}`)
		case "/upload":
			data, _ := io.ReadAll(r.Body)
			if int64(len(data)) != r.ContentLength {
				t.Errorf("content-length %d, body %d", r.ContentLength, len(data))
			}
			uploaded = append(uploaded, data...)
			ranges = append(ranges, r.Header.Get("Content-Range"))
			w.WriteHeader(http.StatusPartialContent)
		case "/v2/post/publish/status/fetch/":
			body, _ := io.ReadAll(r.Body)
			if string(body) != `{"publish_id":"v_pub_file~1"}` {
				t.Errorf("status body %s", body)
			}
			io.WriteString(w, statuses[0])
			statuses = statuses[1:]
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	})
	srvURL = apiURL

	ts := int64(1500)
	post := integrations.PostDetails{
		ID:       "p1",
		Message:  "hello",
		Settings: json.RawMessage(`{"content_posting_method":"DIRECT_POST","duet":"true","stitch":false,"comment":true,"video_made_with_ai":true,"privacy_level":"SELF_ONLY"}`),
		Media:    []integrations.MediaContent{{Type: "video", Path: path, ThumbnailTimestamp: &ts}},
	}
	res, err := p.PostPending(context.Background(), "internal", "tok", []integrations.PostDetails{post}, profilePtr("me"))
	if err != nil {
		t.Fatal(err)
	}
	if res[0].Status != "pending" || string(res[0].PendingData) != `{"publishId":"v_pub_file~1"}` {
		t.Fatalf("unexpected response %+v", res[0])
	}
	if !bytes.Equal(uploaded, video) {
		t.Fatalf("uploaded bytes differ: %q", uploaded)
	}
	if len(ranges) != 9 || ranges[0] != "bytes 0-9/95" || ranges[8] != "bytes 80-94/95" {
		t.Fatalf("ranges %v", ranges)
	}
	wantInfo := map[string]any{
		"title": "hello", "privacy_level": "SELF_ONLY", "disable_duet": false, "disable_comment": false,
		"disable_stitch": true, "is_aigc": true, "brand_content_toggle": false, "brand_organic_toggle": false,
		"video_cover_timestamp_ms": float64(1500),
	}
	if !reflect.DeepEqual(initBody["post_info"], wantInfo) {
		t.Fatalf("post_info %v", initBody["post_info"])
	}
	wantSource := map[string]any{"source": "FILE_UPLOAD", "video_size": float64(95), "chunk_size": float64(10), "total_chunk_count": float64(9)}
	if !reflect.DeepEqual(initBody["source_info"], wantSource) {
		t.Fatalf("source_info %v", initBody["source_info"])
	}

	check, err := p.CheckPostStatus(context.Background(), "tok", res[0].PendingData, profilePtr("me"))
	if err != nil || check.Status != "pending" {
		t.Fatalf("first check %+v %v", check, err)
	}
	check, err = p.CheckPostStatus(context.Background(), "tok", res[0].PendingData, profilePtr("me"))
	if err != nil {
		t.Fatal(err)
	}
	if check.Status != "completed" || check.PostID != "7234567890123456789" || check.ReleaseURL != "https://www.tiktok.com/@me/video/7234567890123456789" {
		t.Fatalf("completed check %+v", check)
	}
}

func TestPostPendingPhotoUploadBody(t *testing.T) {
	var body map[string]any
	var path string
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		io.WriteString(w, `{"data":{"publish_id":"p_inbox_url~1"}}`)
	})
	post := integrations.PostDetails{
		ID:       "p1",
		Message:  "caption",
		Settings: json.RawMessage(`{"content_posting_method":"UPLOAD","title":"My title","duet":true}`),
		Media:    []integrations.MediaContent{{Path: "https://cdn/a.jpg"}, {Path: "https://cdn/b.jpg"}},
	}
	if _, err := p.PostPending(context.Background(), "i", "tok", []integrations.PostDetails{post}, profilePtr("me")); err != nil {
		t.Fatal(err)
	}
	if path != "/v2/post/publish/content/init/" {
		t.Fatalf("path %s", path)
	}
	want := map[string]any{
		"post_info":  map[string]any{"title": "My title", "description": "caption"},
		"post_mode":  "MEDIA_UPLOAD",
		"media_type": "PHOTO",
		"source_info": map[string]any{
			"source": "PULL_FROM_URL", "photo_cover_index": float64(0),
			"photo_images": []any{"https://cdn/a.jpg", "https://cdn/b.jpg"},
		},
	}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("body %v", body)
	}
}

func TestErrorPaths(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/post/publish/content/init/":
			w.WriteHeader(http.StatusUnauthorized)
			io.WriteString(w, `{"error":{"code":"access_token_invalid"}}`)
		case "/v2/post/publish/status/fetch/":
			io.WriteString(w, `{"data":{"status":"FAILED","fail_reason":"picture_size_check_failed"}}`)
		}
	})
	post := integrations.PostDetails{ID: "p1", Media: []integrations.MediaContent{{Path: "https://cdn/a.jpg"}}}
	_, err := p.PostPending(context.Background(), "i", "tok", []integrations.PostDetails{post}, profilePtr("me"))
	if temporalx.FailureType(err) != temporalx.TypeRefreshToken {
		t.Fatalf("want refresh token, got %v", err)
	}
	_, err = p.CheckPostStatus(context.Background(), "tok", json.RawMessage(`{"publishId":"p_pub_url~1"}`), profilePtr("me"))
	if temporalx.FailureType(err) != temporalx.TypeBadBody || !strings.HasPrefix(temporalx.FailureMessage(err), "Media size not supported by TikTok") {
		t.Fatalf("want bad body, got %v", err)
	}
	// upstream's "titok-error-upload" typo is fixed
	var app *temporal.ApplicationError
	var details temporalx.FailureDetails
	if !errors.As(err, &app) || app.Details(&details) != nil || details.Identifier != "tiktok-error-upload" {
		t.Fatalf("identifier %q", details.Identifier)
	}
	if h := handleErrors(`{"error":{"code":"reached_active_user_cap"}}`, 403); h == nil || h.Type != "disconnect" {
		t.Fatalf("active user cap: %+v", h)
	}
}

func TestUploadChunkRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		io.WriteString(w, `{"error":{"code":"invalid_params"}}`)
	}))
	defer srv.Close()
	path := filepath.Join(t.TempDir(), "v.mp4")
	os.WriteFile(path, []byte("abc"), 0o600)
	err := New().uploadVideoBytes(context.Background(), srv.URL, path, 3, "video/mp4")
	if temporalx.FailureMessage(err) != "Invalid request parameters, please check content format" {
		t.Fatalf("got %v", err)
	}
}

func TestResolveReleaseID(t *testing.T) {
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":["9007199254740993"]}}`)
	})
	ctx := context.Background()
	if r, _ := p.ResolveReleaseID(ctx, "t", "12345", profilePtr("me"), nil, ""); r != nil {
		t.Fatalf("plain id should not resolve: %+v", r)
	}
	if r, _ := p.ResolveReleaseID(ctx, "t", "v_pub_file~1", profilePtr("me"), json.RawMessage(`{"privacy_level":"SELF_ONLY"}`), ""); r == nil || !r.Unavailable {
		t.Fatalf("want unavailable: %+v", r)
	}
	r, err := p.ResolveReleaseID(ctx, "t", "missing", profilePtr("me"), json.RawMessage(`{"privacy_level":"SELF_ONLY"}`), "https://www.tiktok.com/messages?lang=en#p_inbox_url~2")
	if err != nil || r == nil || r.PostID != "9007199254740993" || r.ReleaseURL != "https://www.tiktok.com/@me/photo/9007199254740993" {
		t.Fatalf("draft resolve %+v %v", r, err)
	}
}

func TestCheckValidity(t *testing.T) {
	p := New()
	ctx := context.Background()
	cases := map[string][][]integrations.ValidityMedia{
		"No video / images selected":                                {},
		"Only pictures are supported when selecting multiple items": {{{Path: "a.jpg"}, {Path: "b.mp4"}}},
	}
	for want, items := range cases {
		if got, _ := p.CheckValidity(ctx, items, nil, nil); got != want {
			t.Errorf("got %q want %q", got, want)
		}
	}
	if got, _ := p.CheckValidity(ctx, [][]integrations.ValidityMedia{{{Path: "a.mp4"}}}, nil, nil); got != "" {
		t.Errorf("single video should pass, got %q", got)
	}
}

func TestAuthenticate(t *testing.T) {
	t.Setenv("FRONTEND_URL", "https://app.example.com")
	p := setup(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/oauth/token/":
			r.ParseForm()
			if r.Form.Get("redirect_uri") != "https://app.example.com/integrations/social/tiktok" || r.Form.Get("code") != "c" {
				t.Errorf("form %v", r.Form)
			}
			io.WriteString(w, `{"access_token":"at","refresh_token":"rt","scope":"user.info.basic,video.list,video.publish,video.upload,user.info.profile,user.info.stats"}`)
		case "/v2/user/info/":
			io.WriteString(w, `{"data":{"user":{"open_id":"a-b-c","display_name":"Me","avatar_url":"pic","username":"me"}}}`)
		}
	})
	got, err := p.Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c", CodeVerifier: "v"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "abc" || got.AccessToken != "at" || got.ExpiresIn != 82800 || got.Username != "me" {
		t.Fatalf("got %+v", got)
	}
}

func TestValidate(t *testing.T) {
	var d TikTokDTO
	json.Unmarshal([]byte(`{"title":"`+strings.Repeat("x", 91)+`","privacy_level":"NOPE","duet":"true","stitch":true,"comment":true,"autoAddMusic":"yes","brand_content_toggle":false,"brand_organic_toggle":false,"music":{"audio_volume":"150"},"content_posting_method":"DIRECT_POST"}`), &d)
	want := []string{
		"title must be shorter than or equal to 90 characters",
		"privacy_level must be one of the following values: PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR, SELF_ONLY",
		"duet must be a boolean value",
		"music.id should not be null or undefined",
		"music.id must be a string",
		"music.audio_volume must not be greater than 100",
	}
	if got := d.Validate(); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
}
