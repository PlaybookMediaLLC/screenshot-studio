package product

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/collab"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// Collaboration tokens: issued per draft and member, verified by the backend
// for every connection, load and store, and useless in another workspace or
// for another draft.
func TestContentDraftCollaboration(t *testing.T) {
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	id := cuid.New()
	org, other := "org_"+id, "other_"+id
	repo := NewConfiguration(db.Client).WithMonthlyMeter(&recordingMonthlyMeter{}).WithCollabKey([]byte(strings.Repeat("s", 32)))
	actors := map[string]Actor{}
	for _, organization := range []string{org, other} {
		userID := "user_" + organization
		exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Ada',$2,true,now(),now())`, userID, organization+"@example.test")
		exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, organization)
		exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`,
			"session_"+organization, userID, organization)
		exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,'owner',now())`, "member_"+organization, organization, userID)
		actors[organization] = Actor{OrganizationID: organization, UserID: userID, SessionID: "session_" + organization, RequestID: "request_" + id}
		subscribe(t, ctx, repo, organization, "pro")
	}
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM content_draft WHERE "organizationId" IN ($1,$2)`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id IN ($1,$2)`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id IN ($1,$2)`, "user_"+org, "user_"+other)
	})
	owner, foreign := actors[org], actors[other]
	draft, err := repo.CreateContentDraft(ctx, owner, ContentDraftInput{Title: "Shared"})
	if err != nil {
		t.Fatal(err)
	}
	foreignDraft, err := repo.CreateContentDraft(ctx, foreign, ContentDraftInput{Title: "Theirs"})
	if err != nil {
		t.Fatal(err)
	}

	issued, err := repo.IssueContentDraftCollabToken(ctx, owner, draft.ID)
	if err != nil || issued.Access != collab.AccessWrite || issued.DocumentName != "content-draft:"+draft.ID {
		t.Fatalf("issued=%+v err=%v", issued, err)
	}
	grant, err := repo.AuthorizeCollab(ctx, issued.Token, issued.DocumentName)
	if err != nil || grant.Access != collab.AccessWrite || grant.User.Name != "Ada" || grant.OrganizationID != org {
		t.Fatalf("grant=%+v err=%v", grant, err)
	}

	t.Run("state round-trips through the backend", func(t *testing.T) {
		if state, err := repo.LoadCollabState(ctx, issued.Token, draft.ID); err != nil || state != nil {
			t.Fatalf("fresh state=%v err=%v", state, err)
		}
		if err := repo.StoreCollabState(ctx, issued.Token, draft.ID, []byte{1, 2, 3}); err != nil {
			t.Fatal(err)
		}
		if state, err := repo.LoadCollabState(ctx, issued.Token, draft.ID); err != nil || !bytes.Equal(state, []byte{1, 2, 3}) {
			t.Fatalf("state=%v err=%v", state, err)
		}
	})

	t.Run("another workspace is refused", func(t *testing.T) {
		if _, err := repo.IssueContentDraftCollabToken(ctx, foreign, draft.ID); !errors.Is(err, publishing.ErrNotFound) {
			t.Fatalf("foreign issue err=%v", err)
		}
		theirs, err := repo.IssueContentDraftCollabToken(ctx, foreign, foreignDraft.ID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.AuthorizeCollab(ctx, theirs.Token, issued.DocumentName); !errors.Is(err, publishing.ErrForbidden) {
			t.Fatalf("foreign token opened this draft: %v", err)
		}
		if _, err := repo.LoadCollabState(ctx, theirs.Token, draft.ID); !errors.Is(err, publishing.ErrForbidden) {
			t.Fatalf("foreign token loaded this draft: %v", err)
		}
		if err := repo.StoreCollabState(ctx, theirs.Token, draft.ID, []byte{9}); !errors.Is(err, publishing.ErrForbidden) {
			t.Fatalf("foreign token stored this draft: %v", err)
		}
		if _, err := repo.AuthorizeCollab(ctx, "forged.token", issued.DocumentName); !errors.Is(err, publishing.ErrUnauthorized) {
			t.Fatalf("forged token err=%v", err)
		}
	})

	t.Run("a member demoted to viewer joins read-only and cannot store", func(t *testing.T) {
		exec(`UPDATE member SET role='viewer' WHERE id=$1`, "member_"+org)
		t.Cleanup(func() { exec(`UPDATE member SET role='owner' WHERE id=$1`, "member_"+org) })
		if grant, err := repo.AuthorizeCollab(ctx, issued.Token, issued.DocumentName); err != nil || grant.Access != collab.AccessRead {
			t.Fatalf("demoted grant=%+v err=%v", grant, err)
		}
		readOnly, err := repo.IssueContentDraftCollabToken(ctx, owner, draft.ID)
		if err != nil || readOnly.Access != collab.AccessRead {
			t.Fatalf("viewer token=%+v err=%v", readOnly, err)
		}
		if err := repo.StoreCollabState(ctx, readOnly.Token, draft.ID, []byte{7}); !errors.Is(err, publishing.ErrForbidden) {
			t.Fatalf("read-only store err=%v", err)
		}
	})

	t.Run("a member who left is refused", func(t *testing.T) {
		exec(`DELETE FROM member WHERE id=$1`, "member_"+org)
		if _, err := repo.AuthorizeCollab(ctx, issued.Token, issued.DocumentName); !errors.Is(err, publishing.ErrForbidden) {
			t.Fatalf("former member err=%v", err)
		}
	})
}
