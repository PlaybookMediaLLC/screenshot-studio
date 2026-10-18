// Package twitch is the Twitch provider: chat messages and announcements
// in the broadcaster's own channel.
package twitch

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/internal/communityutil"
)

const identifier = "twitch"

// Overridden by tests.
var (
	idURL     = "https://id.twitch.tv"
	apiURL    = "https://api.twitch.tv"
	postDelay = 2 * time.Second
)

var scopes = []string{"user:write:chat", "user:read:chat", "moderator:manage:announcements"}

type Provider struct {
	*integrations.Base
}

func New() *Provider {
	return &Provider{Base: integrations.NewBase(identifier, nil)}
}

// SettingsDTO is TwitchDto.
type SettingsDTO struct {
	MessageType       *string `json:"messageType,omitempty"`
	AnnouncementColor *string `json:"announcementColor,omitempty"`
}

func (d *SettingsDTO) Validate() []string {
	var errs []string
	if d.MessageType != nil && *d.MessageType != "message" && *d.MessageType != "announcement" {
		errs = append(errs, "messageType must be one of the following values: message, announcement")
	}
	if d.AnnouncementColor != nil {
		switch *d.AnnouncementColor {
		case "primary", "blue", "green", "orange", "purple":
		default:
			errs = append(errs, "announcementColor must be one of the following values: primary, blue, green, orange, purple")
		}
	}
	return errs
}

func (p *Provider) Info() integrations.Info {
	return integrations.Info{
		Identifier:       identifier,
		Name:             "Twitch",
		Editor:           "normal",
		Scopes:           scopes,
		MaxConcurrentJob: 5, // Twitch limits are per user
	}
}

// MaxLength is Twitch's chat message max length.
func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 500 }

func (p *Provider) SettingsDTO() any { return &SettingsDTO{} }

func (p *Provider) token(ctx context.Context, form url.Values) (*integrations.AuthTokenDetails, error) {
	res, err := p.Fetch(ctx, idURL+"/oauth2/token", integrations.Request{
		Method:  http.MethodPost,
		Headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
		Body:    []byte(form.Encode()),
	})
	if err != nil {
		return nil, err
	}
	var token struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := res.JSON(&token); err != nil {
		return nil, err
	}
	user, err := getUserInfo(ctx, token.AccessToken)
	if err != nil {
		return nil, err
	}
	user.AccessToken = token.AccessToken
	user.RefreshToken = token.RefreshToken
	user.ExpiresIn = token.ExpiresIn
	return user, nil
}

func (p *Provider) RefreshToken(ctx context.Context, refreshToken string) (*integrations.AuthTokenDetails, error) {
	return p.token(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {os.Getenv("TWITCH_CLIENT_ID")},
		"client_secret": {os.Getenv("TWITCH_CLIENT_SECRET")},
		"refresh_token": {refreshToken},
	})
}

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(32)
	redirectURI := os.Getenv("FRONTEND_URL") + "/integrations/social/twitch"
	return &integrations.GenerateAuthURLResponse{
		URL: "https://id.twitch.tv/oauth2/authorize" +
			"?response_type=code" +
			"&client_id=" + os.Getenv("TWITCH_CLIENT_ID") +
			"&redirect_uri=" + communityutil.EncodeURIComponent(redirectURI) +
			"&scope=" + communityutil.EncodeURIComponent(strings.Join(scopes, " ")) +
			"&state=" + state,
		CodeVerifier: ids.Secure(10),
		State:        state,
	}, nil
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	redirectURI := os.Getenv("FRONTEND_URL") + "/integrations/social/twitch"
	if params.Refresh != "" {
		redirectURI += "?refresh=" + params.Refresh
	}
	return p.token(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {os.Getenv("TWITCH_CLIENT_ID")},
		"client_secret": {os.Getenv("TWITCH_CLIENT_SECRET")},
		"redirect_uri":  {redirectURI},
		"code":          {params.Code},
	})
}

func getUserInfo(ctx context.Context, accessToken string) (*integrations.AuthTokenDetails, error) {
	res, err := communityutil.Fetch(ctx, http.MethodGet, apiURL+"/helix/users", map[string]string{
		"Authorization": "Bearer " + accessToken,
		"Client-Id":     os.Getenv("TWITCH_CLIENT_ID"),
	}, nil)
	if err != nil {
		return nil, err
	}
	var data struct {
		Data []struct {
			ID              any    `json:"id"`
			DisplayName     string `json:"display_name"`
			Login           string `json:"login"`
			ProfileImageURL string `json:"profile_image_url"`
		} `json:"data"`
	}
	if err := res.JSON(&data); err != nil {
		return nil, err
	}
	if len(data.Data) == 0 {
		return nil, errors.New("Cannot read properties of undefined (reading 'id')")
	}
	user := data.Data[0]
	return &integrations.AuthTokenDetails{
		ID:       communityutil.JSString(user.ID),
		Name:     user.DisplayName,
		Username: user.Login,
		Picture:  user.ProfileImageURL,
	}, nil
}

