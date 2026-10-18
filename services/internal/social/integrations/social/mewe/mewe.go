// Package mewe is the MeWe provider and its MeweDto.
package mewe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

// MeweDto is the provider settings DTO.
type MeweDto struct {
	PostType string  `json:"postType" description:"Where to post: timeline or group"`
	Group    *string `json:"group,omitempty" description:"Group must be an id"`
}

// Validate reproduces class-validator: @IsIn on postType, and on group
// (only when postType is group and group is set) @IsString + @MinLength(1).
func (d *MeweDto) Validate() []string {
	var out []string
	if d.PostType != "timeline" && d.PostType != "group" {
		out = append(out, "postType must be one of the following values: timeline, group")
	}
	if d.PostType == "group" && d.Group != nil && len(utf16.Encode([]rune(*d.Group))) < 1 {
		out = append(out, "group must be longer than or equal to 1 characters")
	}
	return out
}

type Provider struct{ *integrations.Base }

var _ integrations.Provider = (*Provider)(nil)

func New() *Provider { return &Provider{Base: integrations.NewBase("mewe", handleErrors)} }

func (p *Provider) Info() integrations.Info {
	return integrations.Info{Identifier: "mewe", Name: "MeWe", Editor: "normal", Scopes: []string{}, MaxConcurrentJob: 1}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 63206 }

func (p *Provider) SettingsDTO() any { return &MeweDto{} }

func meweHost() string {
	if host := os.Getenv("MEWE_HOST"); host != "" {
		return host
	}
	return "https://mewe.com"
}

func authHeaders(apiToken string) map[string]string {
	return map[string]string{
		"X-App-Id":      os.Getenv("MEWE_APP_ID"),
		"X-Api-Key":     os.Getenv("MEWE_API_KEY"),
		"Authorization": "Bearer " + apiToken,
		"Content-Type":  "application/json",
	}
}

func handleErrors(body string, _ int) *integrations.HandledError {
	if strings.Contains(body, "Unauthorized") {
		return &integrations.HandledError{Type: "refresh-token", Value: "Access token expired, please re-authenticate"}
	}
	if strings.Contains(body, "Enhance Your Calm") || strings.Contains(body, "420") {
		return &integrations.HandledError{Type: "retry", Value: "Rate limited, retrying..."}
	}
	if strings.Contains(body, "Forbidden") {
		return &integrations.HandledError{Type: "bad-body", Value: "Insufficient permissions for this action"}
	}
	return nil
}

func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{}, nil
}

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(6)
	return &integrations.GenerateAuthURLResponse{
		URL: meweHost() + "/login" +
			"?client_id=" + os.Getenv("MEWE_APP_ID") +
			"&redirect_uri=" + encodeURIComponent(os.Getenv("FRONTEND_URL")+"/integrations/social/mewe") +
			"&state=" + state,
		CodeVerifier: ids.Secure(10),
		State:        state,
	}, nil
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	loginRequestToken := params.Code
	if loginRequestToken == "" {
		return nil, integrations.AuthMessage("No login request token received. Please try again.")
	}
	details, msg, err := authenticate(ctx, loginRequestToken)
	if err != nil {
		log.Println(err)
		return nil, integrations.AuthMessage("MeWe authentication failed. Please try again.")
	}
	if msg != "" {
		return nil, integrations.AuthMessage(msg)
	}
	return details, nil
}

