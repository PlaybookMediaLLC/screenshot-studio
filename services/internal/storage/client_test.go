package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestReadTenantObject(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/object/assets/org/org-1/input/asset-1/1/file.png" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("apikey") != "secret" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("missing storage authentication headers")
		}
		_, _ = w.Write([]byte("image"))
	}))
	defer server.Close()
	client := New(server.URL, "assets", "secret", &http.Client{Timeout: time.Second})
	bytes, err := client.Read(context.Background(), "org-1", "org/org-1/input/asset-1/1/file.png")
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "image" {
		t.Fatalf("body = %q", bytes)
	}
}

func TestReadRejectsCrossTenantObject(t *testing.T) {
	t.Parallel()
	client := New("http://unused", "assets", "secret", http.DefaultClient)
	if _, err := client.Read(context.Background(), "org-1", "org/org-2/input/asset/1/file.png"); err == nil {
		t.Fatal("expected cross-tenant object key to be rejected")
	}
}
