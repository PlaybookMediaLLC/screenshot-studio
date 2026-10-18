// Package wordpress is the WordPress provider: articles on a self-hosted
// WordPress site through the REST API and an Application Password.
package wordpress

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/internal/communityutil"
)

const (
	identifier = "wordpress"
	userAgent  = "Postiz/1.0 (+https://postiz.com)"
)

type Provider struct {
	*integrations.Base
}

func New() *Provider {
	return &Provider{Base: integrations.NewBase(identifier, handleErrors)}
}

func (p *Provider) Info() integrations.Info {
	return integrations.Info{
		Identifier:       identifier,
		Name:             "WordPress",
		Editor:           "html",
		Scopes:           []string{},
		MaxConcurrentJob: 8, // WordPress sites are the customer's own servers
		Rules:            `WordPress publishes the content as an article: pictures go inside the content as <img src="..."> where they should appear, the src must be a picture from the media library (upload it with uploadFromUrlTool first), attachments are not published, the cover picture is the main_image setting`,
	}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 100000 }

func (p *Provider) InlineImages(json.RawMessage) bool { return true }

func (p *Provider) SettingsDTO() any { return &SettingsDTO{} }

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(6)
	return &integrations.GenerateAuthURLResponse{URL: state, CodeVerifier: ids.Secure(10), State: state}, nil
}

func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{}, nil
}

func handleErrors(body string, _ int) *integrations.HandledError {
	if strings.Contains(body, "rest_cannot_create") {
		return &integrations.HandledError{Type: "bad-body", Value: "The connect user has insufficient permissions to create posts"}
	}
	return nil
}

func (p *Provider) CustomFields() []integrations.CustomField {
	return []integrations.CustomField{
		{Key: "domain", Label: "Domain URL", Validation: `/^https?:\/\/(?:www\.)?[\w\-]+(\.[\w\-]+)+([\/?#][^\s]*)?$/`, Type: "text"},
		{Key: "username", Label: "Username", Validation: `/.+/`, Type: "text"},
		{Key: "password", Label: "Password", Validation: `/.+/`, Type: "password", Hint: "Application password, create in User->Profile"},
	}
}

type credentials struct {
	Domain   *string `json:"domain"`
	Username string  `json:"username"`
	Password string  `json:"password"`
}

func parseCredentials(token string) (*credentials, string, error) {
	var body credentials
	if err := json.Unmarshal([]byte(communityutil.DecodeBase64(token)), &body); err != nil {
		return nil, "", err
	}
	auth := base64.StdEncoding.EncodeToString([]byte(body.Username + ":" + body.Password))
	return &body, auth, nil
}

