package product

import (
	"errors"
	"testing"
)

func TestMentionQuery(t *testing.T) {
	for _, item := range []struct{ channel, query, want string }{
		{"x", "@shots_x", "shots_x"},
		{"x", " jack ", "jack"},
		{"linkedin", "https://www.linkedin.com/company/screenshot-studio/", "screenshot-studio"},
		{"linkedin", "acme-co", "acme-co"},
	} {
		got, err := mentionQuery(item.channel, item.query)
		if err != nil || got != item.want {
			t.Fatalf("mentionQuery(%q, %q) = %q, %v", item.channel, item.query, got, err)
		}
	}
	for _, item := range []struct{ channel, query string }{
		{"x", "has space"}, {"x", "waytoolongusername1"}, {"linkedin", "a"}, {"linkedin", "Jane Doe"}, {"threads", "jane"},
	} {
		if _, err := mentionQuery(item.channel, item.query); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("mentionQuery(%q, %q) accepted", item.channel, item.query)
		}
	}
}
