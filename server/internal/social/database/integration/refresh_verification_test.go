package integration

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

type contextualRefreshFixture struct {
	*fakeProvider
	renew func(*ent.Integration) (*integrations.AuthTokenDetails, error)
}

func (p *contextualRefreshFixture) RefreshIntegration(_ context.Context, in *ent.Integration) (*integrations.AuthTokenDetails, error) {
	return p.renew(in)
}

func TestContextualRefreshAtomicallyPersistsNewProof(t *testing.T) {
	for _, outcome := range []string{"valid", "wrong proof", "changed account"} {
		t.Run(outcome, func(t *testing.T) {
			f := setup(t, "bluesky")
			did := "did:plc:abcdefghijklmnopqrstuvwx"
			proof := &socialidentity.Verification{AccountKey: "bluesky:" + did, AccountKind: "profile", GrantedScopes: []string{"com.atproto.appPass"}, Capabilities: socialidentity.Capabilities{Version: 1, Bluesky: &socialidentity.BlueskyCapabilities{MaxTextGraphemes: 300, MaxTextBytes: 3000, MaxImages: 4, ImageMaxBytes: 2000000, MaxVideos: 1, VideoMaxBytes: 300000000}}}
			row := f.connect(t, CreateOrUpdateIntegrationParams{Name: "Account", InternalID: did, Provider: "bluesky", Token: "old", RefreshToken: "old-refresh", Verification: proof})
			p := &contextualRefreshFixture{fakeProvider: f.providers["bluesky"]}
			p.refresh = func() (*integrations.AuthTokenDetails, error) { t.Fatal("context-free refresh used"); return nil, nil }
			p.renew = func(current *ent.Integration) (*integrations.AuthTokenDetails, error) {
				if current.ID != row.ID || current.InternalID != did || current.RefreshToken == nil || *current.RefreshToken != "old-refresh" || current.VerifiedCapabilities == nil {
					t.Fatal("refresher lost its authoritative connection context")
				}
				proof.GrantedScopes = []string{"com.atproto.appPassPrivileged"}
				if outcome == "wrong proof" {
					proof.AccountKey = "bluesky:did:web:other.social"
				}
				if outcome == "changed account" {
					f.client.Integration.UpdateOneID(row.ID).SetToken("newer").ExecX(f.ctx)
				}
				return &integrations.AuthTokenDetails{ID: did, AccessToken: "renewed", RefreshToken: "renewed-refresh", ExpiresIn: 7200, Verification: proof}, nil
			}
			r := NewRefreshIntegrationService(integrations.NewManager([]integrations.Provider{p}), f.service, nil)
			_, err := r.Refresh(f.ctx, row, "expired")
			stored := f.client.Integration.GetX(f.ctx, row.ID)
			switch outcome {
			case "valid":
				if err != nil || stored.Token != "renewed" || *stored.RefreshToken != "renewed-refresh" || !reflect.DeepEqual(stored.VerifiedScopes, proof.GrantedScopes) || stored.TokenExpiration == nil || stored.TokenExpiration.Before(time.Now().Add(119*time.Minute)) || stored.IdentityVerifiedAt.Before(*row.IdentityVerifiedAt) {
					t.Fatalf("renewed grant did not persist atomically: %v", err)
				}
			case "wrong proof":
				if !errors.Is(err, socialidentity.ErrInvalid) || stored.Token != "old" || stored.VerifiedScopes[0] != "com.atproto.appPass" {
					t.Fatal("wrong proof replaced credentials")
				}
			case "changed account":
				if !errors.Is(err, ErrRefreshChanged) || stored.Token != "newer" || stored.VerifiedScopes[0] != "com.atproto.appPass" {
					t.Fatal("stale proof replaced current state")
				}
			}
		})
	}
}

func TestUnavailableRefreshPreservesHealthAndSendsNoReconnectNotice(t *testing.T) {
	for _, failure := range []error{integrations.ErrRefreshUnavailable, context.Canceled, context.DeadlineExceeded} {
		t.Run(failure.Error(), func(t *testing.T) {
			f := setup(t, "fake")
			row := f.connect(t, CreateOrUpdateIntegrationParams{Name: "Account", InternalID: "account", Provider: "fake", Token: "old", RefreshToken: "old-refresh"})
			f.providers["fake"].refresh = func() (*integrations.AuthTokenDetails, error) { return nil, failure }
			if _, err := f.service.refresh.Refresh(f.ctx, row, "expired"); !errors.Is(err, failure) {
				t.Fatal("temporary failure was swallowed")
			}
			stored := f.client.Integration.GetX(f.ctx, row.ID)
			if !sameRefreshState(row, stored) || len(f.notifications.sent) != 0 {
				t.Fatal("temporary failure changed credentials, health, or sent a reconnect notification")
			}
		})
	}
}
