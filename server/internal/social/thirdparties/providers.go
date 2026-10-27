package thirdparties

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/openai"
)

// Base URLs and the HeyGen poll interval, overridden in tests.
var (
	heygenURL      = "https://api.heygen.com"
	reelFarmURL    = "https://reel.farm/api/v1"
	heygenInterval = 3 * time.Second
)

// fetch sends the request and returns the status and the raw body.
func fetch(ctx context.Context, method, url string, headers map[string]string, body any) (int, []byte, error) {
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return 0, nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	return res.StatusCode, data, err
}

// fetchJSON is fetch(...).json(): the body is decoded whatever the status.
func fetchJSON(ctx context.Context, method, url string, headers map[string]string, body any, out any) error {
	_, data, err := fetch(ctx, method, url, headers, body)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func ok(status int) bool { return status >= 200 && status <= 299 }

// HeygenProvider creates AI avatar videos with HeyGen.
type HeygenProvider struct {
	openai *openai.Service
}

func NewHeygenProvider(openaiService *openai.Service) *HeygenProvider {
	return &HeygenProvider{openai: openaiService}
}

func (*HeygenProvider) Params() Params {
	return Params{
		Identifier:  "heygen",
		Title:       "HeyGen",
		Description: "HeyGen is a platform for creating AI-generated avatars videos.",
		Position:    "media",
		Fields:      []Field{},
	}
}

func heygenHeaders(apiKey string) map[string]string {
	return map[string]string{"accept": "application/json", "x-api-key": apiKey}
}

func (h *HeygenProvider) Functions() map[string]Function {
	return map[string]Function{
		"checkConnection": func(ctx context.Context, apiKey string, _ json.RawMessage) (any, error) {
			connection, err := h.CheckConnection(ctx, apiKey)
			if connection == nil {
				return false, err
			}
			return connection, err
		},
		"generateVoice": func(ctx context.Context, apiKey string, data json.RawMessage) (any, error) {
			var body struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal(data, &body)
			return h.GenerateVoice(ctx, apiKey, body.Text)
		},
		"voices": func(ctx context.Context, apiKey string, _ json.RawMessage) (any, error) {
			return h.Voices(ctx, apiKey)
		},
		"avatars": func(ctx context.Context, apiKey string, _ json.RawMessage) (any, error) {
			return h.Avatars(ctx, apiKey)
		},
		"sendData": func(ctx context.Context, apiKey string, data json.RawMessage) (any, error) {
			return h.SendData(ctx, apiKey, data)
		},
	}
}

func (*HeygenProvider) CheckConnection(ctx context.Context, apiKey string) (*Connection, error) {
	var body struct {
		Data struct {
			FirstName any    `json:"first_name"`
			LastName  any    `json:"last_name"`
			Username  string `json:"username"`
		} `json:"data"`
	}
	status, data, err := fetch(ctx, http.MethodGet, heygenURL+"/v1/user/me", heygenHeaders(apiKey), nil)
	if err != nil {
		return nil, err
	}
	if !ok(status) {
		return nil, nil
	}
	if err := json.Unmarshal(data, &body); err != nil {
		return nil, err
	}
	return &Connection{
		Name:     jsString(body.Data.FirstName) + " " + jsString(body.Data.LastName),
		Username: body.Data.Username,
		ID:       body.Data.Username,
	}, nil
}

func (h *HeygenProvider) GenerateVoice(ctx context.Context, apiKey, text string) (any, error) {
	voice, err := h.openai.GenerateVoiceFromText(ctx, text)
	if err != nil {
		return nil, err
	}
	return map[string]any{"voice": voice}, nil
}

func (*HeygenProvider) Voices(ctx context.Context, apiKey string) ([]any, error) {
	var body struct {
		Data struct {
			Voices []any `json:"voices"`
		} `json:"data"`
	}
	if err := fetchJSON(ctx, http.MethodGet, heygenURL+"/v2/voices", heygenHeaders(apiKey), nil, &body); err != nil {
		return nil, err
	}
	voices := body.Data.Voices
	if len(voices) > 20 {
		voices = voices[:20]
	}
	if voices == nil {
		voices = []any{}
	}
	return voices, nil
}

func (*HeygenProvider) Avatars(ctx context.Context, apiKey string) ([]any, error) {
	var groups struct {
		Data struct {
			AvatarGroupList []struct {
				ID any `json:"id"`
			} `json:"avatar_group_list"`
		} `json:"data"`
	}
	if err := fetchJSON(ctx, http.MethodGet, heygenURL+"/v2/avatar_group.list?include_public=false", heygenHeaders(apiKey), nil, &groups); err != nil {
		return nil, err
	}

	loadedAvatars := []any{}
	for _, avatar := range groups.Data.AvatarGroupList {
		var list struct {
			Data struct {
				AvatarList []any `json:"avatar_list"`
			} `json:"data"`
		}
		if err := fetchJSON(ctx, http.MethodGet, fmt.Sprintf("%s/v2/avatar_group/%s/avatars", heygenURL, jsString(avatar.ID)), heygenHeaders(apiKey), nil, &list); err != nil {
			return nil, err
		}
		loadedAvatars = append(loadedAvatars, list.Data.AvatarList...)
	}
	return loadedAvatars, nil
}

// HeygenData is sendData's body.
type HeygenData struct {
	Voice         string `json:"voice"`
	Avatar        string `json:"avatar"`
	AspectRatio   string `json:"aspect_ratio"`
	Captions      string `json:"captions"`
	SelectedVoice string `json:"selectedVoice"`
	Type          string `json:"type"` // talking_photo | avatar
}

func (*HeygenProvider) SendData(ctx context.Context, apiKey string, raw json.RawMessage) (string, error) {
	var data HeygenData
	_ = json.Unmarshal(raw, &data)

	character := map[string]any{"type": "talking_photo", "talking_photo_id": data.Avatar}
	if data.Type == "avatar" {
		character = map[string]any{"type": "avatar", "avatar_id": data.Avatar}
	}
	dimension := map[string]any{"width": 1280, "height": 720}
	if data.AspectRatio == "story" {
		dimension = map[string]any{"width": 720, "height": 1280}
	}
	headers := heygenHeaders(apiKey)
	headers["content-type"] = "application/json"

	var generated struct {
		Data struct {
			VideoID any `json:"video_id"`
		} `json:"data"`
	}
	if err := fetchJSON(ctx, http.MethodPost, heygenURL+"/v2/video/generate", headers, map[string]any{
		"caption": data.Captions == "yes",
		"video_inputs": []any{map[string]any{
			"character": character,
			"voice": map[string]any{
				"type":       "text",
				"input_text": data.Voice,
				"voice_id":   data.SelectedVoice,
			},
		}},
		"dimension": dimension,
	}, &generated); err != nil {
		return "", err
	}

	const maxAttempts = 180 // ~9 minutes at 3s interval
	for attempts := 0; ; attempts++ {
		if attempts >= maxAttempts {
			return "", errors.New("Video generation timed out")
		}

		var status struct {
			Data struct {
				Status   string `json:"status"`
				VideoURL string `json:"video_url"`
			} `json:"data"`
		}
		if err := fetchJSON(ctx, http.MethodGet, heygenURL+"/v1/video_status.get?video_id="+jsString(generated.Data.VideoID), headers, nil, &status); err != nil {
			return "", err
		}

		switch status.Data.Status {
		case "completed":
			return status.Data.VideoURL, nil
		case "failed":
			return "", errors.New("Video generation failed")
		}

		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(heygenInterval):
		}
	}
}

