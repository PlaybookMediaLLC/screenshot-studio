package bluesky

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
	_ "golang.org/x/image/webp"
)

var errMediaUnavailable = errors.New("The Bluesky media file could not be read; try again later")

// copyMedia bounds the actual bytes, including chunked sources and incorrect
// Content-Length values. Signed GET URLs are never changed into HEAD requests.
func copyMedia(ctx context.Context, source string, limit int64, destination io.Writer) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, integrations.MediaReadTimeout)
	defer cancel()
	var reader io.ReadCloser
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
		if err != nil {
			return 0, contentFailure("Could not read the Bluesky media file")
		}
		req.Header.Set("Accept-Encoding", "identity")
		res, err := ssrf.Client().Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return 0, ctx.Err()
			}
			return 0, errMediaUnavailable
		}
		reader = res.Body
		defer reader.Close()
		if res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500 {
			return 0, errMediaUnavailable
		}
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return 0, contentFailure("Could not read the Bluesky media file")
		}
		if res.ContentLength > limit {
			return 0, contentFailure("The Bluesky media file exceeds the upload size limit")
		}
	} else {
		file, err := os.Open(source)
		if err != nil {
			return 0, contentFailure("Could not read the Bluesky media file")
		}
		reader = file
		defer reader.Close()
	}
	n, err := io.Copy(destination, io.LimitReader(reader, limit+1))
	if ctx.Err() != nil {
		return 0, ctx.Err()
	}
	if err != nil {
		return 0, errMediaUnavailable
	}
	if n == 0 {
		return 0, contentFailure("Could not read the complete Bluesky media file")
	}
	if n > limit {
		return 0, contentFailure("The Bluesky media file exceeds the upload size limit")
	}
	return n, nil
}

type preparedImage struct {
	media         integrations.MediaContent
	data          []byte
	mime          string
	width, height int
}

func prepareImages(ctx context.Context, media []integrations.MediaContent, caps socialidentity.BlueskyCapabilities) ([]preparedImage, error) {
	limit := caps.ImageMaxBytes
	if caps.BlobUploadLimit != nil {
		limit = min(limit, *caps.BlobUploadLimit)
	}
	var images []preparedImage
	for _, m := range media {
		var buffer bytes.Buffer
		if _, err := copyMedia(ctx, m.Path, limit, &buffer); err != nil {
			return nil, err
		}
		data := buffer.Bytes()
		cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
		mime := "image/" + format
		if format == "jpeg" {
			mime = "image/jpeg"
		}
		if err != nil || cfg.Width < 1 || cfg.Height < 1 || (format != "png" && format != "jpeg" && format != "gif" && format != "webp") {
			return nil, contentFailure("Choose a valid PNG, JPEG, GIF or WebP image for Bluesky")
		}
		images = append(images, preparedImage{media: m, data: data, mime: mime, width: cfg.Width, height: cfg.Height})
	}
	return images, nil
}

func (p *Provider) uploadMediaForPost(ctx context.Context, a *agent, media []integrations.MediaContent) (any, error) {
	if err := checkPostContent(integrations.PostDetails{Media: media}); err != nil {
		return nil, err
	}
	if len(media) == 0 {
		return nil, nil
	}
	if mediaKind(media[0]) == "video" {
		embed, err := p.uploadVideo(ctx, a, media[0].Path)
		if embed != nil {
			embed.Alt = media[0].Alt
		}
		return embed, err
	}
	// Validate the entire image selection before uploading its first byte.
	prepared, err := prepareImages(ctx, media, a.limits)
	if err != nil {
		return nil, err
	}
	images := make([]embedImage, 0, len(prepared))
	for _, item := range prepared {
		temporalx.SetHeartbeatDetails(ctx, "bluesky: upload blob")
		blob, err := a.uploadBlob(ctx, item.data, item.mime)
		if err != nil {
			return nil, err
		}
		if err := checkBlob(blob, item.mime, a.limits.ImageMaxBytes, a.limits); err != nil {
			return nil, err
		}
		images = append(images, embedImage{Alt: item.media.Alt, Image: blob, AspectRatio: aspectRatio{Width: item.width, Height: item.height}})
	}
	return &imagesEmbed{Type: "app.bsky.embed.images", Images: images}, nil
}

// startVideoUpload verifies current allowance and the complete source before
// sending any bytes. A bounded private temporary file allows exact length and
// MIME checks without holding a 300 MB video in memory; it is always removed.
func (p *Provider) startVideoUpload(ctx context.Context, a *agent, source string) (*jobStatus, error) {
	limits, err := p.videoUploadLimits(ctx, a)
	if err != nil {
		return nil, err
	}
	if err := limits.permits(0); err != nil {
		return nil, err
	}
	file, err := os.CreateTemp("", "shots-bluesky-video-*")
	if err != nil {
		return nil, errVideoUnavailable
	}
	defer os.Remove(file.Name())
	defer file.Close()
	size, err := copyMedia(ctx, source, a.limits.VideoMaxBytes, file)
	if err != nil {
		return nil, err
	}
	if err := limits.permits(size); err != nil {
		return nil, err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, errVideoUnavailable
	}
	prefix := make([]byte, 512)
	n, err := file.Read(prefix)
	if err != nil && err != io.EOF || http.DetectContentType(prefix[:n]) != "video/mp4" {
		return nil, contentFailure("Choose a valid MP4 video for Bluesky")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, errVideoUnavailable
	}
	audience := a.serverDID
	if audience == "" {
		audience = "did:web:" + a.dispatchURL().Host
	}
	token, err := serviceToken(ctx, a, audience, "com.atproto.repo.uploadBlob", 30*time.Minute)
	if err != nil {
		return nil, err
	}
	did, err := a.accountDid()
	if err != nil {
		return nil, err
	}
	parsed, err := url.Parse(source)
	if err != nil {
		return nil, contentFailure("Choose a valid video file")
	}
	// The filename carries neither a signed URL's query nor its private path.
	name := path.Base(parsed.Path)
	if name == "." || name == "/" || name == "" {
		name = "video.mp4"
	}
	endpoint := videoServiceURL + "/xrpc/app.bsky.video.uploadVideo?" + url.Values{"did": {did}, "name": {name}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, file)
	if err != nil {
		return nil, errVideoUnavailable
	}
	req.ContentLength = size
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "video/mp4")
	temporalx.SetHeartbeatDetails(ctx, "bluesky: upload video")
	// A full 300 MB upload needs more time than the small JSON requests. The
	// activity/request context still wins when its deadline is earlier.
	response, err := p.videoHTTP(8 * time.Minute).Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errVideoUnavailable
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, connectionResponseLimit+1))
	var job jobStatus
	if err != nil || len(data) > connectionResponseLimit || response.StatusCode < 200 || response.StatusCode >= 300 || json.Unmarshal(data, &job) != nil || job.JobID == "" || job.Did != did {
		return nil, errVideoUnavailable
	}
	if job.State == "JOB_STATE_FAILED" {
		return nil, contentFailure("Bluesky could not process this video")
	}
	if hasBlob(job.Blob) {
		if err := checkBlob(job.Blob, "video/mp4", a.limits.VideoMaxBytes, a.limits); err != nil {
			return nil, err
		}
	}
	return &job, nil
}
