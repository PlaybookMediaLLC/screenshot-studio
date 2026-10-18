// Package kick is the Kick provider and its (empty) KickDto.
package kick

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
)

// Overridden by tests.
var (
	idURL  = "https://id.kick.com"
	apiURL = "https://api.kick.com"
)

// KickDto is the provider settings DTO; Kick has no settings.
type KickDto struct{}

func (d *KickDto) Validate() []string { return nil }

type Provider struct{ *integrations.Base }

var (
	_ integrations.Provider  = (*Provider)(nil)
	_ integrations.Commenter = (*Provider)(nil)
)

func New() *Provider { return &Provider{Base: integrations.NewBase("kick", nil)} }

var scopes = []string{"chat:write", "user:read", "channel:read"}

func (p *Provider) Info() integrations.Info {
	return integrations.Info{Identifier: "kick", Name: "Kick", Editor: "normal", Scopes: scopes, MaxConcurrentJob: 3}
}

// MaxLength is Kick's chat message max length.
func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 500 }

func (p *Provider) SettingsDTO() any { return &KickDto{} }

func generatePKCE() (codeVerifier, codeChallenge string) {
	buf := make([]byte, 64)
	rand.Read(buf)
	codeVerifier = base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(codeVerifier))
	return codeVerifier, base64.RawURLEncoding.EncodeToString(sum[:])
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	Scope        any    `json:"scope"`
}

func (p *Provider) token(ctx context.Context, form [][2]string) (*tokenResponse, error) {
	res, err := p.Fetch(ctx, idURL+"/oauth/token", integrations.Request{
		Method:  http.MethodPost,
		Headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
		Body:    []byte(encodeForm(form)),
	})
	if err != nil {
		return nil, err
	}
	var out tokenResponse
	if err := res.JSON(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (p *Provider) RefreshToken(ctx context.Context, refreshToken string) (*integrations.AuthTokenDetails, error) {
	tok, err := p.token(ctx, [][2]string{
		{"grant_type", "refresh_token"},
		{"client_id", os.Getenv("KICK_CLIENT_ID")},
		{"client_secret", os.Getenv("KICK_SECRET")},
		{"refresh_token", refreshToken},
	})
	if err != nil {
		return nil, err
	}

	// Get user info
	userInfo, err := getUserInfo(ctx, tok.AccessToken)
	if err != nil {
		return nil, err
	}
	return &integrations.AuthTokenDetails{
		RefreshToken: tok.RefreshToken,
		ExpiresIn:    tok.ExpiresIn,
		AccessToken:  tok.AccessToken,
		ID:           userInfo.id,
		Name:         userInfo.name,
		Picture:      userInfo.picture,
		Username:     userInfo.username,
	}, nil
}

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(32)
	codeVerifier, codeChallenge := generatePKCE()
	redirectURI := os.Getenv("FRONTEND_URL") + "/integrations/social/kick"
	return &integrations.GenerateAuthURLResponse{
		URL: idURL + "/oauth/authorize" +
			"?response_type=code" +
			"&client_id=" + os.Getenv("KICK_CLIENT_ID") +
			"&redirect_uri=" + encodeURIComponent(redirectURI) +
			"&scope=" + encodeURIComponent(strings.Join(scopes, " ")) +
			"&state=" + state +
			"&code_challenge=" + codeChallenge +
			"&code_challenge_method=S256",
		CodeVerifier: codeVerifier,
		State:        state,
	}, nil
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	redirectURI := os.Getenv("FRONTEND_URL") + "/integrations/social/kick"
	if params.Refresh != "" {
		redirectURI += "?refresh=" + params.Refresh
	}
	tok, err := p.token(ctx, [][2]string{
		{"grant_type", "authorization_code"},
		{"client_id", os.Getenv("KICK_CLIENT_ID")},
		{"client_secret", os.Getenv("KICK_SECRET")},
		{"redirect_uri", redirectURI},
		{"code", params.Code},
		{"code_verifier", params.CodeVerifier},
	})
	if err != nil {
		return nil, err
	}

	// Get user info
	userInfo, err := getUserInfo(ctx, tok.AccessToken)
	if err != nil {
		return nil, err
	}
	return &integrations.AuthTokenDetails{
		ID:           userInfo.id,
		Name:         userInfo.name,
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		ExpiresIn:    tok.ExpiresIn,
		Picture:      userInfo.picture,
		Username:     userInfo.username,
	}, nil
}

type userInfo struct{ id, name, username, picture string }

func getUserInfo(ctx context.Context, accessToken string) (*userInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL+"/public/v1/users", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	body, err := plainFetch(req)
	if err != nil {
		return nil, err
	}
	var userData struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &userData); err != nil {
		return nil, err
	}
	type user struct {
		UserID         any    `json:"user_id"`
		ID             any    `json:"id"`
		Name           string `json:"name"`
		ProfilePicture string `json:"profile_picture"`
	}
	// data is a list; fall back to data itself when it is an object.
	var u *user
	var list []*user
	if json.Unmarshal(userData.Data, &list) == nil && len(list) > 0 && list[0] != nil {
		u = list[0]
	} else if json.Unmarshal(userData.Data, &u) != nil || u == nil {
		return nil, errors.New("Cannot read properties of undefined (reading 'user_id')")
	}
	id := u.UserID
	if !truthy(id) {
		id = u.ID
	}
	return &userInfo{id: jsString(id), name: u.Name, username: u.Name, picture: u.ProfilePicture}, nil
}

