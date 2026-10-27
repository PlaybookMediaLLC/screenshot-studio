package socialidentity

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBlueskyHandleAndDIDBoundaries(t *testing.T) {
	for raw, want := range map[string]string{" @ME.BSKY.SOCIAL ": "me.bsky.social", "custom.example.com": "custom.example.com", "xn--bcher-kva.example.com": "xn--bcher-kva.example.com"} {
		if got, err := BlueskyHandle(raw); err != nil || got != want {
			t.Fatalf("valid handle rejected: %q", raw)
		}
	}
	for _, raw := range []string{"", "me", "@@me.bsky.social", "me@example.com", "https://me.bsky.social", "-me.bsky.social", "me-.bsky.social", "a..social", "a.social.", "a.123", "a.local", "a.test", "a.onion", "bücher.social", "127.0.0.1", strings.Repeat("a", 64) + ".social", strings.Repeat("abcd.", 50) + "social"} {
		if _, err := BlueskyHandle(raw); err == nil {
			t.Fatalf("invalid handle accepted: %q", raw)
		}
	}
	for _, did := range []string{"did:plc:abcdefghijklmnopqrstuvwx", "did:web:account.example.com"} {
		if !BlueskyDID(did) {
			t.Fatal("valid DID rejected")
		}
	}
	for _, did := range []string{"did:plc:short", "did:plc:0bcdefghijklmnopqrstuvwx", "did:web:localhost", "did:web:host.example.com:account", "did:web:HOST.example.com", "did:web:127.0.0.1", "did:web:host.example.com%3A443", "did:key:abc"} {
		if BlueskyDID(did) {
			t.Fatalf("unsupported DID accepted: %s", did)
		}
	}
}

func TestBlueskyProofCannotInheritAnotherProtocolOrPrimaryPassword(t *testing.T) {
	did := "did:plc:abcdefghijklmnopqrstuvwx"
	makeProof := func() *Verification {
		return &Verification{AccountKey: "bluesky:" + did, AccountKind: "profile", GrantedScopes: []string{"com.atproto.appPass"}, Capabilities: Capabilities{Version: 1, Bluesky: &BlueskyCapabilities{MaxTextGraphemes: 300, MaxTextBytes: 3000, MaxImages: 4, ImageMaxBytes: 2000000, MaxVideos: 1, VideoMaxBytes: 300000000}}}
	}
	for _, change := range []func(*Verification){
		func(v *Verification) { v.AccountKey = "bluesky:someone.bsky.social" },
		func(v *Verification) { v.GrantedScopes = []string{"com.atproto.access"} },
		func(v *Verification) { v.GrantedScopes = []string{"com.atproto.appPass", "com.atproto.refresh"} },
		func(v *Verification) { v.AccountKind = "page" },
		func(v *Verification) { v.Capabilities.MaxCharacters = 500 },
		func(v *Verification) { v.Capabilities.Version = 2 },
		func(v *Verification) { v.Capabilities.Bluesky.MaxImages = 5 },
		func(v *Verification) { limit := int64(0); v.Capabilities.Bluesky.BlobUploadLimit = &limit },
	} {
		v := makeProof()
		change(v)
		if v.Validate("bluesky", did) == nil {
			t.Fatal("invalid verification accepted")
		}
	}
	v := makeProof()
	if v.Validate("bluesky", did) != nil || v.Validate("mastodon-custom", did) == nil || v.Validate("bluesky", "did:web:other.social") == nil {
		t.Fatal("proof did not bind to its provider and native identity")
	}
	encoded, err := json.Marshal(v.Capabilities)
	var restored Capabilities
	if err != nil || json.Unmarshal(encoded, &restored) != nil || restored.Validate() != nil || restored.Bluesky.VideoCanUpload != nil || restored.Bluesky.BlobUploadLimit != nil {
		t.Fatal("capability serialization invented unknown permissions or limits")
	}
	mastodon := verifiedAccount()
	mastodon.Capabilities = v.Capabilities
	if mastodon.Validate("mastodon-custom", mastodon.AccountKey) == nil {
		t.Fatal("Mastodon proof accepted Bluesky capabilities")
	}
}
