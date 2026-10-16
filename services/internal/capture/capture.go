// Package capture takes product screenshots through a Microlink-compatible
// API, the same service and request the web's screenshot capture uses.
package capture

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// maxScreenshotBytes bounds one downloaded screenshot.
const maxScreenshotBytes = 20 << 20

// Client calls the screenshot API.
type Client struct {
	API  string
	Key  string
	HTTP *http.Client
}

// FromEnvironment reads SCREENSHOT_API_URL (default Microlink) and the
// optional SCREENSHOT_API_KEY.
func FromEnvironment() *Client {
	api := strings.TrimRight(os.Getenv("SCREENSHOT_API_URL"), "/")
	if api == "" {
		api = "https://api.microlink.io"
	}
	return &Client{API: api, Key: os.Getenv("SCREENSHOT_API_KEY"), HTTP: &http.Client{Timeout: 45 * time.Second}}
}

// Capture screenshots a public page at a desktop viewport and returns the image.
func (c *Client) Capture(ctx context.Context, pageURL string) ([]byte, error) {
	query := url.Values{"meta": {"false"}, "screenshot": {"true"}, "url": {pageURL},
		"viewport.height": {"1080"}, "viewport.isMobile": {"false"}, "viewport.width": {"1920"}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.API+"/?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	if c.Key != "" {
		request.Header.Set("x-api-key", c.Key)
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var out struct {
		Data struct {
			Message    string `json:"message"`
			Screenshot struct {
				URL string `json:"url"`
			} `json:"screenshot"`
		} `json:"data"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&out); err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK || out.Status != "success" || out.Data.Screenshot.URL == "" {
		return nil, fmt.Errorf("screenshot API returned %d %s", response.StatusCode, out.Data.Message)
	}
	return c.download(ctx, out.Data.Screenshot.URL)
}

// download fetches the image only from the API's own host or Microlink's CDN,
// so a hostile answer cannot point the worker at an internal address.
func (c *Client) download(ctx context.Context, imageURL string) ([]byte, error) {
	image, err := url.Parse(imageURL)
	api, apiErr := url.Parse(c.API)
	if err != nil || apiErr != nil || (image.Scheme != "https" && image.Host != api.Host) ||
		(image.Host != api.Host && !strings.HasSuffix(image.Hostname(), ".microlink.io")) {
		return nil, errors.New("screenshot host refused")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("screenshot download returned %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxScreenshotBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxScreenshotBytes {
		return nil, errors.New("screenshot too large")
	}
	return body, nil
}