func (c *credentials) domain() string {
	if c.Domain == nil {
		return "undefined"
	}
	return *c.Domain
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	body, auth, err := parseCredentials(params.Code)
	if err != nil {
		return nil, err
	}
	if body.Domain == nil {
		return nil, errors.New("Cannot read properties of undefined (reading 'trim')")
	}
	// Normalize the domain - users often paste it with surrounding whitespace
	// or a trailing slash, which would otherwise build `https://site.com//wp-json/...`.
	domain := strings.TrimRight(strings.TrimSpace(*body.Domain), "/")

	// Direct fetch (not Fetch) so we can branch on the HTTP status and return
	// a specific message instead of throwing a generic error.
	res, err := communityutil.Fetch(ctx, http.MethodGet, domain+"/wp-json/wp/v2/users/me", map[string]string{
		"Authorization": "Basic " + auth,
		"User-Agent":    userAgent,
	}, nil)
	if err != nil {
		// DNS failure, connection refused, TLS error, site unreachable, etc.
		log.Println(err)
		return nil, integrations.AuthMessage("Could not reach your WordPress site. Check the Domain URL and that the site is publicly accessible.")
	}

	// A security plugin (e.g. Wordfence), a WAF, or the server config commonly
	// strips the Authorization header or locks down the REST API. We don't try
	// to work around that - surface a distinct, actionable message instead.
	if !communityutil.OK(res.Status) {
		errorBody := res.Text()
		var parsed map[string]any
		_ = json.Unmarshal(res.Body, &parsed)
		wpCode, wpMessage := "", ""
		if communityutil.Truthy(parsed["code"]) {
			wpCode = communityutil.JSString(parsed["code"])
		}
		if communityutil.Truthy(parsed["message"]) {
			wpMessage = communityutil.JSString(parsed["message"])
		}
		details := map[string]string{"code": wpCode, "message": wpMessage}
		if wpCode == "" {
			details["body"] = string([]rune(errorBody)[:min(500, len([]rune(errorBody)))])
		}
		data, _ := json.Marshal(details)
		log.Printf("WordPress auth failed for %s (HTTP %d) %s", domain, res.Status, data)
		if res.Status == http.StatusUnauthorized || res.Status == http.StatusForbidden {
			return nil, integrations.AuthMessage("WordPress rejected the login. A security plugin or server setting may be blocking the REST API or stripping the Authorization header, or the username / Application Password is incorrect.")
		}
		return nil, integrations.AuthMessage(fmt.Sprintf("WordPress returned an unexpected error (HTTP %d). Make sure the REST API is enabled and Application Passwords are available.", res.Status))
	}

	// Even on a 200, a security plugin / maintenance page can return HTML
	// instead of JSON.
	var data any
	if err := res.JSON(&data); err != nil {
		log.Println(err)
		return nil, integrations.AuthMessage("WordPress did not return a valid response. The REST API may be disabled or blocked by a security plugin.")
	}
	user, _ := data.(map[string]any)
	if communityutil.Truthy(user["code"]) {
		return nil, integrations.AuthMessage("Invalid credentials")
	}

	avatars, _ := user["avatar_urls"].(map[string]any)
	biggest := 0.0
	for size := range avatars {
		if n, ok := communityutil.JSNumber(size); ok && n >= biggest {
			biggest = n
		}
	}
	picture := ""
	if v := avatars[strconv.FormatFloat(biggest, 'f', -1, 64)]; communityutil.Truthy(v) {
		picture = communityutil.JSString(v)
	}
	now := time.Now()
	return &integrations.AuthTokenDetails{
		ExpiresIn:   now.AddDate(100, 0, 0).Unix() - now.Unix(),
		AccessToken: params.Code,
		ID:          *body.Domain + "_" + jsConcat(user["id"]),
		Name:        communityutil.JSString(user["name"]),
		Picture:     picture,
		Username:    body.Username,
	}, nil
}

func jsConcat(v any) string {
	if v == nil {
		return "undefined"
	}
	return communityutil.JSString(v)
}

// wpGet backs the frontend-callable functions. They run in the backend HTTP
// endpoint (`/integrations/function`), so they use a plain SSRF-guarded fetch
// rather than Fetch's retry/classification.
func wpGet(ctx context.Context, token, path string) ([]byte, error) {
	body, auth, err := parseCredentials(token)
	if err != nil {
		return nil, err
	}
	res, err := communityutil.Fetch(ctx, http.MethodGet, body.domain()+path, map[string]string{
		"Authorization": "Basic " + auth,
		"User-Agent":    userAgent,
	}, nil)
	if err != nil {
		return nil, err
	}
	if !json.Valid(res.Body) {
		return nil, fmt.Errorf("invalid json response: %s", res.Text())
	}
	return res.Body, nil
}

func (p *Provider) Tools() []integrations.Tool {
	return []integrations.Tool{
		{MethodName: "postTypes", Description: "Get list of post types", DataSchema: []integrations.ToolField{}},
		{MethodName: "categoriesList", Description: "Get list of categories", DataSchema: []integrations.ToolField{}},
		{MethodName: "tagsList", Description: "Get list of tags", DataSchema: []integrations.ToolField{}},
	}
}

func (p *Provider) Functions() map[string]integrations.Function {
	wrap := func(fn func(context.Context, string) ([]communityutil.Option, error)) integrations.Function {
		return func(ctx context.Context, token string, _ json.RawMessage, _ string, _ *ent.Integration) (any, error) {
			return fn(ctx, token)
		}
	}
	return map[string]integrations.Function{
		"postTypes":      wrap(p.PostTypes),
		"categoriesList": wrap(p.CategoriesList),
		"tagsList":       wrap(p.TagsList),
	}
}

// PostTypes lists the site's post types, without wp_*, nav_* and attachment,
// in the order WordPress returns them.
func (p *Provider) PostTypes(ctx context.Context, token string) ([]communityutil.Option, error) {
	data, err := wpGet(ctx, token, "/wp-json/wp/v2/types")
	if err != nil {
		return nil, err
	}
	out := []communityutil.Option{}
	dec := json.NewDecoder(bytes.NewReader(data))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return out, nil
	}
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key, _ := t.(string)
		var value struct {
			RestBase any `json:"rest_base"`
			Name     any `json:"name"`
		}
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, err
		}
		if strings.Contains(key, "wp_") || strings.Contains(key, "nav_") || key == "attachment" {
			continue
		}
		_ = json.Unmarshal(raw, &value)
		out = append(out, communityutil.Option{ID: value.RestBase, Name: value.Name})
	}
	return out, nil
}

