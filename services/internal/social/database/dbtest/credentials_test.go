package dbtest_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
)

func TestIntegrationCredentialsAreEncryptedAtRest(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	org := client.Organization.Create().SetName("Credential fixture").SaveX(ctx)
	connection := client.Integration.Create().SetOrganization(org).SetInternalID("account").
		SetName("Fixture").SetProviderIdentifier("x").SetType("social").SetToken("access-fixture").
		SetCustomInstanceDetails("private-details-fixture").SaveX(ctx)
	stored := func() (string, sql.NullString) {
		t.Helper()
		rows, err := client.QueryContext(ctx, `SELECT token,"refreshToken" FROM "Integration" WHERE id=$1`, connection.ID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var access string
		var refresh sql.NullString
		if !rows.Next() {
			t.Fatal("missing credential row")
		}
		if err := rows.Scan(&access, &refresh); err != nil {
			t.Fatal(err)
		}
		return access, refresh
	}
	access, refresh := stored()
	if !credentialcipher.IsSealed(access) || strings.Contains(access, "access-fixture") || refresh.Valid {
		t.Fatal("access token is not encrypted or absent refresh token changed")
	}
	loaded := client.Integration.GetX(ctx, connection.ID)
	if loaded.Token != "access-fixture" || loaded.RefreshToken != nil {
		t.Fatal("credential round trip changed the entity")
	}
	data, err := json.Marshal(loaded)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"access-fixture", "private-details-fixture", `"token"`, `"refreshToken"`, `"customInstanceDetails"`} {
		if strings.Contains(string(data), forbidden) {
			t.Fatal("credential material was serialized")
		}
	}
	newRefresh := "refresh-fixture"
	client.Integration.UpdateOneID(connection.ID).SetToken("updated-fixture").SetRefreshToken(&newRefresh).ExecX(ctx)
	access, refresh = stored()
	if !credentialcipher.IsSealed(access) || !refresh.Valid || !credentialcipher.IsSealed(refresh.String) {
		t.Fatal("update left plaintext credentials")
	}
	loaded = client.Integration.GetX(ctx, connection.ID)
	if loaded.Token != "updated-fixture" || loaded.RefreshToken == nil || *loaded.RefreshToken != newRefresh {
		t.Fatal("updated credentials did not round trip")
	}
	client.Integration.UpdateOneID(connection.ID).ClearRefreshToken().ExecX(ctx)
	if client.Integration.GetX(ctx, connection.ID).RefreshToken != nil {
		t.Fatal("cleared refresh token was not nil")
	}
	// Legacy rows remain readable until the explicit backfill, but every new write is sealed.
	if _, err := client.ExecContext(ctx, `UPDATE "Integration" SET token=$1 WHERE id=$2`, "legacy-fixture", connection.ID); err != nil {
		t.Fatal(err)
	}
	if client.Integration.GetX(ctx, connection.ID).Token != "legacy-fixture" {
		t.Fatal("legacy credential was not preserved")
	}
	// An encrypted refresh token cannot be substituted into the access-token column.
	if _, err := client.ExecContext(ctx, `UPDATE "Integration" SET token=$1 WHERE id=$2`, refresh.String, connection.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Integration.Get(ctx, connection.ID); err == nil || strings.Contains(err.Error(), "fixture") {
		t.Fatal("swapped credential did not fail safely")
	}
}
