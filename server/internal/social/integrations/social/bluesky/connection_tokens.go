package bluesky

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

var errAppPassword = integrations.AuthMessage("Use a dedicated Bluesky app password, not your main account password.")

type tokenClaims struct {
	Subject  string `json:"sub"`
	Audience string `json:"aud"`
	Scope    string `json:"scope"`
	Expires  int64  `json:"exp"`
}

// providerTokenMetadata reads only tokens returned directly by the pinned HTTPS
// PDS (or that same encrypted stored response). This is not JWT signature
// verification and must never be used to authenticate caller-supplied tokens.
func providerTokenMetadata(token, did, serverDID, scope string) (tokenClaims, error) {
	parts := strings.Split(token, ".")
	if len(token) > 16384 || len(parts) != 3 {
		return tokenClaims{}, errConnection
	}
	header, headerErr := base64.RawURLEncoding.DecodeString(parts[0])
	payload, payloadErr := base64.RawURLEncoding.DecodeString(parts[1])
	signature, signatureErr := base64.RawURLEncoding.DecodeString(parts[2])
	var h struct {
		Algorithm string `json:"alg"`
	}
	var claims tokenClaims
	if headerErr != nil || payloadErr != nil || signatureErr != nil || len(signature) < 16 || json.Unmarshal(header, &h) != nil || h.Algorithm == "" || strings.EqualFold(h.Algorithm, "none") || json.Unmarshal(payload, &claims) != nil {
		return tokenClaims{}, errConnection
	}
	if claims.Subject != did || claims.Audience != serverDID || claims.Expires <= time.Now().Unix() || claims.Expires > time.Now().AddDate(1, 0, 0).Unix() {
		return tokenClaims{}, errConnection
	}
	if scope == "app-password" {
		if claims.Scope != "com.atproto.appPass" && claims.Scope != "com.atproto.appPassPrivileged" {
			return tokenClaims{}, errAppPassword
		}
	} else if claims.Scope != scope {
		return tokenClaims{}, errConnection
	}
	return claims, nil
}

func sessionMetadata(s session, did, serverDID string) (tokenClaims, error) {
	access, err := providerTokenMetadata(s.AccessJwt, did, serverDID, "app-password")
	if err != nil {
		return tokenClaims{}, err
	}
	if _, err := providerTokenMetadata(s.RefreshJwt, did, serverDID, "com.atproto.refresh"); err != nil {
		return tokenClaims{}, err
	}
	return access, nil
}
