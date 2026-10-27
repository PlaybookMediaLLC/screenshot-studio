package bluesky

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/instances"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

const connectionResponseLimit = 1 << 20

var errConnection = integrations.AuthMessage("Bluesky could not verify this connection. Check the handle and app password, then try again.")

// connectionHTTP removes echoed credentials from failures before shared error
// handling can log them. Production uses the public-only dial-time SSRF guard.
func connectionHTTP(client *http.Client, origin string) *http.Client {
	copy := *client
	inner := client.Transport
	if inner == nil {
		inner = http.DefaultTransport
	}
	copy.Transport = connectionTransport{inner: inner, origin: origin}
	copy.Timeout = 10 * time.Second
	copy.CheckRedirect = func(*http.Request, []*http.Request) error { return errConnection }
	return &copy
}

type connectionTransport struct {
	inner  http.RoundTripper
	origin string
}

func (t connectionTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	origin, err := instances.Origin(r.URL.Scheme + "://" + r.URL.Host)
	if err != nil || r.URL.User != nil || r.URL.Fragment != "" || (t.origin != "" && t.origin != origin) {
		return nil, errConnection
	}
	response, err := t.inner.RoundTrip(r)
	if err != nil {
		if r.Context().Err() != nil {
			return nil, r.Context().Err()
		}
		return nil, integrations.ErrRefreshUnavailable
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		response.Header.Del("Location")
		data, readErr := io.ReadAll(io.LimitReader(response.Body, connectionResponseLimit+1))
		_ = response.Body.Close()
		if response.StatusCode == http.StatusTooManyRequests || response.StatusCode == http.StatusRequestTimeout || response.StatusCode >= 500 {
			return nil, integrations.ErrRefreshUnavailable
		}
		code := "InvalidResponse"
		var body struct {
			Error string `json:"error"`
		}
		if readErr == nil && len(data) <= connectionResponseLimit && json.Unmarshal(data, &body) == nil {
			switch body.Error {
			case "ExpiredToken", "InvalidToken", "AuthenticationRequired", "AuthFactorTokenRequired", "AccountTakedown", "InvalidRequest", "InvalidRecord", "RateLimitExceeded":
				code = body.Error
			}
		}
		response.Body = io.NopCloser(strings.NewReader(`{"error":"` + code + `"}`))
		response.Header.Set("Content-Type", "application/json")
	}
	return response, nil
}

func (p *Provider) connectionJSON(ctx context.Context, endpoint string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return errConnection
	}
	resp, err := connectionHTTP(p.connectionClient, "").Do(req)
	if err != nil {
		return errConnection
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, connectionResponseLimit+1))
	if err != nil || len(data) > connectionResponseLimit || resp.StatusCode != http.StatusOK || json.Unmarshal(data, out) != nil {
		return errConnection
	}
	return nil
}