func authenticate(ctx context.Context, loginRequestToken string) (*integrations.AuthTokenDetails, string, error) {
	// Exchange loginRequestToken for apiToken
	status, body, err := fetch(ctx, http.MethodGet, meweHost()+"/api/dev/token?loginRequestToken="+loginRequestToken, map[string]string{
		"X-App-Id":  os.Getenv("MEWE_APP_ID"),
		"X-Api-Key": os.Getenv("MEWE_API_KEY"),
	}, nil)
	if err != nil {
		return nil, "", err
	}
	if !ok(status) {
		return nil, "Failed to exchange token. Please try again.", nil
	}
	var tokenData struct {
		Pending   any    `json:"pending"`
		APIToken  string `json:"apiToken"`
		ExpiresAt any    `json:"expiresAt"`
	}
	if err := json.Unmarshal(body, &tokenData); err != nil {
		return nil, "", err
	}
	if truthy(tokenData.Pending) {
		return nil, "Login request is still pending. Please approve on MeWe and try again.", nil
	}
	if tokenData.APIToken == "" {
		return nil, "No API token received. Please try again.", nil
	}
	apiToken := tokenData.APIToken

	// Fetch user profile
	status, body, err = fetch(ctx, http.MethodGet, meweHost()+"/api/dev/me", authHeaders(apiToken), nil)
	if err != nil {
		return nil, "", err
	}
	if !ok(status) {
		return nil, "Failed to fetch MeWe profile.", nil
	}
	var profile struct {
		UserID    jsonID `json:"userId"`
		Name      string `json:"name"`
		FirstName string `json:"firstName"`
		LastName  string `json:"lastName"`
		Handle    string `json:"handle"`
	}
	if err := json.Unmarshal(body, &profile); err != nil {
		return nil, "", err
	}

	now := time.Now()
	expiresIn := now.AddDate(0, 0, 30).Unix() - now.Unix()
	if truthy(tokenData.ExpiresAt) {
		expiresIn = dayjsUnix(tokenData.ExpiresAt) - now.Unix()
	}
	name := profile.Name
	if name == "" {
		name = strings.TrimSpace(profile.FirstName + " " + profile.LastName)
	}
	return &integrations.AuthTokenDetails{
		ID:          string(profile.UserID),
		Name:        name,
		AccessToken: apiToken,
		ExpiresIn:   expiresIn,
		Username:    profile.Handle,
	}, "", nil
}

// dayjsUnix is dayjs(value).unix() for an epoch-milliseconds number or a date
// string; an unparseable date yields 0.
func dayjsUnix(value any) int64 {
	switch v := value.(type) {
	case float64:
		return int64(v) / 1000
	case string:
		for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02"} {
			if t, err := time.Parse(layout, v); err == nil {
				return t.Unix()
			}
		}
	}
	return 0
}

type Group struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Groups is the "groups" @Tool: every group the user belongs to, following
// nextPage links; any failure yields an empty list.
func (p *Provider) Groups(ctx context.Context, accessToken string) ([]Group, error) {
	var all []struct {
		GroupID jsonID `json:"groupId"`
		Name    string `json:"name"`
	}
	nextURL := meweHost() + "/api/dev/groups"
	for nextURL != "" {
		status, body, err := fetch(ctx, http.MethodGet, nextURL, authHeaders(accessToken), nil)
		if err != nil {
			return []Group{}, nil
		}
		if !ok(status) {
			break
		}
		var data struct {
			Groups []struct {
				GroupID jsonID `json:"groupId"`
				Name    string `json:"name"`
			} `json:"groups"`
			NextPage string `json:"nextPage"`
		}
		if err := json.Unmarshal(body, &data); err != nil {
			return []Group{}, nil
		}
		all = append(all, data.Groups...)
		nextURL = ""
		if data.NextPage != "" {
			nextURL = meweHost() + data.NextPage
		}
	}
	out := make([]Group, 0, len(all))
	for _, g := range all {
		out = append(out, Group{ID: string(g.GroupID), Name: g.Name})
	}
	return out, nil
}

func (p *Provider) Functions() map[string]integrations.Function {
	return map[string]integrations.Function{
		"groups": func(ctx context.Context, token string, _ json.RawMessage, _ string, _ *ent.Integration) (any, error) {
			return p.Groups(ctx, token)
		},
	}
}

func (p *Provider) Tools() []integrations.Tool {
	return []integrations.Tool{{MethodName: "groups", Description: "Groups", DataSchema: []integrations.ToolField{}}}
}

