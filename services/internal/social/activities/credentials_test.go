package activities

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"go.temporal.io/sdk/converter"
)

func (p *fakeProvider) RefreshToken(_ context.Context, token string) (*integrations.AuthTokenDetails, error) {
	p.token = token
	if p.onRefresh != nil {
		p.onRefresh()
	}
	return &integrations.AuthTokenDetails{AccessToken: "rotated-access", RefreshToken: "rotated-refresh", ExpiresIn: 3600}, nil
}

func TestRefreshActivityDoesNotChangeRevokedAccountAfterRemoteCall(t *testing.T) {
	f := setup(t)
	f.provider.onRefresh = func() {
		f.client.Integration.UpdateOneID(f.in.ID).SetDeletedAt(time.Now()).ExecX(f.ctx)
	}
	result, err := f.a.RefreshTokenWithCause(f.ctx, f.in, "expired")
	if result.V != nil || temporalx.FailureType(err) != temporalx.TypeBadBody {
		t.Fatal("stale refresh was not a terminal activity result", err)
	}
	stored := f.client.Integration.GetX(f.ctx, f.in.ID)
	if stored.DeletedAt == nil || stored.Token == "rotated-access" || stored.RefreshNeeded || stored.InBetweenSteps {
		t.Fatal("activity refresh/error handling changed the revoked account")
	}
}

func (p *fakeProvider) FinalizePost(_ context.Context, token string, pending json.RawMessage, _ *ent.Integration) (*integrations.PendingCheckResponse, error) {
	p.token = token
	return &integrations.PendingCheckResponse{Status: "completed", PostID: "finalized", PendingData: pending}, nil
}

func TestActivitiesUseCurrentCredentialsAfterWorkflowWait(t *testing.T) {
	f := setup(t)
	list := f.list(t)[:1]
	// Model the actual Temporal serialization boundary and a token rotated while waiting.
	payload, err := converter.GetDefaultDataConverter().ToPayload(f.in)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot Integration
	if err := converter.GetDefaultDataConverter().FromPayload(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Token != "" {
		t.Fatal("workflow retained a token")
	}
	refresh := "current-refresh"
	f.client.Integration.UpdateOneID(f.in.ID).SetToken("current-access").SetRefreshToken(&refresh).ExecX(f.ctx)
	for name, call := range map[string]func() error{
		"publish":         func() error { _, err := f.a.PostSocial(f.ctx, &snapshot, list); return err },
		"pending publish": func() error { _, err := f.a.PostSocialPending(f.ctx, &snapshot, list); return err },
		"comment":         func() error { _, err := f.a.PostComment(f.ctx, "remote-post", nil, &snapshot, list); return err },
		"status":          func() error { _, err := f.a.CheckPostStatus(f.ctx, &snapshot, nil); return err },
		"finalize":        func() error { _, err := f.a.FinalizePost(f.ctx, &snapshot, nil); return err },
	} {
		if err := call(); err != nil || f.provider.token != "current-access" {
			t.Fatal(name, "did not use current credentials", err)
		}
	}
	result, err := f.a.RefreshToken(f.ctx, &snapshot)
	if err != nil || result.V == nil || f.provider.token != "current-refresh" {
		t.Fatal("refresh did not reload credentials", err)
	}
	data, err := json.Marshal(result)
	if err != nil || strings.Contains(string(data), "rotated-") || strings.Contains(string(data), "current-refresh") {
		t.Fatal("refresh result exposed credentials")
	}
	row := f.client.Integration.GetX(f.ctx, f.in.ID)
	if row.Token != "rotated-access" || row.RefreshToken == nil || *row.RefreshToken != "rotated-refresh" {
		t.Fatal("refresh was not persisted")
	}
	if _, err := f.a.PostSocial(f.ctx, &snapshot, list); err != nil || f.provider.token != "rotated-access" {
		t.Fatal("post-refresh retry used stale credentials", err)
	}
}

func TestActivitiesRejectRevokedAndForeignWorkflowSnapshots(t *testing.T) {
	for _, change := range []string{"deleted", "disabled", "reconnect", "between steps", "empty token", "provider changed", "account changed", "wrong workspace", "deleted workspace"} {
		t.Run(change, func(t *testing.T) {
			f := setup(t)
			list := f.list(t)[:1]
			u := f.client.Integration.UpdateOneID(f.in.ID)
			switch change {
			case "deleted":
				u.SetDeletedAt(time.Now()).ExecX(f.ctx)
			case "disabled":
				u.SetDisabled(true).ExecX(f.ctx)
			case "reconnect":
				u.SetRefreshNeeded(true).ExecX(f.ctx)
			case "between steps":
				u.SetInBetweenSteps(true).ExecX(f.ctx)
			case "empty token":
				u.SetToken("").ExecX(f.ctx)
			case "provider changed":
				u.SetProviderIdentifier("other").ExecX(f.ctx)
			case "account changed":
				u.SetInternalID("different-account").ExecX(f.ctx)
			case "wrong workspace":
				f.in.OrganizationID = "other-workspace"
			case "deleted workspace":
				f.client.Organization.UpdateOneID(f.in.OrganizationID).SetDeletedAt(time.Now()).ExecX(f.ctx)
			}
			for _, call := range []func() error{
				func() error { _, err := f.a.PostSocial(f.ctx, f.in, list); return err },
				func() error { _, err := f.a.PostComment(f.ctx, "remote", nil, f.in, list); return err },
				func() error { _, err := f.a.CheckPostStatus(f.ctx, f.in, nil); return err },
				func() error { _, err := f.a.FinalizePost(f.ctx, f.in, nil); return err },
				func() error { _, err := f.a.RefreshToken(f.ctx, f.in); return err },
			} {
				if err := call(); err == nil || f.provider.token != "" {
					t.Fatal("unavailable account reached the provider")
				}
			}
		})
	}
}
