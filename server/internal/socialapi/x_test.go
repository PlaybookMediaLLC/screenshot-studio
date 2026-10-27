package socialapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func TestXDestinationRequiresVerifiedAccountInBoundTenant(t *testing.T) {
	t.Setenv("SOCIAL_API_KEY_X_TEST", "fixture-token")
	org := "original-tenant"
	now := time.Now()
	caps := socialidentity.XStandardPostLimits("read-write", nil)
	account := socialidentity.Connection{ID: "destination", Provider: "x", NativeID: "123456789", Active: true, VerifiedAt: &now,
		Verification: &socialidentity.Verification{AccountKey: "x:123456789", AccountKind: "profile", GrantedScopes: []string{"read-write"}, Capabilities: socialidentity.Capabilities{Version: 1, X: &caps}}}
	reads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "fixture-token" || r.Method != "GET" {
			t.Error("invalid credential or method")
		}
		switch r.URL.Path {
		case "/public/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"organization": map[string]string{"id": org}})
		case "/public/v1/integrations/destination/identity":
			reads++
			_ = json.NewEncoder(w).Encode(account)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	c := New(server.URL+"/public/v1", server.Client(), nil)
	in := VerifyDestinationInput{DestinationID: "destination", Platform: "x", ExpectedGoOrganizationID: org, SecretReference: "SOCIAL_API_KEY_X_TEST"}
	if err := c.VerifyDestination(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	org = "other-tenant"
	if err := c.VerifyDestination(context.Background(), in); err == nil || reads != 1 {
		t.Fatal("cross-tenant identity read")
	}
	org = "original-tenant"
	account.Verification = nil
	if err := c.VerifyDestination(context.Background(), in); err == nil {
		t.Fatal("legacy unverified account accepted")
	}
}