// ReelFarmProvider imports UGC and greenscreen videos from Reel.Farm.
type ReelFarmProvider struct{}

func NewReelFarmProvider() *ReelFarmProvider { return &ReelFarmProvider{} }

func (*ReelFarmProvider) Params() Params {
	return Params{
		Identifier:  "reelfarm",
		Title:       "Reel.Farm",
		Description: "Import UGC and greenscreen videos from your Reel.Farm account.",
		Position:    "media-library",
		Fields:      []Field{},
	}
}

func (r *ReelFarmProvider) Functions() map[string]Function {
	return map[string]Function{
		"checkConnection": func(ctx context.Context, apiKey string, _ json.RawMessage) (any, error) {
			connection, err := r.CheckConnection(ctx, apiKey)
			if connection == nil {
				return false, err
			}
			return connection, err
		},
		"listMedia": func(ctx context.Context, apiKey string, data json.RawMessage) (any, error) {
			var body struct {
				Page any `json:"page"`
			}
			_ = json.Unmarshal(data, &body)
			return r.ListMedia(ctx, apiKey, body.Page)
		},
		"importMedia": func(ctx context.Context, apiKey string, data json.RawMessage) (any, error) {
			var items []ImportItem
			_ = json.Unmarshal(data, &items)
			return r.ImportMedia(ctx, apiKey, items)
		},
		"sendData": func(ctx context.Context, apiKey string, data json.RawMessage) (any, error) {
			return r.SendData(ctx, apiKey, data)
		},
	}
}

