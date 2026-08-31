package postiz

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type staticAssetReader struct{ body []byte }

func (s staticAssetReader) Read(context.Context, string, string) ([]byte, error) { return s.body, nil }

func TestPublishUploadsAssetAndCreatesPost(t *testing.T) {
	t.Setenv("POSTIZ_API_KEY_TEST", "token")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "token" {
			t.Fatalf("authorization header = %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/upload":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Fatal(err)
			}
			file, header, err := r.FormFile("file")
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			body, _ := io.ReadAll(file)
			if string(body) != "png" || header.Header.Get("Content-Type") != "image/png" {
				t.Fatalf("unexpected upload body or media type")
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "media-1", "path": "/media/1"})
		case "/posts":
			if r.Method == http.MethodGet {
				_ = json.NewEncoder(w).Encode(map[string]any{"posts": []any{map[string]string{
					"id": "post-1", "releaseId": "provider-post-1", "state": "PUBLISHED",
				}}})
				return
			}
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			if payload["type"] != "now" {
				t.Fatalf("unexpected payload: %#v", payload)
			}
			_ = json.NewEncoder(w).Encode([]map[string]string{{"postId": "post-1", "integration": "destination-1"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := New(server.URL, &http.Client{Timeout: time.Second}, staticAssetReader{body: []byte("png")})
	id, err := client.Publish(context.Background(), PublishInput{
		AssetMediaType: "image/png", AssetObjectKey: "org/org-1/input/asset/1/file.png",
		Caption: "hello", DestinationID: "destination-1", OrganizationID: "org-1",
		Platform: "x", ProviderSettings: map[string]any{"visibility": "public"}, SecretReference: "POSTIZ_API_KEY_TEST",
	})
	if err != nil {
		t.Fatal(err)
	}
	if id != "post-1" {
		t.Fatalf("id = %q", id)
	}
	status, err := client.Status(context.Background(), StatusInput{PostID: id, SecretReference: "POSTIZ_API_KEY_TEST"})
	if err != nil {
		t.Fatal(err)
	}
	if status.State != "PUBLISHED" || status.ProviderPostID != "provider-post-1" {
		t.Fatalf("status = %#v", status)
	}
}

func TestPublishAcceptsLegacyReceipt(t *testing.T) {
	t.Setenv("POSTIZ_API_KEY_TEST", "token")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/upload" {
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "media-1", "path": "/media/1"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "post-legacy"})
	}))
	defer server.Close()
	client := New(server.URL, &http.Client{Timeout: time.Second}, staticAssetReader{body: []byte("png")})
	id, err := client.Publish(context.Background(), PublishInput{
		AssetMediaType: "image/png", AssetObjectKey: "file.png", Caption: "hello",
		DestinationID: "destination-1", OrganizationID: "org-1", Platform: "x", SecretReference: "POSTIZ_API_KEY_TEST",
	})
	if err != nil || id != "post-legacy" {
		t.Fatalf("id=%q err=%v", id, err)
	}
}

func TestPublishClassifiesRateLimit(t *testing.T) {
	t.Setenv("POSTIZ_API_KEY_TEST", "token")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/upload" {
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "media-1", "path": "/media/1"})
			return
		}
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()
	client := New(server.URL, &http.Client{Timeout: time.Second}, staticAssetReader{body: []byte("png")})
	_, err := client.Publish(context.Background(), PublishInput{
		AssetMediaType: "image/png", AssetObjectKey: "org/org-1/input/asset/1/file.png",
		Caption: "hello", DestinationID: "destination-1", OrganizationID: "org-1",
		Platform: "x", SecretReference: "POSTIZ_API_KEY_TEST",
	})
	providerErr, ok := err.(*Error)
	if !ok || providerErr.Status != http.StatusTooManyRequests || providerErr.UnknownDelivery {
		t.Fatalf("unexpected error: %#v", err)
	}
}
