package integrations

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMediaSizeUsesRangedGETForPresignedMedia(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	var sawRange bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("Range") != "bytes=0-0" || r.URL.Query().Get("X-Amz-Signature") != "abc/def" {
			t.Errorf("unexpected size request: %s %s range=%q", r.Method, r.URL, r.Header.Get("Range"))
			w.WriteHeader(http.StatusForbidden)
			return
		}
		sawRange = true
		w.Header().Set("Content-Range", "bytes 0-0/1048586")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("x"))
	}))
	defer srv.Close()

	size, err := NewBase("x", nil).MediaSize(context.Background(), srv.URL+"/clip.mp4?X-Amz-Signature=abc%2Fdef", "x")
	if err != nil || !sawRange || size != 1048586 {
		t.Fatalf("size=%d ranged=%t error=%v", size, sawRange, err)
	}
}

func TestMediaSizeKeepsHEADForPublicMedia(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead {
			t.Errorf("method=%s, want HEAD", r.Method)
		}
		w.Header().Set("Content-Length", "2048")
	}))
	defer srv.Close()

	size, err := NewBase("x", nil).MediaSize(context.Background(), srv.URL+"/clip.mp4", "x")
	if err != nil || size != 2048 {
		t.Fatalf("size=%d error=%v", size, err)
	}
}
