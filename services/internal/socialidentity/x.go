package socialidentity

import (
	"regexp"
	"strconv"
)

var xAccountID = regexp.MustCompile(`^[1-9][0-9]{0,19}$`)
var xSubscription = regexp.MustCompile(`^[A-Za-z0-9 _-]{1,40}$`)

// XAccountID validates the native decimal account ID, never a mutable handle.
func XAccountID(value string) bool {
	if !xAccountID.MatchString(value) {
		return false
	}
	_, err := strconv.ParseUint(value, 10, 64)
	return err == nil
}

// XCapabilities separates an observed OAuth 1.0a access level from documented
// standard-post limits. Subscription metadata does not prove premium API access.
// Account-specific long-post and video allowances remain unknown until verified.
type XCapabilities struct {
	OAuth1AccessLevel             string  `json:"oauth1AccessLevel"`
	SubscriptionType              *string `json:"subscriptionType"`
	StandardMaxWeightedCharacters int     `json:"standardMaxWeightedCharacters"`
	CharactersReservedPerURL      int     `json:"charactersReservedPerUrl"`
	MaxImages                     int     `json:"maxImages"`
	MaxGIFs                       int     `json:"maxGifs"`
	MaxVideos                     int     `json:"maxVideos"`
	ImageMaxBytes                 int64   `json:"imageMaxBytes"`
	GIFMaxBytes                   int64   `json:"gifMaxBytes"`
	LongPostMaxWeightedCharacters *int    `json:"longPostMaxWeightedCharacters"`
	VideoMaxBytes                 *int64  `json:"videoMaxBytes"`
	VideoMaxDurationSeconds       *int    `json:"videoMaxDurationSeconds"`
}

// XStandardPostLimits pins the public standard-post/media contract. It does not
// infer billing access, quota, premium capabilities, or a successful publication.
func XStandardPostLimits(accessLevel string, subscriptionType *string) XCapabilities {
	return XCapabilities{OAuth1AccessLevel: accessLevel, SubscriptionType: subscriptionType,
		StandardMaxWeightedCharacters: 280, CharactersReservedPerURL: 23,
		MaxImages: 4, MaxGIFs: 1, MaxVideos: 1, ImageMaxBytes: 5000000, GIFMaxBytes: 15000000}
}

// Validate accepts only supported write grants and the pinned standard contract.
func (c XCapabilities) Validate() error {
	if (c.OAuth1AccessLevel != "read-write" && c.OAuth1AccessLevel != "read-write-directmessages") ||
		(c.SubscriptionType != nil && !xSubscription.MatchString(*c.SubscriptionType)) ||
		c.StandardMaxWeightedCharacters != 280 || c.CharactersReservedPerURL != 23 ||
		c.MaxImages != 4 || c.MaxGIFs != 1 || c.MaxVideos != 1 || c.ImageMaxBytes != 5000000 || c.GIFMaxBytes != 15000000 ||
		c.LongPostMaxWeightedCharacters != nil || c.VideoMaxBytes != nil || c.VideoMaxDurationSeconds != nil {
		return ErrInvalid
	}
	return nil
}
