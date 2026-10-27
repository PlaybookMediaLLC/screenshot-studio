package videos

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/openai"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/upload"
)

// elevenLabsURL is overridden in tests.
var elevenLabsURL = "https://api.elevenlabs.io"

// elevenLabsLimit is the p-limit(2) on voice generation.
var elevenLabsLimit = make(chan struct{}, 2)

// ImagesSlidesParams is the image-text-slides params DTO.
type ImagesSlidesParams struct {
	Voice  string `json:"voice"`
	Prompt string `json:"prompt"`
}

func imagesSlidesParams() Params {
	return Params{
		Identifier:  "image-text-slides",
		Title:       "Image Text Slides",
		Description: "Generate videos slides from images and text, Don't break down the slides, provide only the first slide information",
		Placement:   "text-to-image",
		Tools:       []Tool{{FunctionName: "loadVoices", Output: "voice id"}},
		Trial:       true,
		Available: os.Getenv("ELEVENSLABS_API_KEY") != "" &&
			os.Getenv("TRANSLOADIT_AUTH") != "" &&
			os.Getenv("TRANSLOADIT_SECRET") != "" &&
			os.Getenv("OPENAI_API_KEY") != "" &&
			os.Getenv("FAL_KEY") != "",
		DTOName: "ImagesSlidesParams",
		Schema: json.RawMessage(`{"properties":{` +
			`"voice":{"description":"Elevenlabs voice id, use a special tool to get it, this is a required filed","type":"string"},` +
			`"prompt":{"description":"Simple string of the prompt, not a json","type":"string"}},` +
			`"type":"object","required":["voice","prompt"]}`),
	}
}

// ImagesSlides turns a text into slides (fal images + ElevenLabs voice),
// then has Transloadit merge, concatenate and subtitle them.
type ImagesSlides struct {
	openai *openai.Service
	fal    *openai.FalService
}

func NewImagesSlides(openaiService *openai.Service, falService *openai.FalService) *ImagesSlides {
	return &ImagesSlides{openai: openaiService, fal: falService}
}

func (*ImagesSlides) Params() Params { return imagesSlidesParams() }

func (i *ImagesSlides) Functions() map[string]Function {
	return map[string]Function{"loadVoices": i.LoadVoices}
}

func (*ImagesSlides) Validate(customParams json.RawMessage) []string {
	m := decodeParams(customParams)
	messages := []string{}
	for _, key := range []string{"voice", "prompt"} {
		if !isString(m, key) {
			messages = append(messages, key+" must be a string")
		}
	}
	return messages
}

// elevenLabsError: ElevenLabs reports quota and permission problems as 401
// with the reason in the body, as either {detail: {status, message}} or
// {detail: 'text'}.
func elevenLabsError(res *http.Response) error {
	var body struct {
		Detail any `json:"detail"`
	}
	_ = json.NewDecoder(res.Body).Decode(&body)
	reason := http.StatusText(res.StatusCode)
	switch detail := body.Detail.(type) {
	case string:
		reason = detail
	case map[string]any:
		if s, ok := detail["message"].(string); ok && s != "" {
			reason = s
		} else if s, ok := detail["status"].(string); ok && s != "" {
			reason = s
		}
	}
	return fmt.Errorf("ElevenLabs %d: %s", res.StatusCode, reason)
}

type generated struct {
	len float64
	url string
}

func (i *ImagesSlides) voice(ctx context.Context, storage upload.Provider, voice, text string) (generated, error) {
	select {
	case elevenLabsLimit <- struct{}{}:
	case <-ctx.Done():
		return generated{}, ctx.Err()
	}
	buffer, err := func() ([]byte, error) {
		defer func() { <-elevenLabsLimit }()
		ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
		defer cancel()
		body, _ := json.Marshal(map[string]string{"text": text, "model_id": "eleven_multilingual_v2"})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost,
			elevenLabsURL+"/v1/text-to-speech/"+voice+"?output_format=mp3_44100_128", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("xi-api-key", os.Getenv("ELEVENSLABS_API_KEY"))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode > 299 {
			return nil, elevenLabsError(res)
		}
		return io.ReadAll(res.Body)
	}()
	if err != nil {
		return generated{}, err
	}

	uploaded, err := storage.UploadFile(ctx, upload.File{Buffer: buffer, Mimetype: "audio/mp3", Size: len(buffer)})
	if err != nil {
		return generated{}, err
	}
	url := uploaded.Path
	if !strings.Contains(url, "http") {
		url = os.Getenv("FRONTEND_URL") + "/" + os.Getenv("NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY") + url
	}
	return generated{len: mp3Duration(buffer), url: url}, nil
}

