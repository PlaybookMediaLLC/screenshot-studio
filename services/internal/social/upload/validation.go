package upload

import (
	"context"
	"errors"
	"io"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// UploadAllowedMime is what users may put in the media library, whether by
// multipart upload or from a remote URL; narrower than what storage itself
// accepts, no audio.
var UploadAllowedMime = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
	"image/avif": true,
	"image/bmp":  true,
	"image/tiff": true,
	"video/mp4":  true,
}

// GetMaxSize is the per-type size cap; other types are a 400.
func GetMaxSize(mimeType string) (int64, error) {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return 10 * 1024 * 1024, nil // 10 MB
	case strings.HasPrefix(mimeType, "video/"):
		return 1024 * 1024 * 1024, nil // 1 GB
	}
	return 0, httpx.BadRequest("Unsupported file type.")
}

// MaxSizeReader passes bytes through and fails once they exceed max, so a
// body with a missing or lying Content-Length cannot be streamed into storage
// unbounded (maxSizeStream).
type MaxSizeReader struct {
	R        io.Reader
	Max      int64
	total    int64
	Exceeded bool
}

func (m *MaxSizeReader) Read(p []byte) (int, error) {
	n, err := m.R.Read(p)
	m.total += int64(n)
	if m.total > m.Max {
		m.Exceeded = true
		return 0, httpx.BadRequest("File is too large.")
	}
	return n, err
}

// UploadedWithExt is uploadStreamToStorage's result: the stored file plus
// the detected extension.
type UploadedWithExt struct {
	UploadedStream
	Ext string `json:"ext"`
}

// UploadStreamToStorage sniffs the real type from the first bytes, applies
// the per-type size cap and streams the rest into storage, so only the
// sniffing prefix and a few upload parts are ever in memory. Rejections are
// 400s with the same messages the old buffer validation used. declaredSize is
// the Content-Length when the sender gave one; it may be absent or wrong, so
// the stream cap is what really enforces the limit.
func UploadStreamToStorage(ctx context.Context, storage Provider, body io.Reader, declaredSize int64) (*UploadedWithExt, error) {
	prefix := make([]byte, SniffSize)
	n, err := io.ReadFull(body, prefix)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		return nil, httpx.BadRequest("Failed to read file")
	}
	prefix = prefix[:n]

	detected := DetectFileType(prefix)
	if detected == nil || !UploadAllowedMime[detected.Mime] {
		return nil, httpx.BadRequest("Unsupported file type.")
	}

	maxSize, err := GetMaxSize(detected.Mime)
	if err != nil {
		return nil, err
	}
	if declaredSize > maxSize {
		return nil, httpx.BadRequest("File is too large.")
	}

	capped := &MaxSizeReader{R: io.MultiReader(strings.NewReader(string(prefix)), body), Max: maxSize}
	uploaded, err := storage.UploadStream(ctx, capped, detected.Mime, detected.Ext)
	if err != nil {
		// The size cap rejects mid-upload with its own 400, whatever the
		// storage client wrapped it in
		if capped.Exceeded {
			return nil, httpx.BadRequest("File is too large.")
		}
		return nil, err
	}
	return &UploadedWithExt{UploadedStream: *uploaded, Ext: detected.Ext}, nil
}
