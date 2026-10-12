package videos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"
)

// evolinkURL and pollInterval are overridden in tests.
var (
	evolinkURL   = "https://api.evolink.ai/v1"
	pollInterval = 10 * time.Second
)

// SeedanceParams is the seedance params DTO.
type SeedanceParams struct {
	Prompt string          `json:"prompt"`
	Images []SeedanceImage `json:"images"`
}

type SeedanceImage struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

func seedanceParams() Params {
	return Params{
		Identifier:  "seedance",
		Title:       "Seedance 2.0 (Audio + Video)",
		Description: "Generate videos with the most advanced video model.",
		Placement:   "text-to-image",
		Tools:       []Tool{},
		Trial:       false,
		Available:   os.Getenv("EVOLINK_API_KEY") != "",
		DTOName:     "SeedanceParams",
		Schema: json.RawMessage(`{"properties":{"prompt":{"type":"string"},"images":{"items":{"$ref":"#/definitions/Image"},"type":"array","maxItems":3}},` +
			`"type":"object","required":["prompt","images"]}`),
	}
}

// Seedance generates videos with Seedance 2.0 through Evolink.
type Seedance struct{}

func NewSeedance() *Seedance { return &Seedance{} }

func (*Seedance) Params() Params                 { return seedanceParams() }
func (*Seedance) Functions() map[string]Function { return map[string]Function{} }

func (*Seedance) Validate(customParams json.RawMessage) []string {
	m := decodeParams(customParams)
	messages := []string{}
	if !isString(m, "prompt") {
		messages = append(messages, "prompt must be a string")
	}
	images, isArray := m["images"].([]any)
	if !isArray || len(images) > 3 {
		messages = append(messages, "images must contain no more than 3 elements")
	}
	if !isArray {
		messages = append(messages, "images must be an array")
	}
	for i, item := range images {
		image, ok := item.(map[string]any)
		if !ok {
			messages = append(messages, "nested property images must be either object or array")
			continue
		}
		for _, key := range []string{"id", "path"} {
			if !isString(image, key) {
				messages = append(messages, fmt.Sprintf("images.%d.%s must be a string", i, key))
			}
		}
	}
	return messages
}

type evolinkError struct {
	Code    any    `json:"code"`
	Message string `json:"message"`
}

func evolink(ctx context.Context, method, path string, body any, out any) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, evolinkURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+os.Getenv("EVOLINK_API_KEY"))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return json.NewDecoder(res.Body).Decode(out)
}

func (*Seedance) Process(ctx context.Context, output string, customParams json.RawMessage) (string, error) {
	var params SeedanceParams
	_ = json.Unmarshal(customParams, &params)

	imageURLs := []string{}
	for _, p := range params.Images {
		imageURLs = append(imageURLs, p.Path)
	}
	model := "seedance-2.0-fast-text-to-video"
	body := map[string]any{"prompt": params.Prompt}
	if len(imageURLs) > 0 {
		model = "seedance-2.0-fast-reference-to-video"
		body["image_urls"] = imageURLs
	}
	body["model"] = model
	body["aspect_ratio"] = "9:16"
	if output == "horizontal" {
		body["aspect_ratio"] = "16:9"
	}
	body["duration"] = 8
	body["quality"] = "720p"
	body["generate_audio"] = true

	var value struct {
		ID    string        `json:"id"`
		Error *evolinkError `json:"error"`
	}
	if err := evolink(ctx, http.MethodPost, "/videos/generations", body, &value); err != nil {
		return "", err
	}
	taskID := value.ID
	if taskID == "" {
		if value.Error != nil {
			return "", fmt.Errorf("%v: %s", value.Error.Code, value.Error.Message)
		}
		return "", errors.New("Failed to generate video")
	}

	slog.Info("seedance taskId " + taskID)
	const maxAttempts = 180 // ~30 minutes at 10s interval
	for attempts := 0; ; attempts++ {
		if attempts >= maxAttempts {
			return "", errors.New("Video generation timed out")
		}

		slog.Info("waiting for video to be ready")
		var data struct {
			Status  string        `json:"status"`
			Results []string      `json:"results"`
			Error   *evolinkError `json:"error"`
		}
		if err := evolink(ctx, http.MethodGet, "/tasks/"+taskID, nil, &data); err != nil {
			return "", err
		}

		if data.Status == "completed" {
			if len(data.Results) > 0 {
				return data.Results[0], nil
			}
			return "", errors.New("Video generation succeeded but no video URL returned")
		}

		if data.Status != "pending" && data.Status != "processing" {
			if data.Error != nil {
				return "", fmt.Errorf("%v: %s", data.Error.Code, data.Error.Message)
			}
			return "", fmt.Errorf("Video generation failed (status %s)", data.Status)
		}

		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(pollInterval):
		}
	}
}
