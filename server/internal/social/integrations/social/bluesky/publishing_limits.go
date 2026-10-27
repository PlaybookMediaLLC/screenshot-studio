package bluesky

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func contentFailure(message string) error { return temporalx.BadBody(identifier, "{}", "{}", message) }

func publishingLimits(in *ent.Integration) (socialidentity.BlueskyCapabilities, error) {
	if in != nil && in.VerifiedCapabilities != nil && in.VerifiedAccountKey != nil && in.VerifiedAccountKind != nil && in.IdentityVerifiedAt != nil {
		proof := socialidentity.Verification{AccountKey: *in.VerifiedAccountKey, AccountKind: *in.VerifiedAccountKind, GrantedScopes: in.VerifiedScopes, Capabilities: *in.VerifiedCapabilities}
		if proof.Validate(identifier, in.InternalID) == nil {
			return *proof.Capabilities.Bluesky, nil
		}
	}
	return socialidentity.BlueskyCapabilities{}, temporalx.Disconnect(identifier, "{}", "{}", "Reconnect Bluesky to verify this account's publishing permissions and limits")
}

func mediaKind(m integrations.MediaContent) string {
	if m.Type != "" {
		return m.Type
	}
	// Old recorded workflow payloads did not carry an explicit media type.
	if helpers.HasExtension(m.Path, "mp4") {
		return "video"
	}
	return "image"
}

func checkPostContent(post integrations.PostDetails) error {
	if err := socialidentity.CheckBlueskyText(post.Message); err != nil {
		return contentFailure(err.Error())
	}
	images, videos := 0, 0
	for _, media := range post.Media {
		if media.Path == "" || !utf8.ValidString(media.Alt) {
			return contentFailure("Choose a valid Bluesky media file and description")
		}
		switch mediaKind(media) {
		case "image":
			images++
		case "video":
			videos++
		default:
			return contentFailure("Bluesky accepts images or one MP4 video")
		}
	}
	if images > 4 || videos > 1 || images > 0 && videos > 0 {
		return contentFailure("Choose up to four images or one MP4 video for each Bluesky post")
	}
	if post.Poll != nil {
		return contentFailure("Bluesky does not support polls in this integration")
	}
	return nil
}

func (p PendingData) post() integrations.PostDetails {
	post := integrations.PostDetails{Message: p.Message}
	for _, m := range p.Media {
		post.Media = append(post.Media, integrations.MediaContent{Path: m.Path, Alt: m.Alt, Type: m.Type})
	}
	return post
}

type videoLimits struct {
	CanUpload *bool  `json:"canUpload"`
	Videos    *int64 `json:"remainingDailyVideos"`
	Bytes     *int64 `json:"remainingDailyBytes"`
}

var errVideoUnavailable = errors.New("Bluesky video permission could not be checked; try again later")

func serviceToken(ctx context.Context, a *agent, audience, method string, lifetime time.Duration) (string, error) {
	var result struct {
		Token string `json:"token"`
	}
	err := a.call(ctx, xrpcRequest{nsid: "com.atproto.server.getServiceAuth", params: url.Values{
		"aud": {audience}, "lxm": {method}, "exp": {strconv.FormatInt(time.Now().Add(lifetime).Unix(), 10)},
	}}, &result)
	if err != nil || result.Token == "" || len(result.Token) > 16384 {
		return "", errVideoUnavailable
	}
	return result.Token, nil
}

// Video-service credentials are never redirected. Production uses the public
// SSRF-checked client; tests inject a transport for their local protocol server.
func (p *Provider) videoHTTP(timeout time.Duration) *http.Client {
	client := *p.connectionClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	client.Timeout = timeout
	return &client
}

func (p *Provider) videoCall(ctx context.Context, method, token string, params url.Values, out any) error {
	a, err := newAgent(videoServiceURL)
	if err != nil {
		return errVideoUnavailable
	}
	a.client = p.videoHTTP(2 * time.Minute)
	authorization := ""
	if token != "" {
		authorization = "Bearer " + token
	}
	if err := a.call(ctx, xrpcRequest{nsid: method, params: params, authorization: authorization}, out); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errVideoUnavailable
	}
	return nil
}

func (p *Provider) videoUploadLimits(ctx context.Context, a *agent) (videoLimits, error) {
	token, err := serviceToken(ctx, a, "did:web:video.bsky.app", "app.bsky.video.getUploadLimits", time.Minute)
	if err != nil {
		return videoLimits{}, err
	}
	var limits videoLimits
	if err := p.videoCall(ctx, "app.bsky.video.getUploadLimits", token, nil, &limits); err != nil {
		return videoLimits{}, err
	}
	if limits.CanUpload == nil || limits.Videos != nil && *limits.Videos < 0 || limits.Bytes != nil && *limits.Bytes < 0 {
		return videoLimits{}, errVideoUnavailable
	}
	return limits, nil
}

func (v videoLimits) permits(size int64) error {
	if v.CanUpload == nil {
		return errVideoUnavailable
	}
	if !*v.CanUpload || v.Videos != nil && *v.Videos == 0 || v.Bytes != nil && (size > *v.Bytes || *v.Bytes == 0) {
		return contentFailure("Bluesky does not currently allow this video upload for your account; check email verification and the daily video allowance")
	}
	return nil
}

func (p *Provider) captureVideoPermission(ctx context.Context, a *agent, caps *socialidentity.BlueskyCapabilities) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	caps.VideoCanUpload = nil
	if limits, err := p.videoUploadLimits(ctx, a); err == nil {
		caps.VideoCanUpload = limits.CanUpload
	}
}

// A returned blob must describe the expected media and fit the current PDS
// limit; an unbounded/foreign media result cannot be embedded in a new post.
func checkBlob(raw json.RawMessage, mime string, limit int64, caps socialidentity.BlueskyCapabilities) error {
	var blob struct {
		Type string `json:"$type"`
		MIME string `json:"mimeType"`
		Size int64  `json:"size"`
		Ref  struct {
			Link string `json:"$link"`
		} `json:"ref"`
	}
	if caps.BlobUploadLimit != nil {
		limit = min(limit, *caps.BlobUploadLimit)
	}
	if json.Unmarshal(raw, &blob) != nil || blob.Type != "blob" || blob.MIME != mime || blob.Size < 1 || blob.Size > limit || blob.Ref.Link == "" {
		return contentFailure("Bluesky returned media that does not meet this account's publishing limits")
	}
	return nil
}
