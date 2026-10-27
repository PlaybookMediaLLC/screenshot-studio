package credentialcipher

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
)

func TestCredentialEnvelope(t *testing.T) {
	old := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", old)
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_PREVIOUS_KEY", "")
	first, err := Seal("private-token", "integration.token")
	if err != nil || !IsSealed(first) || !UsesCurrentKey(first) || strings.Contains(first, "private-token") {
		t.Fatal("expected encrypted credentials")
	}
	second, err := Seal("private-token", "integration.token")
	if err != nil || first == second {
		t.Fatal("envelopes must use fresh nonces")
	}
	if value, err := Open(first, "integration.token"); err != nil || value != "private-token" {
		t.Fatal("credential round trip failed")
	}
	for _, input := range []struct{ value, purpose string }{
		{first, "integration.refresh_token"},
		{first + "tampered", "integration.token"},
		{prefix + "invalid", "integration.token"},
	} {
		if value, err := Open(input.value, input.purpose); err == nil || value != "" || err.Error() != ErrUnavailable.Error() {
			t.Fatal("invalid envelope did not fail closed")
		}
	}
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 32)))
	if _, err := Open(first, "integration.token"); err == nil {
		t.Fatal("wrong key was accepted")
	}
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_PREVIOUS_KEY", old)
	if value, err := Open(first, "integration.token"); err != nil || value != "private-token" || UsesCurrentKey(first) {
		t.Fatal("previous key could not read the old envelope")
	}
	rotated, err := Seal("private-token", "integration.token")
	if err != nil || !UsesCurrentKey(rotated) {
		t.Fatal("new writes did not use the current key")
	}
	if value, err := Open("legacy-token", "integration.token"); err != nil || value != "legacy-token" {
		t.Fatal("legacy read failed")
	}
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", "")
	if _, err := Seal("private-token", "integration.token"); err == nil {
		t.Fatal("missing key allowed a write")
	}
	if value, err := Seal("", "integration.token"); err != nil || value != "" {
		t.Fatal("empty credentials cannot be cleared")
	}
}
