// Package medium ports medium.provider.ts and its settings DTO.
package medium

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
)

// apiURL is overridden by tests.
var apiURL = "https://api.medium.com/v1"

type MediumTagsSettings struct {
	Value *string `json:"value"`
	Label *string `json:"label"`
}

// MediumSettingsDto is medium.settings.dto.ts.
type MediumSettingsDto struct {
	Title       *string               `json:"title"`
	Subtitle    *string               `json:"subtitle"`
	Canonical   *string               `json:"canonical,omitempty"`
	Publication *string               `json:"publication,omitempty"`
	Tags        *[]MediumTagsSettings `json:"tags,omitempty"`
}

// Validate reproduces class-validator plus Nest's error flattening: messages
// per property in execution order, nested ones prefixed with their path, and
// a property with failing children reports only the children.
func (d *MediumSettingsDto) Validate() []string {
	var out []string
	out = append(out, minLengthDefined("title", d.Title, 2)...)
	out = append(out, minLengthDefined("subtitle", d.Subtitle, 2)...)
	if d.Canonical != nil && *d.Canonical != "" && !strings.Contains(*d.Canonical, "(post:") && !validCanonical(*d.Canonical) {
		out = append(out, "Invalid URL")
	}
	if d.Tags != nil {
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
		} else if len(*d.Tags) > 4 {
			out = append(out, "tags must contain no more than 4 elements")
		}
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

type Provider struct{ *integrations.Base }

var (
	_ integrations.Provider      = (*Provider)(nil)
	_ integrations.CustomFielder = (*Provider)(nil)
)

func New() *Provider { return &Provider{Base: integrations.NewBase("medium", nil)} }

func (p *Provider) Info() integrations.Info {
	// Medium has lenient publishing limits
	return integrations.Info{Identifier: "medium", Name: "Medium", Editor: "markdown", Scopes: []string{}, MaxConcurrentJob: 3}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 100000 }

func (p *Provider) SettingsDTO() any { return &MediumSettingsDto{} }

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(6)
	return &integrations.GenerateAuthURLResponse{URL: state, CodeVerifier: ids.Secure(10), State: state}, nil
}

func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{}, nil
}

func (p *Provider) CustomFields() []integrations.CustomField {
	return []integrations.CustomField{{Key: "apiKey", Label: "API key", Validation: `/^.{3,}$/`, Type: "password"}}
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	var body struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.Unmarshal(decodeBase64(params.Code), &body); err != nil {
		return nil, err
	}
	data, err := fetch(ctx, http.MethodGet, apiURL+"/me", body.APIKey, nil)
	if err != nil {
		return nil, integrations.AuthMessage("Invalid credentials")
	}
	var res struct {
		Data *struct {
			Name     string `json:"name"`
			ID       string `json:"id"`
			ImageURL string `json:"imageUrl"`
			Username string `json:"username"`
		} `json:"data"`
	}
	if json.Unmarshal(data, &res) != nil || res.Data == nil {
		return nil, integrations.AuthMessage("Invalid credentials")
	}
	now := time.Now()
	return &integrations.AuthTokenDetails{
		ExpiresIn:   now.AddDate(100, 0, 0).Unix() - now.Unix(),
		AccessToken: body.APIKey,
		ID:          res.Data.ID,
		Name:        res.Data.Name,
		Picture:     res.Data.ImageURL,
		Username:    res.Data.Username,
	}, nil
}

// Publications is the "publications" @Tool; id is the integration's internal id.
func (p *Provider) Publications(ctx context.Context, accessToken, id string) (json.RawMessage, error) {
	data, err := fetch(ctx, http.MethodGet, apiURL+"/users/"+id+"/publications", accessToken, nil)
	if err != nil {
		return nil, err
	}
	var res struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, err
	}
	return res.Data, nil
}

func (p *Provider) Functions() map[string]integrations.Function {
	return map[string]integrations.Function{
		"publications": func(ctx context.Context, token string, _ json.RawMessage, internalID string, _ *ent.Integration) (any, error) {
			return p.Publications(ctx, token, internalID)
		},
	}
}

func (p *Provider) Tools() []integrations.Tool {
	return []integrations.Tool{{MethodName: "publications", Description: "List of publications", DataSchema: []integrations.ToolField{}}}
}

func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	var settings MediumSettingsDto
	if len(posts[0].Settings) > 0 {
		if err := json.Unmarshal(posts[0].Settings, &settings); err != nil {
			return nil, err
		}
	}
	publication := ""
	if settings.Publication != nil {
		publication = *settings.Publication
	}
	type mediumPost struct {
		Title         *string   `json:"title,omitempty"`
		ContentFormat string    `json:"contentFormat"`
		Content       string    `json:"content"`
		CanonicalURL  string    `json:"canonicalUrl,omitempty"`
		Tags          []*string `json:"tags,omitempty"`
		PublishStatus string    `json:"publishStatus"`
	}
	payload := mediumPost{Title: settings.Title, ContentFormat: "markdown", Content: posts[0].Message, PublishStatus: "public"}
	if settings.Canonical != nil {
		payload.CanonicalURL = *settings.Canonical
	}
	if settings.Tags != nil {
		for _, t := range *settings.Tags {
			payload.Tags = append(payload.Tags, t.Value)
		}
	}
	url := apiURL + "/users/" + id + "/posts"
	if publication != "" {
		url = apiURL + "/publications/" + publication + "/posts"
		payload.PublishStatus = "draft"
	}
	body, _ := json.Marshal(payload)

	data, err := fetch(ctx, http.MethodPost, url, accessToken, body)
	if err != nil {
		return nil, err
	}
	var res struct {
		Data *struct {
			ID  string `json:"id"`
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, err
	}
	if res.Data == nil {
		return nil, errors.New("Cannot read properties of undefined (reading 'id')")
	}
	return []integrations.PostResponse{{ID: posts[0].ID, Status: "completed", PostID: res.Data.ID, ReleaseURL: res.Data.URL}}, nil
}

// fetch is a plain fetch() with a bearer token: any status, body returned.
func fetch(ctx context.Context, method, url, accessToken string, body []byte) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := integrations.Do(req)
	var respErr *integrations.ResponseError
	if errors.As(err, &respErr) {
		return respErr.Body, nil
	}
	if err != nil {
		return nil, err
	}
	return res.Body, nil
}

// decodeBase64 is Buffer.from(s, 'base64'): standard or URL alphabet,
// padding optional, other characters ignored.
func decodeBase64(s string) []byte {
	var clean bytes.Buffer
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '=':
			i = len(s)
		case c == '-':
			clean.WriteByte('+')
		case c == '_':
			clean.WriteByte('/')
		case c == '+' || c == '/' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'):
			clean.WriteByte(c)
		}
	}
	data := clean.Bytes()
	if len(data)%4 == 1 {
		data = data[:len(data)-1]
	}
	out, _ := base64.RawStdEncoding.DecodeString(string(data))
	return out
}
