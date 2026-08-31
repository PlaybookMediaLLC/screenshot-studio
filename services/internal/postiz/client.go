package postiz

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type AssetReader interface {
	Read(context.Context, string, string) ([]byte, error)
}

type Client struct {
	assetReader AssetReader
	baseURL     string
	httpClient  *http.Client
}

type PublishInput struct {
	AssetMediaType   string
	AssetObjectKey   string
	Caption          string
	DestinationID    string
	OrganizationID   string
	Platform         string
	ProviderSettings map[string]any
	SecretReference  string
}

type StatusInput struct {
	PostID          string
	SecretReference string
}

type StatusResult struct {
	ProviderPostID string
	State          string
}

type Error struct {
	Status          int
	UnknownDelivery bool
	message         string
}

func (e *Error) Error() string { return e.message }

func New(baseURL string, httpClient *http.Client, assetReader AssetReader) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), httpClient: httpClient, assetReader: assetReader}
}

func (c *Client) Publish(ctx context.Context, input PublishInput) (string, error) {
	if !publishing.IsSecretReference(input.SecretReference) {
		return "", &Error{message: "invalid Postiz credential reference"}
	}
	token, ok := os.LookupEnv(input.SecretReference)
	if !ok || token == "" {
		return "", &Error{message: "Postiz credentials are unavailable"}
	}
	asset, err := c.assetReader.Read(ctx, input.OrganizationID, input.AssetObjectKey)
	if err != nil {
		return "", &Error{message: "tenant asset is unavailable: " + err.Error()}
	}
	upload, err := c.upload(ctx, token, input.AssetObjectKey, input.AssetMediaType, asset)
	if err != nil {
		return "", err
	}
	settings := make(map[string]any, len(input.ProviderSettings)+1)
	for key, value := range input.ProviderSettings {
		settings[key] = value
	}
	settings["__type"] = input.Platform
	payload := map[string]any{
		"date": time.Now().UTC().Format("2006-01-02T15:04:05.000Z"), "shortLink": false, "tags": []string{}, "type": "now",
		"posts": []any{map[string]any{
			"integration": map[string]string{"id": input.DestinationID},
			"settings":    settings,
			"value":       []any{map[string]any{"content": input.Caption, "image": []any{upload}}},
		}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint("posts"), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", token)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", &Error{UnknownDelivery: true, message: "Postiz post outcome is unknown: " + err.Error()}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return "", &Error{Status: response.StatusCode, message: fmt.Sprintf("Postiz post failed with status %d", response.StatusCode)}
	}
	var result json.RawMessage
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil {
		return "", &Error{UnknownDelivery: true, message: "Postiz returned an invalid post receipt"}
	}
	var current []struct {
		PostID string `json:"postId"`
	}
	if json.Unmarshal(result, &current) == nil && len(current) > 0 && current[0].PostID != "" {
		return current[0].PostID, nil
	}
	var legacy struct {
		ID     string `json:"id"`
		PostID string `json:"postId"`
	}
	if json.Unmarshal(result, &legacy) == nil {
		if legacy.PostID != "" {
			return legacy.PostID, nil
		}
		if legacy.ID != "" {
			return legacy.ID, nil
		}
	}
	return "", &Error{UnknownDelivery: true, message: "Postiz returned an invalid post receipt"}
}

func (c *Client) Status(ctx context.Context, input StatusInput) (StatusResult, error) {
	if !publishing.IsSecretReference(input.SecretReference) {
		return StatusResult{}, &Error{message: "invalid Postiz credential reference"}
	}
	token, ok := os.LookupEnv(input.SecretReference)
	if !ok || token == "" {
		return StatusResult{}, &Error{message: "Postiz credentials are unavailable"}
	}
	now := time.Now().UTC()
	query := url.Values{
		"startDate": []string{now.Add(-48 * time.Hour).Format(time.RFC3339)},
		"endDate":   []string{now.Add(24 * time.Hour).Format(time.RFC3339)},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint("posts")+"?"+query.Encode(), nil)
	if err != nil {
		return StatusResult{}, err
	}
	request.Header.Set("Authorization", token)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return StatusResult{}, &Error{message: "Postiz status is unavailable: " + err.Error()}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return StatusResult{}, &Error{Status: response.StatusCode, message: fmt.Sprintf("Postiz status failed with status %d", response.StatusCode)}
	}
	var result struct {
		Posts []struct {
			ID         string `json:"id"`
			ReleaseID  string `json:"releaseId"`
			ReleaseURL string `json:"releaseURL"`
			State      string `json:"state"`
		} `json:"posts"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil {
		return StatusResult{}, &Error{message: "Postiz returned an invalid status response"}
	}
	for _, post := range result.Posts {
		if post.ID == input.PostID {
			return StatusResult{ProviderPostID: post.ReleaseID, State: strings.ToUpper(post.State)}, nil
		}
	}
	return StatusResult{}, &Error{Status: http.StatusNotFound, message: "Postiz post status was not found"}
}

func (c *Client) upload(ctx context.Context, token, objectKey, mediaType string, content []byte) (map[string]any, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	filename := strings.ReplaceAll(path.Base(objectKey), `"`, "")
	headers := make(textproto.MIMEHeader)
	headers.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename))
	headers.Set("Content-Type", mediaType)
	part, err := writer.CreatePart(headers)
	if err != nil {
		return nil, err
	}
	if _, err := part.Write(content); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint("upload"), &body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", token)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, &Error{message: "Postiz upload is unavailable: " + err.Error()}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil, &Error{Status: response.StatusCode, message: fmt.Sprintf("Postiz upload failed with status %d", response.StatusCode)}
	}
	var result struct {
		ID   string `json:"id"`
		Path string `json:"path"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil || result.ID == "" || result.Path == "" {
		return nil, &Error{message: "Postiz returned an invalid upload receipt"}
	}
	return map[string]any{"id": result.ID, "path": result.Path}, nil
}

func (c *Client) endpoint(relative string) string {
	base, _ := url.Parse(c.baseURL + "/")
	endpoint, _ := base.Parse(relative)
	return endpoint.String()
}
