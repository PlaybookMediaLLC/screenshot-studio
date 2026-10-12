package lemmy

import (
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf16"
)

// dtos/posts/providers-settings/lemmy.dto.ts. Pointers mark presence so
// Validate can reproduce class-validator's IsDefined; a wrong JSON type fails
// decoding instead of producing an isString message.

type SettingsDTOInner struct {
	Subreddit *string `json:"subreddit,omitempty"`
	ID        *string `json:"id,omitempty"`
	Title     *string `json:"title,omitempty"`
	URL       *string `json:"url,omitempty"`
}

type SettingsValueDTO struct {
	Value *SettingsDTOInner `json:"value,omitempty"`
}

type SettingsDTO struct {
	Subreddit []*SettingsValueDTO `json:"subreddit"`
}

// Validate returns class-validator's constraint messages in the order
// posts.service's firstValidationError walks them (the first one is shown).
func (d *SettingsDTO) Validate() []string {
	var out []string
	if len(d.Subreddit) < 1 {
		out = append(out, "subreddit must contain at least 1 elements")
	}
	for _, item := range d.Subreddit {
		if item == nil {
			out = append(out, "nested property subreddit must be either object or array")
			continue
		}
		if item.Value == nil {
			out = append(out, defined("value"))
			continue
		}
		out = append(out, item.Value.validate()...)
	}
	return out
}

func (d *SettingsDTOInner) validate() []string {
	var out []string
	out = append(out, minLengthString("subreddit", d.Subreddit, 2)...)
	if d.ID == nil {
		out = append(out, defined("id"), "id must be a string")
	}
	out = append(out, minLengthString("title", d.Title, 2)...)
	// @ValidateIf((o) => o.url) @IsOptional() @IsUrl()
	if d.URL != nil && *d.URL != "" && !isURL(*d.URL) {
		out = append(out, "url must be a URL address")
	}
	return out
}

func defined(name string) string { return name + " should not be null or undefined" }

// minLengthString is @IsString @MinLength(n) @IsDefined (run as isDefined,
// minLength, isString). JS length counts UTF-16 code units.
func minLengthString(name string, v *string, n int) []string {
	minMsg := fmt.Sprintf("%s must be longer than or equal to %d characters", name, n)
	if v == nil {
		return []string{defined(name), minMsg, name + " must be a string"}
	}
	if len(utf16.Encode([]rune(*v))) < n {
		return []string{minMsg}
	}
	return nil
}

var (
	tld      = regexp.MustCompile(`(?i)^([a-z\x{00a1}-\x{d7ff}\x{f900}-\x{fdcf}\x{fdf0}-\x{ffef}]{2,}|xn[a-z0-9-]{2,})$`)
	hostPart = regexp.MustCompile(`(?i)^[a-z\x{00a1}-\x{ffff}0-9-]+$`)
)

// isURL approximates validator.js isURL with its defaults (http/https/ftp,
// protocol optional, TLD required, no underscores).
// ponytail: approximation of validator.js; port its edge cases if a URL is
// ever accepted/rejected differently from Postiz.
func isURL(s string) bool {
	if s == "" || len(s) >= 2083 || strings.ContainsAny(s, " \t\r\n<>") || strings.HasPrefix(s, "mailto:") || strings.HasPrefix(s, "//") {
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
		if len(part) > 63 || !hostPart.MatchString(part) || strings.HasPrefix(part, "-") || strings.HasSuffix(part, "-") {
			return false
		}
	}
	return true
}
