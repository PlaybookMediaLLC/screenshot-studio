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
	"net/netip"
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

// Options choose the viewport and color scheme, as the web's
// POST /api/screenshot does.
type Options struct {
	Mobile bool
	// ColorScheme is "light" or "dark"; empty leaves the page's default.
	ColorScheme string
}

// Capture screenshots a public page at a desktop viewport and returns the image.
func (c *Client) Capture(ctx context.Context, pageURL string) ([]byte, error) {
	return c.CaptureWith(ctx, pageURL, Options{})
}

// CaptureWith screenshots a public page with the given viewport and color
// scheme. A mobile capture is a current iPhone viewport, like the web's.
func (c *Client) CaptureWith(ctx context.Context, pageURL string, options Options) ([]byte, error) {
	query := url.Values{"meta": {"false"}, "screenshot": {"true"}, "url": {pageURL},
		"viewport.height": {"1080"}, "viewport.isMobile": {"false"}, "viewport.width": {"1920"}}
	if options.Mobile {
		query.Set("viewport.height", "844")
		query.Set("viewport.isMobile", "true")
		query.Set("viewport.width", "390")
	}
	if options.ColorScheme != "" {
		query.Set("colorScheme", options.ColorScheme)
	}
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

// PublicPageURL reports whether raw is an http(s) URL whose host is not
// local or private: the web's assertPublicCaptureUrl, so a capture through
// any transport refuses the same addresses.
func PublicPageURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return false
	}
	host := strings.ToLower(strings.Trim(parsed.Hostname(), "[]"))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return false
	}
	address, err := netip.ParseAddr(host)
	if err != nil {
		return true
	}
	address = address.Unmap()
	return !(address.IsLoopback() || address.IsPrivate() || address.IsLinkLocalUnicast() ||
		address.IsLinkLocalMulticast() || address.IsUnspecified() || address.IsMulticast() ||
		(address.Is4() && (address.As4()[0] == 0 || (address.As4()[0] == 100 && address.As4()[1]&0xc0 == 64))))
}
