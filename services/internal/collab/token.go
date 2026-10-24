// Package collab issues and verifies the short-lived tokens that admit a
// browser to one content draft's real-time session (RFC 013).
//
// Only the Go backend holds the signing key. The collaboration server cannot
// mint or verify a token; it asks the backend, and it passes the connection's
// token on every load and store, so its own credential opens no draft alone.
package collab

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

// Access is what a connection may do with the document.
type Access string

const (
	AccessRead  Access = "read"
	AccessWrite Access = "write"
)

// TokenTTL bounds how long a token admits a new connection.
const TokenTTL = 5 * time.Minute

// StoreGrace bounds how long after expiry a token still authorizes loading
// and storing the document for a connection it already admitted.
const StoreGrace = 12 * time.Hour

var ErrInvalidToken = errors.New("invalid collaboration token")

// Claims are what a token grants: one user, one draft of one workspace.
type Claims struct {
	Generation     int    `json:"g,omitempty"`
	Kind           string `json:"k,omitempty"`
	Access         Access `json:"a"`
	DraftID        string `json:"d"`
	ExpiresAt      int64  `json:"e"`
	OrganizationID string `json:"o"`
	UserID         string `json:"u"`
	SessionID      string `json:"s"`
}

// DocumentName is the collaboration document a draft is edited in.
func DocumentName(draftID string) string { return "content-draft:" + draftID }

// DocumentNameAt isolates replacements from cached Yjs rooms and IndexedDB state.
func DocumentNameAt(draftID string, generation int) string {
	if generation == 0 {
		return DocumentName(draftID)
	}
	return DocumentName(draftID) + ":" + strconv.Itoa(generation)
}

// DocumentNameFor keeps content draft tokens compatible and isolates Story Set presence rooms.
func DocumentNameFor(kind, id string) string {
	if kind == "creative-set" {
		return "creative-set:" + id
	}
	return DocumentName(id)
}

// Sign returns a token for claims.
func Sign(key []byte, claims Claims) (string, error) {
	if len(key) < 32 {
		return "", errors.New("collaboration signing key must be at least 32 bytes")
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + base64.RawURLEncoding.EncodeToString(mac(key, body)), nil
}

// Verify checks the signature and that the token was valid at now minus
// grace (0 to admit a connection, StoreGrace for its loads and stores).
func Verify(key []byte, token string, now time.Time, grace time.Duration) (Claims, error) {
	body, signature, ok := strings.Cut(token, ".")
	if !ok || len(key) < 32 {
		return Claims{}, ErrInvalidToken
	}
	given, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil || !hmac.Equal(given, mac(key, body)) {
		return Claims{}, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil || claims.DraftID == "" || claims.OrganizationID == "" ||
		claims.Generation < 0 || claims.UserID == "" || claims.SessionID == "" || (claims.Access != AccessRead && claims.Access != AccessWrite) || (claims.Kind != "" && claims.Kind != "content-draft" && claims.Kind != "creative-set") {
		return Claims{}, ErrInvalidToken
	}
	if now.Add(-grace).Unix() >= claims.ExpiresAt {
		return Claims{}, ErrInvalidToken
	}
	return claims, nil
}

func mac(key []byte, body string) []byte {
	hash := hmac.New(sha256.New, key)
	hash.Write([]byte("shots.collab.v1." + body))
	return hash.Sum(nil)
}
