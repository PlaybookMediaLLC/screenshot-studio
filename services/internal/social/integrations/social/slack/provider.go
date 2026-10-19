// Package slack adapts publishing to the backend Slack installation lifecycle.
package slack

import (
	"context"
	"encoding/json"
	"errors"
	"go.temporal.io/sdk/temporal"
	"os"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

const identifier = "slack"

// Lifecycle owns credentials, refresh, channel validation, pacing and provider outcomes.
type Lifecycle interface {
	SocialSlackCall(context.Context, string, string, string, map[string]any) (map[string]json.RawMessage, error)
}
type Provider struct {
	*integrations.Base
	lifecycle Lifecycle
}

func New(lifecycle ...Lifecycle) *Provider {
	p := &Provider{Base: integrations.NewBase(identifier, nil)}
	if len(lifecycle) > 0 {
		p.lifecycle = lifecycle[0]
	}
	return p
}

var scopes = []string{"channels:read", "chat:write", "groups:read", "channels:join", "chat:write.customize"}

func (p *Provider) Info() integrations.Info {
	return integrations.Info{Identifier: identifier, Name: "Slack", Editor: "normal", Scopes: scopes, MaxConcurrentJob: 1}
}
func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 40000 }
func (p *Provider) SettingsDTO() any                                                { return &SlackDto{} }
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
	return nil, errors.New("Slack refresh is managed by the backend installation")
}

// The compatibility connect entry point starts the session-bound backend OAuth flow.
func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	base := strings.TrimRight(os.Getenv("BETTER_AUTH_URL"), "/")
	if base == "" {
		return nil, errors.New("configure the platform origin")
	}
	return &integrations.GenerateAuthURLResponse{URL: base + "/api/integrations/slack/connect?purpose=publishing"}, nil
}
func (p *Provider) Authenticate(context.Context, integrations.AuthenticateParams, *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	return nil, errors.New("Complete Slack connection in Workspace Notifications")
}
func (p *Provider) Tools() []integrations.Tool {
	return []integrations.Tool{{MethodName: "channels", Description: "Get list of channels", DataSchema: []integrations.ToolField{}}}
}
func (p *Provider) Functions() map[string]integrations.Function {
	return map[string]integrations.Function{"channels": func(ctx context.Context, _ string, _ json.RawMessage, _ string, in *ent.Integration) (any, error) {
		return p.channels(ctx, in)
	}}
}
func (p *Provider) call(ctx context.Context, in *ent.Integration, method string, payload map[string]any) (map[string]json.RawMessage, error) {
	if p.lifecycle == nil || in == nil {
		return nil, errors.New("Slack backend lifecycle is unavailable")
	}
	return p.lifecycle.SocialSlackCall(ctx, in.OrganizationID, in.ID, method, payload)
}

type Channel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (p *Provider) channels(ctx context.Context, in *ent.Integration) ([]Channel, error) {
	channels := []Channel{}
	cursor := ""
	seen := map[string]bool{}
	for {
		body, err := p.call(ctx, in, "conversations.list", map[string]any{"limit": 200, "types": "public_channel,private_channel", "exclude_archived": true, "cursor": cursor})
		if err != nil {
			return nil, err
		}
		var page []Channel
		var metadata struct {
			Next string `json:"next_cursor"`
		}
		if json.Unmarshal(body["channels"], &page) != nil {
			return nil, errors.New("malformed Slack channels")
		}
		if raw := body["response_metadata"]; len(raw) > 0 && json.Unmarshal(raw, &metadata) != nil {
			return nil, errors.New("malformed Slack cursor")
		}
		channels = append(channels, page...)
		cursor = metadata.Next
		if cursor == "" {
			return channels, nil
		}
		if seen[cursor] || len(seen) >= 100 {
			return nil, errors.New("invalid Slack pagination")
		}
		seen[cursor] = true
	}
}
func escape(text string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(text)
}
func (p *Provider) post(ctx context.Context, in *ent.Integration, posts []integrations.PostDetails, thread string) ([]integrations.PostResponse, error) {
	if len(posts) != 1 {
		return nil, errors.New("one Slack message is required")
	}
	post := posts[0]
	var settings struct {
		Channel string `json:"channel"`
	}
	if json.Unmarshal(post.Settings, &settings) != nil || settings.Channel == "" {
		return nil, errors.New("select a Slack channel")
	}
	blocks := []any{map[string]any{"type": "section", "text": map[string]string{"type": "plain_text", "text": post.Message}}}
	for _, media := range post.Media {
		blocks = append(blocks, map[string]string{"type": "image", "image_url": media.Path, "alt_text": "Published image"})
	}
	payload := map[string]any{"channel": settings.Channel, "text": escape(post.Message), "blocks": blocks, "parse": "none", "link_names": false, "unfurl_links": false, "unfurl_media": false, "username": in.Name}
	if in.Picture != nil {
		payload["icon_url"] = *in.Picture
	}
	if thread != "" {
		payload["thread_ts"] = thread
	}
	body, err := p.call(ctx, in, "chat.postMessage", payload)
	if err != nil {
		var acceptance interface{ MayHaveBeenAccepted() bool }
		if errors.As(err, &acceptance) && acceptance.MayHaveBeenAccepted() {
			return nil, uncertainPublication()
		}
		return nil, err
	}
	var ts, channel string
	if json.Unmarshal(body["ts"], &ts) != nil || ts == "" || json.Unmarshal(body["channel"], &channel) != nil || channel != settings.Channel {
		return nil, uncertainPublication()
	}
	// A permalink failure must not turn a confirmed publication into a retry.
	link := ""
	if result, err := p.call(ctx, in, "chat.getPermalink", map[string]any{"channel": channel, "message_ts": ts}); err == nil {
		_ = json.Unmarshal(result["permalink"], &link)
	}
	return []integrations.PostResponse{{ID: post.ID, PostID: ts, ReleaseURL: link, Status: "posted"}}, nil
}
func (p *Provider) Post(ctx context.Context, _, _ string, posts []integrations.PostDetails, in *ent.Integration) ([]integrations.PostResponse, error) {
	return p.post(ctx, in, posts, "")
}
func (p *Provider) Comment(ctx context.Context, _ string, postID, lastCommentID, _ string, posts []integrations.PostDetails, in *ent.Integration) ([]integrations.PostResponse, error) {
	if lastCommentID != "" {
		postID = lastCommentID
	}
	return p.post(ctx, in, posts, postID)
}
func (p *Provider) ChangeProfilePicture(_ context.Context, _, _, pictureURL string) (string, error) {
	return pictureURL, nil
}
func (p *Provider) ChangeNickname(_ context.Context, _, _, name string) (string, error) {
	return name, nil
}

func uncertainPublication() error {
	return temporal.NewNonRetryableApplicationError("Slack may have accepted this publication. Check the channel before reposting.", "slack_uncertain", nil)
}
