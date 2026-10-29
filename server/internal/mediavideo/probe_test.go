package mediavideo

import (
	"bytes"
	"os"
	"slices"
	"testing"
)

func TestProbeReadsDurationDisplaySizeAndCodecs(t *testing.T) {
	for _, tc := range []struct {
		file          string
		durationMs    int
		width, height int
		codecs        []string
	}{
		// moov after mdat, as most cameras write it.
		{"portrait.mp4", 4000, 240, 426, []string{"avc1", "mp4a"}},
		// moov before mdat (faststart).
		{"faststart.mp4", 3000, 320, 180, []string{"avc1"}},
		// A QuickTime movie whose 320x180 track is displayed a quarter turn.
		{"rotated.mov", 2500, 180, 320, []string{"avc1"}},
	} {
		body, err := os.ReadFile("testdata/" + tc.file)
		if err != nil {
			t.Fatal(err)
		}
		info, err := Probe(bytes.NewReader(body))
		if err != nil || info.DurationMs < tc.durationMs-50 || info.DurationMs > tc.durationMs+50 ||
			info.Width != tc.width || info.Height != tc.height || !slices.Equal(info.Codecs, tc.codecs) {
			t.Fatalf("%s: %+v err=%v", tc.file, info, err)
		}
	}
}

func TestProbeRejectsTruncatedAndForeignFiles(t *testing.T) {
	body, err := os.ReadFile("testdata/portrait.mp4")
	if err != nil {
		t.Fatal(err)
	}
	for name, input := range map[string][]byte{
		"truncated": body[:len(body)-200],
		"no moov":   body[:len(body)/3],
		"png":       []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
		"empty":     nil,
		"tiny box":  {0, 0, 0, 4, 'f', 't', 'y', 'p'},
	} {
		if _, err := Probe(bytes.NewReader(input)); err != ErrInvalid {
			t.Fatalf("%s: err=%v", name, err)
		}
	}
}
