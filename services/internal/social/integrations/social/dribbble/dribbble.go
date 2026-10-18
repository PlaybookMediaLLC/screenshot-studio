// Package dribbble is the Dribbble provider and its DribbbleDto.
package dribbble

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

// Overridden by tests.
var (
	dribbbleURL = "https://dribbble.com"
	apiURL      = "https://api.dribbble.com"
)

// DribbbleDto is the provider settings DTO.
type DribbbleDto struct {
	Title *string `json:"title"`
	Team  *string `json:"team,omitempty"`
}

// Validate reproduces class-validator in its execution order: title
// @IsDefined, @MinLength(1, 'Title is required'), @IsString; team (when set)
// @IsUrl, @IsString.
func (d *DribbbleDto) Validate() []string {
	var out []string
	if d.Title == nil {
		out = append(out, "title should not be null or undefined", "Title is required", "title must be a string")
	} else if len(utf16.Encode([]rune(*d.Title))) < 1 {
		out = append(out, "Title is required")
	}
	if d.Team != nil && !isURL(*d.Team) {
		out = append(out, "team must be a URL address")
	}
	return out
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

type Provider struct{ *integrations.Base }

var (
	_ integrations.Provider      = (*Provider)(nil)
	_ integrations.Analytics     = (*Provider)(nil)
	_ integrations.PostAnalytics = (*Provider)(nil)
)

func New() *Provider { return &Provider{Base: integrations.NewBase("dribbble", nil)} }

var scopes = []string{"public", "upload"}

func (p *Provider) Info() integrations.Info {
	// Dribbble has moderate API limits
	return integrations.Info{Identifier: "dribbble", Name: "Dribbble", Editor: "normal", Scopes: scopes, MaxConcurrentJob: 3}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 40000 }

func (p *Provider) SettingsDTO() any { return &DribbbleDto{} }

func (p *Provider) CheckValidity(ctx context.Context, posts [][]integrations.ValidityMedia, _ json.RawMessage, _ []integrations.AdditionalSetting) (string, error) {
	var firstItem []integrations.ValidityMedia
	if len(posts) > 0 {
		firstItem = posts[0]
	}
	isMp4 := false
	for _, item := range firstItem {
		if strings.Contains(item.Path, "mp4") {
			isMp4 = true
			break
		}
	}
	if len(firstItem) != 1 {
		return "Requires one item", nil
	}
	if isMp4 {
		return "Does not support mp4 files", nil
	}
	width, height, err := p.ImageDimensions(ctx, firstItem[0].Path)
	if err != nil {
		return "", err
	}
	if (width == 400 && height == 300) || (width == 800 && height == 600) {
		return "", nil
	}
	return "Invalid image size. Requires 400x300 or 800x600 px images.", nil
}

// RefreshToken returns empty details: Dribbble issues only a non-expiring
// access token (no refresh token, no refresh grant), and authenticate stores
// expiresIn 999999999. Empty details make Postiz flag the channel as
// "refresh needed" if the token is ever revoked, like the other providers
// whose tokens cannot be refreshed. (Upstream called Pinterest's sandbox
// token endpoint here.)
func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{}, nil
}

type Team struct {
	ID   json.RawMessage `json:"id,omitempty"`
	Name json.RawMessage `json:"name,omitempty"`
}

// Teams is the "teams" @Tool.
func (p *Provider) Teams(ctx context.Context, accessToken string) ([]Team, error) {
	res, err := p.Fetch(ctx, apiURL+"/v2/user", integrations.Request{
		Headers: map[string]string{"Authorization": "Bearer " + accessToken},
	})
	if err != nil {
		return nil, err
	}
	var data struct {
		Teams []Team `json:"teams"`
	}
	if err := res.JSON(&data); err != nil {
		return nil, err
	}
	if data.Teams == nil {
		return []Team{}, nil
	}
	return data.Teams, nil
}

func (p *Provider) Functions() map[string]integrations.Function {
	return map[string]integrations.Function{
		"teams": func(ctx context.Context, token string, _ json.RawMessage, _ string, _ *ent.Integration) (any, error) {
			return p.Teams(ctx, token)
		},
	}
}

