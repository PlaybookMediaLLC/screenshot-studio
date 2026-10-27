package posts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"maps"
	"net/http"
	"os"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/upload"
	_ "golang.org/x/image/webp"
)

// UpdateMedia resolves a post's media (post.image) for publishing: fills
// media saved without a path, picks up files the normalizer replaced, adds
// the public url and the local upload path, and converts PNGs to JPEG when
// the provider needs it. Changes are saved back on the post. On any failure
// it returns imagesList unchanged.
func (s *Service) UpdateMedia(ctx context.Context, id string, imagesList []map[string]any, convertToJPEG bool) []map[string]any {
	list, err := s.updateMedia(ctx, id, imagesList, convertToJPEG)
	if err != nil {
		return imagesList
	}
	return list
}

func mediaURLs(m map[string]any, path string) map[string]any {
	out := maps.Clone(m)
	local := !strings.Contains(path, "http")
	out["url"] = path
	out["type"] = "image"
	out["path"] = path
	if local {
		out["url"] = os.Getenv("FRONTEND_URL") + "/" + os.Getenv("NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY") + path
		out["path"] = os.Getenv("UPLOAD_DIRECTORY") + path
	}
	return out
}

func (s *Service) updateMedia(ctx context.Context, id string, imagesList []map[string]any, convertToJPEG bool) ([]map[string]any, error) {
	imageUpdateNeeded := false
	resolved := make([]map[string]any, 0, len(imagesList))
	for _, p := range imagesList {
		if !truthy(p["id"]) {
			resolved = append(resolved, p)
			continue
		}
		mediaID := fmt.Sprint(p["id"])

		if !truthy(p["path"]) {
			imageUpdateNeeded = true
			media, err := s.mediaService.GetMediaByID(ctx, mediaID)
			if err != nil {
				return nil, err
			}
			if media == nil {
				return nil, fmt.Errorf("media %s not found", mediaID)
			}
			m, err := toMap(media)
			if err != nil {
				return nil, err
			}
			resolved = append(resolved, m)
			continue
		}

		// the normalizer may have replaced the file after the post was
		// composed; a record still processing publishes the original
		fresh, err := s.mediaService.GetMediaByID(ctx, mediaID)
		if err != nil {
			return nil, err
		}
		if fresh != nil && fresh.Status == "ready" && fresh.Path != p["path"] {
			imageUpdateNeeded = true
			m := maps.Clone(p)
			m["name"], m["path"] = fresh.Name, fresh.Path
			resolved = append(resolved, m)
			continue
		}
		resolved = append(resolved, p)
	}

	out := make([]map[string]any, 0, len(resolved))
	for _, m := range resolved {
		path, ok := m["path"].(string)
		if !ok {
			return nil, fmt.Errorf("media without a path")
		}
		m = mediaURLs(m, path)

		if convertToJPEG && helpers.HasExtension(m["path"].(string), "png") {
			imageUpdateNeeded = true
			uploaded, err := s.convertToJPEG(ctx, m["url"].(string))
			if err != nil {
				return nil, err
			}
			m = mediaURLs(m, uploaded.Path)
			m["name"] = uploaded.Originalname
		}
		out = append(out, m)
	}

	if imageUpdateNeeded {
		data, err := json.Marshal(out)
		if err != nil {
			return nil, err
		}
		if _, err := s.repo.UpdateImages(ctx, id, string(data)); err != nil {
			return nil, err
		}
	}

	return out, nil
}

// convertToJPEG downloads the image and stores it again as a quality 100
// JPEG (sharp().jpeg({quality: 100})); transparency flattens onto black, as
// with sharp.
func (s *Service) convertToJPEG(ctx context.Context, url string) (*upload.UploadedStream, error) {
	signer, err := upload.NewPrivateMediaSigner()
	if err != nil {
		return nil, err
	}
	url, err = signer.SignURL(ctx, url)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := ssrf.Client().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("download %s: status %d", url, res.StatusCode)
	}
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}

	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 100}); err != nil {
		return nil, err
	}

	return s.storage.UploadFile(ctx, upload.File{Buffer: buf.Bytes(), Mimetype: "image/jpeg", Size: buf.Len()})
}
