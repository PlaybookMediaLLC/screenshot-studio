package product

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/mediadocument"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/mediaimage"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/medialimits"
)

// Upload checks (RFC 025): an upload's bytes must be what it says it is,
// checked from storage when it completes, so a renamed file cannot pass as
// an image or a PDF. A PDF is also held to LinkedIn's document limits.

// objectOpener streams a stored object, to check an upload's bytes.
type objectOpener interface {
	Open(ctx context.Context, key string) (io.ReadCloser, error)
}

// sniffedTypes are the media types whose first bytes are checked, and what
// net/http's sniffer reports for each.
var sniffedTypes = map[string]string{
	"image/gif": "image/gif", "image/jpeg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp",
	"video/mp4": "video/mp4", "video/webm": "video/webm",
}

// verifyAssetBytes checks an object's bytes against its declared type.
func verifyAssetBytes(mediaType string, object io.Reader) error {
	reader := bufio.NewReaderSize(object, 4096)
	head, _ := reader.Peek(512)
	if mediaType == "application/pdf" {
		if !bytes.HasPrefix(head, []byte("%PDF-")) {
			return invalid("This file is not a PDF.")
		}
		pages, known := countPDFPages(reader)
		if !known {
			return invalid("This PDF is malformed, encrypted, or has an unreadable page tree.")
		}
		if pages > medialimits.Limits.PDFPages {
			return invalid("LinkedIn takes documents of up to 300 pages; this one has " + strconv.Itoa(pages) + ".")
		}
		return nil
	}
	want, checked := sniffedTypes[mediaType]
	if !checked {
		return nil
	}
	got := http.DetectContentType(head)
	if !strings.HasPrefix(got, want) {
		return invalid("This file's contents are not a " + mediaType + " file.")
	}
	if strings.HasPrefix(mediaType, "image/") {
		data, err := io.ReadAll(io.LimitReader(reader, int64(medialimits.Limits.PaidImageBytes)+1))
		if err != nil {
			return err
		}
		if len(data) > medialimits.Limits.PaidImageBytes {
			return invalid("The image exceeds 20 MB.")
		}
		if _, err := decodeAssetDimensions(bytes.NewReader(data)); err != nil {
			return err
		}
		if mediaType == "image/gif" {
			if err := mediaimage.ValidateGIF(data, mediaimage.GIFLimits{MaxWidth: 65535, MaxHeight: 65535, MaxFrames: 1000, MaxCanvasPixels: 300000000}); err != nil {
				return invalid(err.Error())
			}
			return nil
		}
		if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
			return invalid("The image is incomplete or cannot be decoded.")
		}
	}
	return nil
}

// countPDFPages shares the same parser with the native document publisher.
func countPDFPages(object io.Reader) (int, bool) { return mediadocument.CountPages(object) }

// verifyUploadedContent consumes at most the reserved size plus one byte. Neither
// a dishonest Content-Length nor a caller-supplied checksum establishes readiness.
func verifyUploadedContent(source io.Reader, mediaType string, size int, digest *string) error {
	hash := sha256.New()
	limited := &io.LimitedReader{R: source, N: int64(size) + 1}
	reader := bufio.NewReader(io.TeeReader(limited, hash))
	if err := verifyAssetBytes(mediaType, reader); err != nil {
		return err
	}
	if _, err := io.Copy(io.Discard, reader); err != nil {
		return err
	}
	if int64(size)+1-limited.N != int64(size) {
		return invalid("The stored file size differs from the reserved upload. Upload the complete file again.")
	}
	if digest != nil && !strings.EqualFold(fmt.Sprintf("%x", hash.Sum(nil)), *digest) {
		return invalid("The uploaded file checksum does not match. Upload the file again.")
	}
	return nil
}
