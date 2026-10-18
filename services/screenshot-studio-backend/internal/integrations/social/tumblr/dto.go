package tumblr

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// TumblrDTO holds the Tumblr post settings. Every field is
// @IsOptional, so nil skips its validators; a wrong JSON type fails decoding
// instead of producing an isString message.
type TumblrDTO struct {
	Title     *string `json:"title,omitempty"`
	Link      *string `json:"link,omitempty"`
	SourceURL *string `json:"sourceUrl,omitempty"`
	Tags      *string `json:"tags,omitempty"`
}

// Validate returns class-validator's constraint messages in the order
// posts.service's firstValidationError walks them (the first one is shown).
func (d *TumblrDTO) Validate() []string {
	var out []string
	if d.Title != nil {
		n := utf8.RuneCountInString(*d.Title)
		if n > 4096 {
			out = append(out, "title must be shorter than or equal to 4096 characters")
		}
		if n < 1 {
			out = append(out, "title must be longer than or equal to 1 characters")
		}
	}
	// @ValidateIf((o) => o.link): an empty string skips the regex.
	if d.Link != nil && *d.Link != "" && !matchesURL(*d.Link) {
		out = append(out, "Invalid URL")
	}
	if d.SourceURL != nil && *d.SourceURL != "" && !matchesURL(*d.SourceURL) {
		out = append(out, "Invalid URL")
	}
	if d.Tags != nil && utf8.RuneCountInString(*d.Tags) > 4096 {
		out = append(out, "tags must be shorter than or equal to 4096 characters")
	}
	return out
}

var urlHost = regexp.MustCompile(`^(?:[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]|[a-zA-Z0-9]+)\.\S{2,}$`)

// matchesURL is the DTO's optionalUrlRegex. RE2 has no lookahead, so the JS
// `(?:www\.|(?!www))` alternative is expanded by hand.
func matchesURL(s string) bool {
	if s == "" {
		return true
	}
	rest, ok := strings.CutPrefix(s, "https://")
	if !ok {
		rest, ok = strings.CutPrefix(s, "http://")
	}
	if ok {
		if strings.HasPrefix(rest, "www") {
			host, www := strings.CutPrefix(rest, "www.")
			return www && urlHost.MatchString(host)
		}
		return urlHost.MatchString(rest)
	}
	host, www := strings.CutPrefix(s, "www.")
	return www && urlHost.MatchString(host)
}
