package capture

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCaptureDownloadsFromTheAPIHostOnly(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nfake")
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/image":
			_, _ = w.Write(png)
		case r.URL.Query().Get("url") == "https://app.acme.test/" && r.URL.Query().Get("screenshot") == "true":
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "success",
				"data": map[string]any{"screenshot": map[string]string{"url": server.URL + "/image"}}})
		case r.URL.Query().Get("url") == "https://evil.test/":
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "success",
				"data": map[string]any{"screenshot": map[string]string{"url": "http://169.254.169.254/latest"}}})
		default:
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "fail", "data": map[string]string{"message": "rate limited"}})
		}
	}))
	defer server.Close()
	client := &Client{API: server.URL, HTTP: server.Client()}
	body, err := client.Capture(context.Background(), "https://app.acme.test/")
	if err != nil || !bytes.Equal(body, png) {
		t.Fatalf("capture=%q err=%v", body, err)
	}
	if _, err := client.Capture(context.Background(), "https://evil.test/"); err == nil {
		t.Fatal("a screenshot URL on an internal address was downloaded")
	}
	if _, err := client.Capture(context.Background(), "https://down.test/"); err == nil {
		t.Fatal("a failed capture returned an image")
	}
}

func TestCaptureOptionsAndPublicPageURL(t *testing.T) {
	var query map[string]string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/image" {
			_, _ = w.Write([]byte("png"))
			return
		}
		query = map[string]string{"colorScheme": r.URL.Query().Get("colorScheme"),
			"isMobile": r.URL.Query().Get("viewport.isMobile"), "width": r.URL.Query().Get("viewport.width")}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "success",
			"data": map[string]any{"screenshot": map[string]string{"url": server.URL + "/image"}}})
	}))
	defer server.Close()
	client := &Client{API: server.URL, HTTP: server.Client()}
	if _, err := client.CaptureWith(context.Background(), "https://acme.test/", Options{Mobile: true, ColorScheme: "dark"}); err != nil {
		t.Fatal(err)
	}
	if query["colorScheme"] != "dark" || query["isMobile"] != "true" || query["width"] != "390" {
		t.Fatalf("query=%v", query)
	}
	for raw, want := range map[string]bool{
		"https://example.com/pricing": true, "http://example.com": true,
		"ftp://example.com": false, "https://localhost:3000": false, "http://app.local": false,
		"http://127.0.0.1": false, "http://10.0.0.8": false, "http://[::1]/": false,
		"http://169.254.169.254/latest": false, "http://100.64.0.1": false, "http://8.8.8.8": true,
	} {
		if PublicPageURL(raw) != want {
			t.Errorf("PublicPageURL(%q) = %v, want %v", raw, !want, want)
		}
	}
}
