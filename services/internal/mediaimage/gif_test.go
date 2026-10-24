package mediaimage

import (
	"bytes"
	"compress/lzw"
	"image/gif"
	"testing"
)

func TestGIFRejectsMissingPaletteAndOutOfRangePixel(t *testing.T) {
	limits := GIFLimits{MaxWidth: 100, MaxHeight: 100, MaxFrames: 2, MaxCanvasPixels: 20000}
	for _, test := range []struct {
		name    string
		palette bool
		pixel   byte
		valid   bool
	}{
		{"valid palette index", true, 1, true},
		{"index outside palette", true, 2, false},
		{"missing palette", false, 0, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00")
			if test.palette {
				body[10] = 0x80
				body = append(body, 0, 0, 0, 255, 255, 255)
			}
			body = append(body, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2)
			var encoded bytes.Buffer
			writer := lzw.NewWriter(&encoded, lzw.LSB, 2)
			if _, err := writer.Write([]byte{test.pixel}); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			body = append(body, byte(encoded.Len()))
			body = append(body, encoded.Bytes()...)
			body = append(body, 0, 0x3b)
			// The independent standard decoder confirms the fixture's meaning.
			_, decoded := gif.DecodeAll(bytes.NewReader(body))
			if (decoded == nil) != test.valid {
				t.Fatalf("decoder fixture: %v", decoded)
			}
			if err := ValidateGIF(body, limits); (err == nil) != test.valid {
				t.Fatalf("valid=%v, got %v", test.valid, err)
			}
		})
	}
}
