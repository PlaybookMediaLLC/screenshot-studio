package publicapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/dbtest"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

func TestAccountIdentityIsTenantScopedAndCredentialFree(t *testing.T) {
	client := dbtest.Open(t)
	ctx := context.Background()
	org := client.Organization.Create().SetName("Original").SaveX(ctx)
	other := client.Organization.Create().SetName("Other").SaveX(ctx)
	did := "did:plc:abcdefghijklmnopqrstuvwx"
	caps := socialidentity.Capabilities{Version: 1, Bluesky: &socialidentity.BlueskyCapabilities{MaxTextGraphemes: 300, MaxTextBytes: 3000, MaxImages: 4, ImageMaxBytes: 2000000, MaxVideos: 1, VideoMaxBytes: 300000000}}
	row := client.Integration.Create().SetOrganizationID(org.ID).SetName("Native account").SetInternalID(did).SetProviderIdentifier("bluesky").SetType("social").SetToken("private-access-canary").SetTokenExpiration(time.Now().Add(time.Hour)).
		SetVerifiedAccountKey("bluesky:" + did).SetVerifiedAccountKind("profile").SetVerifiedScopes([]string{"com.atproto.appPass"}).SetVerifiedCapabilities(&caps).SetIdentityVerifiedAt(time.Now()).SaveX(ctx)
	router := httpx.NewRouter()
	RegisterPublicIntegrationsController(router, Deps{Orgs: &fakeOrgs{byKey: map[string]*ent.Organization{"original-key": org, "other-key": other}}, OAuth: fakeOAuth{}, Store: redis.NewMemory(), Perms: auth.NewPermissionsService(nil, nil, nil, nil), Integrations: integration.NewService(integration.NewRepository(client, nil), nil, nil, nil, nil, redis.NewMemory(), nil)})
	path := "/public/v1/integrations/" + row.ID + "/identity"
	if status, _ := do(t, router, http.MethodGet, path, "other-key", ""); status != 404 {
		t.Fatal("foreign tenant read account proof")
	}
	status, body := do(t, router, http.MethodGet, path, "original-key", "")
	var account socialidentity.Connection
	if status != 200 || strings.Contains(body, "private-access-canary") || strings.Contains(body, "customInstanceDetails") || json.Unmarshal([]byte(body), &account) != nil || account.Validate("bluesky", row.ID) != nil {
		t.Fatal("identity response missing proof or leaked credentials")
	}
	client.Integration.UpdateOneID(row.ID).SetDeletedAt(time.Now()).ExecX(ctx)
	status, body = do(t, router, http.MethodGet, path, "original-key", "")
	if status != 200 || json.Unmarshal([]byte(body), &account) != nil || account.Active || account.NativeID != did {
		t.Fatal("removed account lost reconnect identity or appeared healthy")
	}
}
