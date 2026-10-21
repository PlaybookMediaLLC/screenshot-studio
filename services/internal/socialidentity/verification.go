// Package socialidentity defines credential-free facts verified by provider adapters.
// These facts are separate from user-editable provider settings.
package socialidentity

import (
	"errors"
	"mime"
	"regexp"
	"slices"
	"strings"
)

// Capabilities is a versioned snapshot of the provider's reported publishing limits.
// Missing limits remain unknown; they must never be replaced with invented defaults.
type Capabilities struct {
	Version                  int                  `json:"version"`
	Bluesky                  *BlueskyCapabilities `json:"bluesky,omitempty"`
	MaxCharacters            int                  `json:"maxCharacters"`
	MaxMediaAttachments      int                  `json:"maxMediaAttachments"`
	CharactersReservedPerURL int                  `json:"charactersReservedPerUrl"`
	MediaMIMETypes           []string             `json:"mediaMimeTypes"`
	ImageSizeLimit           int64                `json:"imageSizeLimit"`
	VideoSizeLimit           int64                `json:"videoSizeLimit"`
	ImageMatrixLimit         int64                `json:"imageMatrixLimit"`
	VideoMatrixLimit         int64                `json:"videoMatrixLimit"`
	VideoFrameRateLimit      int                  `json:"videoFrameRateLimit"`
	MediaDescriptionLimit    *int                 `json:"mediaDescriptionLimit"`
}

// Verification is produced only after the adapter verifies the remote account and grants.
// AccountKey is immutable identity; handles and names never participate in this binding.
type Verification struct {
	AccountKey    string
	AccountKind   string
	GrantedScopes []string
	Capabilities  Capabilities
}

var ErrInvalid = errors.New("provider identity or publishing capabilities could not be verified")
var mastodonKey = regexp.MustCompile(`^mastodon:([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?:[0-9]{1,80}$`)
var scopeName = regexp.MustCompile(`^[a-zA-Z0-9:._-]{1,100}$`)

// Validate binds a snapshot to the actual adapter and returned native identity.
// Each additional provider must supply its own identity and grant rules here.
func (v *Verification) Validate(provider, internalID string) error {
	if v != nil && provider == "bluesky" {
		if !BlueskyDID(internalID) || v.AccountKey != "bluesky:"+internalID || v.AccountKind != "profile" || len(v.GrantedScopes) != 1 ||
			(v.GrantedScopes[0] != "com.atproto.appPass" && v.GrantedScopes[0] != "com.atproto.appPassPrivileged") || v.Capabilities.Bluesky == nil {
			return ErrInvalid
		}
		return v.Capabilities.Validate()
	}
	if v == nil || provider != "mastodon-custom" || v.AccountKey != internalID || len(v.AccountKey) > 350 || !mastodonKey.MatchString(v.AccountKey) || v.AccountKind != "profile" || v.Capabilities.Bluesky != nil {
		return ErrInvalid
	}
	if len(v.GrantedScopes) == 0 || len(v.GrantedScopes) > 64 {
		return ErrInvalid
	}
	for _, scope := range v.GrantedScopes {
		if !scopeName.MatchString(scope) {
			return ErrInvalid
		}
	}
	for _, required := range []string{"read:accounts", "write:statuses", "write:media"} {
		if !slices.Contains(v.GrantedScopes, required) && !slices.Contains(v.GrantedScopes, strings.SplitN(required, ":", 2)[0]) {
			return ErrInvalid
		}
	}
	return v.Capabilities.Validate()
}

// Validate rejects missing, inconsistent and unbounded remote configuration.
func (c Capabilities) Validate() error {
	if c.Bluesky != nil {
		if c.Version != 1 || c.MaxCharacters != 0 || c.MaxMediaAttachments != 0 || c.CharactersReservedPerURL != 0 || len(c.MediaMIMETypes) != 0 ||
			c.ImageSizeLimit != 0 || c.VideoSizeLimit != 0 || c.ImageMatrixLimit != 0 || c.VideoMatrixLimit != 0 || c.VideoFrameRateLimit != 0 || c.MediaDescriptionLimit != nil {
			return ErrInvalid
		}
		return c.Bluesky.Validate()
	}
	if c.Version != 1 || c.MaxCharacters < 1 || c.MaxCharacters > 1000000 || c.MaxMediaAttachments < 1 || c.MaxMediaAttachments > 64 || c.CharactersReservedPerURL < 1 || c.CharactersReservedPerURL > 10000 || len(c.MediaMIMETypes) == 0 || len(c.MediaMIMETypes) > 128 {
		return ErrInvalid
	}
	if c.ImageSizeLimit < 1 || c.ImageSizeLimit > 1<<40 || c.VideoSizeLimit < 1 || c.VideoSizeLimit > 1<<40 || c.ImageMatrixLimit < 1 || c.ImageMatrixLimit > 1<<40 || c.VideoMatrixLimit < 1 || c.VideoMatrixLimit > 1<<40 || c.VideoFrameRateLimit < 1 || c.VideoFrameRateLimit > 10000 {
		return ErrInvalid
	}
	if c.MediaDescriptionLimit != nil && (*c.MediaDescriptionLimit < 0 || *c.MediaDescriptionLimit > 1000000) {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for _, value := range c.MediaMIMETypes {
		media, params, err := mime.ParseMediaType(value)
		if err != nil || len(value) > 128 || len(params) != 0 || media != value || !strings.Contains(media, "/") || seen[media] {
			return ErrInvalid
		}
		seen[media] = true
	}
	return nil
}
