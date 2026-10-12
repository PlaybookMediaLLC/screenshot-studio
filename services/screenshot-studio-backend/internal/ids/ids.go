// Package ids generates Postiz's random identifiers (services/make.is.ts and
// make.secure.id.ts).
package ids

import (
	"crypto/rand"
	"math/big"
	mrand "math/rand/v2"
)

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// Secure is makeSecureId: crypto-random, for tokens, secrets, API keys,
// OAuth state and PKCE verifiers.
func Secure(length int) string {
	out := make([]byte, length)
	for i := range out {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			panic(err)
		}
		out[i] = alphabet[n.Int64()]
	}
	return string(out)
}

// Make is makeId: not for anything that acts as a credential.
func Make(length int) string {
	out := make([]byte, length)
	for i := range out {
		out[i] = alphabet[mrand.IntN(len(alphabet))]
	}
	return string(out)
}
