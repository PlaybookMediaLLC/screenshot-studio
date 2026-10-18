// Package slack is the Slack provider.
package slack

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

const identifier = "slack"

// apiBase is overridden by tests.
var apiBase = "https://slack.com"

type Provider struct {
	*integrations.Base
}

func New() *Provider {
	return &Provider{Base: integrations.NewBase(identifier, nil)}
}

var scopes = []string{"channels:read", "chat:write", "users:read", "groups:read", "channels:join", "chat:write.customize"}

func (p *Provider) Info() integrations.Info {
	return integrations.Info{
		Identifier:       identifier,
		Name:             "Slack",
		Editor:           "normal",
		Scopes:           scopes,
		MaxConcurrentJob: 10, // Slack limits are per workspace
	}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 400000 }

func (p *Provider) SettingsDTO() any { return &SlackDto{} }

// CheckValidity: media goes out as Block Kit image blocks, which Slack only
// accepts for png / jpg / gif; an mp4 makes chat.postMessage reject the whole
// message.
func (p *Provider) CheckValidity(_ context.Context, posts [][]integrations.ValidityMedia, _ json.RawMessage, _ []integrations.AdditionalSetting) (string, error) {
	for _, post := range posts {
		for _, item := range post {
			if strings.Contains(item.Path, "mp4") {
				return "No video support for Slack, only images", nil
			}
		}
	}
	return "", nil
}

func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{ExpiresIn: 1000000}, nil
}

// redirectURI: Slack requires https, so plain-http instances go through
// redirectmeto.com.
func redirectURI() string {
	frontend, ok := os.LookupEnv("FRONTEND_URL")
	prefix := ""
	if ok && !strings.Contains(frontend, "https") {
		prefix = "https://redirectmeto.com/"
	}
	return prefix + frontend + "/integrations/social/slack"
}

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(6)
	return &integrations.GenerateAuthURLResponse{
		URL: "https://slack.com/oauth/v2/authorize?client_id=" + os.Getenv("SLACK_ID") +
			"&redirect_uri=" + url.QueryEscape(redirectURI()) +
			"&scope=channels:read,chat:write,users:read,groups:read,channels:join,chat:write.customize&state=" + state,
		CodeVerifier: ids.Secure(10),
		State:        state,
	}, nil
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	redirect := redirectURI()
	if params.Refresh != "" {
		redirect += "?refresh=" + params.Refresh
	}
	res, err := p.Fetch(ctx, apiBase+"/api/oauth.v2.access", integrations.Request{
		Method:  "POST",
		Headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
		Body: []byte(url.Values{
			"client_id":     {os.Getenv("SLACK_ID")},
			"client_secret": {os.Getenv("SLACK_SECRET")},
			"code":          {params.Code},
			"redirect_uri":  {redirect},
		}.Encode()),
	})
	if err != nil {
		return nil, err
	}
	var access struct {
		AccessToken string `json:"access_token"`
		Team        struct {
			ID string `json:"id"`
		} `json:"team"`
		BotUserID string `json:"bot_user_id"`
		Scope     string `json:"scope"`
	}
	if err := res.JSON(&access); err != nil {
		return nil, err
	}
	if err := p.CheckScopes(scopes, strings.Split(access.Scope, ",")); err != nil {
		return nil, err
	}

	var info struct {
		User struct {
			Name     string `json:"name"`
			RealName string `json:"real_name"`
			Profile  struct {
				ImageOriginal string `json:"image_original"`
			} `json:"profile"`
		} `json:"user"`
	}
	if err := call(ctx, http.MethodGet, "/api/users.info?user="+url.QueryEscape(access.BotUserID), access.AccessToken, nil, &info); err != nil {
		return nil, err
	}
	now := time.Now()
	return &integrations.AuthTokenDetails{
		ID:           access.Team.ID,
		Name:         info.User.RealName,
		AccessToken:  access.AccessToken,
		RefreshToken: "null",
		ExpiresIn:    now.AddDate(100, 0, 0).Unix() - now.Unix(),
		Picture:      info.User.Profile.ImageOriginal,
		Username:     info.User.Name,
	}, nil
}

// call is the plain fetch the provider uses for Slack's API (no retry or
// classification); out == nil skips reading the JSON.
func call(ctx context.Context, method, endpoint, token string, body, out any) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, apiBase+endpoint, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := ssrf.Client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if out == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}

func (p *Provider) Tools() []integrations.Tool {
	return []integrations.Tool{{MethodName: "channels", Description: "Get list of channels", DataSchema: []integrations.ToolField{}}}
}

func (p *Provider) Functions() map[string]integrations.Function {
	return map[string]integrations.Function{
		"channels": func(ctx context.Context, accessToken string, _ json.RawMessage, internalID string, _ *ent.Integration) (any, error) {
			return p.Channels(ctx, accessToken, internalID)
		},
	}
}

