package x

import (
	"bytes"
	"image"
	"image/gif"
	"image/jpeg"
	"math"

	"golang.org/x/image/draw"
)

// The sharp pipelines of the provider: resize({ width: 1000 }) then .gif() or
// .jpeg() (quality 80, sharp's default).
const resizeWidth = 1000

func scaled(v int, scale float64) int { return int(math.Round(float64(v) * scale)) }

func resize(src image.Image) image.Image {
	b := src.Bounds()
	height := max(scaled(b.Dy(), float64(resizeWidth)/float64(b.Dx())), 1)
	dst := image.NewRGBA(image.Rect(0, 0, resizeWidth, height))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	return dst
}

func toJPEG(data []byte) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	err = jpeg.Encode(&out, resize(img), &jpeg.Options{Quality: 80})
	return out.Bytes(), err
}

// toGIF keeps every frame of an animated GIF (sharp's { animated: true }),
// otherwise converts the first frame.
func toGIF(data []byte, animated bool) ([]byte, error) {
	var out bytes.Buffer
	if animated {
		if g, err := gif.DecodeAll(bytes.NewReader(data)); err == nil && g.Config.Width > 0 {
			scale := float64(resizeWidth) / float64(g.Config.Width)
			for i, frame := range g.Image {
				b := frame.Bounds()
				r := image.Rect(scaled(b.Min.X, scale), scaled(b.Min.Y, scale), scaled(b.Max.X, scale), scaled(b.Max.Y, scale))
				r.Max.X, r.Max.Y = max(r.Max.X, r.Min.X+1), max(r.Max.Y, r.Min.Y+1)
				dst := image.NewPaletted(r, frame.Palette)
				draw.NearestNeighbor.Scale(dst, r, frame, b, draw.Src, nil)
				g.Image[i] = dst
			}
			g.Config.Width, g.Config.Height = resizeWidth, max(scaled(g.Config.Height, scale), 1)
			err = gif.EncodeAll(&out, g)
			return out.Bytes(), err
		}
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	err = gif.Encode(&out, resize(img), nil)
	return out.Bytes(), err
}
