package publicapi

import (
	"net/http"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func (h *controller) integrationIdentity(c *httpx.Ctx) (any, error) {
	in, err := h.Integrations.GetIntegrationByID(c.R.Context(), c.Org.ID, c.Param("id"))
	if err != nil {
		return nil, err
	}
	if in == nil {
		return nil, msg(http.StatusNotFound, "Integration not found")
	}
	value := socialidentity.Connection{ID: in.ID, Provider: in.ProviderIdentifier, NativeID: in.InternalID, Name: in.Name,
		Active:     in.DeletedAt == nil && !in.Disabled && !in.RefreshNeeded && !in.InBetweenSteps && (in.TokenExpiration == nil || in.TokenExpiration.After(time.Now())),
		VerifiedAt: in.IdentityVerifiedAt}
	if in.Profile != nil {
		value.Handle = *in.Profile
	}
	if in.Picture != nil {
		value.AvatarURL = *in.Picture
	}
	if in.VerifiedAccountKey != nil && in.VerifiedAccountKind != nil && in.VerifiedCapabilities != nil {
		proof := &socialidentity.Verification{AccountKey: *in.VerifiedAccountKey, AccountKind: *in.VerifiedAccountKind, GrantedScopes: in.VerifiedScopes, Capabilities: *in.VerifiedCapabilities}
		if proof.Validate(in.ProviderIdentifier, in.InternalID) == nil {
			value.Verification = proof
		}
	}
	return value, nil
}
