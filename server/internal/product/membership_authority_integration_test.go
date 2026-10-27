package product

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	entgo "entgo.io/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

func TestMembershipCommandsRecheckCurrentAuthority(t *testing.T) {
	w := newTestWorkspace(t)
	foreign := newTestWorkspace(t)
	w.addMember(t, "admin", "admin")
	w.addMember(t, "viewer", "viewer")
	admin, target := w.actor("admin"), "member_viewer_"+w.id
	ctx, cancel := context.WithTimeout(w.ctx, 30*time.Second)
	defer cancel()
	w.db.SQL.SetMaxOpenConns(1)
	// With one connection, authorization must use the transaction's client.
	changed, err := w.repo.UpdateMemberRole(ctx, admin, target, "publisher")
	if err != nil || changed.OrganizationID != w.org || changed.UserID != w.actor("viewer").UserID {
		t.Fatalf("canonical result: %+v %v", changed, err)
	}
	for _, scenario := range []struct {
		name, deny, restore string
		args                []any
		want                error
	}{
		{"demoted", `UPDATE member SET role='viewer' WHERE "userId"=$1`, `UPDATE member SET role='admin' WHERE "userId"=$1`, []any{admin.UserID}, publishing.ErrForbidden},
		{"expired", `UPDATE session SET "expiresAt"=now()-interval '1 minute' WHERE id=$1`, `UPDATE session SET "expiresAt"=now()+interval '1 hour' WHERE id=$1`, []any{admin.SessionID}, publishing.ErrUnauthorized},
		{"banned", `UPDATE "user" SET banned=true WHERE id=$1`, `UPDATE "user" SET banned=false WHERE id=$1`, []any{admin.UserID}, publishing.ErrForbidden},
		{"switched", `UPDATE session SET "activeOrganizationId"='other' WHERE id=$1`, `UPDATE session SET "activeOrganizationId"=$2 WHERE id=$1`, []any{admin.SessionID, w.org}, publishing.ErrForbidden},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			w.exec(t, scenario.deny, scenario.args[:1]...)
			defer w.exec(t, scenario.restore, scenario.args...)
			if _, err := w.repo.UpdateMemberRole(ctx, admin, target, "creator"); !errors.Is(err, scenario.want) {
				t.Fatalf("update: %v", err)
			}
			if _, err := w.repo.RemoveMember(ctx, admin, target); !errors.Is(err, scenario.want) {
				t.Fatalf("remove: %v", err)
			}
			if scenario.name != "demoted" {
				if _, err := w.repo.LeaveWorkspace(ctx, admin); !errors.Is(err, scenario.want) {
					t.Fatalf("leave: %v", err)
				}
			}
		})
	}
	for _, kind := range []string{"api_key", "service", "support"} {
		machine := w.owner
		machine.Kind = kind
		if _, err := w.repo.UpdateMemberRole(ctx, machine, target, "creator"); !errors.Is(err, publishing.ErrForbidden) {
			t.Fatalf("%s update: %v", kind, err)
		}
		if _, err := w.repo.RemoveMember(ctx, machine, target); !errors.Is(err, publishing.ErrForbidden) {
			t.Fatalf("%s remove: %v", kind, err)
		}
		if _, err := w.repo.LeaveWorkspace(ctx, machine); !errors.Is(err, publishing.ErrForbidden) {
			t.Fatalf("%s leave: %v", kind, err)
		}
		if err := w.repo.TransferOwnership(ctx, machine, target); !errors.Is(err, publishing.ErrForbidden) {
			t.Fatalf("%s transfer: %v", kind, err)
		}
	}
	if _, err := w.repo.UpdateMemberRole(ctx, w.owner, "member_owner_"+foreign.id, "creator"); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("foreign update: %v", err)
	}
	if _, err := w.repo.RemoveMember(ctx, w.owner, "member_owner_"+foreign.id); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("foreign remove: %v", err)
	}
	removed, err := w.repo.RemoveMember(ctx, w.owner, target)
	if err != nil || removed.ID != target || removed.Role != "publisher" {
		t.Fatalf("remove result: %+v %v", removed, err)
	}
	if err := w.repo.AuthorizeSession(ctx, w.actor("viewer")); !errors.Is(err, publishing.ErrUnauthorized) {
		t.Fatalf("removed session: %v", err)
	}
	if _, err := w.repo.RemoveMember(ctx, w.owner, target); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("repeat remove: %v", err)
	}
	left, err := w.repo.LeaveWorkspace(ctx, admin)
	if err != nil || left.UserID != admin.UserID {
		t.Fatalf("leave result: %+v %v", left, err)
	}
	if err := w.repo.AuthorizeSession(ctx, admin); !errors.Is(err, publishing.ErrUnauthorized) {
		t.Fatalf("departed session: %v", err)
	}
}

