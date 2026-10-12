// Package nostr ports integrations/social/nostr.provider.ts. nostr-tools'
// event signing (NIP-01, BIP-340 schnorr) and relay protocol are implemented
// directly over websockets.
package nostr

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
)

const identifier = "nostr"

// relays is the relay list, overridden by tests.
var relays = []string{
	"wss://nos.lol",
	"wss://relay.damus.io",
	"wss://relay.snort.social",
	"wss://temp.iris.to",
	"wss://vault.iris.to",
}

type Provider struct {
	*integrations.Base
}

var (
	_ integrations.Provider      = (*Provider)(nil)
	_ integrations.Commenter     = (*Provider)(nil)
	_ integrations.CustomFielder = (*Provider)(nil)
)

func New() *Provider {
	return &Provider{Base: integrations.NewBase(identifier, nil)}
}

func (p *Provider) Info() integrations.Info {
	return integrations.Info{
		Identifier:       identifier,
		Name:             "Nostr",
		Editor:           "normal",
		Scopes:           []string{},
		MaxConcurrentJob: 5,
		ToolTip:          "Make sure you private a HEX key of your Nostr private key, you can get it from websites like iris.to",
	}
}

func (p *Provider) MaxLength([]integrations.AdditionalSetting, json.RawMessage) int { return 100000 }

func (p *Provider) CustomFields() []integrations.CustomField {
	return []integrations.CustomField{{Key: "password", Label: "Nostr private key", Validation: `/^.{3,}$/`, Type: "password"}}
}

func (p *Provider) RefreshToken(context.Context, string) (*integrations.AuthTokenDetails, error) {
	return &integrations.AuthTokenDetails{}, nil
}

func (p *Provider) GenerateAuthURL(context.Context, *integrations.ClientInformation) (*integrations.GenerateAuthURLResponse, error) {
	state := ids.Secure(17)
	return &integrations.GenerateAuthURLResponse{URL: state, CodeVerifier: ids.Secure(10), State: state}, nil
}

// findRelayInformation queries ALL relays in parallel and resolves with the
// newest kind-0 metadata event from ANY relay.
func findRelayInformation(ctx context.Context, pubkey string) map[string]any {
	evt := poolGet(ctx, relays, filter{Kinds: []int{0}, Authors: []string{pubkey}, Limit: 1})
	if evt == nil {
		return map[string]any{}
	}
	content := evt.Content
	if content == "" {
		content = "{}"
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return map[string]any{}
	}
	if str(parsed["name"]) != "" || str(parsed["displayName"]) != "" || str(parsed["display_name"]) != "" {
		return parsed
	}
	return map[string]any{}
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// publish sends the event to every relay in turn and returns its id once at
// least one relay confirmed it with an `OK` (NIP-01). A failing relay is
// skipped; when none accepts the event, the last relay error is returned.
func publish(ctx context.Context, event *Event) (string, error) {
	var lastErr error
	accepted := false
	for _, relay := range relays {
		if err := publishTo(ctx, relay, event); err != nil {
			lastErr = err
			continue
		}
		accepted = true
	}
	if !accepted {
		return "", fmt.Errorf("no nostr relay accepted the event: %w", lastErr)
	}
	return event.ID, nil
}

func (p *Provider) Authenticate(ctx context.Context, params integrations.AuthenticateParams, _ *integrations.ClientInformation) (*integrations.AuthTokenDetails, error) {
	invalid := integrations.AuthMessage("Invalid credentials")
	raw, err := base64.StdEncoding.DecodeString(params.Code)
	if err != nil {
		if raw, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(params.Code, "=")); err != nil {
			return nil, invalid
		}
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, invalid
	}
	priv, err := secretKey(body.Password)
	if err != nil {
		return nil, invalid
	}
	pubkey := publicKey(priv)
	user := findRelayInformation(ctx, pubkey)
	token, err := helpers.SignJWT(map[string]any{"password": body.Password})
	if err != nil {
		return nil, invalid
	}
	now := time.Now()
	return &integrations.AuthTokenDetails{
		ID:           pubkey,
		Name:         firstNonEmpty(str(user["display_name"]), str(user["displayName"]), str(user["name"]), "No Name"),
		AccessToken:  token,
		RefreshToken: "",
		ExpiresIn:    now.AddDate(200, 0, 0).Unix() - now.Unix(),
		Picture:      str(user["picture"]),
		Username:     firstNonEmpty(str(user["name"]), "nousername"),
	}, nil
}

func buildContent(post integrations.PostDetails) string {
	paths := make([]string, 0, len(post.Media))
	for _, m := range post.Media {
		paths = append(paths, m.Path)
	}
	media := strings.Join(paths, "\n\n")
	if media == "" {
		return post.Message
	}
	return post.Message + "\n\n" + media
}

func password(accessToken string) (string, error) {
	claims, err := helpers.VerifyJWT(accessToken)
	if err != nil {
		return "", err
	}
	pw, ok := claims["password"].(string)
	if !ok {
		return "", errors.New("missing password claim")
	}
	return pw, nil
}

func (p *Provider) note(ctx context.Context, id, accessToken string, post integrations.PostDetails, tags [][]string) ([]integrations.PostResponse, error) {
	pw, err := password(accessToken)
	if err != nil {
		return nil, err
	}
	priv, err := secretKey(pw)
	if err != nil {
		return nil, err
	}
	event, err := finalizeEvent(priv, 1, buildContent(post), tags, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	eventID, err := publish(ctx, event)
	if err != nil {
		return nil, err
	}
	return []integrations.PostResponse{{
		ID:         post.ID,
		PostID:     eventID,
		ReleaseURL: fmt.Sprintf("https://primal.net/e/%s", eventID),
		Status:     "completed",
	}}, nil
}

func (p *Provider) Post(ctx context.Context, id, accessToken string, posts []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	// Text note
	return p.note(ctx, id, accessToken, posts[0], [][]string{})
}

func (p *Provider) Comment(ctx context.Context, id, postID, lastCommentID, accessToken string, posts []integrations.PostDetails, _ *ent.Integration) ([]integrations.PostResponse, error) {
	replyToID := lastCommentID
	if replyToID == "" {
		replyToID = postID
	}
	return p.note(ctx, id, accessToken, posts[0], [][]string{{"e", replyToID, "", "reply"}, {"p", id}})
}