// plainFetch is fetch(): the body is read whatever the status.
func plainFetch(req *http.Request) ([]byte, error) {
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

type chatMessage struct {
	Type              string `json:"type"`
	Content           string `json:"content"`
	BroadcasterUserID any    `json:"broadcaster_user_id"`
	ReplyToMessageID  string `json:"reply_to_message_id,omitempty"`
}

func (p *Provider) sendChat(ctx context.Context, accessToken string, msg chatMessage, postID string, integration *ent.Integration) ([]integrations.PostResponse, error) {
	body, _ := json.Marshal(msg)
	res, err := p.Fetch(ctx, apiURL+"/public/v1/chat", integrations.Request{
		Method: http.MethodPost,
		Headers: map[string]string{
			"Authorization": "Bearer " + accessToken,
			"Content-Type":  "application/json",
		},
		Body: body,
	})
	if err != nil {
		return nil, err
	}
	type sent struct {
		MessageID any `json:"message_id"`
		IsSent    any `json:"is_sent"`
	}
	var data struct {
		sent
		Data *sent `json:"data"`
	}
	if err := res.JSON(&data); err != nil {
		return nil, err
	}
	var inner sent
	if data.Data != nil {
		inner = *data.Data
	}

	messageID := ids.Make(10)
	if truthy(inner.MessageID) {
		messageID = jsString(inner.MessageID)
	} else if truthy(data.MessageID) {
		messageID = jsString(data.MessageID)
	}
	status := "error"
	if truthy(inner.IsSent) || truthy(data.IsSent) {
		status = "posted"
	}
	profile := "channel"
	if integration != nil && integration.Profile != nil && *integration.Profile != "" {
		profile = *integration.Profile
	}
	return []integrations.PostResponse{{ID: postID, PostID: messageID, ReleaseURL: "https://kick.com/" + profile, Status: status}}, nil
}

// Post sends a chat message. Kick chat doesn't support media attachments
// directly in messages.
func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	firstPost := posts[0]
	return p.sendChat(ctx, accessToken, chatMessage{
		Type:              "user",
		Content:           substring(firstPost.Message, 500), // Ensure max length
		BroadcasterUserID: parseInt(id),
	}, firstPost.ID, integration)
}

// Comment replies with reply_to_message_id.
func (p *Provider) Comment(ctx context.Context, id, postID, lastCommentID, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	commentPost := posts[0]
	replyTo := lastCommentID
	if replyTo == "" {
		replyTo = postID
	}
	return p.sendChat(ctx, accessToken, chatMessage{
		Type:              "user",
		Content:           substring(commentPost.Message, 500),
		BroadcasterUserID: parseInt(id),
		ReplyToMessageID:  replyTo,
	}, commentPost.ID, integration)
}

// parseInt is parseInt(s, 10); NaN (serialized as null) is nil.
func parseInt(s string) any {
	s = strings.TrimSpace(s)
	end := 0
	if end < len(s) && (s[end] == '-' || s[end] == '+') {
		end++
	}
	start := end
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == start {
		return nil
	}
	n, err := strconv.ParseFloat(s[:end], 64)
	if err != nil {
		return nil
	}
	return n
}

// substring is String.prototype.substring(0, n) over UTF-16 code units.
func substring(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}

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

// encodeForm is URLSearchParams serialization, keeping insertion order.
func encodeForm(pairs [][2]string) string {
	parts := make([]string, len(pairs))
	for i, kv := range pairs {
		parts[i] = url.QueryEscape(kv[0]) + "=" + url.QueryEscape(kv[1])
	}
	return strings.Join(parts, "&")
}

// encodeURIComponent matches JavaScript's escaping.
func encodeURIComponent(s string) string {
	return strings.NewReplacer("+", "%20", "%21", "!", "%27", "'", "%28", "(", "%29", ")", "%2A", "*").Replace(url.QueryEscape(s))
}
