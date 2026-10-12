package pinterest

import (
	"net"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

// SettingsDTO is PinterestSettingsDto.
type SettingsDTO struct {
	Title         string `json:"title,omitempty"`
	Link          string `json:"link,omitempty"`
	DominantColor string `json:"dominant_color,omitempty"`
	// Board carries the @JSONSchema description for schema generators.
	Board *string `json:"board" jsonschema_description:"The numeric id of the board (from the boards list of the channel), not the board name"`
}

var numeric = regexp.MustCompile(`^\d+$`)

const boardRequired = "Board is required"

// Validate reproduces class-validator: properties in declaration order, each
// property's constraints IsDefined first, then the decorators bottom-up.
func (d *SettingsDTO) Validate() []string {
	var out []string
	if d.Title != "" && utf8.RuneCountInString(d.Title)-strings.Count(d.Title, "️")-strings.Count(d.Title, "︎") > 100 {
		out = append(out, "title must be shorter than or equal to 100 characters")
	}
	if d.Link != "" && !isURL(d.Link) {
		out = append(out, "link must be a URL address")
	}
	board := ""
	if d.Board == nil {
		out = append(out, boardRequired)
	} else {
		board = *d.Board
	}
	if !numeric.MatchString(board) {
		out = append(out, "Board must be the numeric board id (use the boards list of the channel to find it), not the board name")
	}
	if board == "" {
		out = append(out, boardRequired) // MinLength(1)
	}
	if d.Board == nil {
		out = append(out, boardRequired) // IsString
	}
	return out
}

var (
	tldPattern   = regexp.MustCompile(`(?i)^([a-z\p{L}]{2,}|xn--[a-z0-9-]{2,})$`)
	labelPattern = regexp.MustCompile(`(?i)^[a-z0-9\p{L}]([a-z0-9\p{L}-]{0,61}[a-z0-9\p{L}])?$`)
)

// isURL approximates class-validator's @IsUrl() (validator.js isURL with
// default options: protocol optional, http/https/ftp, TLD required unless the
// host is an IP).
func isURL(value string) bool {
	if value == "" || len(value) >= 2083 || strings.ContainsAny(value, " \t\r\n<>") || strings.HasPrefix(value, "//") {
		return false
	}
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "ftp") {
		return false
	}
	host := u.Hostname()
	if net.ParseIP(host) != nil {
		return true
	}
	labels := strings.Split(host, ".")
	if len(labels) < 2 || !tldPattern.MatchString(labels[len(labels)-1]) {
		return false
	}
	for _, label := range labels {
		if !labelPattern.MatchString(label) {
			return false
		}
	}
	return true
}
