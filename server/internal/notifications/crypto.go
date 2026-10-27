package notifications

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"strings"
)

func encryptionKey(name string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(os.Getenv(name))
	if err != nil || len(key) != 32 {
		return nil, ErrUnavailable
	}
	return key, nil
}
func seal(plain []byte) (string, error) {
	key, err := encryptionKey("PLATFORM_NOTIFICATION_ENCRYPTION_KEY")
	if err != nil {
		return "", err
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
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	data := gcm.Seal(nonce, nonce, plain, []byte("platform-notifications-v2"))
	return "v2." + base64.RawURLEncoding.EncodeToString(data), nil
}
func unseal(value string) ([]byte, error) {
	key, err := encryptionKey("PLATFORM_NOTIFICATION_ENCRYPTION_KEY")
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(value, "v2.") {
		return nil, errors.New("unsupported credential version")
	}
	data, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, "v2."))
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < gcm.NonceSize()+gcm.Overhead() {
		return nil, errors.New("invalid encrypted credentials")
	}
	return gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], []byte("platform-notifications-v2"))
}

// Legacy credentials are imported in Go once; the legacy key never reaches a browser.
func openLegacy(value string) ([]byte, error) {
	key, err := encryptionKey("INTEGRATION_ENCRYPTION_KEY")
	if err != nil {
		return nil, err
	}
	parts := strings.Split(value, ".")
	if len(parts) != 4 || parts[0] != "v1" {
		return nil, errors.New("invalid legacy credential version")
	}
	nonce, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	tag, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, err
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(nonce) != gcm.NonceSize() || len(tag) != gcm.Overhead() {
		return nil, errors.New("invalid legacy credentials")
	}
	return gcm.Open(nil, nonce, append(data, tag...), nil)
}