type Channel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (p *Provider) Channels(ctx context.Context, accessToken, _ string) ([]Channel, error) {
	var list struct {
		Channels *[]Channel `json:"channels"`
	}
	if err := call(ctx, http.MethodGet, "/api/conversations.list?types=public_channel,private_channel", accessToken, nil, &list); err != nil {
		return nil, err
	}
	if list.Channels == nil {
		return nil, errors.New("Cannot read properties of undefined (reading 'map')")
	}
	return *list.Channels, nil
}

// checkAPIError: Slack answers HTTP 200 with { ok: false, error } on
// failures, so the post used to be marked completed with no message in the
// channel.
func (p *Provider) checkAPIError(all map[string]any) error {
	if ok, isBool := all["ok"].(bool); !isBool || ok {
		return nil
	}
	data, _ := json.Marshal(all)
	errorCode, _ := all["error"].(string)
	var parts []string
	if errorCode != "" {
		parts = append(parts, errorCode)
	}
	if list, ok := all["errors"].([]any); ok {
		for _, e := range list {
			if s := jsString(e); s != "" {
				parts = append(parts, s)
			}
		}
	}
	message := strings.Join(parts, ": ")
	if message == "" {
		message = "Slack rejected the request"
	}
	if slices.Contains([]string{"invalid_auth", "token_revoked", "token_expired", "account_inactive"}, errorCode) {
		return temporalx.RefreshToken(identifier, string(data), "{}", message)
	}
	if errorCode == "ratelimited" {
		return errors.New(message)
	}
	return temporalx.BadBody(identifier, string(data), "{}", message)
}

// jsString is String(value) for the falsy filter of checkApiError.
func jsString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		if !t {
			return ""
		}
		return "true"
	case float64:
		if t == 0 {
			return ""
		}
		return fmt.Sprint(t)
	}
	return "[object Object]"
}

func blocks(post integrations.PostDetails) []any {
	out := []any{map[string]any{"type": "section", "text": map[string]string{"type": "mrkdwn", "text": post.Message}}}
	for _, m := range post.Media {
		out = append(out, map[string]string{"type": "image", "image_url": m.Path, "alt_text": ""})
	}
	return out
}

type message struct {
	Channel  string  `json:"channel"`
	Username string  `json:"username"`
	IconURL  *string `json:"icon_url"`
	ThreadTS string  `json:"thread_ts,omitempty"`
	Blocks   []any   `json:"blocks"`
}

// postMessage posts and returns the message ts and its permalink.
func (p *Provider) postMessage(ctx context.Context, accessToken string, msg message) (string, string, error) {
	var posted map[string]any
	if err := call(ctx, http.MethodPost, "/api/chat.postMessage", accessToken, msg, &posted); err != nil {
		return "", "", err
	}
	if err := p.checkAPIError(posted); err != nil {
		return "", "", err
	}
	ts, _ := posted["ts"].(string)
	channel, _ := posted["channel"].(string)

	var link struct {
		Permalink string `json:"permalink"`
	}
	if err := call(ctx, http.MethodGet, "/api/chat.getPermalink?channel="+url.QueryEscape(channel)+"&message_ts="+url.QueryEscape(ts), accessToken, nil, &link); err != nil {
		return "", "", err
	}
	return ts, link.Permalink, nil
}

func channelOf(raw json.RawMessage) string {
	var s struct {
		Channel string `json:"channel"`
	}
	_ = json.Unmarshal(raw, &s)
	return s.Channel
}

func (p *Provider) Post(ctx context.Context, _, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	first := posts[0]
	channel := channelOf(first.Settings)

	// Join the channel first
	if err := call(ctx, http.MethodPost, "/api/conversations.join", accessToken, map[string]string{"channel": channel}, nil); err != nil {
		return nil, err
	}

	// Post the main message
	ts, permalink, err := p.postMessage(ctx, accessToken, message{
		Channel: channel, Username: integration.Name, IconURL: integration.Picture, Blocks: blocks(first),
	})
	if err != nil {
		return nil, err
	}
	return []integrations.PostResponse{{ID: first.ID, PostID: ts, ReleaseURL: permalink, Status: "posted"}}, nil
}

func (p *Provider) Comment(ctx context.Context, _, postID, lastCommentID, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	commentPost := posts[0]
	threadTS := lastCommentID
	if threadTS == "" {
		threadTS = postID
	}
	// Post the threaded reply
	ts, permalink, err := p.postMessage(ctx, accessToken, message{
		Channel: channelOf(commentPost.Settings), Username: integration.Name, IconURL: integration.Picture,
		ThreadTS: threadTS, Blocks: blocks(commentPost),
	})
	if err != nil {
		return nil, err
	}
	return []integrations.PostResponse{{ID: commentPost.ID, PostID: ts, ReleaseURL: permalink, Status: "posted"}}, nil
}

func (p *Provider) ChangeProfilePicture(_ context.Context, _, _, pictureURL string) (string, error) {
	return pictureURL, nil
}

func (p *Provider) ChangeNickname(_ context.Context, _, _, name string) (string, error) {
	return name, nil
}
