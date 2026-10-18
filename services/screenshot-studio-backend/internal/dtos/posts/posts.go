// Package posts holds the post request bodies (except
// providers-settings, which the provider packages own).
//
// class-validator rules that struct tags cannot express (custom messages,
// nested paths, ISO dates) are implemented as Validate() []string returning
// the validation messages in the API's format, in declaration order. Call it
// after binding and answer httpx.BadRequest(messages) when it is not empty.
package posts

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
)

// class-validator default messages.
func notDefined(p string) string { return p + " should not be null or undefined" }
func notString(p string) string  { return p + " must be a string" }
func notArray(p string) string   { return p + " must be an array" }
func notISODate(p string) string { return p + " must be a valid ISO 8601 date string" }
func notURL(p string) string     { return p + " must be a URL address" }
func minSize(p string, n int) string {
	return fmt.Sprintf("%s must contain at least %d elements", p, n)
}
func notIn(p string, values ...string) string {
	return fmt.Sprintf("%s must be one of the following values: %s", p, strings.Join(values, ", "))
}

// ISO 8601 as validator.js isISO8601 accepts it for the shapes clients send
// (date, date-time, optional fraction and zone).
var isoDate = regexp.MustCompile(`^[+-]?\d{4}-(0[1-9]|1[0-2])(-([12]\d|0[1-9]|3[01]))?([T\s](([01]\d|2[0-3])(:?[0-5]\d)?|24:?00)([.,]\d+)?(:[0-5]\d([.,]\d+)?)?([zZ]|[+-]([01]\d|2[0-3]):?([0-5]\d)?)?)?$`)

// IsISODate is class-validator's IsDateString.
func IsISODate(s string) bool { return isoDate.MatchString(s) }

// isURL approximates validator.js isURL defaults: http/https/ftp, a host
// with a top-level domain.
func isURL(s string) bool {
	raw := s
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || !slices.Contains([]string{"http", "https", "ftp"}, u.Scheme) {
		return false
	}
	host := u.Hostname()
	return strings.Contains(host, ".") && !strings.HasSuffix(host, ".") && !strings.ContainsAny(host, " _")
}

type Integration struct {
	ID string `json:"id"`
}

// MediaDto is dtos/media MediaDto. class-transformer keeps every property the
// client sent, and JSON.stringify(value.image) stores them, so the raw object
// is kept and re-emitted with the known fields on top.
type MediaDto struct {
	ID        string                     `json:"id"`
	Path      string                     `json:"path"`
	Alt       string                     `json:"alt,omitempty"`
	Thumbnail string                     `json:"thumbnail,omitempty"`
	Raw       map[string]json.RawMessage `json:"-"`
}

func (m *MediaDto) UnmarshalJSON(data []byte) error {
	type plain MediaDto
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	var p plain
	for _, key := range []string{"id", "path", "alt", "thumbnail"} {
		// non-string values are reported by Validate, not by the decoder
		if v, ok := raw[key]; ok {
			var s string
			if json.Unmarshal(v, &s) == nil {
				switch key {
				case "id":
					p.ID = s
				case "path":
					p.Path = s
				case "alt":
					p.Alt = s
				case "thumbnail":
					p.Thumbnail = s
				}
			}
		}
	}
	p.Raw = raw
	*m = MediaDto(p)
	return nil
}

func (m MediaDto) MarshalJSON() ([]byte, error) {
	out := map[string]any{}
	for k, v := range m.Raw {
		out[k] = v
	}
	out["id"] = m.ID
	out["path"] = m.Path
	if m.Alt != "" {
		out["alt"] = m.Alt
	}
	if m.Thumbnail != "" {
		out["thumbnail"] = m.Thumbnail
	}
	return json.Marshal(out)
}

func (m *MediaDto) isString(key string) (present, isString bool) {
	v, ok := m.Raw[key]
	if !ok || string(v) == "null" {
		return false, false
	}
	var s string
	return true, json.Unmarshal(v, &s) == nil
}

func (m *MediaDto) validate(prefix string) []string {
	var out []string
	if m.Raw == nil {
		m.Raw = map[string]json.RawMessage{}
		if m.ID != "" {
			m.Raw["id"], _ = json.Marshal(m.ID)
		}
		if m.Path != "" {
			m.Raw["path"], _ = json.Marshal(m.Path)
		}
	}
	if present, str := m.isString("id"); !present {
		out = append(out, prefix+notDefined("id"), prefix+notString("id"))
	} else if !str {
		out = append(out, prefix+notString("id"))
	}
	present, str := m.isString("path")
	if !present {
		out = append(out, prefix+notDefined("path"))
	}
	if !helpers.ValidURLExtension(m.Path) {
		out = append(out, prefix+helpers.ValidURLExtensionMessage)
	}
	if !helpers.IsAllowedUploadPath(m.Path) {
		out = append(out, prefix+helpers.ValidURLPathMessage())
	}
	if !str {
		out = append(out, prefix+notString("path"))
	}
	if present, str := m.isString("alt"); present && !str {
		out = append(out, prefix+notString("alt"))
	}
	if m.Thumbnail != "" && !isURL(m.Thumbnail) {
		out = append(out, prefix+notURL("thumbnail"))
	}
	return out
}

type PostContent struct {
	Content string     `json:"content"`
	ID      string     `json:"id,omitempty"`
	Delay   int        `json:"delay,omitempty"`
	Image   []MediaDto `json:"image"`
}

type Post struct {
	Type        string        `json:"type,omitempty"`
	Integration Integration   `json:"integration"`
	Value       []PostContent `json:"value"`
	Group       string        `json:"group,omitempty"`
	// a channel that keeps a date of its own, the others use the post date
	Date string `json:"date,omitempty"`
	// Settings is the provider's settings object, `__type` = provider identifier.
	Settings json.RawMessage `json:"settings,omitempty"`
}

