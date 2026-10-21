package tenantpublishing

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialapi"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func verifiedDirectAccount(t *testing.T, account *socialent.Integration, provider string) {
	t.Helper()
	account.ProviderIdentifier, account.InternalID = provider, "123456789"
	x := socialidentity.XStandardPostLimits("read-write", nil)
	proof := socialidentity.Verification{AccountKey: "x:" + account.InternalID, AccountKind: "profile", GrantedScopes: []string{"read-write"}, Capabilities: socialidentity.Capabilities{Version: 1, X: &x}}
	switch provider {
	case "bluesky":
		account.InternalID = "did:plc:abcdefghijklmnopqrstuvwx"
		limits := socialidentity.BlueskyLexiconLimits()
		proof = socialidentity.Verification{AccountKey: "bluesky:" + account.InternalID, AccountKind: "profile", GrantedScopes: []string{"com.atproto.appPass"}, Capabilities: socialidentity.Capabilities{Version: 1, Bluesky: &limits}}
	case "mastodon-custom":
		account.InternalID = "mastodon:fixture.social:123456789"
		proof = socialidentity.Verification{AccountKey: account.InternalID, AccountKind: "profile", GrantedScopes: []string{"read", "write"},
			Capabilities: socialidentity.Capabilities{Version: 1, MaxCharacters: 500, MaxMediaAttachments: 4, CharactersReservedPerURL: 23,
				MediaMIMETypes: []string{"image/png", "video/mp4"}, ImageSizeLimit: 16000000, VideoSizeLimit: 99000000,
				ImageMatrixLimit: 33000000, VideoMatrixLimit: 8200000, VideoFrameRateLimit: 60}}
	}
	if err := proof.Validate(provider, account.InternalID); err != nil {
		t.Fatal(err)
	}
	verifiedAt := time.Now().UTC()
	account.VerifiedAccountKey, account.VerifiedAccountKind = &proof.AccountKey, &proof.AccountKind
	account.VerifiedScopes, account.VerifiedCapabilities, account.IdentityVerifiedAt = proof.GrantedScopes, &proof.Capabilities, &verifiedAt
}

func TestDirectPublisherRequiresCurrentProviderProof(t *testing.T) {
	for _, provider := range []string{"x", "bluesky", "mastodon-custom"} {
		t.Run(provider, func(t *testing.T) {
			for _, scenario := range []string{"missing", "wrong-account", "read-only", "invalid-limits", "valid"} {
				t.Run(scenario, func(t *testing.T) {
					p, signer, poster, input := directFixture()
					account := p.integrations.(fakeIntegrations).item
					verifiedDirectAccount(t, account, provider)
					input.Platform, poster.expectedNativeID = provider, account.InternalID
					switch scenario {
					case "missing":
						account.IdentityVerifiedAt = nil
					case "wrong-account":
						wrong := "another-account"
						account.VerifiedAccountKey = &wrong
					case "read-only":
						account.VerifiedScopes = []string{"read"}
					case "invalid-limits":
						account.VerifiedCapabilities.Version = 99
					}
					id, err := p.Publish(context.Background(), input)
					if scenario == "valid" {
						// Custom Mastodon uses the social workflow path; proof must
						// not bypass the direct publisher's provider allowlist.
						if provider == "mastodon-custom" {
							var unavailable *socialapi.Error
							if !errors.As(err, &unavailable) || unavailable.Status != 400 || signer.calls != 0 || poster.calls != 0 {
								t.Fatalf("unsupported direct provider accepted: %v", err)
							}
							return
						}
						if err != nil || id != "remote-post-1" || poster.calls != 1 {
							t.Fatalf("verified publication: id=%q err=%v calls=%d", id, err, poster.calls)
						}
						return
					}
					var rejected *socialapi.Error
					if !errors.As(err, &rejected) || rejected.Status != 409 || rejected.UnknownDelivery || signer.calls != 0 || poster.calls != 0 {
						t.Fatalf("unverified publication: err=%v signed=%d posted=%d", err, signer.calls, poster.calls)
					}
				})
			}
		})
	}
}

