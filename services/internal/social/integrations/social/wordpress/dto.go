package wordpress

import (
	"net/url"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/internal/communityutil"
)

// MediaDTO is a media reference, the main_image setting.
type MediaDTO struct {
	ID        *string `json:"id"`
	Path      *string `json:"path"`
	Alt       *string `json:"alt,omitempty"`
	Thumbnail *string `json:"thumbnail,omitempty"`
}

// SettingsDTO is WordpressDto. Categories and tags stay untyped so IsArray /
// IsNumber can be checked like class-validator does.
type SettingsDTO struct {
	Title      *string   `json:"title"`
	MainImage  *MediaDTO `json:"main_image,omitempty"`
	Type       *string   `json:"type"`
	Categories any       `json:"categories,omitempty"`
	Tags       any       `json:"tags,omitempty"`
	Status     *string   `json:"status,omitempty"`
}

// Validate reproduces class-validator: per property IsDefined first, then the
// remaining decorators bottom-up; nested errors are prefixed with the parent
// property.
func (d *SettingsDTO) Validate() []string {
	var errs []string
	add := func(msg ...string) { errs = append(errs, msg...) }

	if d.Title == nil {
		add("title should not be null or undefined")
	}
	if d.Title == nil || communityutil.Length(*d.Title) < 2 {
		add("title must be longer than or equal to 2 characters")
	}
	if d.Title == nil {
		add("title must be a string")
	}

	if d.MainImage != nil {
		for _, msg := range d.MainImage.Validate() {
			add("main_image." + msg)
		}
	}

	if d.Type == nil {
		add("type should not be null or undefined", "type must be a string")
	}

	for _, name := range []string{"categories", "tags"} {
		value := d.Categories
		if name == "tags" {
			value = d.Tags
		}
		if value == nil {
			continue
		}
		list, isArray := value.([]any)
		allNumbers := isArray
		for _, item := range list {
			if _, ok := item.(float64); !ok {
				allNumbers = false
			}
		}
		if !allNumbers {
			add("each value in " + name + " must be a number conforming to the specified constraints")
		}
		if !isArray {
			add(name + " must be an array")
		}
	}

	if d.Status != nil {
		switch *d.Status {
		case "publish", "draft", "pending", "private":
		default:
			add("status must be one of the following values: publish, draft, pending, private")
		}
	}
	return errs
}

// Validate is MediaDto's class-validator rules.
func (m *MediaDTO) Validate() []string {
	var errs []string
	if m.ID == nil {
		errs = append(errs, "id should not be null or undefined", "id must be a string")
	}
	if m.Path == nil {
		errs = append(errs, "path should not be null or undefined")
	}
	path := ""
	if m.Path != nil {
		path = *m.Path
	}
	if m.Path == nil || !helpers.ValidURLExtension(path) {
		errs = append(errs, helpers.ValidURLExtensionMessage)
	}
	if !helpers.IsAllowedUploadPath(path) {
		errs = append(errs, helpers.ValidURLPathMessage())
	}
	if m.Path == nil {
		errs = append(errs, "path must be a string")
	}
	// alt is only validated when truthy, and a decoded *string is a string.
	if m.Thumbnail != nil && *m.Thumbnail != "" && !isURL(*m.Thumbnail) {
		errs = append(errs, "thumbnail must be a URL address")
	}
	return errs
}

// isURL approximates validator.js isURL defaults: http/https/ftp (or no
// protocol), a host with a TLD, no whitespace.
// ponytail: approximation, port validator.js isURL if thumbnails need exact parity.
func isURL(value string) bool {
	if strings.ContainsAny(value, " \t\n") {
		return false
	}
	candidate := value
	if !strings.Contains(candidate, "://") {
		candidate = "http://" + candidate
	}
	u, err := url.Parse(candidate)
	if err != nil {
		return false
	}
	switch u.Scheme {
	case "http", "https", "ftp":
	default:
		return false
	}
	host := u.Hostname()
	return host != "" && strings.Contains(host, ".") && !strings.HasSuffix(host, ".")
}
