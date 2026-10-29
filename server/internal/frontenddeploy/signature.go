package frontenddeploy

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
)

// VerifyWebhook follows each provider's actual contract over the original bytes.
func VerifyWebhook(provider, secret, signature string, body []byte) bool {
	if secret == "" || len(body) > MaxBody || len(signature) > 4096 {
		return false
	}
	switch provider {
	case "vercel":
		mac := hmac.New(sha1.New, []byte(secret))
		mac.Write(body)
		got, e := hex.DecodeString(signature)
		return e == nil && hmac.Equal(mac.Sum(nil), got)
	case "netlify":
		parts := strings.Split(signature, ".")
		if len(parts) != 3 {
			return false
		}
		var header struct {
			Alg string `json:"alg"`
		}
		var claims struct {
			Issuer string `json:"iss"`
			SHA256 string `json:"sha256"`
		}
		h, e := base64.RawURLEncoding.DecodeString(parts[0])
		if e != nil || json.Unmarshal(h, &header) != nil || header.Alg != "HS256" {
			return false
		}
		p, e := base64.RawURLEncoding.DecodeString(parts[1])
		if e != nil || json.Unmarshal(p, &claims) != nil || claims.Issuer != "netlify" {
			return false
		}
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(parts[0] + "." + parts[1]))
		sig, e := base64.RawURLEncoding.DecodeString(parts[2])
		if e != nil || !hmac.Equal(mac.Sum(nil), sig) {
			return false
		}
		digest := sha256.Sum256(body)
		want, e := hex.DecodeString(claims.SHA256)
		return e == nil && hmac.Equal(digest[:], want)
	}
	return false
}

func Fingerprint(body []byte) string { h := sha256.Sum256(body); return hex.EncodeToString(h[:]) }
