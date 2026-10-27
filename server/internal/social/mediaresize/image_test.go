package mediaresize

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math/rand/v2"
	"testing"
)

func TestFitPreservesAlphaAndBounds(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 700, 500))
	rng := rand.New(rand.NewPCG(1, 2))
	for y := 0; y < 500; y++ {
		for x := 0; x < 700; x++ {
			img.SetNRGBA(x, y, color.NRGBA{uint8(rng.Uint32()), uint8(rng.Uint32()), uint8(rng.Uint32()), 120})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatal(err)
	}
	original := bytes.Clone(encoded.Bytes())
	output, mime, err := Fit(original, "image/png", 100_000)
	if err != nil || mime != "image/png" || len(output) > 100_000 {
		t.Fatalf("fit %s %d: %v", mime, len(output), err)
	}
	decoded, err := png.Decode(bytes.NewReader(output))
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, alpha := decoded.At(0, 0).RGBA()
	if alpha == 65535 || !bytes.Equal(original, encoded.Bytes()) {
		t.Fatal("transparency or original lost")
	}
}
func TestFitRejectsOversizedAnimationAndMalformedData(t *testing.T) {
	for _, mime := range []string{"image/gif", "video/mp4", "image/png"} {
		if _, _, err := Fit(make([]byte, 2048), mime, 1024); err == nil {
			t.Fatal(mime)
		}
	}
	original := []byte("unchanged")
	got, _, err := Fit(original, "image/png", 1024)
	if err != nil || !bytes.Equal(got, original) {
		t.Fatal("small input changed")
	}
}
