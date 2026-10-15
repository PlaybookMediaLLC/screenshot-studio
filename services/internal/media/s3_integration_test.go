package media

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestS3StoreRoundTrip(t *testing.T) {
	endpoint := os.Getenv("MEDIA_TEST_ENDPOINT")
	if endpoint == "" {
		t.Skip("MEDIA_TEST_ENDPOINT is not set")
	}
	store, err := NewS3Store(endpoint, endpoint, os.Getenv("R2_REGION"),
		os.Getenv("R2_BUCKET_NAME"), os.Getenv("R2_ACCESS_KEY_ID"), os.Getenv("R2_SECRET_ACCESS_KEY"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	key := "org/integration-test/input/" + uuid.NewString() + "/1/canary.txt"
	t.Cleanup(func() { _ = store.Delete(context.Background(), key) })
	const body = "private media canary"
	uploadURL, err := store.SignUpload(ctx, key, "text/plain")
	if err != nil {
		t.Fatal(err)
	}
	put := func() int {
		request, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "text/plain")
		request.Header.Set("If-None-Match", "*")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		return response.StatusCode
	}
	if status := put(); status < 200 || status >= 300 {
		t.Fatalf("signed upload status=%d", status)
	}
	if status := put(); status != http.StatusPreconditionFailed {
		t.Fatalf("replayed upload status=%d, want 412", status)
	}
	if found, err := store.Exists(ctx, key); err != nil || !found {
		t.Fatalf("uploaded object found=%v err=%v", found, err)
	}
	objects := NewTenantObjects(store)
	if content, err := objects.Read(ctx, "integration-test", key); err != nil || string(content) != body {
		t.Fatalf("tenant read=%q err=%v", content, err)
	}
	downloadURL, err := store.SignDownload(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.Get(downloadURL)
	if err != nil {
		t.Fatal(err)
	}
	content, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK || string(content) != body {
		t.Fatalf("signed download status=%d body=%q err=%v", response.StatusCode, content, err)
	}
}
