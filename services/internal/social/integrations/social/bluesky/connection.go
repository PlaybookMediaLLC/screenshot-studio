package bluesky

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/instances"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func (p *Provider) authenticateAppPassword(ctx context.Context, params integrations.AuthenticateParams) (*integrations.AuthTokenDetails, error) {
	if len(params.Code) > 8192 {
		return nil, errConnection
	}
	data, err := base64.StdEncoding.DecodeString(params.Code)
	if err != nil {
		data, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(params.Code, "="))
	}
	var input credentials
	if err != nil || json.Unmarshal(data, &input) != nil {
		return nil, errConnection
	}
	handle, err := socialidentity.BlueskyHandle(input.Identifier)
	if err != nil {
		return nil, integrations.AuthMessage("Enter the full Bluesky handle, such as name.bsky.social.")
	}
	if !socialidentity.BlueskyAppPasswordShape(input.Password) {
		return nil, errAppPassword
	}
	did, origin, err := p.discoverAccount(ctx, handle)
	if err != nil {
		return nil, err
	}
	var server struct {
		DID             string `json:"did"`
		BlobUploadLimit *int64 `json:"blobUploadLimit"`
	}
	if err := p.connectionJSON(ctx, origin+"/xrpc/com.atproto.server.describeServer", &server); err != nil || !socialidentity.BlueskyDID(server.DID) {
		return nil, errConnection
	}
	capabilities := socialidentity.BlueskyCapabilities{MaxTextGraphemes: 300, MaxTextBytes: 3000, MaxImages: 4, ImageMaxBytes: 2000000, MaxVideos: 1, VideoMaxBytes: 300000000, BlobUploadLimit: server.BlobUploadLimit}
	if capabilities.Validate() != nil {
		return nil, errConnection
	}
	// Persist only the server obtained from the verified DID document. A caller's
	// service field cannot select the destination for this password or later logins.
	stored := credentials{Version: 1, Service: origin, Identifier: did, Password: input.Password, ServerDID: server.DID}
	a, err := p.credentialAgent(stored, handle)
	if err != nil {
		return nil, err
	}
	if err := a.login(ctx, did, input.Password); err != nil {
		return nil, err
	}
	profile, err := a.getProfile(ctx, did)
	if err != nil || profile.Did != did || profile.Handle != handle {
		return nil, errConnection
	}
	auth, err := verifiedSessionResult(*a.session, stored, capabilities)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(profile.DisplayName)
	if name == "" {
		name = handle
	}
	auth.Name, auth.Username = name, handle
	if avatar, err := url.Parse(profile.Avatar); err == nil && avatar.Scheme == "https" && avatar.Hostname() != "" && avatar.User == nil {
		auth.Picture = profile.Avatar
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, errConnection
	}
	details := string(encoded)
	auth.CredentialDetails = &details
	return auth, nil
}

func (p *Provider) credentialAgent(c credentials, handle string) (*agent, error) {
	origin, err := instances.Origin(c.Service)
	if err != nil || c.Version != 1 || origin != c.Service || !socialidentity.BlueskyDID(c.Identifier) || !socialidentity.BlueskyDID(c.ServerDID) || !socialidentity.BlueskyAppPasswordShape(c.Password) {
		return nil, errConnection
	}
	u, err := url.Parse(origin)
	if err != nil {
		return nil, errConnection
	}
	a := &agent{service: u, client: connectionHTTP(p.connectionClient, origin)}
	a.validateCredentialSession = func(s session) error {
		if s.Did != c.Identifier {
			return errAccountMismatch
		}
		if handle != "" && s.Handle != handle {
			return errConnection
		}
		if len(s.DidDoc) > 0 && string(s.DidDoc) != "null" {
			if err := validateSessionDocument(s, origin, c.Identifier, handle); err != nil {
				return err
			}
		}
		_, err := sessionMetadata(s, c.Identifier, c.ServerDID)
		return err
	}
	return a, nil
}

func verifiedSessionResult(s session, c credentials, caps socialidentity.BlueskyCapabilities) (*integrations.AuthTokenDetails, error) {
	claims, err := sessionMetadata(s, c.Identifier, c.ServerDID)
	if err != nil {
		return nil, err
	}
	proof := &socialidentity.Verification{AccountKey: "bluesky:" + c.Identifier, AccountKind: "profile", GrantedScopes: []string{claims.Scope}, Capabilities: socialidentity.Capabilities{Version: 1, Bluesky: &caps}}
	if proof.Validate(identifier, c.Identifier) != nil {
		return nil, errConnection
	}
	expiresIn := claims.Expires - time.Now().Unix()
	if expiresIn <= 0 {
		return nil, errConnection
	}
	return &integrations.AuthTokenDetails{ID: c.Identifier, AccessToken: s.AccessJwt, RefreshToken: s.RefreshJwt, ExpiresIn: expiresIn, Verification: proof}, nil
}

func storedCredentials(in *ent.Integration) (credentials, error) {
	if in == nil || in.CustomInstanceDetails == nil {
		return credentials{}, errConnection
	}
	plain, err := helpers.FixedDecryption(*in.CustomInstanceDetails)
	var c credentials
	if err != nil || json.Unmarshal([]byte(plain), &c) != nil {
		return credentials{}, errConnection
	}
	return c, nil
}

// RefreshIntegration renews the stored session at its original verified PDS.
// The shared repository applies the result only while the connection snapshot is current.
func (p *Provider) RefreshIntegration(ctx context.Context, in *ent.Integration) (*integrations.AuthTokenDetails, error) {
	c, err := storedCredentials(in)
	if err != nil || c.Version != 1 || c.Identifier != in.InternalID || in.RefreshToken == nil || in.VerifiedCapabilities == nil || in.VerifiedCapabilities.Bluesky == nil {
		return nil, errConnection
	}
	if _, err := providerTokenMetadata(*in.RefreshToken, c.Identifier, c.ServerDID, "com.atproto.refresh"); err != nil {
		return nil, err
	}
	a, err := p.credentialAgent(c, "")
	if err != nil {
		return nil, err
	}
	a.session = &session{Did: in.InternalID, AccessJwt: in.Token, RefreshJwt: *in.RefreshToken}
	if err := a.refreshSession(ctx); err != nil {
		return nil, err
	}
	return verifiedSessionResult(*a.session, c, *in.VerifiedCapabilities.Bluesky)
}
