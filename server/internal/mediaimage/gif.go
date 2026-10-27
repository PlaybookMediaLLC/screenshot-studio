// Package mediaimage performs bounded media validation before assets become ready.
package mediaimage

import (
	"bytes"
	"compress/lzw"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// GIFLimits bounds decompression work without allocating whole animation bitmaps.
type GIFLimits struct {
	MaxWidth, MaxHeight, MaxFrames int
	MaxCanvasPixels                int64
}

// ValidateGIF walks every frame without allocating every frame's bitmap. LZW
// output is bounded by each frame, while the canvas/frame count bounds total work.
func ValidateGIF(data []byte, limits GIFLimits) error {
	if len(data) < 14 || (string(data[:6]) != "GIF89a" && string(data[:6]) != "GIF87a") {
		return errors.New("The GIF is incomplete or invalid. Choose another file.")
	}
	width, height := int(binary.LittleEndian.Uint16(data[6:8])), int(binary.LittleEndian.Uint16(data[8:10]))
	if width < 1 || height < 1 || width > limits.MaxWidth || height > limits.MaxHeight {
		return fmt.Errorf("GIFs must be no larger than %d × %d pixels.", limits.MaxWidth, limits.MaxHeight)
	}
	at := 13
	globalColors := 0
	if data[10]&0x80 != 0 {
		globalColors = 1 << ((data[10] & 7) + 1)
		at += 3 * globalColors
	}
	blocks := func() ([]byte, error) {
		var encoded []byte
		for {
			if at >= len(data) {
				return nil, errors.New("The GIF is incomplete or invalid. Choose another file.")
			}
			size := int(data[at])
			at++
			if size == 0 {
				return encoded, nil
			}
			if size > len(data)-at {
				return nil, errors.New("The GIF is incomplete or invalid. Choose another file.")
			}
			encoded = append(encoded, data[at:at+size]...)
			at += size
		}
	}
	frames := 0
	for at < len(data) {
		tag := data[at]
		at++
		switch tag {
		case 0x3b:
			if frames == 0 || at != len(data) {
				return errors.New("The GIF is incomplete or invalid. Choose another file.")
			}
			return nil
		case 0x21:
			if at >= len(data) {
				return errors.New("The GIF is incomplete or invalid. Choose another file.")
			}
			at++ // extension label
			if _, err := blocks(); err != nil {
				return err
			}
		case 0x2c:
			frames++
			if frames > limits.MaxFrames || int64(width)*int64(height)*int64(frames) > limits.MaxCanvasPixels {
				return fmt.Errorf("GIFs support up to %d frames and %d total canvas pixels.", limits.MaxFrames, limits.MaxCanvasPixels)
			}
			if len(data)-at < 9 {
				return errors.New("The GIF is incomplete or invalid. Choose another file.")
			}
			x, y := int(binary.LittleEndian.Uint16(data[at:at+2])), int(binary.LittleEndian.Uint16(data[at+2:at+4]))
			w, h := int(binary.LittleEndian.Uint16(data[at+4:at+6])), int(binary.LittleEndian.Uint16(data[at+6:at+8]))
			flags := data[at+8]
			at += 9
			if w < 1 || h < 1 || x+w > width || y+h > height {
				return errors.New("The GIF is incomplete or invalid. Choose another file.")
			}
			colors := globalColors
			if flags&0x80 != 0 {
				colors = 1 << ((flags & 7) + 1)
				at += 3 * colors
			}
			if colors == 0 || at >= len(data) || data[at] < 2 || data[at] > 8 {
				return errors.New("The GIF is incomplete or invalid. Choose another file.")
			}
			codeSize := int(data[at])
			at++
			encoded, err := blocks()
			if err != nil {
				return err
			}
			decoder := lzw.NewReader(bytes.NewReader(encoded), lzw.LSB, codeSize)
			n, err := io.Copy(gifPaletteValidator(colors), io.LimitReader(decoder, int64(w)*int64(h)+1))
			_ = decoder.Close()
			// Like image/gif, tolerate an omitted LZW end code only after all
			// expected pixels were decoded. The container must still be complete.
			if (err != nil && !errors.Is(err, io.ErrUnexpectedEOF)) || n != int64(w)*int64(h) {
				return errors.New("The GIF is incomplete or invalid. Choose another file.")
			}
		default:
			return errors.New("The GIF is incomplete or invalid. Choose another file.")
		}
	}
	return errors.New("The GIF is incomplete or invalid. Choose another file.")
}

// Validate decoded indices while streaming, without allocating frame bitmaps.
type gifPaletteValidator int

func (colors gifPaletteValidator) Write(pixels []byte) (int, error) {
	for i, pixel := range pixels {
		if int(pixel) >= int(colors) {
			return i, errors.New("The GIF uses a color outside its palette.")
		}
	}
	return len(pixels), nil
}
