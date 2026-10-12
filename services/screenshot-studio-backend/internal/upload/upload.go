// Package upload is Postiz's libraries/nestjs-libraries/src/upload: the
// storage providers (local disk, Cloudflare R2), the R2 multipart endpoints,
// upload validation, the multer stream engine equivalent and the RunPod media
// processors.
package upload

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/url"
	"os"
	"regexp"
)

// UploadedStream is what a provider returns for a streamed upload.
type UploadedStream struct {
	Filename     string `json:"filename"`
	Originalname string `json:"originalname"`
	Path         string `json:"path"`
	Mimetype     string `json:"mimetype"`
}

// File is the part of Express.Multer.File uploadFile reads.
type File struct {
	Buffer       []byte
	Mimetype     string
	Size         int
	Originalname string
}

// Provider is IUploadProvider.
type Provider interface {
	UploadSimple(ctx context.Context, path string) (string, error)
	UploadFile(ctx context.Context, file File) (*UploadedStream, error)
	// UploadStream streams the body straight into storage without buffering
	// it. The caller has already sniffed the real type from the first bytes,
	// so it passes the detected mime/ext instead of the provider re-sniffing.
	UploadStream(ctx context.Context, body io.Reader, mimetype, ext string) (*UploadedStream, error)
	RemoveFile(ctx context.Context, filePath string) error
}

// CloudProvider holds IUploadProvider's optional methods, which only cloud
// storage implements: presigned URLs handed to the media processor (it has
// no storage credentials), the public URL of a key it wrote, and small text
// files (a transcript) exchanged with it under a key both sides know.
type CloudProvider interface {
	Provider
	SignDownloadURL(ctx context.Context, fileName string) (string, error)
	SignUploadURL(ctx context.Context, fileName, contentType string) (string, error)
	PublicURL(fileName string) string
	ReadFile(ctx context.Context, fileName string) (string, error)
	WriteFile(ctx context.Context, fileName, body, contentType string) error
}

// CreateStorage is UploadFactory.createStorage.
func CreateStorage() (Provider, error) {
	storageProvider := os.Getenv("STORAGE_PROVIDER")
	if storageProvider == "" {
		storageProvider = "local"
	}
	switch storageProvider {
	case "local":
		return NewLocalStorage(os.Getenv("UPLOAD_DIRECTORY")), nil
	case "cloudflare":
		return NewCloudflareStorage(
			os.Getenv("CLOUDFLARE_ACCOUNT_ID"),
			os.Getenv("CLOUDFLARE_ACCESS_KEY"),
			os.Getenv("CLOUDFLARE_SECRET_ACCESS_KEY"),
			os.Getenv("CLOUDFLARE_REGION"),
			os.Getenv("CLOUDFLARE_BUCKETNAME"),
			os.Getenv("CLOUDFLARE_BUCKET_URL"),
		), nil
	}
	return nil, fmt.Errorf("Invalid storage type %s", storageProvider)
}

// ProcessorEnabled reports whether normalization is available. It needs
// presigned URLs, so it is only available on cloud storage.
func ProcessorEnabled() bool {
	return os.Getenv("STORAGE_PROVIDER") == "cloudflare" &&
		os.Getenv("RUNPOD_API_KEY") != "" &&
		os.Getenv("RUNPOD_ENDPOINT_ID") != ""
}

// CreateProcessor returns the normalization processor, nil when disabled.
func CreateProcessor() MediaProcessor[MediaProcessorJob, MediaProcessorResult] {
	if !ProcessorEnabled() {
		return nil
	}
	return NewRunPodMediaProcessor[MediaProcessorJob, MediaProcessorResult](os.Getenv("RUNPOD_API_KEY"), os.Getenv("RUNPOD_ENDPOINT_ID"))
}

// ClippingEnabled reports whether clipping is available. Clipping hands
// presigned URLs to the ingest and clip endpoints and to the transcriber, so
// it is only available on cloud storage as well.
func ClippingEnabled() bool {
	return os.Getenv("STORAGE_PROVIDER") == "cloudflare" &&
		os.Getenv("RUNPOD_API_KEY") != "" &&
		os.Getenv("RUNPOD_INGEST_ENDPOINT_ID") != "" &&
		os.Getenv("RUNPOD_CLIPPER_ENDPOINT_ID") != "" &&
		os.Getenv("DEEPGRAM_API_KEY") != "" &&
		// the clips are picked by the model
		os.Getenv("OPENAI_API_KEY") != ""
}

// CreateIngestProcessor returns the ingest processor, nil when disabled.
func CreateIngestProcessor() MediaProcessor[IngestJob, IngestResult] {
	if !ClippingEnabled() {
		return nil
	}
	return NewRunPodMediaProcessor[IngestJob, IngestResult](os.Getenv("RUNPOD_API_KEY"), os.Getenv("RUNPOD_INGEST_ENDPOINT_ID"))
}

// CreateClipProcessor returns the clip processor, nil when disabled.
func CreateClipProcessor() MediaProcessor[ClipJob, ClipResult] {
	if !ClippingEnabled() {
		return nil
	}
	return NewRunPodMediaProcessor[ClipJob, ClipResult](os.Getenv("RUNPOD_API_KEY"), os.Getenv("RUNPOD_CLIPPER_ENDPOINT_ID"))
}

var dataURLRegex = regexp.MustCompile(`^data:([^;,]+)?(;base64)?,([\s\S]*)$`)

// ParseDataURL parses a `data:` URL into its bytes and mime type; ok is false
// when the value is not a valid data URL. gpt-image models only return
// base64 image data (never a URL), so the image generation flow hands
// UploadSimple a data URL instead of a remote URL.
func ParseDataURL(value string) (data []byte, mime string, ok bool) {
	match := dataURLRegex.FindStringSubmatch(value)
	if match == nil {
		return nil, "", false
	}
	mime = match[1]
	if mime == "" {
		mime = "application/octet-stream"
	}
	if match[2] != "" {
		// Buffer.from(..., 'base64') is lenient: it ignores invalid characters
		// and missing padding
		return lenientBase64(match[3]), mime, true
	}
	decoded, err := url.PathUnescape(match[3])
	if err != nil {
		// decodeURIComponent throws URIError on a malformed escape
		return nil, "", false
	}
	return []byte(decoded), mime, true
}

func lenientBase64(s string) []byte {
	clean := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '+', c == '/':
			clean = append(clean, c)
		case c == '-':
			clean = append(clean, '+')
		case c == '_':
			clean = append(clean, '/')
		case c == '=':
			i = len(s)
		}
	}
	// a dangling single character carries no full byte; Node drops it
	if len(clean)%4 == 1 {
		clean = clean[:len(clean)-1]
	}
	out, _ := base64.RawStdEncoding.DecodeString(string(clean))
	return out
}
