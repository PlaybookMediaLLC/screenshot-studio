package media

import (
	"bytes"
	"context"
	"net/url"
	"os"
	"testing"

	"github.com/google/uuid"
)

// This opt-in check uses a local S3-compatible service, never a production bucket.
func TestLocalS3RoundTrip(t *testing.T) {
	if os.Getenv("PUBLISHING_TEST_LOCAL_OBJECT_STORE") != "true" {
		t.Skip("PUBLISHING_TEST_LOCAL_OBJECT_STORE is not enabled")
	}
	endpoint, err := url.Parse(os.Getenv("R2_ENDPOINT"))
	if err != nil || (endpoint.Hostname() != "localhost" && endpoint.Hostname() != "127.0.0.1") {
		t.Fatal("local S3 endpoint required")
	}
	store, err := NewS3StoreFromEnvironment()
	if err != nil || store == nil {
		t.Fatal("storage unavailable", err)
	}
	ctx := context.Background()
	key := "typefully-verification/" + uuid.NewString() + "/image.txt"
	data := []byte("Object storage round-trip verification.")
	if err = store.Put(ctx, key, "text/plain", bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Delete(ctx, key) })
	if exists, err := store.Exists(ctx, key); err != nil || !exists {
		t.Fatal("missing uploaded object", err)
	}
	actual, err := store.Read(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, data) {
		t.Fatal("stored bytes changed")
	}
}