func TestDirectPublisherRejectsInactiveOrMismatchedDestination(t *testing.T) {
	for _, scenario := range []string{"nil-binding", "nil-account", "wrong-tenant", "wrong-id", "wrong-provider", "removed", "incomplete"} {
		t.Run(scenario, func(t *testing.T) {
			p, signer, poster, input := directFixture()
			account := p.integrations.(fakeIntegrations).item
			switch scenario {
			case "nil-binding":
				p.bindings = fakeBindings{}
			case "nil-account":
				p.integrations = fakeIntegrations{}
			case "wrong-tenant":
				account.OrganizationID = "another-org"
			case "wrong-id":
				account.ID = "another-account"
			case "wrong-provider":
				account.ProviderIdentifier = "x"
			case "removed":
				now := time.Now()
				account.DeletedAt = &now
			case "incomplete":
				account.InBetweenSteps = true
			}
			_, err := p.Publish(context.Background(), input)
			var rejected *socialapi.Error
			if !errors.As(err, &rejected) || rejected.UnknownDelivery || signer.calls != 0 || poster.calls != 0 {
				t.Fatalf("unusable destination: err=%v signed=%d posted=%d", err, signer.calls, poster.calls)
			}
		})
	}
}

func TestDirectPublisherRechecksAfterSigningMedia(t *testing.T) {
	for _, scenario := range []string{"removed-proof", "changed-identity", "disabled"} {
		t.Run(scenario, func(t *testing.T) {
			p, signer, poster, input := directFixture()
			account := p.integrations.(fakeIntegrations).item
			verifiedDirectAccount(t, account, "x")
			input.Platform = "x"
			signer.afterSign = func() {
				switch scenario {
				case "removed-proof":
					account.IdentityVerifiedAt = nil
				case "changed-identity":
					account.InternalID = "987654321"
					key := "x:" + account.InternalID
					account.VerifiedAccountKey = &key
				case "disabled":
					account.Disabled = true
				}
			}
			_, err := p.Publish(context.Background(), input)
			var rejected *socialapi.Error
			if !errors.As(err, &rejected) || rejected.Status != 409 || rejected.UnknownDelivery || signer.calls != 1 || poster.calls != 0 {
				t.Fatalf("stale handoff: err=%v signed=%d posted=%d", err, signer.calls, poster.calls)
			}
		})
	}
}

func TestDirectPublisherPreservesPartialThreadWhenAccessIsLost(t *testing.T) {
	p, _, poster, input := directFixture()
	account := p.integrations.(fakeIntegrations).item
	verifiedDirectAccount(t, account, "x")
	input.Platform, poster.expectedNativeID = "x", account.InternalID
	input.Replies = []publishing.PublishReply{{Caption: "two"}, {Caption: "three"}}
	poster.afterReply = func() { account.IdentityVerifiedAt = nil }
	receipt, err := p.PublishThread(context.Background(), input)
	if err != nil || receipt.PostID != "remote-post-1" || receipt.Thread.Total != 2 || receipt.Thread.Posted != 1 || receipt.Thread.LastReplyID != "reply-1" || len(poster.replies) != 1 {
		t.Fatalf("partial thread lost or unauthorized reply posted: receipt=%+v err=%v replies=%v", receipt, err, poster.replies)
	}
}

func TestDirectPublisherDoesNotPublishReplyWithoutItsMedia(t *testing.T) {
	p, signer, poster, input := directFixture()
	input.Replies = []publishing.PublishReply{{Caption: "two", Assets: []publishing.MediaAsset{{ObjectKey: "org/product-org/reply.png", MediaType: "image/png"}}}}
	poster.afterPost = func() { signer.err = errors.New("signing unavailable") }
	receipt, err := p.PublishThread(context.Background(), input)
	if err != nil || receipt.PostID != "remote-post-1" || receipt.Thread.Total != 1 || receipt.Thread.Posted != 0 || len(poster.replies) != 0 {
		t.Fatalf("media failure downgraded reply: receipt=%+v err=%v replies=%v", receipt, err, poster.replies)
	}
}
