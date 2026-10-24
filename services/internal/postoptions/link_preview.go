package postoptions

import (
	"fmt"
	"net/url"
	"unicode/utf8"
)

// LinkPreview stores the writer's card choice independently from the URL text.
// Removed cards remain explicit so a scheduler cannot silently regenerate them.
type LinkPreview struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Image       string `json:"image,omitempty"`
	Removed     bool   `json:"removed,omitempty"`
}

func (p LinkPreview) Validate() error {
	validURL := func(raw string) bool {
		u, err := url.Parse(raw)
		return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && len(raw) <= 2048
	}
	if !validURL(p.URL) || p.Image != "" && !validURL(p.Image) || !utf8.ValidString(p.Title) || !utf8.ValidString(p.Description) || len(p.Title) > 1000 || len(p.Description) > 4000 {
		return fmt.Errorf("Choose a valid HTTPS link preview with a short title and description.")
	}
	return nil
}