func (p *Provider) idNames(ctx context.Context, token, path string) ([]communityutil.Option, error) {
	data, err := wpGet(ctx, token, path)
	if err != nil {
		return nil, err
	}
	var items []map[string]any
	out := []communityutil.Option{}
	if json.Unmarshal(data, &items) != nil {
		return out, nil
	}
	for _, item := range items {
		out = append(out, communityutil.Option{ID: item["id"], Name: item["name"]})
	}
	return out, nil
}

func (p *Provider) CategoriesList(ctx context.Context, token string) ([]communityutil.Option, error) {
	return p.idNames(ctx, token, "/wp-json/wp/v2/categories?per_page=100")
}

func (p *Provider) TagsList(ctx context.Context, token string) ([]communityutil.Option, error) {
	return p.idNames(ctx, token, "/wp-json/wp/v2/tags?per_page=100")
}

// numbers is `.map(Number).filter(n => !isNaN(n))`.
func numbers(v any) []float64 {
	list, _ := v.([]any)
	out := []float64{}
	for _, item := range list {
		if n, ok := communityutil.JSNumber(item); ok {
			out = append(out, n)
		}
	}
	return out
}

type article struct {
	Title         *string   `json:"title,omitempty"`
	Content       string    `json:"content"`
	Slug          string    `json:"slug"`
	Status        string    `json:"status"`
	Categories    []float64 `json:"categories,omitempty"`
	Tags          []float64 `json:"tags,omitempty"`
	FeaturedMedia any       `json:"featured_media,omitempty"`
}

func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	body, auth, err := parseCredentials(accessToken)
	if err != nil {
		return nil, err
	}
	post := posts[0]
	var settings SettingsDTO
	if err := communityutil.DecodeSettings(post.Settings, &settings); err != nil {
		return nil, err
	}

	var mediaID any
	if settings.MainImage != nil && settings.MainImage.Path != nil && *settings.MainImage.Path != "" {
		path := *settings.MainImage.Path
		log.Println("Uploading image to WordPress", path)
		blob, err := p.Fetch(ctx, path, integrations.Request{})
		if err != nil {
			return nil, err
		}
		res, err := p.Fetch(ctx, body.domain()+"/wp-json/wp/v2/media", integrations.Request{
			Method: http.MethodPost,
			Headers: map[string]string{
				"Authorization":       "Basic " + auth,
				"Content-Disposition": `attachment; filename="` + communityutil.LastSegment(path) + `"`,
				"Content-Type":        strings.ToLower(blob.Header.Get("Content-Type")),
				"User-Agent":          userAgent,
			},
			Body: blob.Body,
		})
		if err != nil {
			return nil, err
		}
		var media map[string]any
		if err := res.JSON(&media); err != nil {
			return nil, err
		}
		if communityutil.Truthy(media["id"]) {
			mediaID = media["id"]
		}
	}

	if settings.Title == nil {
		return nil, errors.New("slugify: string argument expected")
	}
	status := "publish"
	if settings.Status != nil && *settings.Status != "" {
		status = *settings.Status
	}
	postType := "undefined"
	if settings.Type != nil {
		postType = *settings.Type
	}
	data, err := json.Marshal(article{
		Title:         settings.Title,
		Content:       post.Message,
		Slug:          communityutil.Slugify(*settings.Title),
		Status:        status,
		Categories:    numbers(settings.Categories),
		Tags:          numbers(settings.Tags),
		FeaturedMedia: mediaID,
	})
	if err != nil {
		return nil, err
	}
	res, err := p.Fetch(ctx, body.domain()+"/wp-json/wp/v2/"+postType, integrations.Request{
		Method: http.MethodPost,
		Headers: map[string]string{
			"Authorization": "Basic " + auth,
			"Content-Type":  "application/json",
			"User-Agent":    userAgent,
		},
		Body: data,
	})
	if err != nil {
		return nil, err
	}
	var submit map[string]any
	if err := res.JSON(&submit); err != nil {
		return nil, err
	}
	return []integrations.PostResponse{{
		ID:         post.ID,
		Status:     "completed",
		PostID:     jsConcat(submit["id"]),
		ReleaseURL: communityutil.JSString(submit["link"]),
	}}, nil
}
