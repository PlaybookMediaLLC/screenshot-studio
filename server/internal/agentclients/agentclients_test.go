package agentclients

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/lucsky/cuid"

	platformdb "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/oauthapp"
)

func TestRedirectURIs(t *testing.T) {
	for uri, want := range map[string]string{
		"https://claude.ai/cb":          "",
		"https://app.claude.ai/cb":      "",
		"http://localhost:3000/cb":      "",
		"http://[::1]:3000/cb":          "",
		"cursor://anysphere/oauth/cb":   "",
		"javascript:alert(1)":           `redirect_uri scheme "javascript:" is not allowed`,
		"http://evil.com/cb":            "redirect_uris must use https or a private-use scheme (http is allowed for loopback only)",
		"https://evilclaude.ai/cb":      `redirect_uri host "evilclaude.ai" is not a verified domain`,
		"https://claude.ai.evil.com/cb": `redirect_uri host "claude.ai.evil.com" is not a verified domain`,
		"not a url":                     "Invalid redirect_uri: not a url",
		"https:///cb":                   "Invalid redirect_uri: https:///cb",
	} {
		err := checkRedirectURI(uri, []string{"claude.ai"})
		var refused *RegistrationError
		if want == "" && err != nil || want != "" && (!errors.As(err, &refused) || refused.Code != "invalid_redirect_uri" || refused.Description != want) {
			t.Errorf("%s: %v", uri, err)
		}
	}
	if err := checkRedirectURI("https://anyone.example/cb", nil); err != nil {
		t.Fatalf("open registration refused a web callback: %v", err)
	}
}

// Registered clients authenticate at the token endpoint with the secret the
// social backend sealed, and the prune keeps clients a member approved.
func TestRegisterAuthenticateAndPrune(t *testing.T) {
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("DCR_VERIFIED_DOMAINS", "")
	ctx := context.Background()
	db, err := platformdb.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	r := New(db.SQL)
	var clientIDs []string
	t.Cleanup(func() { r.client.OAuthApp.Delete().Where(oauthapp.ClientIDIn(clientIDs...)).ExecX(ctx) })

	name := "  Claude  "
	confidential, err := r.RegisterAgentClient(ctx, Registration{RedirectURIs: []string{" https://claude.ai/cb "}, ClientName: &name,
		TokenEndpointAuthMethod: "client_secret_basic"})
	if err != nil {
		t.Fatal(err)
	}
	public, err := r.RegisterAgentClient(ctx, Registration{RedirectURIs: []string{"cursor://anysphere/oauth/cb"}, TokenEndpointAuthMethod: "none"})
	if err != nil {
		t.Fatal(err)
	}
	clientIDs = append(clientIDs, confidential.ClientID, public.ClientID)
	if confidential.ClientName != "Claude" || !strings.HasPrefix(confidential.ClientID, "pcd_") || !strings.HasPrefix(confidential.ClientSecret, "pcs_") ||
		*confidential.ClientSecretExpiresAt != 0 || confidential.TokenEndpointAuthMethod != "client_secret_basic" ||
		!slices.Equal(confidential.RedirectURIs, []string{"https://claude.ai/cb"}) || confidential.ClientIDIssuedAt == 0 {
		t.Fatalf("confidential=%+v", confidential)
	}
	if public.ClientSecret != "" || public.ClientSecretExpiresAt != nil || public.ClientName != "MCP Client" {
		t.Fatalf("public=%+v", public)
	}
	if _, err := r.RegisterAgentClient(ctx, Registration{RedirectURIs: []string{"https://claude.ai/cb"}, GrantTypes: []string{"client_credentials"}}); err == nil {
		t.Fatal("a client without the authorization_code grant registered")
	}
	// A client the social backend registered: pcs_social-fixture sealed with
	// JWT_SECRET=test-secret.
	legacy := r.client.OAuthApp.Create().SetName("Legacy").SetRedirectURL("https://claude.ai/cb").SetRedirectUris(`["https://claude.ai/cb"]`).
		SetClientID("pcd_legacy_" + cuid.New()).SetClientSecret("a5ebe468d2d07dca0130db2c9ab29af095dbb2531195792c6d830c8be30ee369").
		SetTokenEndpointAuthMethod("client_secret_post").SetDynamic(true).SaveX(ctx)
	clientIDs = append(clientIDs, legacy.ClientID)

	for label, c := range map[string]struct {
		id, secret string
		want       bool
	}{
		"confidential":            {confidential.ClientID, confidential.ClientSecret, true},
		"wrong secret":            {confidential.ClientID, "pcs_wrong", false},
		"no secret":               {confidential.ClientID, "", false},
		"another client's secret": {confidential.ClientID, "pcs_social-fixture", false},
		"social registration":     {legacy.ClientID, "pcs_social-fixture", true},
		"public":                  {public.ClientID, "", true},
		"unknown":                 {"pcd_unknown", "pcs_social-fixture", false},
	} {
		if ok, err := r.AuthenticateAgentClient(ctx, c.id, c.secret); ok != c.want || err != nil {
			t.Errorf("%s: %v %v", label, ok, err)
		}
	}
	found, err := r.FindAgentClient(ctx, public.ClientID)
	if err != nil || found == nil || !found.Public || !found.Dynamic || !slices.Equal(found.RedirectURIs, public.RedirectURIs) {
		t.Fatalf("consent screen client=%+v %v", found, err)
	}

	org := "org_agentclients_" + cuid.New()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, org)
	t.Cleanup(func() { _, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1`, org) })
	exec(`INSERT INTO agent_authorization (id,"organizationId","userId","clientId","clientName","redirectUri","codeHash",scopes,"expiresAt")
		VALUES ($1,$2,'user',$3,'Claude','https://claude.ai/cb',$1,'[]',now())`, cuid.New(), org, confidential.ClientID)
	exec(`UPDATE "OAuthApp" SET "createdAt" = now() - interval '31 days' WHERE "clientId" = ANY($1)`, []string{confidential.ClientID, public.ClientID})
	if _, err := r.pruneAbandoned(ctx); err != nil {
		t.Fatal(err)
	}
	if kept, _ := r.FindAgentClient(ctx, confidential.ClientID); kept == nil {
		t.Fatal("the prune deleted a client a member approved")
	}
	if pruned, _ := r.FindAgentClient(ctx, public.ClientID); pruned != nil {
		t.Fatal("the prune kept an abandoned client")
	}
}