func (p *Provider) uploadPhoto(ctx context.Context, accessToken, mediaPath string) (string, error) {
	media, err := p.ReadOrFetch(ctx, mediaPath)
	if err != nil {
		return "", err
	}
	parts := strings.Split(mediaPath, "/")
	fileName := parts[len(parts)-1]
	if fileName == "" {
		fileName = "photo.jpg"
	}

	var form bytes.Buffer
	w := multipart.NewWriter(&form)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, fileName))
	contentType := mime.TypeByExtension(filepath.Ext(fileName))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	header.Set("Content-Type", contentType)
	part, err := w.CreatePart(header)
	if err != nil {
		return "", err
	}
	part.Write(media)
	w.Close()

	status, body, err := fetch(ctx, http.MethodPost, meweHost()+"/api/dev/photo/upload", map[string]string{
		"X-App-Id":      os.Getenv("MEWE_APP_ID"),
		"X-Api-Key":     os.Getenv("MEWE_API_KEY"),
		"Authorization": "Bearer " + accessToken,
		"Content-Type":  w.FormDataContentType(),
	}, form.Bytes())
	if err != nil {
		return "", err
	}
	if !ok(status) {
		return "", errors.New("Photo upload failed: " + string(body))
	}
	var uploadData struct {
		ID jsonID `json:"id"`
	}
	if err := json.Unmarshal(body, &uploadData); err != nil {
		return "", err
	}
	return string(uploadData.ID), nil
}

func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	firstPost := posts[0]
	var settings MeweDto
	if len(firstPost.Settings) > 0 {
		if err := json.Unmarshal(firstPost.Settings, &settings); err != nil {
			return nil, err
		}
	}
	postType := settings.PostType
	if postType == "" {
		postType = "group"
	}
	groupID := "undefined"
	if settings.Group != nil {
		groupID = *settings.Group
	}

	// Upload photos if present (exclude videos)
	uploadedPhotoIDs := []string{}
	for _, media := range firstPost.Media {
		if media.Path != "" && helpers.HasExtension(media.Path, "mp4") {
			continue
		}
		photoID, err := p.uploadPhoto(ctx, accessToken, media.Path)
		if err != nil {
			return nil, err
		}
		uploadedPhotoIDs = append(uploadedPhotoIDs, photoID)
	}

	postBody := map[string]any{"text": firstPost.Message}
	if len(uploadedPhotoIDs) > 0 {
		postBody["uploadedPhotoIds"] = uploadedPhotoIDs
	}
	data, _ := json.Marshal(postBody)

	postURL := meweHost() + "/api/dev/group/" + groupID + "/post"
	if postType == "timeline" {
		postURL = meweHost() + "/api/dev/me/post"
	}

	// MeWe post endpoint may return 204 (no content), so use raw fetch
	status, body, err := fetch(ctx, http.MethodPost, postURL, authHeaders(accessToken), data)
	if err != nil {
		return nil, err
	}
	if !ok(status) {
		if handled := handleErrors(string(body), status); handled != nil {
			return nil, errors.New(handled.Value)
		}
		return nil, errors.New("Failed to create MeWe post")
	}

	profile := "null"
	if integration != nil && integration.Profile != nil {
		profile = *integration.Profile
	}
	releaseURL := "https://mewe.com/group/" + groupID
	if postType == "timeline" {
		releaseURL = "https://mewe.com/" + profile + "/posts"
	}
	return []integrations.PostResponse{{ID: firstPost.ID, PostID: ids.Make(12), ReleaseURL: releaseURL, Status: "success"}}, nil
}

// fetch is a plain fetch(): it returns any status with its body.
func fetch(ctx context.Context, method, url string, headers map[string]string, body []byte) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := integrations.Do(req)
	var respErr *integrations.ResponseError
	if errors.As(err, &respErr) {
		return respErr.Status, respErr.Body, nil
	}
	if err != nil {
		return 0, nil, err
	}
	return res.Status, res.Body, nil
}

func ok(status int) bool { return status >= 200 && status < 300 }

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0
	}
	return true
}

// jsonID accepts a JSON string or number, like String(value).
type jsonID string

func (s *jsonID) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		return nil
	}
	var str string
	if json.Unmarshal(b, &str) == nil {
		*s = jsonID(str)
		return nil
	}
	*s = jsonID(b)
	return nil
}

// encodeURIComponent matches JavaScript's escaping.
func encodeURIComponent(s string) string {
	return strings.NewReplacer("+", "%20", "%21", "!", "%27", "'", "%28", "(", "%29", ")", "%2A", "*").Replace(url.QueryEscape(s))
}
