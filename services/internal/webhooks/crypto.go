package webhooks

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
)

// ErrUnavailable means the server has no webhook encryption key, so it can
// neither store nor use a signing secret.
var ErrUnavailable = errors.New("outbound webhooks are not configured on this server")

// NewSecret is a fresh signing secret: whsec_ and 32 random bytes.
func NewSecret() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return "whsec_" + base64.RawURLEncoding.EncodeToString(buffer), nil
}

// Seal encrypts a secret with AES-256-GCM as nonce.ciphertext, base64url.
func Seal(key []byte, secret string) (string, error) {
	if len(key) != 32 {
		return "", ErrUnavailable
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(secret), []byte("webhook-secret-v1"))
	return base64.RawURLEncoding.EncodeToString(nonce) + "." + base64.RawURLEncoding.EncodeToString(sealed), nil
}

// Open decrypts a sealed secret.
func Open(key []byte, sealed string) (string, error) {
	if len(key) != 32 {
		return "", ErrUnavailable
	}
	parts := strings.Split(sealed, ".")
	if len(parts) != 2 {
		return "", errors.New("invalid sealed secret")
	}
	nonce, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", errors.New("invalid sealed secret")
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("invalid sealed secret")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(nonce) != gcm.NonceSize() {
		return "", errors.New("invalid sealed secret")
	}
	plain, err := gcm.Open(nil, nonce, ciphertext, []byte("webhook-secret-v1"))
	if err != nil {
		return "", errors.New("invalid sealed secret")
	}
	return string(plain), nil
}

// Sign is the v1 signature: hex HMAC-SHA256 of "<event id>.<timestamp>.<body>",
// the same contract inbound signed webhooks use.
func Sign(secret, eventID, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(eventID + "." + timestamp + "."))
	mac.Write(body)
	return "v1=" + hex.EncodeToString(mac.Sum(nil))
}

// Verify reports whether header carries a valid v1 signature for body under
// secret, in constant time. Receivers do the same, and also reject an old
// timestamp and deduplicate the event ID.
func Verify(secret, eventID, timestamp string, body []byte, header string) bool {
	want := Sign(secret, eventID, timestamp, body)
	for _, candidate := range strings.Split(header, ",") {
		if hmac.Equal([]byte(strings.TrimSpace(candidate)), []byte(want)) {
			return true
		}
	}
	return false
}
