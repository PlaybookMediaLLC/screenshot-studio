package x

import (
	"bytes"
	"compress/lzw"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"io"
)

func invalidImage() error {
	return publishRejected("The X image is incomplete or invalid. Choose another file.")
}

func checkImageContainer(data []byte, mime string) error {
	switch mime {
	case "image/jpeg":
		if len(data) < 4 || !bytes.HasSuffix(data, []byte{0xff, 0xd9}) {
			return invalidImage()
		}
	case "image/webp":
		if len(data) < 12 || int64(binary.LittleEndian.Uint32(data[4:8]))+8 != int64(len(data)) {
			return invalidImage()
		}
	case "image/png":
		for at := 8; at < len(data); {
			if len(data)-at < 12 {
				return invalidImage()
			}
			size := int64(binary.BigEndian.Uint32(data[at : at+4]))
			if size > int64(len(data)-at-12) {
				return invalidImage()
			}
			end := at + 8 + int(size)
			if crc32.ChecksumIEEE(data[at+4:end]) != binary.BigEndian.Uint32(data[end:end+4]) {
				return invalidImage()
			}
			if string(data[at+4:at+8]) == "IEND" {
				if size != 0 || end+4 != len(data) {
					return invalidImage()
				}
				return nil
			}
			at = end + 4
		}
		return invalidImage()
	}
	return nil
}

// inspectGIF walks every frame without allocating every frame's bitmap. LZW
// output is bounded by each frame, while the canvas/frame count bounds total work.
func inspectGIF(data []byte) error {
	if len(data) < 14 || (string(data[:6]) != "GIF89a" && string(data[:6]) != "GIF87a") {
		return invalidImage()
	}
	width, height := int(binary.LittleEndian.Uint16(data[6:8])), int(binary.LittleEndian.Uint16(data[8:10]))
	if width < 1 || height < 1 || width > 1280 || height > 1080 {
		return publishRejected("X GIFs must be no larger than 1280 × 1080 pixels.")
	}
	at := 13
	if data[10]&0x80 != 0 {
		at += 3 * (1 << ((data[10] & 7) + 1))
	}
	blocks := func() ([]byte, error) {
		var encoded []byte
		for {
			if at >= len(data) {
				return nil, invalidImage()
			}
			size := int(data[at])
			at++
			if size == 0 {
				return encoded, nil
			}
			if size > len(data)-at {
				return nil, invalidImage()
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
				return invalidImage()
			}
			return nil
		case 0x21:
			if at >= len(data) {
				return invalidImage()
			}
			at++ // extension label
			if _, err := blocks(); err != nil {
				return err
			}
		case 0x2c:
			frames++
			if frames > 350 || int64(width)*int64(height)*int64(frames) > 300000000 {
				return publishRejected("X GIFs support up to 350 frames and 300 million total canvas pixels.")
			}
			if len(data)-at < 9 {
				return invalidImage()
			}
			x, y := int(binary.LittleEndian.Uint16(data[at:at+2])), int(binary.LittleEndian.Uint16(data[at+2:at+4]))
			w, h := int(binary.LittleEndian.Uint16(data[at+4:at+6])), int(binary.LittleEndian.Uint16(data[at+6:at+8]))
			flags := data[at+8]
			at += 9
			if w < 1 || h < 1 || x+w > width || y+h > height {
				return invalidImage()
			}
			if flags&0x80 != 0 {
				at += 3 * (1 << ((flags & 7) + 1))
			}
			if at >= len(data) || data[at] < 2 || data[at] > 8 {
				return invalidImage()
			}
			codeSize := int(data[at])
			at++
			encoded, err := blocks()
			if err != nil {
				return err
			}
			decoder := lzw.NewReader(bytes.NewReader(encoded), lzw.LSB, codeSize)
			n, err := io.Copy(io.Discard, io.LimitReader(decoder, int64(w)*int64(h)+1))
			_ = decoder.Close()
			// Like image/gif, tolerate an omitted LZW end code only after all
			// expected pixels were decoded. The container must still be complete.
			if (err != nil && !errors.Is(err, io.ErrUnexpectedEOF)) || n != int64(w)*int64(h) {
				return invalidImage()
			}
		default:
			return invalidImage()
		}
	}
	return invalidImage()
}
