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
