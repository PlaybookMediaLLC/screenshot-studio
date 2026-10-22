package bluesky

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func TestInvalidSelectionsNeverUploadOrCreate(t *testing.T) {
	for _, name := range []string{"text overflow", "byte overflow", "five images", "mixed media", "two videos", "poll", "bad image after valid image", "oversize image", "legacy proof"} {
		t.Run(name, func(t *testing.T) {
			f := newFakePDS(t)
			p := newProvider(f.Client())
			in := f.integration(t, "app-password")
			img := integrations.MediaContent{Type: "image", Path: f.URL + "/media/image.png"}
			video := integrations.MediaContent{Type: "video", Path: f.URL + "/media/video.mp4"}
			post := integrations.PostDetails{ID: "p", Message: "hello"}
			switch name {
			case "text overflow":
				post.Message = strings.Repeat("a", 301)
			case "byte overflow":
				post.Message = strings.Repeat("👩‍💻", 300)
			case "five images":
				post.Media = []integrations.MediaContent{img, img, img, img, img}
			case "mixed media":
				post.Media = []integrations.MediaContent{img, video}
			case "two videos":
				post.Media = []integrations.MediaContent{video, video}
			case "poll":
				post.Poll = &integrations.PollDetails{Options: []string{"a", "b"}}
			case "bad image after valid image":
				post.Media = []integrations.MediaContent{img, {Type: "image", Path: video.Path}}
			case "oversize image":
				post.Media = []integrations.MediaContent{img}
				limit := int64(1)
				in.VerifiedCapabilities.Bluesky.BlobUploadLimit = &limit
			case "legacy proof":
				in.VerifiedCapabilities = nil
			}
			_, err := p.Post(context.Background(), in.InternalID, "", []integrations.PostDetails{post}, in)
			if err == nil || len(f.records) != 0 || f.uploads != 0 {
				t.Fatalf("invalid selection caused a write: %v", err)
			}
		})
	}
}

func TestMediaReadsAreBoundedAndTransientErrorsStayRetryable(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	for _, tc := range []struct {
		name      string
		status    int
		chunked   bool
		body      string
		permanent bool
	}{
		{"chunked oversized", 200, true, "123456", true},
		{"known oversized", 200, false, "123456", true},
		{"empty", 200, false, "", true},
		{"outage", 503, false, "private provider details", false},
		{"rate limit", 429, false, "private provider details", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet {
					t.Error("signed GET was changed to HEAD")
				}
				w.WriteHeader(tc.status)
				if tc.chunked {
					w.(http.Flusher).Flush()
				}
				_, _ = io.WriteString(w, tc.body)
			}))
			defer server.Close()
			var out bytes.Buffer
			_, err := copyMedia(context.Background(), server.URL+"?secret-signed-url", 5, &out)
			if err == nil || (temporalx.FailureType(err) == temporalx.TypeBadBody) != tc.permanent || out.Len() > 6 || strings.Contains(err.Error(), "secret-signed-url") || strings.Contains(err.Error(), "private provider") {
				t.Fatalf("incorrect bounded/error behavior: %v, bytes=%d", err, out.Len())
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := copyMedia(ctx, "https://example.com/private", 5, io.Discard); !errors.Is(err, context.Canceled) {
		t.Fatalf("lost cancellation: %v", err)
	}
}

