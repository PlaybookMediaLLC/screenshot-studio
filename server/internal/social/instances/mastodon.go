// Package instances validates public social-server origins and reads safe metadata.
package instances

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"unicode"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
	"golang.org/x/net/idna"
)

var ErrInvalidOrigin = errors.New("enter a public HTTPS server hostname without a path, port, or credentials")
var ErrUnavailable = errors.New("this server could not be verified; check its hostname and try again")

// Origin accepts a hostname or HTTPS origin. DNS is checked at connection time
// by ssrf.PublicClient, including the actual address chosen after resolution.
func Origin(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || len(value) > 2048 || strings.ContainsAny(value, "\\?#") {
		return "", ErrInvalidOrigin
	}
	if !strings.Contains(value, "://") {
		value = "https://" + value
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Opaque != "" || u.Port() != "" ||
		(u.Path != "" && u.Path != "/") || u.RawPath != "" {
		return "", ErrInvalidOrigin
	}
	host, err := idna.Lookup.ToASCII(strings.ToLower(u.Hostname()))
	if err != nil || len(host) > 253 || net.ParseIP(host) != nil || strings.HasSuffix(host, ".") ||
		!strings.Contains(host, ".") || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") ||
		strings.ContainsAny(u.Host, ":%") {
		return "", ErrInvalidOrigin
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", ErrInvalidOrigin
		}
		for _, ch := range label {
			if !(ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch == '-') {
				return "", ErrInvalidOrigin
			}
		}
	}
	return "https://" + host, nil
}

// MastodonPreview is public metadata, never credentials or a proof of account access.
type MastodonPreview struct {
	Origin      string `json:"origin"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ActiveUsers *int64 `json:"activeUsers"`
}

// Mastodon reads the public v2 instance API. It cannot authorize a connection.
func Mastodon(ctx context.Context, raw string) (*MastodonPreview, error) {
	origin, err := Origin(raw)
	if err != nil {
		return nil, err
	}
	return mastodon(ctx, origin, ssrf.PublicClient())
}

func mastodon(ctx context.Context, origin string, client *http.Client) (*MastodonPreview, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/api/v2/instance", nil)
	if err != nil {
		return nil, ErrInvalidOrigin
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, ErrUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, ErrUnavailable
	}
	const limit = 256 << 10
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || len(body) > limit {
		return nil, ErrUnavailable
	}
	var instance struct {
		Domain      string `json:"domain"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Usage       struct {
			Users struct {
				ActiveMonth *int64 `json:"active_month"`
			} `json:"users"`
		} `json:"usage"`
	}
	if json.Unmarshal(body, &instance) != nil || strings.TrimSpace(instance.Domain) == "" || strings.TrimSpace(instance.Title) == "" ||
		(instance.Usage.Users.ActiveMonth != nil && (*instance.Usage.Users.ActiveMonth < 0 || *instance.Usage.Users.ActiveMonth > 1<<53-1)) {
		return nil, ErrUnavailable
	}
	title := plainText(instance.Title, 160)
	if title == "" {
		return nil, ErrUnavailable
	}
	return &MastodonPreview{Origin: origin, Title: title, Description: plainText(instance.Description, 1200),
		ActiveUsers: instance.Usage.Users.ActiveMonth}, nil
}

func plainText(value string, max int) string {
	value = strings.Map(func(ch rune) rune {
		if unicode.IsControl(ch) && ch != '\n' && ch != '\t' {
			return -1
		}
		return ch
	}, value)
	text := []rune(strings.TrimSpace(value))
	units := 0
	for index, ch := range text {
		units++
		if ch > 0xffff {
			units++
		}
		if units > max {
			text = text[:index]
			break
		}
	}
	return string(text)
}
