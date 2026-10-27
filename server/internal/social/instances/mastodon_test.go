package instances

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOrigin(t *testing.T) {
	for _, raw := range []string{"mastodon.social", " HTTPS://Mastodon.Social/ "} {
		got, err := Origin(raw)
		if err != nil || got != "https://mastodon.social" {
			t.Fatalf("%q: %q %v", raw, got, err)
		}
	}
	for _, raw := range []string{"", "http://mastodon.social", "https://user:secret@mastodon.social", "https://mastodon.social:8443", "https://mastodon.social/path", "mastodon.social?next=x", "mastodon.social#fragment", "https://127.0.0.1", "https://[::1]", "localhost", "machine.local", "machine.localhost", "foo..example", "-bad.example", "https://mastodon.social\\@localhost", "https://mastodon.social:", "https://mastodon.social/%2e"} {
		if _, err := Origin(raw); !errors.Is(err, ErrInvalidOrigin) {
			t.Errorf("accepted %q: %v", raw, err)
		}
	}
}

func TestMastodonPreview(t *testing.T) {
	for _, test := range []struct {
		name, body string
		status     int
		valid      bool
	}{
		{"valid", `{"domain":"social.example","title":"Community","description":"Welcome","usage":{"users":{"active_month":123}}}`, 200, true},
		{"not mastodon", `{"title":"Other site"}`, 200, false},
		{"wrong shape", `{"domain":"social.example","title":"Community","usage":{"users":{"active_month":"123"}}}`, 200, false},
		{"negative", `{"domain":"social.example","title":"Community","usage":{"users":{"active_month":-1}}}`, 200, false},
		{"oversize", strings.Repeat(" ", 256<<10) + `{}`, 200, false},
		{"malformed", `{`, 200, false},
		{"rate limited", `{"token":"must-never-leak"}`, 429, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v2/instance" || r.Header.Get("Authorization") != "" {
					t.Errorf("unexpected discovery request")
				}
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			preview, err := mastodon(context.Background(), server.URL, server.Client())
			if test.valid {
				if err != nil || preview.Title != "Community" || preview.ActiveUsers == nil || *preview.ActiveUsers != 123 {
					t.Fatalf("%+v %v", preview, err)
				}
			} else if !errors.Is(err, ErrUnavailable) || strings.Contains(err.Error(), "must-never-leak") {
				t.Fatalf("%+v %v", preview, err)
			}
		})
	}
}

func TestPreviewTextMatchesBrowserLengthLimit(t *testing.T) {
	if got := plainText("\x01  "+strings.Repeat("🌍", 100)+"  ", 160); got != strings.Repeat("🌍", 80) {
		t.Fatalf("invalid clipping: %q", got)
	}
}