func TestVideoAllowanceAndContentCheckedBeforeUpload(t *testing.T) {
	for _, name := range []string{"denied", "daily videos", "daily bytes", "insufficient bytes", "unknown", "outage", "rate limit", "wrong MIME", "wrong job account", "wrong job id", "oversized returned blob", "redirect"} {
		t.Run(name, func(t *testing.T) {
			f := newFakePDS(t)
			p := newProvider(f.Client())
			in := f.integration(t, "app-password")
			uploads, reads := 0, 0
			f.override = func(w http.ResponseWriter, r *http.Request) bool {
				switch r.URL.Path {
				case "/media/video.mp4":
					reads++
					if name == "wrong MIME" {
						_, _ = io.WriteString(w, "not a video")
						return true
					}
				case "/xrpc/app.bsky.video.getUploadLimits":
					response := ""
					switch name {
					case "denied":
						response = `{"canUpload":false}`
					case "daily videos":
						response = `{"canUpload":true,"remainingDailyVideos":0}`
					case "daily bytes":
						response = `{"canUpload":true,"remainingDailyBytes":0}`
					case "insufficient bytes":
						response = `{"canUpload":true,"remainingDailyBytes":1}`
					case "unknown":
						response = `{}`
					case "outage":
						w.WriteHeader(503)
						return true
					case "rate limit":
						w.WriteHeader(429)
						return true
					case "redirect":
						w.Header().Set("Location", f.URL+"/unexpected")
						w.WriteHeader(302)
						return true
					}
					if response != "" {
						_, _ = io.WriteString(w, response)
						return true
					}
				case "/xrpc/app.bsky.video.uploadVideo":
					uploads++
					if name == "wrong job account" {
						_, _ = io.WriteString(w, `{"jobId":"job1","did":"did:plc:foreign","state":"JOB_STATE_CREATED"}`)
						return true
					}
				case "/xrpc/app.bsky.video.getJobStatus":
					if name == "wrong job id" {
						_, _ = io.WriteString(w, `{"jobStatus":{"jobId":"foreign","did":"`+connectionDID+`","state":"JOB_STATE_COMPLETED"}}`)
						return true
					}
					if name == "oversized returned blob" {
						_, _ = io.WriteString(w, `{"jobStatus":{"jobId":"job1","did":"`+connectionDID+`","state":"JOB_STATE_COMPLETED","blob":{"$type":"blob","mimeType":"video/mp4","size":300000001,"ref":{"$link":"blob"}}}}`)
						return true
					}
				case "/unexpected":
					t.Error("followed authenticated video redirect")
					return true
				}
				return false
			}
			_, err := p.Post(context.Background(), in.InternalID, "", []integrations.PostDetails{{ID: "p", Message: "video", Media: []integrations.MediaContent{{Type: "video", Path: f.URL + "/media/video.mp4?private=signature", Alt: "Description"}}}}, in)
			if err == nil || len(f.records) != 0 {
				t.Fatalf("invalid video created a post: %v", err)
			}
			if !strings.HasPrefix(name, "wrong job") && name != "oversized returned blob" && uploads != 0 {
				t.Fatal("unusable source reached video upload")
			}
			if (name == "denied" || name == "daily videos" || name == "daily bytes" || name == "unknown" || name == "outage" || name == "rate limit") && reads != 0 {
				t.Fatal("unavailable permission still downloaded media")
			}
		})
	}
}

func TestVideoUsesSeparateServiceGrantsAndSafeFilename(t *testing.T) {
	f := newFakePDS(t)
	p := newProvider(f.Client())
	in := f.integration(t, "app-password")
	grants := map[string]bool{}
	f.override = func(w http.ResponseWriter, r *http.Request) bool {
		switch r.URL.Path {
		case "/xrpc/com.atproto.server.getServiceAuth":
			method := r.URL.Query().Get("lxm")
			grants[method] = true
			if method == "app.bsky.video.getUploadLimits" && r.URL.Query().Get("aud") != "did:web:video.bsky.app" {
				t.Error("wrong permission audience")
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"token": method})
			return true
		case "/xrpc/app.bsky.video.getUploadLimits":
			if r.Header.Get("Authorization") != "Bearer app.bsky.video.getUploadLimits" {
				t.Error("used upload grant for permission lookup")
			}
		case "/xrpc/app.bsky.video.uploadVideo":
			body, _ := io.ReadAll(r.Body)
			if r.Header.Get("Authorization") != "Bearer com.atproto.repo.uploadBlob" || r.URL.Query().Get("name") != "video.mp4" || !bytes.Equal(body, testMP4) || r.ContentLength != int64(len(testMP4)) {
				t.Error("video was changed or filename leaked its signed query")
			}
			_, _ = io.WriteString(w, `{"jobId":"job1","did":"`+connectionDID+`","state":"JOB_STATE_CREATED"}`)
			return true
		}
		return false
	}
	_, err := p.Post(context.Background(), in.InternalID, "", []integrations.PostDetails{{ID: "p", Message: "video", Media: []integrations.MediaContent{{Type: "video", Path: f.URL + "/media/video.mp4?private=signature", Alt: "Description"}}}}, in)
	if err != nil || len(f.records) != 1 || len(grants) != 2 {
		t.Fatalf("valid video did not publish: %v", err)
	}
	embed, _ := json.Marshal(f.records[0]["record"].(map[string]any)["embed"])
	if !strings.Contains(string(embed), `"alt":"Description"`) {
		t.Fatal("video description was lost")
	}
}

func TestVideoUploadHonorsCallerCancellation(t *testing.T) {
	f := newFakePDS(t)
	p := newProvider(f.Client())
	in := f.integration(t, "app-password")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f.override = func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != "/xrpc/app.bsky.video.uploadVideo" {
			return false
		}
		// Cancel after upload has started, with no response that could be used
		// as a confirmed upload or publication receipt.
		_, _ = io.Copy(io.Discard, r.Body)
		cancel()
		<-r.Context().Done()
		return true
	}
	_, err := p.PostPending(ctx, in.InternalID, "", []integrations.PostDetails{{ID: "p", Message: "video", Media: []integrations.MediaContent{{Type: "video", Path: f.URL + "/media/video.mp4"}}}}, in)
	if !errors.Is(err, context.Canceled) || len(f.records) != 0 {
		t.Fatalf("upload ignored cancellation or created a post: %v", err)
	}
}
