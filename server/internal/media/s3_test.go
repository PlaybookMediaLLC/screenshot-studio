package media

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPrivateMediaSigningAndObjectExistence(t *testing.T) {
	exists := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead || r.URL.Path != "/tenant-assets/org/org-1/input/asset-1/1/image.png" {
			t.Errorf("unexpected object request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if !exists {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	store, err := NewS3Store(server.URL, "https://browser.example", "us-east-1", "tenant-assets", "test-key", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	key := "org/org-1/input/asset-1/1/image.png"
	upload, err := store.SignUpload(context.Background(), key, "image/png")
	if err != nil || !strings.HasPrefix(upload, "https://browser.example/tenant-assets/"+key+"?") || !strings.Contains(upload, "X-Amz-Signature=") || !strings.Contains(upload, "if-none-match") {
		t.Fatalf("upload URL=%q err=%v", upload, err)
	}
	download, err := store.SignDownload(context.Background(), key)
	if err != nil || !strings.Contains(download, "X-Amz-Signature=") {
		t.Fatalf("download URL=%q err=%v", download, err)
	}
	delivery, err := NewTenantObjects(store).SignDelivery(context.Background(), "org-1", key)
	if err != nil || !strings.HasPrefix(delivery, server.URL+"/tenant-assets/"+key+"?") || !strings.Contains(delivery, "X-Amz-Expires=86400") {
		t.Fatalf("delivery URL=%q err=%v", delivery, err)
	}
	if found, err := store.Exists(context.Background(), key); err != nil || found {
		t.Fatalf("missing object found=%v err=%v", found, err)
	}
	exists = true
	if found, err := store.Exists(context.Background(), key); err != nil || !found {
		t.Fatalf("existing object found=%v err=%v", found, err)
	}
}

func TestTenantObjectAccessRejectsForeignAndUnsafeKeys(t *testing.T) {
	objects := NewTenantObjects(&S3Store{})
	for _, key := range []string{
		"org/org-2/input/asset-1/1/image.png",
		"org/org-1/../asset-1/image.png",
		"org/org-1/input/asset-1/1/image space.png",
	} {
		if _, err := objects.Read(context.Background(), "org-1", key); err == nil {
			t.Errorf("unsafe object read accepted: %q", key)
		}
		if err := objects.Delete(context.Background(), "org-1", key); err == nil {
			t.Errorf("unsafe object delete accepted: %q", key)
		}
		if _, err := objects.SignDelivery(context.Background(), "org-1", key); err == nil {
			t.Errorf("unsafe object delivery accepted: %q", key)
		}
	}
}
