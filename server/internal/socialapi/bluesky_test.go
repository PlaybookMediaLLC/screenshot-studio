package socialapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func TestBlueskyStartResolvesReconnectInsideOriginalTenant(t *testing.T) {
	t.Setenv("SOCIAL_API_KEY_BLUE_TEST", "fixture-token")
	state := "fixture_bluesky_connection_state_0123456789"
	org, provider := "original-tenant", "bluesky"
	starts, exchanges := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/integrations/social-connect/bluesky" && r.Header.Get("Authorization") != "fixture-token" {
			t.Error("tenant token missing")
		}
		switch r.URL.Path {
		case "/public/v1/me":
			_ = json.NewEncoder(w).Encode(map[string]any{"organization": map[string]string{"id": org}})
		case "/public/v1/integrations/original-destination/identity":
			_ = json.NewEncoder(w).Encode(socialidentity.Connection{ID: "original-destination", Provider: provider, NativeID: "did:plc:abcdefghijklmnopqrstuvwx"})
		case "/public/v1/social/bluesky":
			starts++
			if r.URL.Query().Get("refresh") != "did:plc:abcdefghijklmnopqrstuvwx" {
				t.Error("reconnect not bound to native DID")
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"url": state})
		case "/integrations/social-connect/bluesky":
			exchanges++
			var input map[string]string
			if r.Method != "POST" || r.URL.RawQuery != "" || json.NewDecoder(r.Body).Decode(&input) != nil {
				t.Fatal("credentials were not posted")
			}
			data, err := base64.StdEncoding.DecodeString(input["code"])
			var credentials map[string]string
			if err != nil || json.Unmarshal(data, &credentials) != nil || credentials["identifier"] != "me.bsky.social" || credentials["password"] != "abcd-efgh-ijkl-mnop" || credentials["service"] != "" {
				t.Fatal("unexpected credential destination or handle")
			}
			_ = json.NewEncoder(w).Encode(OAuthExchange{ID: "original-destination"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	c := New(server.URL+"/public/v1", server.Client(), nil)
	in := BeginBlueskyInput{ExpectedGoOrganizationID: org, SecretReference: "SOCIAL_API_KEY_BLUE_TEST", ExpectedDestinationID: "original-destination"}
	if got, err := c.BeginBluesky(context.Background(), in); err != nil || got != state || starts != 1 {
		t.Fatalf("start: %v", err)
	}
	org = "another-tenant"
	if _, err := c.BeginBluesky(context.Background(), in); err == nil || starts != 1 {
		t.Fatal("changed tenant binding started credentials")
	}
	org, provider = "original-tenant", "x"
	if _, err := c.BeginBluesky(context.Background(), in); err == nil || starts != 1 {
		t.Fatal("wrong provider became a Bluesky reconnect")
	}
	if _, err := c.ExchangeBluesky(context.Background(), state, " @ME.BSKY.SOCIAL ", "abcd-efgh-ijkl-mnop"); err != nil || exchanges != 1 {
		t.Fatalf("exchange: %v", err)
	}
	if _, err := c.ExchangeBluesky(context.Background(), state, "me", "primary-password"); err == nil || exchanges != 1 {
		t.Fatal("invalid credentials reached adapter")
	}
}