type Tags struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type CreatePostDto struct {
	Type      string `json:"type"` // draft | schedule | now | update
	Order     string `json:"order,omitempty"`
	ShortLink bool   `json:"shortLink"`
	Inter     *int   `json:"inter,omitempty"`
	// explicit opt-in to publish an already-PUBLISHED post again; without it a
	// schedule/now save targeting a published post is rejected
	Republish bool   `json:"republish,omitempty"`
	Date      string `json:"date"`
	Tags      []Tags `json:"tags"`
	Posts     []Post `json:"posts"`
}

// Validate runs the CreatePostDto rules. settings validates one post's
// settings (the discriminated provider DTO) and returns its messages without
// a path; it is only called when the post type is not draft (@ValidateIf).
func (d *CreatePostDto) Validate(settings func(post *Post) []string) []string {
	var out []string
	types := []string{"draft", "schedule", "now", "update"}
	if d.Type == "" {
		out = append(out, notDefined("type"))
	}
	if !slices.Contains(types, d.Type) {
		out = append(out, notIn("type", types...))
	}
	if d.Date == "" {
		out = append(out, notDefined("date"))
	}
	if !IsISODate(d.Date) {
		out = append(out, notISODate("date"))
	}
	if d.Tags == nil {
		out = append(out, notDefined("tags"), notArray("tags"))
	}
	if d.Posts == nil {
		out = append(out, notDefined("posts"), minSize("posts", 1), notArray("posts"))
	} else if len(d.Posts) == 0 {
		out = append(out, minSize("posts", 1))
	}
	for i := range d.Posts {
		out = append(out, d.Posts[i].validate(fmt.Sprintf("posts.%d.", i), settings)...)
	}
	return out
}

func (p *Post) validate(prefix string, settings func(post *Post) []string) []string {
	var out []string
	if p.Integration.ID == "" {
		out = append(out, prefix+"integration."+notDefined("id"), prefix+"integration."+notString("id"))
	}
	if p.Value == nil {
		out = append(out, prefix+notDefined("value"), prefix+notArray("value"), prefix+minSize("value", 1))
	} else if len(p.Value) == 0 {
		out = append(out, prefix+minSize("value", 1))
	}
	for j := range p.Value {
		v := &p.Value[j]
		vp := fmt.Sprintf("%svalue.%d.", prefix, j)
		if !helpers.ValidContent(v.Content, len(v.Image)) {
			out = append(out, vp+helpers.ValidContentMessage)
		}
		if v.Image == nil {
			out = append(out, vp+notArray("image"))
		}
		for k := range v.Image {
			out = append(out, v.Image[k].validate(fmt.Sprintf("%simage.%d.", vp, k))...)
		}
	}
	if p.Date != "" && !IsISODate(p.Date) {
		out = append(out, prefix+notISODate("date"))
	}
	if p.Type != "draft" && settings != nil {
		for _, msg := range settings(p) {
			out = append(out, prefix+"settings."+msg)
		}
	}
	return out
}

// SettingsType returns settings.__type, the provider identifier.
func (p *Post) SettingsType() string {
	var s struct {
		Type string `json:"__type"`
	}
	_ = json.Unmarshal(p.Settings, &s)
	return s.Type
}

type ChangePostStatusDto struct {
	Status string `json:"status" validate:"oneof=draft schedule"`
}

type CreateTagDto struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

type GetPostsDto struct {
	StartDate string `json:"startDate" query:"startDate"`
	EndDate   string `json:"endDate" query:"endDate"`
	Customer  string `json:"customer,omitempty" query:"customer"`
}

// Validate is the IsDateString checks.
func (d *GetPostsDto) Validate() []string {
	var out []string
	if !IsISODate(d.StartDate) {
		out = append(out, notISODate("startDate"))
	}
	if !IsISODate(d.EndDate) {
		out = append(out, notISODate("endDate"))
	}
	return out
}

type PostListStateFilter = string

type GetPostsListDto struct {
	Page     int    `json:"page,omitempty" query:"page" validate:"min=0"`
	Limit    int    `json:"limit,omitempty" query:"limit" validate:"omitempty,min=1,max=100"`
	Customer string `json:"customer,omitempty" query:"customer"`
	// Integrations is the raw comma separated list; nil when absent. Use
	// IntegrationIDs for the transformed value.
	Integrations *string             `json:"integrations,omitempty" query:"integrations"`
	State        PostListStateFilter `json:"state,omitempty" query:"state" validate:"omitempty,oneof=all scheduled draft published"`
}

// IntegrationIDs is the @Transform: value ? value.split(',') : [].
func (d *GetPostsListDto) IntegrationIDs() []string {
	if d.Integrations == nil {
		return nil
	}
	if *d.Integrations == "" {
		return []string{}
	}
	return strings.Split(*d.Integrations, ",")
}

type UpdatePostSettingsDto struct {
	Settings map[string]any `json:"settings"`
}

// Validate is IsDefined + IsObject.
func (d *UpdatePostSettingsDto) Validate() []string {
	if d.Settings == nil {
		return []string{notDefined("settings"), "settings must be an object"}
	}
	return nil
}

// WithSettingsType returns {...settings, __type: identifier}.
func WithSettingsType(settings json.RawMessage, identifier string) (json.RawMessage, error) {
	obj := map[string]json.RawMessage{}
	if len(settings) > 0 && string(settings) != "null" {
		if err := json.Unmarshal(settings, &obj); err != nil {
			return nil, err
		}
	}
	obj["__type"], _ = json.Marshal(identifier)
	return json.Marshal(obj)
}
