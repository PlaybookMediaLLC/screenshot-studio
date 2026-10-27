package socialidentity

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func verifiedAccount() *Verification {
	return &Verification{
		AccountKey: "mastodon:example.social:123", AccountKind: "profile", GrantedScopes: []string{"read:accounts", "write:statuses", "write:media"},
		Capabilities: Capabilities{Version: 1, MaxCharacters: 500, MaxMediaAttachments: 4, CharactersReservedPerURL: 23,
			MediaMIMETypes: []string{"image/jpeg", "video/mp4"}, ImageSizeLimit: 16777216, VideoSizeLimit: 103809024,
			ImageMatrixLimit: 33177600, VideoMatrixLimit: 8294400, VideoFrameRateLimit: 120},
	}
}

func TestVerificationCannotChangeAccountOrInferGrants(t *testing.T) {
	good := verifiedAccount()
	if err := good.Validate("mastodon-custom", good.AccountKey); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ provider, id string }{
		{"mastodon-custom", "mastodon:other.social:123"},
		{"mastodon-custom", "mastodon:example.social:124"},
		{"mastodon", good.AccountKey},
		{"x", good.AccountKey},
	} {
		if !errors.Is(good.Validate(tc.provider, tc.id), ErrInvalid) {
			t.Fatal("verification transferred to a different provider or account")
		}
	}
	for _, scopes := range [][]string{nil, {"read:accounts", "write:statuses"}, {"read", "write:statuses", "write:media-extra"}, {"read write"}, {"read", "write", "secret\ncanary"}} {
		bad := verifiedAccount()
		bad.GrantedScopes = scopes
		if !errors.Is(bad.Validate("mastodon-custom", bad.AccountKey), ErrInvalid) {
			t.Fatal("unverified permissions accepted")
		}
	}
	good.GrantedScopes = []string{"read", "write"}
	if err := good.Validate("mastodon-custom", good.AccountKey); err != nil {
		t.Fatal("documented hierarchical grants rejected")
	}
}

func TestVerificationRejectsMalformedIdentity(t *testing.T) {
	for _, key := range []string{"", "mastodon:localhost:123", "mastodon:-bad.social:123", "mastodon:bad-.social:123", "mastodon:" + strings.Repeat("a", 64) + ".social:123", "mastodon:example.social:../123", "mastodon:user@example.social:123", "mastodon:example.social:443:123"} {
		v := verifiedAccount()
		v.AccountKey = key
		if !errors.Is(v.Validate("mastodon-custom", key), ErrInvalid) {
			t.Fatalf("malformed account key accepted: %s", key)
		}
	}
	v := verifiedAccount()
	v.AccountKind = "page"
	if !errors.Is(v.Validate("mastodon-custom", v.AccountKey), ErrInvalid) {
		t.Fatal("profile identity accepted as page")
	}
}

func TestCapabilitySnapshotDistinguishesUnknownFromZero(t *testing.T) {
	caps := verifiedAccount().Capabilities
	data, err := json.Marshal(caps)
	if err != nil || !strings.Contains(string(data), `"mediaDescriptionLimit":null`) {
		t.Fatal("unknown description limit was invented")
	}
	zero := 0
	caps.MediaDescriptionLimit = &zero
	data, err = json.Marshal(caps)
	if err != nil || !strings.Contains(string(data), `"mediaDescriptionLimit":0`) {
		t.Fatal("advertised zero description limit was lost")
	}
	var restored Capabilities
	if json.Unmarshal(data, &restored) != nil || restored.Validate() != nil || restored.MediaDescriptionLimit == nil || *restored.MediaDescriptionLimit != 0 {
		t.Fatal("versioned snapshot cannot round trip")
	}
}
