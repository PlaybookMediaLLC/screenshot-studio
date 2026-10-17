package product

import (
	"os"
	"regexp"
	"slices"
	"testing"
)

// Go grants agents the same scopes the web issues keys with.
func TestAPIKeyScopesMirrorTheWeb(t *testing.T) {
	source, err := os.ReadFile("../../../lib/auth/api-key-scopes.ts")
	if err != nil {
		t.Fatal(err)
	}
	list := regexp.MustCompile(`(?s)export const apiKeyScopes = \[(.*?)\]`).FindSubmatch(source)
	if list == nil {
		t.Fatal("apiKeyScopes not found")
	}
	web := []string{}
	for _, match := range regexp.MustCompile(`'([a-z]+:[a-z]+)'`).FindAllSubmatch(list[1], -1) {
		web = append(web, string(match[1]))
	}
	if !slices.Equal(web, APIKeyScopes) {
		t.Fatalf("web=%v go=%v", web, APIKeyScopes)
	}
}

func TestScopesRoundTripThroughBetterAuthPermissions(t *testing.T) {
	permissions := permissionsOf([]string{"release:create", "artifact:read", "asset:write"})
	if got := scopesOf(&permissions); !slices.Equal(got, []string{"artifact:read", "asset:write", "release:create"}) {
		t.Fatalf("scopes=%v from %s", got, permissions)
	}
	broken := "{"
	if scopesOf(&broken) != nil || scopesOf(nil) != nil {
		t.Fatal("unreadable permissions granted scopes")
	}
	if hashAPIKey("ss_abc") != "Nt7aJr_3qBSywT5xQSaJfBLivNfjrT01MzL1KhH738M" {
		t.Fatalf("hash=%s, not Better Auth's SHA-256 base64url", hashAPIKey("ss_abc"))
	}
}