func (p *Provider) Tools() []integrations.Tool {
	return []integrations.Tool{{MethodName: "teams", Description: "Teams list", DataSchema: []integrations.ToolField{}}}
}

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(6)
	return &integrations.GenerateAuthURLResponse{
		URL: dribbbleURL + "/oauth/authorize?client_id=" + os.Getenv("DRIBBBLE_CLIENT_ID") +
			"&redirect_uri=" + encodeURIComponent(os.Getenv("FRONTEND_URL")+"/integrations/social/dribbble") +
			"&response_type=code&scope=" + strings.Join(scopes, "+") + "&state=" + state,
		CodeVerifier: ids.Secure(10),
		State:        state,
	}, nil
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	res, err := p.Fetch(ctx, dribbbleURL+"/oauth/token?client_id="+os.Getenv("DRIBBBLE_CLIENT_ID")+
		"&client_secret="+os.Getenv("DRIBBBLE_CLIENT_SECRET")+"&code="+params.Code+
		"&redirect_uri="+os.Getenv("FRONTEND_URL")+"/integrations/social/dribbble", integrations.Request{Method: http.MethodPost})
	if err != nil {
		return nil, err
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		Scope       any    `json:"scope"`
	}
	if err := res.JSON(&tok); err != nil {
		return nil, err
	}
	if err := p.CheckScopes(scopes, tok.Scope); err != nil {
		return nil, err
	}

	res, err = p.Fetch(ctx, apiURL+"/v2/user", integrations.Request{
		Headers: map[string]string{"Authorization": "Bearer " + tok.AccessToken},
	})
	if err != nil {
		return nil, err
	}
	var user struct {
		ID        any    `json:"id"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
		Login     string `json:"login"`
	}
	if err := res.JSON(&user); err != nil {
		return nil, err
	}
	return &integrations.AuthTokenDetails{
		ID:          jsString(user.ID),
		Name:        user.Name,
		AccessToken: tok.AccessToken,
		ExpiresIn:   999999999,
		Picture:     user.AvatarURL,
		Username:    user.Login,
	}, nil
}

func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	if len(posts) == 0 || len(posts[0].Media) == 0 {
		return nil, errors.New("Dribbble requires an image")
	}
	path := posts[0].Media[0].Path
	image, err := p.ReadOrFetch(ctx, path)
	if err != nil {
		return nil, err
	}
	var settings DribbbleDto
	if len(posts[0].Settings) > 0 {
		if err := json.Unmarshal(posts[0].Settings, &settings); err != nil {
			return nil, err
		}
	}

	segments := strings.Split(path, "/")
	slash := segments[len(segments)-1]
	contentType := mime.TypeByExtension(filepath.Ext(slash))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	var form bytes.Buffer
	w := multipart.NewWriter(&form)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="image"; filename=%q`, slash))
	header.Set("Content-Type", contentType)
	part, err := w.CreatePart(header)
	if err != nil {
		return nil, err
	}
	part.Write(image)
	title := ""
	if settings.Title != nil {
		title = *settings.Title
	}
	w.WriteField("title", title)
	w.WriteField("description", posts[0].Message)
	w.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL+"/v2/shots", &form)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+accessToken)
	res, err := ssrf.Client().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		var buf bytes.Buffer
		buf.ReadFrom(res.Body)
		status := res.StatusCode
		if status >= 400 && status < 500 && status != 429 {
			var data struct {
				Message string `json:"message"`
			}
			details := buf.String()
			if json.Unmarshal(buf.Bytes(), &data) != nil {
				// axios hands back a non-JSON body as a string.
				encoded, _ := json.Marshal(details)
				details = string(encoded)
			}
			if details == "null" {
				details = "{}"
			}
			message := data.Message
			if message == "" {
				message = fmt.Sprintf("Dribbble rejected the shot with status %d", status)
			}
			return nil, temporalx.BadBody("dribbble", details, "{}", message)
		}
		return nil, &integrations.ResponseError{Status: status, Body: buf.Bytes()}
	}

	location := strings.Split(res.Header.Get("Location"), "/")
	newID := location[len(location)-1]
	return []integrations.PostResponse{{
		ID:         posts[0].ID,
		Status:     "completed",
		PostID:     newID,
		ReleaseURL: "https://dribbble.com/shots/" + newID,
	}}, nil
}

func (p *Provider) Analytics(context.Context, string, string, int) ([]integrations.AnalyticsData, error) {
	return []integrations.AnalyticsData{}, nil
}

// PostAnalytics: Dribbble doesn't provide detailed post-level analytics via their API.
func (p *Provider) PostAnalytics(context.Context, string, string, string, int64) ([]integrations.AnalyticsData, error) {
	return []integrations.AnalyticsData{}, nil
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

// encodeURIComponent matches JavaScript's escaping.
func encodeURIComponent(s string) string {
	return strings.NewReplacer("+", "%20", "%21", "!", "%27", "'", "%28", "(", "%29", ")", "%2A", "*").Replace(url.QueryEscape(s))
}
