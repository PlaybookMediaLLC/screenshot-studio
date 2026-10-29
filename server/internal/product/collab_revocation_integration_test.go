package product

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

func TestCollaborationRechecksSessionAndUser(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo := w.ctx, w.repo.WithCollabKey([]byte(strings.Repeat("s", 32)))
	subscribe(t, ctx, repo, w.org, "pro")
	draft, err := repo.CreateContentDraft(ctx, w.owner, ContentDraftInput{Title: "Session revocation"})
	if err != nil {
		t.Fatal(err)
	}
	token, err := repo.IssueContentDraftCollabToken(ctx, w.owner, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	w.db.SQL.SetMaxOpenConns(1)
	if err := repo.StoreCollabState(ctx, token.Token, draft.ID, []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		name, deny, restore string
		args                []any
		want                error
	}{
		{"expired session", `UPDATE session SET "expiresAt"=now()-interval '1 minute' WHERE id=$1`, `UPDATE session SET "expiresAt"=now()+interval '1 hour' WHERE id=$1`, []any{w.owner.SessionID}, publishing.ErrUnauthorized},
		{"banned user", `UPDATE "user" SET banned=true WHERE id=$1`, `UPDATE "user" SET banned=false WHERE id=$1`, []any{w.owner.UserID}, publishing.ErrForbidden},
		{"switched workspace", `UPDATE session SET "activeOrganizationId"='other' WHERE id=$1`, `UPDATE session SET "activeOrganizationId"=$2 WHERE id=$1`, []any{w.owner.SessionID, w.org}, publishing.ErrForbidden},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			if _, err := w.db.SQL.ExecContext(ctx, scenario.deny, scenario.args[:1]...); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if _, err := w.db.SQL.ExecContext(ctx, scenario.restore, scenario.args...); err != nil {
					t.Error(err)
				}
			})
			if _, err := repo.AuthorizeCollab(ctx, token.Token, token.DocumentName); !errors.Is(err, scenario.want) {
				t.Fatalf("join: %v", err)
			}
			if _, err := repo.LoadCollabState(ctx, token.Token, draft.ID); !errors.Is(err, scenario.want) {
				t.Fatalf("read: %v", err)
			}
			if err := repo.StoreCollabState(ctx, token.Token, draft.ID, []byte{9}); !errors.Is(err, scenario.want) {
				t.Fatalf("write: %v", err)
			}
		})
	}
	var state []byte
	if err := w.db.SQL.QueryRowContext(ctx, `SELECT "collabState" FROM content_draft WHERE id=$1`, draft.ID).Scan(&state); err != nil || !bytes.Equal(state, []byte{1, 2, 3}) {
		t.Fatalf("unauthorized state persisted: %v %v", state, err)
	}
	if _, err := w.db.SQL.ExecContext(ctx, `DELETE FROM session WHERE id=$1`, w.owner.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AuthorizeCollab(ctx, token.Token, token.DocumentName); !errors.Is(err, publishing.ErrUnauthorized) {
		t.Fatalf("revoked login retained its collab token: %v", err)
	}
}

func TestCollaborationStoreRechecksAfterConcurrentDemotion(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, cancel := context.WithTimeout(w.ctx, 10*time.Second)
	defer cancel()
	repo := w.repo.WithCollabKey([]byte(strings.Repeat("s", 32)))
	subscribe(t, ctx, repo, w.org, "pro")
	w.addMember(t, "editor", "creator")
	draft, err := repo.CreateContentDraft(ctx, w.owner, ContentDraftInput{Title: "Concurrent demotion"})
	if err != nil {
		t.Fatal(err)
	}
	token, err := repo.IssueContentDraftCollabToken(ctx, w.actor("editor"), draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.StoreCollabState(ctx, token.Token, draft.ID, []byte{1}); err != nil {
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
	if _, err := tx.ExecContext(ctx, `UPDATE member SET role='viewer' WHERE "organizationId"=$1 AND "userId"=$2`, w.org, w.actor("editor").UserID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- repo.StoreCollabState(ctx, token.Token, draft.ID, []byte{9}) }()
	for {
		var blocked bool
		if err := w.db.SQL.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT id FROM member%')`, blocker).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("store did not wait for the current membership: %v", err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(5 * time.Millisecond):
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("concurrently demoted writer stored: %v", err)
	}
	var state []byte
	if err := w.db.SQL.QueryRowContext(ctx, `SELECT "collabState" FROM content_draft WHERE id=$1`, draft.ID).Scan(&state); err != nil || !bytes.Equal(state, []byte{1}) {
		t.Fatalf("denied state changed: %v %v", state, err)
	}
}

// Changes that can take collaboration access away move the counts the
// collaboration server polls; creating a draft, or another workspace, does not.
func TestCollaborationAccessChangesMoveTheCounts(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo := w.ctx, w.repo
	subscribe(t, ctx, repo, w.org, "pro")
	w.addMember(t, "editor", "creator")
	count := func() int64 {
		t.Helper()
		_, counts, err := repo.CollabEpochs(ctx, []string{w.org, "another-workspace"})
		if err != nil {
			t.Fatal(err)
		}
		if counts["another-workspace"] != 0 {
			t.Fatalf("another workspace moved: %v", counts)
		}
		return counts[w.org]
	}
	start := count()
	moved := func(step string, want int64) {
		t.Helper()
		if got := count() - start; got != want {
			t.Fatalf("%s: moved %d, want %d", step, got, want)
		}
	}
	member := "member_editor_" + w.id
	if _, err := repo.UpdateMemberRole(ctx, w.owner, member, "viewer"); err != nil {
		t.Fatal(err)
	}
	moved("demotion", 1)
	draft, err := repo.CreateContentDraft(ctx, w.owner, ContentDraftInput{Title: "Replaced"})
	if err != nil {
		t.Fatal(err)
	}
	moved("creation", 1)
	body := []any{map[string]any{"type": "p", "children": []any{map[string]any{"text": "Replaced"}}}}
	updated, err := repo.UpdateContentDraft(ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: draft.Version, Body: &body})
	if err != nil {
		t.Fatal(err)
	}
	moved("body replaced", 2)
	title := "Renamed"
	if _, err := repo.UpdateContentDraft(ctx, w.owner, draft.ID, ContentDraftUpdate{BaseVersion: updated.Version, Title: &title}); err != nil {
		t.Fatal(err)
	}
	moved("title only", 2)
	if err := repo.DeleteContentDraft(ctx, w.owner, draft.ID); err != nil {
		t.Fatal(err)
	}
	moved("deletion", 3)
	if _, err := repo.RemoveMember(ctx, w.owner, member); err != nil {
		t.Fatal(err)
	}
	moved("removal", 4)
}
