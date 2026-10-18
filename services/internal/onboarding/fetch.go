// Package onboarding reads a product's public site for the onboarding agent
// (docs/rfcs/032-background-onboarding-agent.md): SSRF-guarded fetches,
// robots and sitemap discovery, page text and brand extraction, and the
// fenced, schema-constrained model calls that turn pages into drafts.
package onboarding

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrfguard"
)

const (
	// UserAgent identifies the crawler; RobotsToken is the name robots.txt rules use.
	UserAgent    = "ScreenshotStudioOnboarding/1.0 (+https://screenshot.studio/bot)"
	RobotsToken  = "ScreenshotStudioOnboarding"
	maxPageBytes = 5 << 20
	maxRedirects = 5
)

var webPorts = map[string]bool{"": true, "80": true, "443": true, "8080": true, "8443": true}

// FetchError is a page that could not be read. Retryable is true for server
// errors, timeouts, and network failures; false for refusals and 4xx.
type FetchError struct {
	Reason    string
	Retryable bool
	Status    int
}

func (e *FetchError) Error() string { return e.Reason }

func refused(reason string) error { return &FetchError{Reason: reason} }

// Page is a fetched response body, at most 5 MB.
type Page struct {
	Body         []byte
	ContentType  string
	ETag         string
	LastModified string
	// NotModified is a 304 answer to a conditional request; Body is empty.
	NotModified bool
	Status      int
	// Truncated is a body cut short by the deadline or the size cap.
	Truncated bool
	URL       string
}

// Conditional carries a stored page's validators for a conditional request.
type Conditional struct{ ETag, LastModified string }

// Fetcher reads public pages through the platform SSRF guard.
type Fetcher struct {
	guarded *http.Client
	plain   *http.Client
	// testHosts may resolve to private addresses: e2e fixtures only.
	testHosts map[string]bool
}

// NewFetcher builds the fetcher. SCREENSHOT_E2E_ALLOWED_DOWNLOAD_HOSTS, the
// web's e2e allowlist, lets named fixture hosts through outside production.
func NewFetcher() *Fetcher {
	f := &Fetcher{testHosts: map[string]bool{}}
	if os.Getenv("NODE_ENV") != "production" {
		for _, host := range strings.Split(os.Getenv("SCREENSHOT_E2E_ALLOWED_DOWNLOAD_HOSTS"), ",") {
			if host = strings.ToLower(strings.TrimSpace(host)); host != "" {
				f.testHosts[host] = true
			}
		}
	}
	guarded := *ssrfguard.Client()
	guarded.CheckRedirect = f.checkRedirect(false)
	f.guarded = &guarded
	f.plain = &http.Client{Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext}, CheckRedirect: f.checkRedirect(true)}
	return f
}

func (f *Fetcher) checkRedirect(testHostOnly bool) func(*http.Request, []*http.Request) error {
	return func(request *http.Request, via []*http.Request) error {
		if len(via) >= maxRedirects {
			return refused("The page redirected too many times.")
		}
		if testHostOnly && !f.testHosts[strings.ToLower(request.URL.Hostname())] {
			return refused("A test page redirected off its host.")
		}
		return f.CheckURL(request.URL)
	}
}

// CheckURL refuses what onboarding never reads: other schemes, credentials,
// non-web ports, and local names. The guard checks the dialed address.
func (f *Fetcher) CheckURL(target *url.URL) error {
	host := strings.ToLower(target.Hostname())
	test := f.testHosts[host]
	switch {
	case target.Scheme != "http" && target.Scheme != "https":
		return refused("Only http and https pages are read.")
	case target.User != nil:
		return refused("Links with credentials are not read.")
	case host == "":
		return refused("The link has no host.")
	case !test && !webPorts[target.Port()]:
		return refused("Only standard web ports are read.")
	case !test && (host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal")):
		return refused("Local addresses are not read.")
	}
	return nil
}

// Get reads a page. A body cut short by ctx is returned Truncated when any of
// it arrived, so a slow homepage still yields its head metadata.
func (f *Fetcher) Get(ctx context.Context, rawURL string, conditional Conditional) (*Page, error) {
	target, err := url.Parse(rawURL)
	if err != nil {
		return nil, refused("The link is not a valid URL.")
	}
	if err := f.CheckURL(target); err != nil {
		return nil, err
	}
	client := f.guarded
	if f.testHosts[strings.ToLower(target.Hostname())] {
		client = f.plain
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, refused("The link is not a valid URL.")
	}
	request.Header.Set("User-Agent", UserAgent)
	request.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5")
	if conditional.ETag != "" {
		request.Header.Set("If-None-Match", conditional.ETag)
	}
	if conditional.LastModified != "" {
		request.Header.Set("If-Modified-Since", conditional.LastModified)
	}
	response, err := client.Do(request)
	if err != nil {
		var fetchErr *FetchError
		switch {
		case errors.As(err, &fetchErr):
			return nil, fetchErr
		case errors.Is(err, ssrfguard.ErrBlocked):
			return nil, refused("The site resolves to a private address.")
		case ctx.Err() != nil:
			return nil, &FetchError{Reason: "The site took too long to respond.", Retryable: true}
		}
		return nil, &FetchError{Reason: "The site could not be reached.", Retryable: true}
	}
	defer response.Body.Close()
	page := &Page{ContentType: response.Header.Get("Content-Type"), ETag: response.Header.Get("ETag"),
		LastModified: response.Header.Get("Last-Modified"), Status: response.StatusCode, URL: response.Request.URL.String()}
	if response.StatusCode == http.StatusNotModified {
		page.NotModified = true
		return page, nil
	}
	if response.StatusCode >= 400 {
		return nil, &FetchError{Reason: fmt.Sprintf("The page answered %d.", response.StatusCode), Retryable: response.StatusCode >= 500 || response.StatusCode == http.StatusTooManyRequests, Status: response.StatusCode}
	}
	page.Body, err = io.ReadAll(io.LimitReader(response.Body, maxPageBytes+1))
	if len(page.Body) > maxPageBytes {
		page.Body, page.Truncated = page.Body[:maxPageBytes], true
	}
	if err != nil {
		if len(page.Body) == 0 {
			return nil, &FetchError{Reason: "The site took too long to respond.", Retryable: true}
		}
		page.Truncated = true
	}
	return page, nil
}
