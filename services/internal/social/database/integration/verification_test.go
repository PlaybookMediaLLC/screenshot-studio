package integration

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func accountVerification() *socialidentity.Verification {
	return &socialidentity.Verification{
		AccountKey: "mastodon:example.social:123", AccountKind: "profile", GrantedScopes: []string{"read:accounts", "write:statuses", "write:media"},
		Capabilities: socialidentity.Capabilities{Version: 1, MaxCharacters: 1024, MaxMediaAttachments: 4, CharactersReservedPerURL: 23,
			MediaMIMETypes: []string{"image/jpeg", "video/mp4"}, ImageSizeLimit: 16777216, VideoSizeLimit: 103809024,
			ImageMatrixLimit: 33177600, VideoMatrixLimit: 8294400, VideoFrameRateLimit: 120},
	}
}

func requireNoVerification(t *testing.T, stored *ent.Integration) {
	t.Helper()
	if stored.VerifiedAccountKey != nil || stored.VerifiedAccountKind != nil || stored.VerifiedScopes != nil || stored.VerifiedCapabilities != nil || stored.IdentityVerifiedAt != nil {
		t.Fatal("unverified credential retained a verified identity or capabilities")
	}
}

func TestVerificationPersistsSeparatelyFromEditableSettings(t *testing.T) {
	f := setup(t, "mastodon-custom")
	proof := accountVerification()
	params := CreateOrUpdateIntegrationParams{Org: f.org.ID, Type: "social", Name: "Account", Provider: "mastodon-custom", InternalID: proof.AccountKey, Token: "original", Verification: proof}
	before := time.Now().Add(-time.Second)
	created := f.connect(t, params)
	stored := f.client.Integration.GetX(f.ctx, created.ID)
	if stored.VerifiedAccountKey == nil || *stored.VerifiedAccountKey != proof.AccountKey || stored.VerifiedAccountKind == nil || *stored.VerifiedAccountKind != "profile" ||
		!reflect.DeepEqual(stored.VerifiedScopes, proof.GrantedScopes) || !reflect.DeepEqual(stored.VerifiedCapabilities, &proof.Capabilities) || stored.IdentityVerifiedAt == nil || stored.IdentityVerifiedAt.Before(before) {
		t.Fatal("verified provider facts did not persist")
	}
	otherOrg := f.client.Organization.Create().SetName("Other").SaveX(f.ctx)
	if _, err := f.service.repo.UpdateProviderSettings(f.ctx, otherOrg.ID, stored.ID, `{"maxCharacters":999999}`); !ent.IsNotFound(err) {
		t.Fatal("foreign workspace changed provider settings")
	}
	if _, err := f.service.repo.UpdateProviderSettings(f.ctx, f.org.ID, stored.ID, `{"maxCharacters":999999,"verifiedScopes":["all"]}`); err != nil {
		t.Fatal(err)
	}
	stored = f.client.Integration.GetX(f.ctx, stored.ID)
	if stored.VerifiedCapabilities.MaxCharacters != 1024 || !reflect.DeepEqual(stored.VerifiedScopes, proof.GrantedScopes) {
		t.Fatal("editable settings changed verified capabilities")
	}
	// A fresh successful authorization replaces the entire snapshot on the same row.
	proof.Capabilities.MaxCharacters = 700
	proof.GrantedScopes = []string{"read", "write"}
	params.Token = "replacement"
	updated := f.connect(t, params)
	if updated.ID != stored.ID || updated.VerifiedCapabilities.MaxCharacters != 700 || !reflect.DeepEqual(updated.VerifiedScopes, proof.GrantedScopes) {
		t.Fatal("reconnect failed to replace verified facts atomically")
	}
	// A replacement token without provider verification cannot inherit old proof.
	params.Token, params.Verification = "legacy-replacement", nil
	updated = f.connect(t, params)
	if updated.ID != stored.ID || updated.Token != "legacy-replacement" {
		t.Fatal("reconnect changed the integration identity")
	}
	requireNoVerification(t, updated)
}

func TestInvalidVerificationCannotReplaceStoredCredentials(t *testing.T) {
	f := setup(t, "mastodon-custom")
	proof := accountVerification()
	params := CreateOrUpdateIntegrationParams{Org: f.org.ID, Type: "social", Name: "Account", Provider: "mastodon-custom", InternalID: proof.AccountKey, Token: "original", Verification: proof}
	created := f.connect(t, params)
	proof.AccountKey = "mastodon:other.social:123"
	params.Token = "invalid-replacement"
	if _, err := f.service.repo.CreateOrUpdateIntegration(f.ctx, params); !errors.Is(err, socialidentity.ErrInvalid) {
		t.Fatal("mismatched verification was accepted")
	}
	stored := f.client.Integration.GetX(f.ctx, created.ID)
	if stored.Token != "original" || stored.VerifiedAccountKey == nil || *stored.VerifiedAccountKey != params.InternalID {
		t.Fatal("rejected authorization modified current credentials")
	}
	// The database independently prevents a partially written verification record.
	if _, err := f.client.Integration.UpdateOneID(created.ID).ClearVerifiedCapabilities().Save(f.ctx); err == nil {
		t.Fatal("database accepted incomplete verification")
	}
	if _, err := f.service.repo.MigrateIntegration(f.ctx, f.org.ID, created.ID, "new-id", "other", nil); err != nil {
		t.Fatal(err)
	}
	requireNoVerification(t, f.client.Integration.GetX(f.ctx, created.ID))
}
