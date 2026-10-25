// Package mediaresize adapts static images while preserving their stored originals.
package mediaresize

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"image/png"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// MaxSourceBytes is the composer import ceiling for automatic image resizing.
const MaxSourceBytes int64 = 20_000_000

// Static reports the image formats that can be resized without losing animation.
func Static(mime string) bool {
	return mime == "image/png" || mime == "image/jpeg" || mime == "image/webp"
}

// Fit returns a bounded provider copy; bytes already within the limit are untouched.
// Transparent pixels are kept, and GIF/video is never silently flattened.
func Fit(data []byte, mime string, limit int64) ([]byte, string, error) {
	if int64(len(data)) <= limit {
		return data, mime, nil
	}
	if !Static(mime) || int64(len(data)) > MaxSourceBytes || limit < 1024 {
		return nil, "", errors.New("image exceeds the supported resize limits")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || !Static("image/"+format) || cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 40_000_000 {
		return nil, "", errors.New("choose a valid static image of at most 40 megapixels")
	}
	original, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", errors.New("the complete image could not be decoded")
	}
	width, height := cfg.Width, cfg.Height
	for attempt := 0; attempt < 18; attempt++ {
		if width > 4096 || height > 4096 || attempt > 0 {
			width = max(1, width*4/5)
			height = max(1, height*4/5)
		}
		if width > 4096 || height > 4096 {
			continue
		}
		resized := image.NewNRGBA(image.Rect(0, 0, width, height))
		draw.CatmullRom.Scale(resized, resized.Bounds(), original, original.Bounds(), draw.Src, nil)
		var output bytes.Buffer
		outMime := "image/png"
		if resized.Opaque() {
			err = jpeg.Encode(&output, resized, &jpeg.Options{Quality: 85})
			outMime = "image/jpeg"
		} else {
			err = png.Encode(&output, resized)
		}
		if err != nil {
			return nil, "", err
		}
		if int64(output.Len()) <= limit {
			return output.Bytes(), outMime, nil
		}
	}
	return nil, "", errors.New("this image could not fit the destination limit; resize it in the editor")
}
