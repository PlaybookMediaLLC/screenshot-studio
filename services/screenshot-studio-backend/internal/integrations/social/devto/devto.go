// Package devto ports dev.to.provider.ts and its settings DTOs.
package devto

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
)

// apiURL is overridden by tests.
var apiURL = "https://dev.to/api"

type Provider struct{ *integrations.Base }

var (
	_ integrations.Provider      = (*Provider)(nil)
	_ integrations.CustomFielder = (*Provider)(nil)
)

func New() *Provider { return &Provider{Base: integrations.NewBase("devto", handleErrors)} }

func (p *Provider) Info() integrations.Info {
	// Dev.to has moderate publishing limits
	return integrations.Info{Identifier: "devto", Name: "Dev.to", Editor: "markdown", Scopes: []string{}, MaxConcurrentJob: 3}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 100000 }

func (p *Provider) SettingsDTO() any { return &DevToSettingsDto{} }

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(6)
	return &integrations.GenerateAuthURLResponse{URL: state, CodeVerifier: ids.Secure(10), State: state}, nil
}

func handleErrors(body string, _ int) *integrations.HandledError {
	if strings.Contains(body, "Canonical url has already been taken") {
		return &integrations.HandledError{Type: "bad-body", Value: "Canonical URL already exists"}
	}
	return nil
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
	data, err := fetch(ctx, apiURL+"/users/me", body.APIKey)
	if err != nil {
		return nil, integrations.AuthMessage("Invalid credentials")
	}
	var user *struct {
		Name         string `json:"name"`
		ID           any    `json:"id"`
		ProfileImage string `json:"profile_image"`
		Username     string `json:"username"`
	}
	if json.Unmarshal(data, &user) != nil || user == nil {
		return nil, integrations.AuthMessage("Invalid credentials")
	}
	now := time.Now()
	return &integrations.AuthTokenDetails{
		ExpiresIn:   now.AddDate(100, 0, 0).Unix() - now.Unix(),
		AccessToken: body.APIKey,
		ID:          jsString(user.ID),
		Name:        user.Name,
		Picture:     user.ProfileImage,
		Username:    user.Username,
	}, nil
}

type Tag struct {
	Value json.RawMessage `json:"value,omitempty"`
	Label json.RawMessage `json:"label,omitempty"`
}

// Tags is the "tags" @Tool.
func (p *Provider) Tags(ctx context.Context, token string) ([]Tag, error) {
	data, err := fetch(ctx, apiURL+"/tags?per_page=1000&page=1", token)
	if err != nil {
		return nil, err
	}
	var tags []struct {
		ID   json.RawMessage `json:"id"`
		Name json.RawMessage `json:"name"`
	}
	if err := json.Unmarshal(data, &tags); err != nil {
		return nil, err
	}
	out := make([]Tag, 0, len(tags))
	for _, t := range tags {
		out = append(out, Tag{Value: t.ID, Label: t.Name})
	}
	return out, nil
}

type Organization struct {
	ID       json.RawMessage `json:"id,omitempty"`
	Name     json.RawMessage `json:"name,omitempty"`
	Username json.RawMessage `json:"username,omitempty"`
}

// Organizations is the "organizations" @Tool: the organizations the user
// published under, with their full details.
func (p *Provider) Organizations(ctx context.Context, token string) ([]Organization, error) {
	data, err := fetch(ctx, apiURL+"/articles/me/all?per_page=1000", token)
	if err != nil {
		return nil, err
	}
	var orgs []*struct {
		Organization *struct {
			Username string `json:"username"`
		} `json:"organization"`
	}
	if err := json.Unmarshal(data, &orgs); err != nil {
		return nil, err
	}
	var allOrgs []string
	seen := map[string]bool{}
	for _, org := range orgs {
		if org == nil || org.Organization == nil || org.Organization.Username == "" || seen[org.Organization.Username] {
			continue
		}
		seen[org.Organization.Username] = true
		allOrgs = append(allOrgs, org.Organization.Username)
	}

	out := make([]Organization, 0, len(allOrgs))
	for _, org := range allOrgs {
		data, err := fetch(ctx, apiURL+"/organizations/"+org, token)
		if err != nil {
			return nil, err
		}
		var details Organization
		if err := json.Unmarshal(data, &details); err != nil {
			return nil, err
		}
		out = append(out, details)
	}
	return out, nil
}

func (p *Provider) Functions() map[string]integrations.Function {
	return map[string]integrations.Function{
		"tags": func(ctx context.Context, token string, _ json.RawMessage, _ string, _ *ent.Integration) (any, error) {
			return p.Tags(ctx, token)
		},
		"organizations": func(ctx context.Context, token string, _ json.RawMessage, _ string, _ *ent.Integration) (any, error) {
			return p.Organizations(ctx, token)
		},
	}
}

func (p *Provider) Tools() []integrations.Tool {
	return []integrations.Tool{
		{MethodName: "tags", Description: "Tag list", DataSchema: []integrations.ToolField{}},
		{MethodName: "organizations", Description: "Organization list", DataSchema: []integrations.ToolField{}},
	}
}

func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	var settings DevToSettingsDto
	if len(posts[0].Settings) > 0 {
		if err := json.Unmarshal(posts[0].Settings, &settings); err != nil {
			return nil, err
		}
	}
	type article struct {
		Title          *string    `json:"title,omitempty"`
		BodyMarkdown   string     `json:"body_markdown"`
		Published      bool       `json:"published"`
		MainImage      string     `json:"main_image,omitempty"`
		Tags           *[]*string `json:"tags,omitempty"`
		OrganizationID *string    `json:"organization_id,omitempty"`
		CanonicalURL   string     `json:"canonical_url,omitempty"`
	}
	a := article{Title: settings.Title, BodyMarkdown: posts[0].Message, Published: true, OrganizationID: settings.Organization}
	if settings.MainImage != nil && settings.MainImage.Path != nil {
		a.MainImage = *settings.MainImage.Path
	}
	if settings.Tags != nil {
		labels := make([]*string, 0, len(*settings.Tags))
		for _, t := range *settings.Tags {
			labels = append(labels, t.Label)
		}
		a.Tags = &labels
	}
	if settings.Canonical != nil {
		a.CanonicalURL = *settings.Canonical
	}
	body, _ := json.Marshal(map[string]any{"article": a})

	res, err := p.Fetch(ctx, apiURL+"/articles", integrations.Request{
		Method: http.MethodPost,
		Body:   body,
		Headers: map[string]string{
			"Content-Type": "application/json",
			"api-key":      accessToken,
		},
	})
	if err != nil {
		return nil, err
	}
	var data struct {
		ID  any    `json:"id"`
		URL string `json:"url"`
	}
	if err := res.JSON(&data); err != nil {
		return nil, err
	}
	return []integrations.PostResponse{{ID: posts[0].ID, Status: "completed", PostID: jsString(data.ID), ReleaseURL: data.URL}}, nil
}

// fetch is a plain fetch() with the api-key header: any status, body returned.
func fetch(ctx context.Context, url, apiKey string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("api-key", apiKey)
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

// jsString is String(value) for JSON scalars.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	data, _ := json.Marshal(v)
	return string(data)
}
