package facebook

import (
	"net"
	"regexp"
	"strconv"
	"strings"
)

// FacebookPresetMaxChars is the maximum characters Facebook allows on a
// background ("text format") post.
const FacebookPresetMaxChars = 130

// FacebookDTO is dtos/posts/providers-settings/facebook.dto.ts.
type FacebookDTO struct {
	URL      string  `json:"url,omitempty"`
	PostType *string `json:"post_type,omitempty"` // post | story
	// Optional Facebook background preset for text-only posts. Kept permissive
	// (a string rather than an enum) so existing posts without the field still
	// validate and future preset drift on Facebook's side doesn't hard-fail.
	TextFormatPresetID string `json:"text_format_preset_id,omitempty"`
	Title              string `json:"title,omitempty" description:"Title of the video, used only for video (non-story) posts"`
}

// Validate reproduces the class-validator messages in declaration order.
func (d *FacebookDTO) Validate() []string {
	var out []string
	// @ValidateIf(p => p.url) skips empty values
	if d.URL != "" && !isURL(d.URL) {
		out = append(out, "url must be a URL address")
	}
	if d.PostType != nil && *d.PostType != "post" && *d.PostType != "story" {
		out = append(out, "post_type must be one of the following values: post, story")
	}
	return out
}

var (
	tldPattern      = regexp.MustCompile(`(?i)^([a-z\x{00A1}-\x{00A8}\x{00AA}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]{2,}|xn[a-z0-9-]{2,})$`)
	labelPattern    = regexp.MustCompile(`(?i)^[a-z_\x{00a1}-\x{ffff}0-9-]+$`)
	fullWidth       = regexp.MustCompile(`[\x{ff01}-\x{ff5e}]`)
	digitsOnly      = regexp.MustCompile(`^\d+$`)
	urlInvalidChars = regexp.MustCompile(`[\s<>]`)
)

// isURL is validator.js isURL with class-validator's default options
// (http/https/ftp, protocol optional, TLD required, no underscores).
func isURL(s string) bool {
	if s == "" || len([]rune(s)) >= 2083 || urlInvalidChars.MatchString(s) || strings.HasPrefix(s, "mailto:") {
		return false
	}
	if i := strings.Index(s, "://"); i >= 0 {
		switch strings.ToLower(s[:i]) {
		case "http", "https", "ftp":
		default:
			return false
		}
		s = s[i+3:]
	} else if strings.HasPrefix(s, "//") {
		return false
	}
	if i := strings.IndexAny(s, "#?/"); i >= 0 {
		s = s[:i]
	}
	if s == "" {
		return false
	}
	if parts := strings.Split(s, "@"); len(parts) > 1 {
		if parts[0] == "" || len(strings.Split(parts[0], ":")) > 2 {
			return false
		}
		s = strings.Join(parts[1:], "@")
	}
	host := s
	if strings.HasPrefix(s, "[") {
		end := strings.Index(s, "]")
		if end < 0 {
			return false
		}
		host = s[1:end]
		if rest := s[end+1:]; rest != "" && (!strings.HasPrefix(rest, ":") || !validPort(rest[1:])) {
			return false
		}
		return net.ParseIP(host) != nil
	}
	if h, port, found := strings.Cut(s, ":"); found {
		if port != "" && !validPort(port) {
			return false
		}
		host = h
	}
	if net.ParseIP(host) != nil {
		return true
	}
	return isFQDN(host)
}

func validPort(p string) bool {
	if !digitsOnly.MatchString(p) {
		return false
	}
	n, err := strconv.Atoi(p)
	return err == nil && n > 0 && n <= 65535
}

func isFQDN(host string) bool {
	parts := strings.Split(host, ".")
	tld := parts[len(parts)-1]
	if len(parts) < 2 || !tldPattern.MatchString(tld) {
		return false
	}
	for _, part := range parts {
		if len(part) > 63 || !labelPattern.MatchString(part) || fullWidth.MatchString(part) ||
			strings.HasPrefix(part, "-") || strings.HasSuffix(part, "-") || strings.Contains(part, "_") {
			return false
		}
	}
	return true
}
