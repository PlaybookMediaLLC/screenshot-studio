package helpers

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// AuthService is the auth service.

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	return string(hash), err
}

func ComparePassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// SignJWT signs claims with JWT_SECRET (HS256) and adds iat, like
// jsonwebtoken's sign(value, secret).
func SignJWT(claims map[string]any) (string, error) {
	payload := jwt.MapClaims{}
	for k, v := range claims {
		payload[k] = v
	}
	if _, ok := payload["iat"]; !ok {
		payload["iat"] = time.Now().Unix()
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, payload).SignedString([]byte(os.Getenv("JWT_SECRET")))
}

// VerifyJWT checks the signature (and exp when present) and returns the claims.
func VerifyJWT(token string) (map[string]any, error) {
	parsed, err := jwt.Parse(token, func(*jwt.Token) (any, error) {
		return []byte(os.Getenv("JWT_SECRET")), nil
	}, jwt.WithValidMethods([]string{"HS256", "HS384", "HS512"}))
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return nil, errors.New("invalid token claims")
	}
	return claims, nil
}

// deriveLegacyKeyIV is OpenSSL's EVP_BytesToKey(md5, no salt) for aes-256-cbc.
func deriveLegacyKeyIV(secret string) (key, iv []byte) {
	var derived, prev []byte
	for len(derived) < 48 {
		sum := md5.Sum(append(append([]byte{}, prev...), secret...))
		prev = sum[:]
		derived = append(derived, prev...)
	}
	return derived[:32], derived[32:48]
}

// FixedEncryption is encrypt_legacy_using_IV: aes-256-cbc, PKCS#7, hex.
func FixedEncryption(value string) (string, error) {
	key, iv := deriveLegacyKeyIV(os.Getenv("JWT_SECRET"))
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	pad := aes.BlockSize - len(value)%aes.BlockSize
	plain := append([]byte(value), bytes.Repeat([]byte{byte(pad)}, pad)...)
	out := make([]byte, len(plain))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, plain)
	return hex.EncodeToString(out), nil
}

// FixedDecryption is decrypt_legacy_using_IV.
func FixedDecryption(hash string) (string, error) {
	data, err := hex.DecodeString(hash)
	if err != nil {
		return "", err
	}
	if len(data) == 0 || len(data)%aes.BlockSize != 0 {
		return "", errors.New("bad decrypt")
	}
	key, iv := deriveLegacyKeyIV(os.Getenv("JWT_SECRET"))
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	out := make([]byte, len(data))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(out, data)
	pad := int(out[len(out)-1])
	if pad == 0 || pad > aes.BlockSize || pad > len(out) || !bytes.Equal(out[len(out)-pad:], bytes.Repeat([]byte{byte(pad)}, pad)) {
		return "", errors.New("bad decrypt")
	}
	return string(out[:len(out)-pad]), nil
}
