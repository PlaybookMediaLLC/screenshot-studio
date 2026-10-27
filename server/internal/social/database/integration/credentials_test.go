package integration

import (
	"database/sql"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
)

func TestReconnectKeepsCredentialsEncrypted(t *testing.T) {
	f := setup(t, "x")
	params := CreateOrUpdateIntegrationParams{
		Name: "Credential fixture", InternalID: "credential-account", Provider: "x",
		Token: "first-access", RefreshToken: "first-refresh",
	}
	connectionID := ""
	for _, stage := range []struct{ name, access, refresh, retainedRefresh string }{
		{"create", "first-access", "first-refresh", "first-refresh"},
		{"reconnect", "second-access", "second-refresh", "second-refresh"},
		{"retain refresh", "third-access", "", "second-refresh"},
	} {
		t.Run(stage.name, func(t *testing.T) {
			params.Token, params.RefreshToken = stage.access, stage.refresh
			connected := f.connect(t, params)
			if connectionID != "" && connected.ID != connectionID {
				t.Fatal("reconnect replaced the integration identity")
			}
			connectionID = connected.ID
			if connected.Token != stage.access || connected.RefreshToken == nil || *connected.RefreshToken != stage.retainedRefresh {
				t.Fatal("credential round trip changed the provider values")
			}
			rows, err := f.client.QueryContext(f.ctx, `SELECT token,"refreshToken" FROM "Integration" WHERE id=$1`, connectionID)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			var access string
			var refresh sql.NullString
			if !rows.Next() {
				t.Fatal("missing stored integration")
			}
			if err := rows.Scan(&access, &refresh); err != nil {
				t.Fatal(err)
			}
			if !credentialcipher.IsSealed(access) || !refresh.Valid || !credentialcipher.IsSealed(refresh.String) {
				t.Fatal("provider access or refresh credential was stored without encryption")
			}
		})
	}
}
