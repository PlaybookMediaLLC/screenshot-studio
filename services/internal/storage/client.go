package storage

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const maxAssetBytes = 50 << 20

type Client struct {
	apiURL     string
	bucket     string
	httpClient *http.Client
	serviceKey string
}

func New(apiURL, bucket, serviceKey string, httpClient *http.Client) *Client {
	return &Client{
		apiURL: strings.TrimRight(apiURL, "/"), bucket: bucket,
		httpClient: httpClient, serviceKey: serviceKey,
	}
}

func (c *Client) Read(ctx context.Context, organizationID, objectKey string) ([]byte, error) {
	if !safeSegment(organizationID) || !strings.HasPrefix(objectKey, "org/"+organizationID+"/") {
		return nil, fmt.Errorf("asset object key is outside the active organization")
	}
	path := make([]string, 0, 2+strings.Count(objectKey, "/"))
	path = append(path, "object", url.PathEscape(c.bucket))
	for _, part := range strings.Split(objectKey, "/") {
		if !safeSegment(part) {
			return nil, fmt.Errorf("asset object key contains an unsafe segment")
		}
		path = append(path, url.PathEscape(part))
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiURL+"/"+strings.Join(path, "/"), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("apikey", c.serviceKey)
	request.Header.Set("Authorization", "Bearer "+c.serviceKey)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("read tenant asset: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("storage request failed with status %d", response.StatusCode)
	}
	bytes, err := io.ReadAll(io.LimitReader(response.Body, maxAssetBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read tenant asset: %w", err)
	}
	if len(bytes) > maxAssetBytes {
		return nil, fmt.Errorf("tenant asset exceeds %d bytes", maxAssetBytes)
	}
	return bytes, nil
}

func safeSegment(value string) bool {
	if value == "" || value == "." || value == ".." {
		return false
	}
	for _, r := range value {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '.' && r != '_' && r != '-' {
			return false
		}
	}
	return true
}