func reelFarmHeaders(apiKey string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + apiKey}
}

func (*ReelFarmProvider) CheckConnection(ctx context.Context, apiKey string) (*Connection, error) {
	status, _, err := fetch(ctx, http.MethodGet, reelFarmURL+"/videos?limit=1", reelFarmHeaders(apiKey), nil)
	if err != nil {
		return nil, err
	}
	if !ok(status) {
		return nil, nil
	}
	id := apiKey
	if len(id) > 8 {
		id = id[len(id)-8:]
	}
	return &Connection{Name: "Reel.Farm", Username: "reelfarm", ID: id}, nil
}

// MediaItem is one listMedia result.
type MediaItem struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Thumbnail string `json:"thumbnail"`
	Name      string `json:"name"`
	Type      string `json:"type"` // video | image
}

// MediaPage is listMedia's {results, pages}.
type MediaPage struct {
	Results []MediaItem `json:"results"`
	Pages   int         `json:"pages"`
}

// pageNumber is data?.page || 1, coerced to a number like page - 1 does.
func pageNumber(page any) float64 {
	if !truthy(page) {
		return 1
	}
	switch p := page.(type) {
	case float64:
		return p
	case string:
		if n, err := strconv.ParseFloat(strings.TrimSpace(p), 64); err == nil {
			return n
		}
	}
	return math.NaN()
}

func (*ReelFarmProvider) ListMedia(ctx context.Context, apiKey string, page any) (*MediaPage, error) {
	const limit = 20
	offset := (pageNumber(page) - 1) * limit

	allVideos := []map[string]any{}
	for _, videoType := range []string{"ugc", "greenscreen"} {
		status, data, err := fetch(ctx, http.MethodGet,
			fmt.Sprintf("%s/videos?video_type=%s&status=completed&limit=%d&offset=%s", reelFarmURL, videoType, limit, jsString(offset)),
			reelFarmHeaders(apiKey), nil)
		if err != nil {
			return nil, err
		}
		if !ok(status) {
			continue
		}
		var body map[string]any
		if err := json.Unmarshal(data, &body); err != nil {
			return nil, err
		}
		slog.Info("reelfarm videos", "body", body)
		videos, _ := or(body["videos"], body["data"], []any{}).([]any)
		for _, v := range videos {
			video, _ := v.(map[string]any)
			if video == nil {
				video = map[string]any{}
			}
			video["_video_type"] = videoType
			allVideos = append(allVideos, video)
		}
	}

	total := len(allVideos)
	results := []MediaItem{}
	for _, v := range allVideos[:min(limit, total)] {
		results = append(results, MediaItem{
			ID:        jsString(or(v["id"], v["video_id"])),
			URL:       jsString(or(v["video_url"], v["url"], v["download_url"], "")),
			Thumbnail: jsString(or(v["thumbnail_url"], v["thumbnail"], v["preview_url"], "")),
			Name:      jsString(v["_video_type"]),
			Type:      "video",
		})
	}
	return &MediaPage{Results: results, Pages: max(1, int(math.Ceil(float64(total)/limit)))}, nil
}

// ImportItem is one {url, name} of importMedia.
type ImportItem struct {
	URL  string `json:"url"`
	Name string `json:"name"`
}

// ImportMedia strips the query and fragment from each URL; items without a
// URL are dropped.
func (*ReelFarmProvider) ImportMedia(_ context.Context, _ string, items []ImportItem) ([]ImportItem, error) {
	out := []ImportItem{}
	for _, item := range items {
		if item.URL == "" {
			continue
		}
		url, _, _ := strings.Cut(item.URL, "#")
		url, _, _ = strings.Cut(url, "?")
		name := item.Name
		if name == "" {
			name = "reelfarm-video"
		}
		out = append(out, ImportItem{URL: url, Name: name})
	}
	return out, nil
}

func (*ReelFarmProvider) SendData(context.Context, string, json.RawMessage) (string, error) {
	return "", errors.New("ReelFarm media-library provider does not support sendData")
}
