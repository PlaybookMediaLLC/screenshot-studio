package activities

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
	"go.temporal.io/sdk/converter"
)

func TestActivitiesReloadCurrentProofAfterWorkflowWait(t *testing.T) {
	for _, provider := range []string{"x", "bluesky"} {
		t.Run(provider, func(t *testing.T) {
			f := setup(t)
			f.provider.providerID = provider
			native := "123456789"
			caps := socialidentity.XStandardPostLimits("read-write", nil)
			proof := socialidentity.Verification{AccountKey: "x:" + native, AccountKind: "profile", GrantedScopes: []string{"read-write"}, Capabilities: socialidentity.Capabilities{Version: 1, X: &caps}}
			if provider == "bluesky" {
				native = "did:plc:abcdefghijklmnopqrstuvwx"
				limits := socialidentity.BlueskyLexiconLimits()
				proof = socialidentity.Verification{AccountKey: "bluesky:" + native, AccountKind: "profile", GrantedScopes: []string{"com.atproto.appPass"}, Capabilities: socialidentity.Capabilities{Version: 1, Bluesky: &limits}}
			}
			verifiedAt := time.Now().UTC().Truncate(time.Millisecond)
			save := func() {
				t.Helper()
				f.client.Integration.UpdateOneID(f.in.ID).SetProviderIdentifier(provider).SetInternalID(native).
					SetVerifiedAccountKey(proof.AccountKey).SetVerifiedAccountKind(proof.AccountKind).SetVerifiedScopes(proof.GrantedScopes).
					SetVerifiedCapabilities(&proof.Capabilities).SetIdentityVerifiedAt(verifiedAt).ExecX(f.ctx)
			}
			save()
			row := f.client.Integration.GetX(f.ctx, f.in.ID)
			payload, err := converter.GetDefaultDataConverter().ToPayload(toIntegration(row))
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(payload.Data), "verifiedCapabilities") || strings.Contains(string(payload.Data), proof.AccountKey) {
				t.Fatal("workflow history retained authority")
			}
			var snapshot Integration
			if err := converter.GetDefaultDataConverter().FromPayload(payload, &snapshot); err != nil {
				t.Fatal(err)
			}
			if snapshot.VerifiedCapabilities != nil || snapshot.IdentityVerifiedAt != nil {
				t.Fatal("workflow snapshot supplied proof")
			}
			// Reverification during a workflow wait must supersede the old facts.
			verifiedAt = verifiedAt.Add(time.Minute)
			if provider == "x" {
				proof.GrantedScopes = []string{"read-write-directmessages"}
				proof.Capabilities.X.OAuth1AccessLevel = "read-write-directmessages"
			} else {
				limit := int64(1000000)
				proof.Capabilities.Bluesky.BlobUploadLimit = &limit
			}
			save()
			f.in = &snapshot
			list := f.list(t)[:1]
			calls := map[string]func() error{
				"publish":  func() error { _, err := f.a.PostSocial(f.ctx, &snapshot, list); return err },
				"pending":  func() error { _, err := f.a.PostSocialPending(f.ctx, &snapshot, list); return err },
				"comment":  func() error { _, err := f.a.PostComment(f.ctx, "remote", nil, &snapshot, list); return err },
				"status":   func() error { _, err := f.a.CheckPostStatus(f.ctx, &snapshot, nil); return err },
				"finalize": func() error { _, err := f.a.FinalizePost(f.ctx, &snapshot, nil); return err },
			}
			for name, call := range calls {
				f.provider.received = nil
				if err := call(); err != nil {
					t.Fatalf("%s: %v", name, err)
				}
				in := f.provider.received
				if in == nil || in.VerifiedAccountKey == nil || *in.VerifiedAccountKey != proof.AccountKey || in.VerifiedAccountKind == nil || *in.VerifiedAccountKind != "profile" || !reflect.DeepEqual(in.VerifiedScopes, proof.GrantedScopes) || !reflect.DeepEqual(in.VerifiedCapabilities, &proof.Capabilities) || in.IdentityVerifiedAt == nil || !in.IdentityVerifiedAt.Equal(verifiedAt) {
					t.Fatalf("%s dropped or reused stale verification", name)
				}
			}
			// Removal of proof wins over even a forged old workflow snapshot.
			f.client.Integration.UpdateOneID(f.in.ID).ClearVerifiedAccountKey().ClearVerifiedAccountKind().ClearVerifiedScopes().ClearVerifiedCapabilities().ClearIdentityVerifiedAt().ExecX(f.ctx)
			data := `{"verifiedAccountKey":"` + proof.AccountKey + `","verifiedAccountKind":"profile","verifiedScopes":["read-write"]}`
			if err := json.Unmarshal([]byte(data), &snapshot); err != nil {
				t.Fatal(err)
			}
			for name, call := range calls {
				f.provider.received = nil
				if err := call(); temporalx.FailureType(err) != temporalx.TypeBadBody || f.provider.received != nil {
					t.Fatalf("%s used missing proof: %v", name, err)
				}
			}
		})
	}
}
