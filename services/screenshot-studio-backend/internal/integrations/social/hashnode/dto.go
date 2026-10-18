package hashnode

import (
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf16"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
)

type HashnodeTagsSettings struct {
	Value *string `json:"value"`
	Label *string `json:"label"`
}

// MediaDto is a media reference (used for main_image).
type MediaDto struct {
	ID        *string `json:"id"`
	Path      *string `json:"path"`
	Alt       *string `json:"alt,omitempty"`
	Thumbnail *string `json:"thumbnail,omitempty"`
}

// HashnodeSettingsDto holds the Hashnode settings.
type HashnodeSettingsDto struct {
	Title       *string                 `json:"title"`
	Subtitle    *string                 `json:"subtitle,omitempty"`
	MainImage   *MediaDto               `json:"main_image,omitempty"`
	Canonical   *string                 `json:"canonical,omitempty"`
	Publication *string                 `json:"publication"`
	Tags        *[]HashnodeTagsSettings `json:"tags"`
}

// Validate reproduces class-validator with flattened errors: messages
// per property in execution order, nested ones prefixed with their path, and
// a property with failing children reports only the children.
func (d *HashnodeSettingsDto) Validate() []string {
	var out []string
	out = append(out, minLengthDefined("title", d.Title, 6)...)
	if d.Subtitle != nil && len(utf16.Encode([]rune(*d.Subtitle))) < 2 {
		out = append(out, "subtitle must be longer than or equal to 2 characters")
	}
	if d.MainImage != nil {
		out = append(out, d.MainImage.validate("main_image.")...)
	}
	if d.Canonical != nil && *d.Canonical != "" && !strings.Contains(*d.Canonical, "(post:") && !validCanonical(*d.Canonical) {
		out = append(out, "Invalid URL")
	}
	if d.Publication == nil {
		out = append(out, "publication should not be null or undefined", "publication must be a string")
	}
	if d.Tags == nil {
		out = append(out, "tags must contain at least 1 elements", "tags must be an array")
		return out
	}
	var children []string
	for i, tag := range *d.Tags {
		if tag.Value == nil {
			children = append(children, fmt.Sprintf("tags.%d.value must be a string", i))
		}
		if tag.Label == nil {
			children = append(children, fmt.Sprintf("tags.%d.label must be a string", i))
		}
	}
	if len(children) > 0 {
		out = append(out, children...)
	} else if len(*d.Tags) < 1 {
		out = append(out, "tags must contain at least 1 elements")
	}
	return out
}

// minLengthDefined is @IsString @MinLength(n) @IsDefined.
func minLengthDefined(name string, value *string, n int) []string {
	if value == nil {
		return []string{
			name + " should not be null or undefined",
			fmt.Sprintf("%s must be longer than or equal to %d characters", name, n),
			name + " must be a string",
		}
	}
	if len(utf16.Encode([]rune(*value))) < n {
		return []string{fmt.Sprintf("%s must be longer than or equal to %d characters", name, n)}
	}
	return nil
}

func (m *MediaDto) validate(prefix string) []string {
	var out []string
	if m.ID == nil {
		out = append(out, prefix+"id should not be null or undefined", prefix+"id must be a string")
	}
	path := ""
	if m.Path == nil {
		out = append(out, prefix+"path should not be null or undefined")
	} else {
		path = *m.Path
	}
	if !helpers.ValidURLExtension(path) {
		out = append(out, prefix+helpers.ValidURLExtensionMessage)
	}
	if !helpers.IsAllowedUploadPath(path) {
		out = append(out, prefix+helpers.ValidURLPathMessage())
	}
	if m.Path == nil {
		out = append(out, prefix+"path must be a string")
	}
	if m.Thumbnail != nil && *m.Thumbnail != "" && !isURL(*m.Thumbnail) {
		out = append(out, prefix+"thumbnail must be a URL address")
	}
	return out
}

// The canonical @Matches pattern uses a lookahead, (?:www\.|(?!www)), which
// RE2 lacks; validCanonical applies it by hand around these host patterns.
// [^\s] spells out JavaScript's \s.
const notSpace = `[^\s\x{0b}\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]{2,}`

var (
	canonicalHosts = []*regexp.Regexp{
		regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.` + notSpace + `$`),
		regexp.MustCompile(`^[a-zA-Z0-9]+\.` + notSpace + `$`),
	}
	httpPrefix = regexp.MustCompile(`^https?://`)
)

func canonicalHost(s string) bool {
	return canonicalHosts[0].MatchString(s) || canonicalHosts[1].MatchString(s)
}

func validCanonical(s string) bool {
	if s == "" {
		return true
	}
	if strings.HasPrefix(s, "www.") && canonicalHost(s[4:]) {
		return true
	}
	prefix := httpPrefix.FindString(s)
	if prefix == "" {
		return false
	}
	rest := s[len(prefix):]
	if strings.HasPrefix(rest, "www") {
		return strings.HasPrefix(rest, "www.") && canonicalHost(rest[4:])
	}
	return canonicalHost(rest)
}

var tldPattern = regexp.MustCompile(`^([a-z\x{00a1}-\x{ffff}]{2,}|xn[a-z0-9-]{2,})$`)

// isURL approximates validator.js isURL with class-validator's defaults:
// optional http/https/ftp protocol, a host with a TLD (or an IP), no spaces.
func isURL(s string) bool {
	if s == "" || len(s) >= 2083 || strings.ContainsAny(s, " \t\r\n<>") || strings.HasPrefix(s, "mailto:") {
		return false
	}
	if !strings.Contains(s, "://") {
		if strings.HasPrefix(s, "//") {
			return false
		}
		s = "http://" + s
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "ftp") {
		return false
	}
	host := u.Hostname()
	if host == "" {
		return false
	}
	if net.ParseIP(host) != nil {
		return true
	}
	labels := strings.Split(strings.TrimSuffix(strings.ToLower(host), "."), ".")
	if len(labels) < 2 || !tldPattern.MatchString(labels[len(labels)-1]) {
		return false
	}
	for _, label := range labels {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") || strings.Contains(label, "_") {
			return false
		}
	}
	return true
}
