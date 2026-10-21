// Package credentialcipher protects the existing provider credential store.
package credentialcipher

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"strings"
)

const prefix = "scc1."

// ErrUnavailable never contains credential material or key configuration.
var ErrUnavailable = errors.New("social credential encryption is unavailable")

func key(name string) ([]byte, error) {
	value, err := base64.StdEncoding.DecodeString(os.Getenv(name))
	if err != nil || len(value) != 32 {
		return nil, ErrUnavailable
	}
	return value, nil
}

func keyID(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:12])
}

func aead(value []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(value)
	if err != nil {
		return nil, ErrUnavailable
	}
	return cipher.NewGCM(block)
}

// ValidateKey checks the configured write key before a migration or startup.
func ValidateKey() error {
	_, err := key("PLATFORM_SOCIAL_ENCRYPTION_KEY")
	return err
}

// IsSealed distinguishes the authenticated envelope from legacy values.
func IsSealed(value string) bool { return strings.HasPrefix(value, prefix) }

// UsesCurrentKey lets a backfill skip existing envelopes after verifying them.
func UsesCurrentKey(value string) bool {
	current, err := key("PLATFORM_SOCIAL_ENCRYPTION_KEY")
	return err == nil && strings.HasPrefix(value, prefix+keyID(current)+".")
}

// Seal uses a fresh nonce and binds the value to its credential field or OAuth state.
func Seal(value, purpose string) (string, error) {
	if value == "" {
		return "", nil
	}
	current, err := key("PLATFORM_SOCIAL_ENCRYPTION_KEY")
	if err != nil {
		return "", err
	}
	gcm, err := aead(current)
	if err != nil {
		return "", ErrUnavailable
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", ErrUnavailable
	}
	id := keyID(current)
	data := gcm.Seal(nonce, nonce, []byte(value), []byte(prefix+id+":"+purpose))
	return prefix + id + "." + base64.RawURLEncoding.EncodeToString(data), nil
}

// Open reads current envelopes or legacy plaintext during the staged backfill.
// Malformed envelopes never fall back to plaintext. The previous key is read-only.
func Open(value, purpose string) (string, error) {
	if !IsSealed(value) {
		return value, nil
	}
	parts := strings.Split(strings.TrimPrefix(value, prefix), ".")
	if len(parts) != 2 {
		return "", ErrUnavailable
	}
	current, err := key("PLATFORM_SOCIAL_ENCRYPTION_KEY")
	if err != nil {
		return "", err
	}
	if parts[0] != keyID(current) {
		current, err = key("PLATFORM_SOCIAL_ENCRYPTION_PREVIOUS_KEY")
		if err != nil || parts[0] != keyID(current) {
			return "", ErrUnavailable
		}
	}
	gcm, err := aead(current)
	if err != nil {
		return "", ErrUnavailable
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(data) < gcm.NonceSize()+gcm.Overhead() {
		return "", ErrUnavailable
	}
	plain, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], []byte(prefix+parts[0]+":"+purpose))
	if err != nil {
		return "", ErrUnavailable
	}
	return string(plain), nil
}