// sendAnnouncement ignores the response: announcements answer 204 No Content.
func sendAnnouncement(ctx context.Context, broadcasterID, accessToken, message, color string) error {
	body, _ := json.Marshal(map[string]string{"message": communityutil.Substring16(message, 500), "color": color})
	_, err := communityutil.Fetch(ctx, http.MethodPost,
		apiURL+"/helix/chat/announcements?broadcaster_id="+broadcasterID+"&moderator_id="+broadcasterID,
		map[string]string{
			"Authorization": "Bearer " + accessToken,
			"Client-Id":     os.Getenv("TWITCH_CLIENT_ID"),
			"Content-Type":  "application/json",
		}, body)
	return err
}

func (p *Provider) sendChatMessage(ctx context.Context, broadcasterID, accessToken, message, replyToMessageID string) (messageID string, isSent bool, err error) {
	payload := map[string]string{
		"broadcaster_id": broadcasterID,
		"sender_id":      broadcasterID,
		"message":        communityutil.Substring16(message, 500),
	}
	if replyToMessageID != "" {
		payload["reply_parent_message_id"] = replyToMessageID
	}
	body, _ := json.Marshal(payload)
	res, err := p.Fetch(ctx, apiURL+"/helix/chat/messages", integrations.Request{
		Method: http.MethodPost,
		Headers: map[string]string{
			"Authorization": "Bearer " + accessToken,
			"Client-Id":     os.Getenv("TWITCH_CLIENT_ID"),
			"Content-Type":  "application/json",
		},
		Body: body,
	})
	if err != nil {
		return "", false, err
	}
	var data struct {
		Data []struct {
			MessageID string `json:"message_id"`
			IsSent    *bool  `json:"is_sent"`
		} `json:"data"`
	}
	if err := res.JSON(&data); err != nil {
		return "", false, err
	}
	messageID = ids.Make(10)
	if len(data.Data) > 0 {
		if data.Data[0].MessageID != "" {
			messageID = data.Data[0].MessageID
		}
		if data.Data[0].IsSent != nil {
			isSent = *data.Data[0].IsSent
		}
	}
	return messageID, isSent, nil
}

func channelURL(integration *ent.Integration) string {
	if integration.Profile != nil && *integration.Profile != "" {
		return "https://twitch.tv/" + *integration.Profile
	}
	return "https://twitch.tv/" + integration.ProviderIdentifier
}

func status(ok bool) string {
	if ok {
		return "posted"
	}
	return "error"
}

func (p *Provider) send(ctx context.Context, id, accessToken string, post integrations.PostDetails, replyTo string, integration *ent.Integration) ([]integrations.PostResponse, error) {
	if err := p.Sleep(ctx, postDelay); err != nil {
		return nil, err
	}
	var settings SettingsDTO
	if err := communityutil.DecodeSettings(post.Settings, &settings); err != nil {
		return nil, err
	}
	if settings.MessageType != nil && *settings.MessageType == "announcement" {
		color := "primary"
		if settings.AnnouncementColor != nil && *settings.AnnouncementColor != "" {
			color = *settings.AnnouncementColor
		}
		if err := sendAnnouncement(ctx, id, accessToken, post.Message, color); err != nil {
			return nil, err
		}
		return []integrations.PostResponse{{
			ID:         post.ID,
			PostID:     ids.Make(10), // Announcements don't return a message ID
			ReleaseURL: channelURL(integration),
			Status:     "posted",
		}}, nil
	}
	messageID, isSent, err := p.sendChatMessage(ctx, id, accessToken, post.Message, replyTo)
	if err != nil {
		return nil, err
	}
	return []integrations.PostResponse{{
		ID:         post.ID,
		PostID:     messageID,
		ReleaseURL: channelURL(integration),
		Status:     status(isSent),
	}}, nil
}

func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	return p.send(ctx, id, accessToken, posts[0], "", integration)
}

// Comment replies in chat to the last comment (or the post).
func (p *Provider) Comment(ctx context.Context, id, postID, lastCommentID, accessToken string, posts []integrations.PostDetails, integration *ent.Integration) ([]integrations.PostResponse, error) {
	replyTo := lastCommentID
	if replyTo == "" {
		replyTo = postID
	}
	return p.send(ctx, id, accessToken, posts[0], replyTo, integration)
}
