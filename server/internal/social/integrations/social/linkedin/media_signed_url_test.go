package linkedin

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"net/http"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

func animatedGIF(t *testing.T, frames int) []byte {
	t.Helper()
	animation := &gif.GIF{LoopCount: 0}
	for i := 0; i < frames; i++ {
		frame := image.NewPaletted(image.Rect(0, 0, 3, 2), color.Palette{color.Transparent, color.White})
		frame.SetColorIndex(i%3, 0, 1)
		animation.Image = append(animation.Image, frame)
		animation.Delay = append(animation.Delay, 10)
	}
	var out bytes.Buffer
	if err := gif.EncodeAll(&out, animation); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestSignedImageURLsPreserveAnimationAndTransparency(t *testing.T) {
	for _, format := range []string{"gif", "png"} {
		t.Run(format, func(t *testing.T) {
			original := animatedGIF(t, 2)
			if format == "png" {
				original = pngBytes(t, 3, 2) // one red pixel, otherwise transparent
			}
			f, srv := newFake(t, nil)
			f.routes["GET /media/image."+format] = func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("signature") != "fixture" {
					t.Error("signed query was lost")
				}
				_, _ = w.Write(original)
			}
			f.routes["POST /rest/images"] = jsonReply(map[string]any{"value": map[string]any{"uploadUrl": srv.URL + "/upload", "image": "urn:li:image:1"}})
			f.routes["PUT /upload"] = func(w http.ResponseWriter, r *http.Request) {}
			_, err := New().PostPendingAs(context.Background(), "org1", "fixture-token", []integrations.PostDetails{{
				ID: "p1", Message: "Signed media", Settings: json.RawMessage(`{}`),
				Media: []integrations.MediaContent{{Type: "image", Path: srv.URL + "/media/image." + format + "?signature=fixture&expires=42&filename=source.pdf", Alt: "A moving white pixel"}},
			}}, Company)
			if err != nil {
				t.Fatal(err)
			}
			uploads := f.find("PUT", "/upload")
			if len(uploads) != 1 {
				t.Fatalf("expected one image upload, got %d", len(uploads))
			}
			if format == "gif" {
				if !bytes.Equal(uploads[0].body, original) {
					t.Fatal("signed GIF was changed or flattened")
				}
				decoded, err := gif.DecodeAll(bytes.NewReader(uploads[0].body))
				if err != nil || len(decoded.Image) != 2 || decoded.Delay[1] != 10 {
					t.Fatalf("animation did not survive upload: %v", err)
				}
			} else {
				decoded, err := png.Decode(bytes.NewReader(uploads[0].body))
				if err != nil {
					t.Fatalf("signed PNG lost its encoding: %v", err)
				}
				_, _, _, alpha := decoded.At(1, 1).RGBA()
				if alpha != 0 || decoded.Bounds() != image.Rect(0, 0, 3, 2) {
					t.Fatal("PNG transparency or dimensions changed")
				}
			}
			if len(f.find("POST", "/rest/posts")) != 0 {
				t.Fatal("published before media processing completed")
			}
		})
	}
}

func TestLinkedInRejectsIncompatibleGIFBeforeProviderMutation(t *testing.T) {
	valid := animatedGIF(t, 2)
	for name, data := range map[string][]byte{
		"too many frames": animatedGIF(t, 251),
		"incomplete":      valid[:len(valid)-1],
		"disguised":       []byte("<html>not an animation</html>"),
	} {
		t.Run(name, func(t *testing.T) {
			f, srv := newFake(t, nil)
			f.routes["GET /media/image.gif"] = func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(data) }
			_, err := New().PostPendingAs(context.Background(), "org1", "fixture-token", []integrations.PostDetails{{
				ID: "p1", Message: "Invalid GIF", Settings: json.RawMessage(`{}`),
				Media: []integrations.MediaContent{{Type: "image", Path: srv.URL + "/media/image.gif?signature=fixture"}},
			}}, Company)
			if err == nil {
				t.Fatal("incompatible GIF accepted")
			}
			if len(f.find("POST", "/rest/images")) != 0 || len(f.find("POST", "/rest/posts")) != 0 {
				t.Fatal("invalid image caused a provider mutation")
			}
		})
	}
}