func TestMembershipMutationWaitsForConcurrentDemotion(t *testing.T) {
	for _, action := range []string{"update", "remove"} {
		t.Run(action, func(t *testing.T) {
			w := newTestWorkspace(t)
			w.addMember(t, "admin", "admin")
			w.addMember(t, "target", "viewer")
			ctx, cancel := context.WithTimeout(w.ctx, 30*time.Second)
			defer cancel()
			admin, target := w.actor("admin"), "member_target_"+w.id
			if err := w.repo.Authorize(ctx, admin); err != nil {
				t.Fatal(err)
			}
			tx, err := w.db.SQL.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			var blocker int
			if err := tx.QueryRowContext(ctx, `SELECT pg_backend_pid()`).Scan(&blocker); err != nil {
				t.Fatal(err)
			}
			if _, err := tx.ExecContext(ctx, `UPDATE member SET role='viewer' WHERE "organizationId"=$1 AND "userId"=$2`, w.org, admin.UserID); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() {
				var err error
				if action == "update" {
					_, err = w.repo.UpdateMemberRole(ctx, admin, target, "admin")
				} else {
					_, err = w.repo.RemoveMember(ctx, admin, target)
				}
				done <- err
			}()
			for {
				var blocked bool
				if err := w.db.SQL.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, blocker).Scan(&blocked); err != nil {
					t.Fatal(err)
				}
				if blocked {
					break
				}
				select {
				case err := <-done:
					t.Fatalf("did not wait for current membership: %v", err)
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-time.After(5 * time.Millisecond):
				}
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			if err := <-done; !errors.Is(err, publishing.ErrForbidden) {
				t.Fatalf("stale administrator mutated membership: %v", err)
			}
			member, err := w.db.Client.Member.Get(ctx, target)
			if err != nil || member.Role != "viewer" {
				t.Fatalf("denied mutation changed target: %+v %v", member, err)
			}
		})
	}
}

func TestMembershipFinalAuditFailureRollsBackRevocation(t *testing.T) {
	for _, action := range []string{"remove", "leave", "update", "transfer"} {
		t.Run(action, func(t *testing.T) {
			w := newTestWorkspace(t)
			w.addMember(t, "target", "viewer")
			w.exec(t, `UPDATE "user" SET "twoFactorEnabled"=true WHERE id=$1`, w.owner.UserID)
			target := "member_target_" + w.id
			injected := errors.New("injected audit write failure")
			w.db.Client.AuditLog.Use(func(next entgo.Mutator) entgo.Mutator {
				return entgo.MutateFunc(func(ctx context.Context, m entgo.Mutation) (entgo.Value, error) { return nil, injected })
			})
			var err error
			switch action {
			case "remove":
				_, err = w.repo.RemoveMember(w.ctx, w.owner, target)
			case "leave":
				_, err = w.repo.LeaveWorkspace(w.ctx, w.actor("target"))
			case "update":
				_, err = w.repo.UpdateMemberRole(w.ctx, w.owner, target, "admin")
			case "transfer":
				err = w.repo.TransferOwnership(w.ctx, w.owner, target)
			}
			if !errors.Is(err, injected) {
				t.Fatalf("expected rollback: %v", err)
			}
			member, err := w.db.Client.Member.Get(w.ctx, target)
			if err != nil || member.Role != "viewer" {
				t.Fatalf("partial mutation: %+v %v", member, err)
			}
			if err := w.repo.AuthorizeSession(w.ctx, w.actor("target")); err != nil {
				t.Fatalf("partial session revocation: %v", err)
			}
			if err := w.repo.AuthorizeSensitive(w.ctx, w.owner); err != nil {
				t.Fatalf("partial owner transfer: %v", err)
			}
		})
	}
}

func TestMembershipOwnerProtectionAndConcurrentTransfers(t *testing.T) {
	w := newTestWorkspace(t)
	w.addMember(t, "first", "admin")
	w.addMember(t, "second", "viewer")
	ownerID := "member_owner_" + w.id
	if _, err := w.repo.UpdateMemberRole(w.ctx, w.owner, ownerID, "viewer"); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("owner demotion: %v", err)
	}
	if _, err := w.repo.RemoveMember(w.ctx, w.owner, ownerID); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("owner removal: %v", err)
	}
	if _, err := w.repo.LeaveWorkspace(w.ctx, w.owner); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("owner leave: %v", err)
	}
	if err := w.repo.TransferOwnership(w.ctx, w.owner, "member_first_"+w.id); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("transfer without MFA: %v", err)
	}
	w.exec(t, `UPDATE "user" SET "twoFactorEnabled"=true WHERE id=$1`, w.owner.UserID)
	w.exec(t, `UPDATE session SET "createdAt"=now()-interval '16 minutes' WHERE id=$1`, w.owner.SessionID)
	if err := w.repo.TransferOwnership(w.ctx, w.owner, "member_first_"+w.id); !errors.Is(err, publishing.ErrUnauthorized) {
		t.Fatalf("transfer without recent login: %v", err)
	}
	w.exec(t, `UPDATE session SET "createdAt"=now() WHERE id=$1`, w.owner.SessionID)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, name := range []string{"first", "second"} {
		wg.Add(1)
		go func(i int, name string) {
			defer wg.Done()
			errs[i] = w.repo.TransferOwnership(w.ctx, w.owner, "member_"+name+"_"+w.id)
		}(i, name)
	}
	wg.Wait()
	success := 0
	for _, err := range errs {
		if err == nil {
			success++
		} else if !errors.Is(err, publishing.ErrForbidden) {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("transfer outcomes: %v", errs)
	}
	var owners, audits int
	if err := w.db.SQL.QueryRowContext(w.ctx, `SELECT count(*) FROM member WHERE "organizationId"=$1 AND role='owner'`, w.org).Scan(&owners); err != nil {
		t.Fatal(err)
	}
	if err := w.db.SQL.QueryRowContext(w.ctx, `SELECT count(*) FROM audit_log WHERE "organizationId"=$1 AND action='product.workspace_ownership_transferred'`, w.org).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if owners != 1 || audits != 1 {
		t.Fatalf("owners=%d audits=%d", owners, audits)
	}
}
