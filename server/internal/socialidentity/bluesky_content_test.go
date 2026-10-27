package socialidentity

import (
	"strings"
	"testing"
)

func TestBlueskyTextUsesBothGraphemesAndBytes(t *testing.T) {
	for _, tc := range []struct {
		name, text string
		valid      bool
	}{
		{"ascii boundary", strings.Repeat("a", 300), true},
		{"ascii overflow", strings.Repeat("a", 301), false},
		{"emoji", strings.Repeat("👍🏽", 300), true},
		{"combining", strings.Repeat("e\u0301", 300), true},
		{"joined emoji", strings.Repeat("👩‍💻", 200), true},
		{"byte overflow despite 300 graphemes", strings.Repeat("👩‍💻", 300), false},
		{"invalid utf8", string([]byte{0xff}), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := CheckBlueskyText(tc.text); (got == nil) != tc.valid {
				t.Fatalf("valid=%v: %v", tc.valid, got)
			}
		})
	}
}

func TestBlueskyMediaBounds(t *testing.T) {
	yes, no := true, false
	for _, tc := range []struct {
		name       string
		media      []BlueskyMedia
		permission *bool
		blob       int64
		valid      bool
	}{
		{"text", nil, nil, 0, true},
		{"image boundary", []BlueskyMedia{{"image/png", 2000000}}, nil, 0, true},
		{"oversized image", []BlueskyMedia{{"image/png", 2000001}}, nil, 0, false},
		{"server bound", []BlueskyMedia{{"image/png", 101}}, nil, 100, false},
		{"empty image", []BlueskyMedia{{"image/png", 0}}, nil, 0, false},
		{"unsupported image", []BlueskyMedia{{"image/svg+xml", 100}}, nil, 0, false},
		{"video unknown", []BlueskyMedia{{"video/mp4", 100}}, nil, 0, false},
		{"video denied", []BlueskyMedia{{"video/mp4", 100}}, &no, 0, false},
		{"video boundary", []BlueskyMedia{{"video/mp4", 300000000}}, &yes, 100, true},
		{"video overflow", []BlueskyMedia{{"video/mp4", 300000001}}, &yes, 0, false},
		{"wrong video", []BlueskyMedia{{"video/webm", 100}}, &yes, 0, false},
		{"mixed", []BlueskyMedia{{"video/mp4", 100}, {"image/png", 100}}, &yes, 0, false},
		{"two videos", []BlueskyMedia{{"video/mp4", 100}, {"video/mp4", 100}}, &yes, 0, false},
		{"four images", []BlueskyMedia{{"image/png", 1}, {"image/png", 1}, {"image/png", 1}, {"image/png", 1}}, nil, 0, true},
		{"five images", []BlueskyMedia{{"image/png", 1}, {"image/png", 1}, {"image/png", 1}, {"image/png", 1}, {"image/png", 1}}, nil, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			caps := BlueskyLexiconLimits()
			caps.VideoCanUpload = tc.permission
			if tc.blob > 0 {
				caps.BlobUploadLimit = &tc.blob
			}
			if err := CheckBlueskyMedia(caps, tc.media); (err == nil) != tc.valid {
				t.Fatalf("valid=%v: %v", tc.valid, err)
			}
		})
	}
}
