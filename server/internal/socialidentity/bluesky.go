package socialidentity

import (
	"regexp"
	"strings"
)

var blueskyLabel = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
var blueskyPLC = regexp.MustCompile(`^did:plc:[a-z2-7]{24}$`)
var blueskyAppPassword = regexp.MustCompile(`^[a-z0-9]{4}(-[a-z0-9]{4}){3}$`)

// BlueskyHandle normalizes a complete AT Protocol handle without treating a
// handle as durable account identity. Resolution must still bind it to a DID.
func BlueskyHandle(raw string) (string, error) {
	handle := strings.ToLower(strings.TrimSpace(raw))
	handle = strings.TrimPrefix(handle, "@")
	if len(handle) > 253 {
		return "", ErrInvalid
	}
	labels := strings.Split(handle, ".")
	if len(labels) < 2 {
		return "", ErrInvalid
	}
	for _, label := range labels {
		if !blueskyLabel.MatchString(label) {
			return "", ErrInvalid
		}
	}
	tld := labels[len(labels)-1]
	if tld[0] < 'a' || tld[0] > 'z' {
		return "", ErrInvalid
	}
	switch tld {
	case "alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion", "test":
		return "", ErrInvalid
	}
	return handle, nil
}

// BlueskyDID accepts the two account DID methods supported by AT Protocol.
func BlueskyDID(value string) bool {
	if blueskyPLC.MatchString(value) {
		return true
	}
	if !strings.HasPrefix(value, "did:web:") {
		return false
	}
	host := strings.TrimPrefix(value, "did:web:")
	normalized, err := BlueskyHandle(host)
	return err == nil && normalized == host
}

// BlueskyAppPasswordShape rejects ordinary passwords before a credential request.
// The provider-issued session must independently confirm an app-password scope.
func BlueskyAppPasswordShape(value string) bool { return blueskyAppPassword.MatchString(value) }

// BlueskyCapabilities records the current post/embed lexicon limits and the
// server's optional blob limit. Unknown video-account permission stays unknown.
type BlueskyCapabilities struct {
	MaxTextGraphemes int    `json:"maxTextGraphemes"`
	MaxTextBytes     int    `json:"maxTextBytes"`
	MaxImages        int    `json:"maxImages"`
	ImageMaxBytes    int64  `json:"imageMaxBytes"`
	MaxVideos        int    `json:"maxVideos"`
	VideoMaxBytes    int64  `json:"videoMaxBytes"`
	BlobUploadLimit  *int64 `json:"blobUploadLimit"`
	VideoCanUpload   *bool  `json:"videoCanUpload"`
}

// Validate rejects unsupported versions of the pinned Bluesky lexicon limits.
func (c BlueskyCapabilities) Validate() error {
	if c.MaxTextGraphemes != 300 || c.MaxTextBytes != 3000 || c.MaxImages != 4 || c.ImageMaxBytes != 2000000 || c.MaxVideos != 1 || c.VideoMaxBytes != 300000000 ||
		(c.BlobUploadLimit != nil && (*c.BlobUploadLimit < 1 || *c.BlobUploadLimit > 1<<40)) {
		return ErrInvalid
	}
	return nil
}
