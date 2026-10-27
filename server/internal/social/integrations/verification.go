package integrations

import (
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

// RequireVerifiedIdentity checks the current stored proof for adapters that
// provide one. It never derives identity or grants from editable settings.
func RequireVerifiedIdentity(in *ent.Integration) error {
	if in == nil {
		return socialidentity.ErrInvalid
	}
	if !socialidentity.RequiresVerification(in.ProviderIdentifier) {
		return nil
	}
	if in.VerifiedAccountKey == nil || in.VerifiedAccountKind == nil || in.VerifiedCapabilities == nil || in.IdentityVerifiedAt == nil {
		return socialidentity.ErrInvalid
	}
	proof := socialidentity.Verification{AccountKey: *in.VerifiedAccountKey, AccountKind: *in.VerifiedAccountKind, GrantedScopes: in.VerifiedScopes, Capabilities: *in.VerifiedCapabilities}
	return proof.Validate(in.ProviderIdentifier, in.InternalID)
}
