package credentialbackfill_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/credentialbackfill"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
)

func TestBackfillPreservesLegacyCredentialsAndRotatesInBatches(t *testing.T) {
	client := dbtest.Open(t)
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)))
	ctx := context.Background()
	org := client.Organization.Create().SetName("Backfill").SaveX(ctx)
	t.Setenv("JWT_SECRET", "legacy-fixture")
	legacy, err := helpers.FixedEncryption(`{"password":"private-fixture"}`)
	if err != nil {
		t.Fatal(err)
	}
	for i := range 102 {
		id := fmt.Sprintf("backfill-%03d", i)
		_, err := client.ExecContext(ctx, `INSERT INTO "Integration"(id,"organizationId","internalId",name,"providerIdentifier",type,token,"refreshToken","customInstanceDetails","createdAt","updatedAt") VALUES($1,$2,$1,'Fixture','fake','social','access-fixture','refresh-fixture',$3,now(),now())`, id, org.ID, legacy)
		if err != nil {
			t.Fatal(err)
		}
	}
	if n, err := credentialbackfill.Run(ctx, client); err != nil || n != 102 {
		t.Fatalf("backfill: updated=%d error=%v", n, err)
	}
	assertCredentials(t, client, "backfill-000")
	first := stored(t, client, "backfill-000")
	if n, err := credentialbackfill.Run(ctx, client); err != nil || n != 0 || first != stored(t, client, "backfill-000") {
		t.Fatal("backfill was not idempotent", n, err)
	}
	old := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_PREVIOUS_KEY", old)
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 32)))
	if n, err := credentialbackfill.Run(ctx, client); err != nil || n != 102 {
		t.Fatal("rotation failed", n, err)
	}
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_PREVIOUS_KEY", "")
	assertCredentials(t, client, "backfill-101")
	if n, err := credentialbackfill.Run(ctx, client); err != nil || n != 0 {
		t.Fatal("rotation depended on retired key", n, err)
	}
}

func TestBackfillRollsBackInvalidBatchAndPreservesNullAndEmpty(t *testing.T) {
	client := dbtest.Open(t)
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)))
	ctx := context.Background()
	org := client.Organization.Create().SetName("Rollback").SaveX(ctx)
	for _, id := range []string{"a-valid", "b-invalid"} {
		client.Integration.Create().SetID(id).SetOrganization(org).SetInternalID(id).SetName(id).
			SetProviderIdentifier("fake").SetType("social").SetToken("").SaveX(ctx)
	}
	_, err := client.ExecContext(ctx, `UPDATE "Integration" SET token='plain-fixture' WHERE id='a-valid'`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.ExecContext(ctx, `UPDATE "Integration" SET token='scc1.invalid-private-fixture' WHERE id='b-invalid'`)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := credentialbackfill.Run(ctx, client); err == nil || n != 0 || strings.Contains(err.Error(), "private-fixture") {
		t.Fatal("invalid ciphertext was accepted or exposed")
	}
	if stored(t, client, "a-valid")[0] != "plain-fixture" {
		t.Fatal("failed batch partially committed")
	}
	_, err = client.ExecContext(ctx, `UPDATE "Integration" SET token='',"refreshToken"='',"customInstanceDetails"='' WHERE id='b-invalid'`)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := credentialbackfill.Run(ctx, client); err != nil || n != 1 {
		t.Fatal("resume failed", n, err)
	}
	if record := client.Integration.GetX(ctx, "a-valid"); record.RefreshToken != nil || record.CustomInstanceDetails != nil {
		t.Fatal("NULL fields changed")
	}
	if record := client.Integration.GetX(ctx, "b-invalid"); record.Token != "" || record.RefreshToken == nil || *record.RefreshToken != "" || record.CustomInstanceDetails == nil || *record.CustomInstanceDetails != "" {
		t.Fatal("empty fields changed")
	}
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", "")
	if _, err := credentialbackfill.Run(ctx, client); err == nil {
		t.Fatal("missing key permitted backfill")
	}
}

func TestBackfillHandlesErasedAccountTombstonesWithoutAcceptingActiveCorruption(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	org := client.Organization.Create().SetName("Erased").SaveX(ctx)
	row := client.Integration.Create().SetOrganization(org).SetInternalID("erased").SetName("Erased").
		SetProviderIdentifier("fake").SetType("social").SetToken("hashed-token").
		SetDeletedAt(time.Now()).SetCustomInstanceDetails("00000000000000000000000000000000").SaveX(ctx)
	if _, err := credentialbackfill.Run(ctx, client); err == nil {
		t.Fatal("corrupt credentials in an active organization were accepted")
	}
	client.Organization.UpdateOneID(org.ID).SetDeletedAt(time.Now()).ExecX(ctx)
	if n, err := credentialbackfill.Run(ctx, client); err != nil || n != 1 {
		t.Fatal("erased credential tombstone blocked backfill", n, err)
	}
	loaded := client.Integration.GetX(ctx, row.ID)
	if loaded.DeletedAt == nil || loaded.CustomInstanceDetails == nil {
		t.Fatal("erased account was changed")
	}
	if value, err := helpers.FixedDecryption(*loaded.CustomInstanceDetails); err != nil || value != "00000000000000000000000000000000" {
		t.Fatal("tombstone was not preserved")
	}
}

func stored(t *testing.T, client *ent.Client, id string) [3]string {
	t.Helper()
	rows, err := client.QueryContext(context.Background(), `SELECT token,"refreshToken","customInstanceDetails" FROM "Integration" WHERE id=$1`, id)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	if !rows.Next() {
		t.Fatal("missing row")
	}
	var token string
	var refresh, details sql.NullString
	if err := rows.Scan(&token, &refresh, &details); err != nil {
		t.Fatal(err)
	}
	return [3]string{token, refresh.String, details.String}
}

func assertCredentials(t *testing.T, client *ent.Client, id string) {
	t.Helper()
	for _, value := range stored(t, client, id) {
		if !credentialcipher.IsSealed(value) || strings.Contains(value, "fixture") {
			t.Fatal("plaintext remained in storage")
		}
	}
	record := client.Integration.GetX(context.Background(), id)
	if record.Token != "access-fixture" || record.RefreshToken == nil || *record.RefreshToken != "refresh-fixture" || record.CustomInstanceDetails == nil {
		t.Fatal("credentials changed")
	}
	if plain, err := helpers.FixedDecryption(*record.CustomInstanceDetails); err != nil || plain != `{"password":"private-fixture"}` {
		t.Fatal("provider cannot read custom credentials")
	}
}