func (i *ImagesSlides) Process(ctx context.Context, output string, customParams json.RawMessage) (string, error) {
	var params ImagesSlidesParams
	_ = json.Unmarshal(customParams, &params)

	storage, err := upload.CreateStorage()
	if err != nil {
		return "", err
	}
	list := i.openai.GenerateSlidesFromText(ctx, params.Prompt)

	// Plain calls whose failure fails the job, instead of a job that hangs
	// until the workflow times out. split[n] is {image, voice} of slide n.
	split := make([][2]generated, len(list))
	errs := make(chan error, 2*len(list))
	for n, current := range list {
		go func() {
			url, err := i.fal.GenerateImageFromText(ctx, "ideogram/v2", current.ImagePrompt, output == "vertical")
			split[n][0] = generated{url: url}
			errs <- err
		}()
		go func() {
			var err error
			split[n][1], err = i.voice(ctx, storage, params.Voice, current.VoiceText)
			errs <- err
		}()
	}
	for range 2 * len(list) {
		if err := <-errs; err != nil {
			return "", err
		}
	}

	cues := make([]cue, 0, len(list))
	for n, current := range list {
		start := 0.0
		if len(cues) > 0 {
			start = cues[len(cues)-1].end
		}
		cues = append(cues, cue{start: start, end: start + split[n][1].len*1000 + 1000, text: current.VoiceText})
	}

	steps := map[string]any{}
	concat := []any{}
	for n, current := range split {
		steps[fmt.Sprintf("image%d", n)] = map[string]any{"robot": "/http/import", "url": current[0].url}
		steps[fmt.Sprintf("audio%d", n)] = map[string]any{"robot": "/http/import", "url": current[1].url}
		steps[fmt.Sprintf("merge%d", n)] = map[string]any{
			"use": []any{
				map[string]any{"name": fmt.Sprintf("image%d", n), "as": "image"},
				map[string]any{"name": fmt.Sprintf("audio%d", n), "as": "audio"},
			},
			"robot":           "/video/merge",
			"duration":        current[1].len + 1,
			"audio_delay":     0.5,
			"preset":          "hls-1080p",
			"resize_strategy": "min_fit",
			"loop":            true,
		}
		concat = append(concat, map[string]any{"name": fmt.Sprintf("merge%d", n), "as": fmt.Sprintf("video_%d", n+1)})
	}
	steps["concatenated"] = map[string]any{
		"robot":              "/video/concat",
		"result":             false,
		"video_fade_seconds": 0.5,
		"use":                concat,
	}
	steps["subtitled"] = map[string]any{
		"robot":  "/video/subtitle",
		"result": true,
		"preset": "hls-1080p",
		"use": map[string]any{
			"bundle_steps": true,
			"steps": []any{
				map[string]any{"name": "concatenated", "as": "video"},
				map[string]any{"name": ":original", "as": "subtitles"},
			},
		},
		"position":       "center",
		"font_size":      8,
		"subtitles_type": "burned",
	}

	results, err := createAssembly(ctx, map[string]string{"subtitles.srt": stringifySRT(cues)}, steps, 30*time.Minute)
	if err != nil {
		return "", err
	}
	if len(results["subtitled"]) == 0 {
		return "", fmt.Errorf("Cannot read properties of undefined (reading 'url')")
	}
	return results["subtitled"][0].URL, nil
}

// LoadVoices lists the premade ElevenLabs voices (@ExposeVideoFunction).
func (i *ImagesSlides) LoadVoices(ctx context.Context, _ json.RawMessage) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, elevenLabsURL+"/v2/voices?page_size=40&category=premade", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("xi-api-key", os.Getenv("ELEVENSLABS_API_KEY"))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, elevenLabsError(res)
	}

	var body struct {
		Voices []struct {
			VoiceID    any `json:"voice_id"`
			Name       any `json:"name"`
			PreviewURL any `json:"preview_url"`
		} `json:"voices"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, err
	}
	voices := make([]map[string]any, 0, len(body.Voices))
	for _, voice := range body.Voices {
		voices = append(voices, map[string]any{"id": voice.VoiceID, "name": voice.Name, "preview_url": voice.PreviewURL})
	}
	return map[string]any{"voices": voices}, nil
}
