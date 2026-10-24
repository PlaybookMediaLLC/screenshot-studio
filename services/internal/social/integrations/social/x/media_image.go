package x

import (
	"bytes"
	"encoding/binary"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/mediaimage"
	"hash/crc32"
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

// inspectGIF applies X's stricter animation limits to the shared validator.
func inspectGIF(data []byte) error {
	if err := mediaimage.ValidateGIF(data, mediaimage.GIFLimits{MaxWidth: 1280, MaxHeight: 1080, MaxFrames: 350, MaxCanvasPixels: 300000000}); err != nil {
		return publishRejected("X: " + err.Error())
	}
	return nil
}
