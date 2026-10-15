package product

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// The cache is global: entries upsert by URL hash, keep their age across
// re-stores, and are purged by URL or by age.
func TestScreenshotCache(t *testing.T) {
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	id := cuid.New()
	hash := func(value string) string {
		sum := sha256.Sum256([]byte(value))
		return hex.EncodeToString(sum[:])
	}
	pageURL, otherURL := "https://"+id+".example/:desktop:light", "https://"+id+".example/:mobile:dark"
	first, second := hash(pageURL), hash(otherURL)
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM screenshot_cache WHERE "urlHash"=$1 OR "urlHash"=$2`, first, second)
	})
	objects := &recordingAssetObjects{}
	repo := NewConfiguration(db.Client).WithObjectStore(objects)
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFgAI/ScL6fQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.PutScreenshotCacheObject(ctx, first, png); err != nil || objects.key != screenshotCacheObjectKey(first) {
		t.Fatalf("store cache image: key=%q err=%v", objects.key, err)
	}
	if err := repo.PutScreenshotCacheObject(ctx, first, []byte("not a PNG")); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid cache image accepted: %v", err)
	}

	if _, err := repo.GetScreenshotCache(ctx, first); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("missing entry: %v", err)
	}
	stored, err := repo.PutScreenshotCache(ctx, first, ScreenshotCacheInput{URL: pageURL,
		CloudinaryPublicID: "screenshots/" + first + ".png", CloudinaryURL: "https://cdn.example/a.png"})
	if err != nil || stored.URLHash != first || stored.URL != pageURL {
		t.Fatalf("stored=%+v err=%v", stored, err)
	}
	if image, err := repo.GetScreenshotCacheObject(ctx, first); err != nil || !bytes.Equal(image, png) {
		t.Fatalf("read cache image: err=%v", err)
	}
	if _, err := db.SQL.ExecContext(ctx, `UPDATE screenshot_cache SET "createdAt"='2000-01-01' WHERE "urlHash"=$1`, first); err != nil {
		t.Fatal(err)
	}
	restored, err := repo.PutScreenshotCache(ctx, first, ScreenshotCacheInput{URL: pageURL,
		CloudinaryPublicID: "screenshots/" + first + ".png", CloudinaryURL: "https://cdn.example/b.png"})
	if err != nil || restored.CloudinaryURL != "https://cdn.example/b.png" || restored.CreatedAt.Year() != 2000 {
		t.Fatalf("re-store must update in place and keep createdAt: %+v err=%v", restored, err)
	}
	var rows int
	if err := db.SQL.QueryRowContext(ctx, `SELECT count(*) FROM screenshot_cache WHERE "urlHash"=$1`, first).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("rows=%d err=%v", rows, err)
	}
	if _, err := repo.PutScreenshotCache(ctx, second, ScreenshotCacheInput{URL: otherURL,
		CloudinaryPublicID: "screenshots/" + first + ".png", CloudinaryURL: "https://cdn.example/c.png"}); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("object key reused across hashes: %v", err)
	}
	if _, err := repo.PutScreenshotCache(ctx, second, ScreenshotCacheInput{URL: otherURL,
		CloudinaryPublicID: "screenshots/" + second + ".png", CloudinaryURL: "https://cdn.example/c.png"}); err != nil {
		t.Fatal(err)
	}

	for _, invalid := range []ScreenshotCacheFilter{{}, {URLs: []string{pageURL}, CreatedBefore: &time.Time{}}} {
		if _, err := repo.ListScreenshotCache(ctx, invalid); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("filter %+v accepted: %v", invalid, err)
		}
	}
	if _, err := repo.GetScreenshotCache(ctx, "not-a-hash"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("malformed hash accepted: %v", err)
	}
	listed, err := repo.ListScreenshotCache(ctx, ScreenshotCacheFilter{URLs: []string{pageURL, otherURL}})
	if err != nil || len(listed) != 2 {
		t.Fatalf("listed=%+v err=%v", listed, err)
	}
	cutoff := time.Date(2000, 1, 2, 0, 0, 0, 0, time.UTC)
	old, err := repo.ListScreenshotCache(ctx, ScreenshotCacheFilter{CreatedBefore: &cutoff})
	if err != nil || len(old) != 1 || old[0].URLHash != first {
		t.Fatalf("old=%+v err=%v", old, err)
	}
	if deleted, err := repo.PurgeScreenshotCache(ctx, ScreenshotCacheFilter{CreatedBefore: &cutoff}); err != nil || deleted != 1 {
		t.Fatalf("aged purge deleted=%d err=%v", deleted, err)
	}
	if objects.key != screenshotCacheObjectKey(first) {
		t.Fatalf("purge left cache image at %q", objects.key)
	}
	if deleted, err := repo.PurgeScreenshotCache(ctx, ScreenshotCacheFilter{URLs: []string{pageURL, otherURL}}); err != nil || deleted != 1 {
		t.Fatalf("url purge deleted=%d err=%v", deleted, err)
	}
	for range 2 {
		if err := repo.DeleteScreenshotCache(ctx, second); err != nil {
			t.Fatalf("delete must be idempotent: %v", err)
		}
	}
}
