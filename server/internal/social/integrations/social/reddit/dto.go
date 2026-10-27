package reddit

import (
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Reddit post settings. Pointers mark presence so
// Validate can reproduce class-validator's IsDefined; a wrong JSON type fails
// decoding instead of producing an isString/isBoolean message.

type RedditFlairDTO struct {
	ID   *string `json:"id,omitempty"`
	Name *string `json:"name,omitempty"`
}

type RedditSettingsDTOInner struct {
	Subreddit       *string         `json:"subreddit,omitempty" jsonschema_description:"Subreddit must start with /r"`
	Title           *string         `json:"title,omitempty"`
	Type            *string         `json:"type,omitempty" jsonschema_description:"Must be one of self (text post), link (requires url), media (uploads the post's first attached image or mp4 video)"`
	URL             *string         `json:"url,omitempty"`
	IsFlairRequired *bool           `json:"is_flair_required,omitempty"`
	Flair           *RedditFlairDTO `json:"flair,omitempty"`
}

type RedditSettingsValueDTO struct {
	Value *RedditSettingsDTOInner `json:"value,omitempty"`
}

type RedditSettingsDTO struct {
	Subreddit []RedditSettingsValueDTO `json:"subreddit"`
}

// Validate returns class-validator's constraint messages in the order
// posts.service's firstValidationError walks them (the first one is shown).
func (d *RedditSettingsDTO) Validate() []string {
	var out []string
	if len(d.Subreddit) < 1 {
		out = append(out, "subreddit must contain at least 1 elements")
	}
	for _, item := range d.Subreddit {
		if item.Value == nil {
			out = append(out, defined("value"))
			continue
		}
		out = append(out, item.Value.validate()...)
	}
	return out
}

func (d *RedditSettingsDTOInner) validate() []string {
	var out []string
	out = append(out, minLengthString("subreddit", d.Subreddit, 2)...)
	out = append(out, minLengthString("title", d.Title, 2)...)
	switch {
	case d.Type == nil:
		out = append(out, defined("type"), "type must be one of the following values: self, link, media", "type must be a string")
	case *d.Type != "self" && *d.Type != "link" && *d.Type != "media":
		out = append(out, "type must be one of the following values: self, link, media")
	}
	// @ValidateIf((o) => o.type === 'link' && o?.url?.indexOf('(post:') === -1)
	if d.Type != nil && *d.Type == "link" && d.URL != nil && !strings.Contains(*d.URL, "(post:") {
		if !matchesURL(*d.URL) {
			out = append(out, "Invalid URL")
		}
		if !isURL(*d.URL) {
			out = append(out, "url must be a URL address")
		}
	}
	if d.IsFlairRequired == nil {
		out = append(out, defined("is_flair_required"), "is_flair_required must be a boolean value")
	}
	if d.IsFlairRequired != nil && *d.IsFlairRequired {
		if d.Flair == nil {
			out = append(out, defined("flair"))
		} else {
			if d.Flair.ID == nil {
				out = append(out, defined("id"), "id must be a string")
			}
			if d.Flair.Name == nil {
				out = append(out, defined("name"), "name must be a string")
			}
		}
	}
	return out
}

func defined(name string) string { return name + " should not be null or undefined" }

// minLengthString is @IsString @MinLength(n) @IsDefined (run as isDefined,
// minLength, isString).
func minLengthString(name string, v *string, n int) []string {
	minMsg := fmt.Sprintf("%s must be longer than or equal to %d characters", name, n)
	if v == nil {
		return []string{defined(name), minMsg, name + " must be a string"}
	}
	if utf8.RuneCountInString(*v) < n {
		return []string{minMsg}
	}
	return nil
}

var urlHost = regexp.MustCompile(`^(?:[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]|[a-zA-Z0-9]+)\.\S{2,}$`)

// matchesURL is the DTO's URL regex. RE2 has no lookahead, so the JS
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

var (
	tld      = regexp.MustCompile(`(?i)^([a-z\x{00a1}-\x{d7ff}\x{f900}-\x{fdcf}\x{fdf0}-\x{ffef}]{2,}|xn[a-z0-9-]{2,})$`)
	hostPart = regexp.MustCompile(`(?i)^[a-z_\x{00a1}-\x{ffff}0-9-]+$`)
)

// isURL approximates validator.js isURL with its defaults (http/https/ftp,
// protocol optional, TLD required).
// ponytail: approximation of validator.js; port its edge cases if a URL that
// passes matchesURL is ever accepted/rejected differently.
func isURL(s string) bool {
	if s == "" || strings.ContainsAny(s, " \t\r\n<>") || strings.HasPrefix(s, "mailto:") || strings.HasPrefix(s, "//") {
		return false
	}
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "ftp") {
		return false
	}
	host := u.Hostname()
	if net.ParseIP(host) != nil {
		return true
	}
	parts := strings.Split(host, ".")
	if len(parts) < 2 || !tld.MatchString(parts[len(parts)-1]) {
		return false
	}
	for _, part := range parts {
		if !hostPart.MatchString(part) || strings.HasPrefix(part, "-") || strings.HasSuffix(part, "-") {
			return false
		}
	}
	return true
}
