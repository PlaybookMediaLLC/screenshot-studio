package product

import (
	"bytes"
	"errors"
	"image"
	"image/png"
	"strings"
	"testing"
	"time"
)

func TestAssetDimensions(t *testing.T) {
	var body bytes.Buffer
	if err := png.Encode(&body, image.NewRGBA(image.Rect(0, 0, 1200, 900))); err != nil {
		t.Fatal(err)
	}
	dimensions, err := decodeAssetDimensions(&body)
	if err != nil || dimensions.Width != 1200 || dimensions.Height != 900 {
		t.Fatalf("dimensions=%+v err=%v", dimensions, err)
	}
	if _, err := decodeAssetDimensions(strings.NewReader("not an image")); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid image: %v", err)
	}
}

func TestAssetCursorBoundaries(t *testing.T) {
	original := assetCursor{ID: "asset-1", CreatedAt: time.Date(2026, 10, 21, 12, 30, 45, 123456000, time.UTC), OrganizationID: "org-1", Type: "video", Sort: "oldest"}
	value := encodeAssetCursor(original)
	decoded, err := decodeAssetCursor(value, "org-1", "video", "oldest")
	if err != nil || *decoded != original {
		t.Fatalf("decoded=%+v err=%v", decoded, err)
	}
	for _, bad := range []struct{ value, org, kind, sort string }{
		{value, "org-2", "video", "oldest"}, {value, "org-1", "image", "oldest"}, {value, "org-1", "video", "newest"},
		{"v1.invalid", "org-1", "video", "oldest"}, {"v1." + strings.Repeat("a", 513), "org-1", "video", "oldest"},
	} {
		if _, err := decodeAssetCursor(bad.value, bad.org, bad.kind, bad.sort); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid cursor accepted: %+v", bad)
		}
	}
}
