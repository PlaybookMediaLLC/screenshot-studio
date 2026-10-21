package integration

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

func waitSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(10 * time.Second):
		t.Fatal("provider refresh did not start")
	}
}

func waitRefresh(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("refresh did not finish")
		return nil
	}
}

func TestRefreshCannotReviveOrOverwriteChangedAccount(t *testing.T) {
	for _, change := range []string{"deleted", "disabled", "refresh required", "between steps", "provider", "account identity", "workspace deleted", "new credentials", "same-token reconnect", "hard deleted"} {
		for _, failed := range []bool{false, true} {
			name := change + "/success"
			if failed {
				name = change + "/failure"
			}
			t.Run(name, func(t *testing.T) {
				f := setup(t, "fake")
				before := f.connect(t, CreateOrUpdateIntegrationParams{Name: "Account", InternalID: "account", Provider: "fake", Token: "old", RefreshToken: "old-refresh"})
				entered, release := make(chan struct{}), make(chan struct{})
				defer func() {
					select {
					case <-release:
					default:
						close(release)
					}
				}()
				f.providers["fake"].refresh = func() (*integrations.AuthTokenDetails, error) {
					close(entered)
					<-release
					if failed {
						return nil, errors.New("remote refresh rejected")
					}
					return &integrations.AuthTokenDetails{AccessToken: "stale-result", RefreshToken: "stale-refresh", ExpiresIn: 3600}, nil
				}
				done := make(chan error, 1)
				go func() { _, err := f.service.refresh.Refresh(f.ctx, before, "expired"); done <- err }()
				waitSignal(t, entered)
				u := f.client.Integration.UpdateOneID(before.ID)
				switch change {
				case "deleted":
					u.SetDeletedAt(time.Now()).ExecX(f.ctx)
				case "disabled":
					u.SetDisabled(true).ExecX(f.ctx)
				case "refresh required":
					u.SetRefreshNeeded(true).ExecX(f.ctx)
				case "between steps":
					u.SetInBetweenSteps(true).ExecX(f.ctx)
				case "provider":
					u.SetProviderIdentifier("other").ExecX(f.ctx)
				case "account identity":
					u.SetInternalID("other").ExecX(f.ctx)
				case "workspace deleted":
					f.client.Organization.UpdateOneID(f.org.ID).SetDeletedAt(time.Now()).ExecX(f.ctx)
				case "new credentials":
					refresh := "reconnected-refresh"
					u.SetToken("reconnected-token").SetRefreshToken(&refresh).ExecX(f.ctx)
				case "same-token reconnect":
					u.SetToken("old").SetUpdatedAt(before.UpdatedAt.Add(time.Second)).ExecX(f.ctx)
				case "hard deleted":
					f.client.Integration.DeleteOneID(before.ID).ExecX(f.ctx)
				}
				close(release)
				if err := waitRefresh(t, done); !errors.Is(err, ErrRefreshChanged) {
					t.Fatalf("stale completion accepted: %v", err)
				}
				if len(f.notifications.sent) != 0 {
					t.Fatal("stale failure sent a reconnect notification")
				}
				stored, err := f.client.Integration.Get(f.ctx, before.ID)
				if change == "hard deleted" {
					if !ent.IsNotFound(err) {
						t.Fatal("deleted connection was recreated")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				if stored.Token == "stale-result" || stored.RefreshToken != nil && *stored.RefreshToken == "stale-refresh" {
					t.Fatal("stale credentials replaced current state")
				}
				if change != "refresh required" && stored.RefreshNeeded {
					t.Fatal("stale failure changed refresh health")
				}
				if change != "between steps" && stored.InBetweenSteps {
					t.Fatal("stale failure changed connection state")
				}
				if change == "deleted" && stored.DeletedAt == nil || change == "disabled" && !stored.Disabled {
					t.Fatal("refresh revoked removal")
				}
				if err := f.service.refresh.SetBetweenSteps(f.ctx, before, "expired"); !errors.Is(err, ErrRefreshChanged) {
					t.Fatal("stale between-steps transition accepted")
				}
			})
		}
	}
}

func TestConcurrentRefreshHasOneCredentialWinner(t *testing.T) {
	for _, secondFails := range []bool{false, true} {
		t.Run(map[bool]string{false: "two successes", true: "late failure"}[secondFails], func(t *testing.T) {
			f := setup(t, "fake")
			before := f.connect(t, CreateOrUpdateIntegrationParams{Name: "Account", InternalID: "account", Provider: "fake", Token: "old", RefreshToken: "refresh"})
			var calls atomic.Int32
			entered := []chan struct{}{make(chan struct{}), make(chan struct{})}
			release := []chan struct{}{make(chan struct{}), make(chan struct{})}
			defer func() {
				for _, signal := range release {
					select {
					case <-signal:
					default:
						close(signal)
					}
				}
			}()
			f.providers["fake"].refresh = func() (*integrations.AuthTokenDetails, error) {
				index := int(calls.Add(1)) - 1
				close(entered[index])
				<-release[index]
				if index == 1 && secondFails {
					return nil, errors.New("old refresh token consumed")
				}
				if index == 0 {
					return &integrations.AuthTokenDetails{AccessToken: "winner", RefreshToken: "winner-refresh", ExpiresIn: 3600}, nil
				}
				return &integrations.AuthTokenDetails{AccessToken: "loser", RefreshToken: "loser-refresh", ExpiresIn: 3600}, nil
			}
			done := []chan error{make(chan error, 1), make(chan error, 1)}
			for i := range done {
				go func(index int) { _, err := f.service.refresh.Refresh(f.ctx, before, ""); done[index] <- err }(i)
				waitSignal(t, entered[i])
			}
			close(release[0])
			if err := waitRefresh(t, done[0]); err != nil {
				t.Fatal(err)
			}
			close(release[1])
			if err := waitRefresh(t, done[1]); !errors.Is(err, ErrRefreshChanged) {
				t.Fatalf("late completion: %v", err)
			}
			stored := f.client.Integration.GetX(f.ctx, before.ID)
			if stored.Token != "winner" || stored.RefreshToken == nil || *stored.RefreshToken != "winner-refresh" || stored.RefreshNeeded || stored.InBetweenSteps || len(f.notifications.sent) != 0 {
				t.Fatal("late completion corrupted the winning connection")
			}
		})
	}
}

func TestRefreshLinkedAccountsPreserveRevocationAndWorkspaceScope(t *testing.T) {
	f := setup(t, "fake")
	f.providers["fake"].oneTimeToken = true
	root := f.connect(t, CreateOrUpdateIntegrationParams{Name: "Root", InternalID: "root", Provider: "fake", Token: "root-old", RefreshToken: "root-refresh"})
	makeChild := func(id, org, provider string) *ent.Integration {
		refresh := "child-refresh"
		return f.client.Integration.Create().SetOrganizationID(org).SetName(id).SetType("social").SetProviderIdentifier(provider).SetInternalID(id).
			SetRootInternalID("root").SetToken("child-old").SetRefreshToken(&refresh).SaveX(f.ctx)
	}
	active := makeChild("active", f.org.ID, "fake")
	removed := makeChild("removed", f.org.ID, "fake")
	reconnected := makeChild("reconnected", f.org.ID, "fake")
	other := f.client.Organization.Create().SetName("Other").SaveX(f.ctx)
	foreign := makeChild("foreign", other.ID, "fake")
	provider := makeChild("provider", f.org.ID, "other")
	f.providers["fake"].refresh = func() (*integrations.AuthTokenDetails, error) {
		f.client.Integration.UpdateOneID(removed.ID).SetDeletedAt(time.Now()).ExecX(f.ctx)
		f.client.Integration.UpdateOneID(reconnected.ID).SetToken("independent-new").ExecX(f.ctx)
		return &integrations.AuthTokenDetails{ID: "root", AccessToken: "rotated", ExpiresIn: 3600}, nil
	}
	if _, err := f.service.refresh.Refresh(f.ctx, root, ""); err != nil {
		t.Fatal(err)
	}
	for _, row := range []*ent.Integration{root, active} {
		stored := f.client.Integration.GetX(f.ctx, row.ID)
		if stored.Token != "rotated" || stored.RefreshToken == nil || *stored.RefreshToken != *row.RefreshToken {
			t.Fatal("valid linked account did not rotate or lost its omitted refresh token")
		}
	}
	for _, row := range []*ent.Integration{removed, foreign, provider} {
		if f.client.Integration.GetX(f.ctx, row.ID).Token != "child-old" {
			t.Fatal("propagation overwrote a removed, foreign, or unrelated account")
		}
	}
	if f.client.Integration.GetX(f.ctx, reconnected.ID).Token != "independent-new" {
		t.Fatal("propagation overwrote newer sibling credentials")
	}
}

func TestRefreshRevalidatesBeforeRemoteCallAndRejectsWrongIdentity(t *testing.T) {
	f := setup(t, "fake")
	row := f.connect(t, CreateOrUpdateIntegrationParams{Name: "Account", InternalID: "account", Provider: "fake", Token: "old", RefreshToken: "refresh"})
	calls := 0
	f.providers["fake"].refresh = func() (*integrations.AuthTokenDetails, error) {
		calls++
		return &integrations.AuthTokenDetails{ID: "different", AccessToken: "wrong"}, nil
	}
	if _, err := f.service.refresh.Refresh(f.ctx, row, ""); err == nil {
		t.Fatal("refresh changed external identity")
	}
	if f.client.Integration.GetX(f.ctx, row.ID).Token != "old" {
		t.Fatal("wrong account token was stored")
	}
	f.client.Integration.UpdateOneID(row.ID).SetDisabled(true).ExecX(f.ctx)
	if _, err := f.service.refresh.Refresh(f.ctx, row, ""); !errors.Is(err, ErrRefreshChanged) || calls != 1 {
		t.Fatal("disabled account reached the provider")
	}
}

func TestRefreshSweepUsesConditionalCompletion(t *testing.T) {
	f := setup(t, "fake")
	expiry := int64(-60)
	row := f.connect(t, CreateOrUpdateIntegrationParams{Name: "Account", InternalID: "account", Provider: "fake", Token: "old", RefreshToken: "refresh", ExpiresIn: &expiry})
	f.providers["fake"].refresh = func() (*integrations.AuthTokenDetails, error) {
		f.client.Integration.UpdateOneID(row.ID).SetDeletedAt(time.Now()).ExecX(f.ctx)
		return &integrations.AuthTokenDetails{AccessToken: "stale", RefreshToken: "stale-refresh", ExpiresIn: 3600}, nil
	}
	if err := f.service.RefreshTokens(f.ctx); err != nil {
		t.Fatal(err)
	}
	stored := f.client.Integration.GetX(f.ctx, row.ID)
	if stored.DeletedAt == nil || stored.Token != "old" {
		t.Fatal("periodic refresh revived a removed account")
	}
}
