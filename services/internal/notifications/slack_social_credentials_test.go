package notifications

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
)

func TestImportSocialSlackReadsEncryptedCredentials(t *testing.T) {
	f := notificationFixture(t)
	ctx := context.Background()
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=")
	socialOrg := "encrypted_" + f.owner.OrganizationID
	id := "encrypted_" + f.owner.UserID
	execFixture(t, f, `INSERT INTO "Organization"(id,name,"updatedAt") VALUES($1,'Encrypted fixture',now())`, socialOrg)
	t.Cleanup(func() { _, _ = f.s.DB.Exec(`DELETE FROM "Organization" WHERE id=$1`, socialOrg) })
	token, err := credentialcipher.Seal("fixture-access", "integration.token")
	if err != nil {
		t.Fatal(err)
	}
	refresh, err := credentialcipher.Seal("fixture-refresh", "integration.refresh_token")
	if err != nil {
		t.Fatal(err)
	}
	execFixture(t, f, `INSERT INTO "Integration"(id,"organizationId","internalId",name,"providerIdentifier",type,token,"refreshToken","createdAt","updatedAt") VALUES($1,$2,'T123','Fixture','slack','social',$3,$4,now(),now())`, id, socialOrg, token, refresh)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-access" {
			t.Error("encrypted token was passed to Slack")
		}
		_, _ = io.WriteString(w, `{"ok":true,"team_id":"T123"}`)
	}))
	defer server.Close()
	f.s.SlackBase = server.URL
	if err := f.s.importSocialSlack(ctx, f.owner.OrganizationID, socialOrg, id); err != nil {
		t.Fatal(err)
	}
	var stored string
	if err := f.s.DB.QueryRow(`SELECT token FROM "Integration" WHERE id=$1`, id).Scan(&stored); err != nil || stored != "backend-owned" {
		t.Fatal("legacy credentials were not retired", err)
	}
	// The import is idempotent after the existing backend vault owns the installation.
	if err := f.s.importSocialSlack(ctx, f.owner.OrganizationID, socialOrg, id); err != nil {
		t.Fatal(err)
	}
}
