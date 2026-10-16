package product

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/brand"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/lucsky/cuid"
)

// testWorkspace is one workspace with an owner session on the product test
// database, removed when the test ends.
type testWorkspace struct {
	ctx   context.Context
	db    *database.Database
	repo  *Configuration
	id    string
	org   string
	owner Actor
}

func newTestWorkspace(t *testing.T) *testWorkspace {
	t.Helper()
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
	id := cuid.New()
	w := &testWorkspace{ctx: ctx, db: db, repo: NewConfiguration(db.Client), id: id, org: "org_" + id}
	w.addMember(t, "owner", "owner")
	w.owner = w.actor("owner")
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1`, w.org)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id LIKE $1`, "user_%_"+id)
	})
	return w
}

func (w *testWorkspace) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := w.db.SQL.ExecContext(w.ctx, query, args...); err != nil {
		t.Fatalf("%v\n%s", err, query)
	}
}

// addMember adds a user with a session and a role; the first call creates the workspace.
func (w *testWorkspace) addMember(t *testing.T, name, role string) {
	t.Helper()
	userID := "user_" + name + "_" + w.id
	w.exec(t, `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,now(),now())`, userID, name, name+"-"+w.id+"@example.test")
	if role == "owner" {
		w.exec(t, `INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,'Workspace',$1,now())`, w.org)
	}
	w.exec(t, `INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`,
		"session_"+name+"_"+w.id, userID, w.org)
	w.exec(t, `INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())`, "member_"+name+"_"+w.id, w.org, userID, role)
}

func (w *testWorkspace) actor(name string) Actor {
	return Actor{OrganizationID: w.org, UserID: "user_" + name + "_" + w.id, SessionID: "session_" + name + "_" + w.id, RequestID: "request_" + w.id}
}

// Prohibited terms block copy wherever it is written or scheduled, and the
// error names each term and its reason.
func TestProhibitedTermsBlockCopy(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo, owner := w.ctx, w.repo, w.owner
	if _, err := repo.UpsertBrandProfile(ctx, owner, UpsertBrandProfileInput{Audience: "Developers", ProductDescription: "Studio", Tone: "Clear",
		ProhibitedTerms: []brand.ProhibitedTerm{{Term: "Acme", Reason: "Competitor"}, {Term: "cheap", MatchMode: "phrase"}}}); err != nil {
		t.Fatal(err)
	}
	blocked := func(err error, term, what string) {
		t.Helper()
		var prohibited *ProhibitedTermsError
		if !errors.As(err, &prohibited) || len(prohibited.Matches) != 1 || prohibited.Matches[0].Term != term {
			t.Fatalf("%s: err=%v, want a block on %q", what, err, term)
		}
	}
	cta := "Switch from ACME"
	_, err := repo.CreateCampaign(ctx, owner, CreateCampaignInput{Name: "Launch", Objective: "Adoption",
		Posts: []CampaignPostInput{{Channel: "x", Copy: "Fast screenshots", CallToAction: &cta}}})
	blocked(err, "Acme", "create campaign")
	if !strings.Contains(err.Error(), "Competitor") {
		t.Fatalf("error lacks the reason: %v", err)
	}
	campaign, err := repo.CreateCampaign(ctx, owner, CreateCampaignInput{Name: "Launch", Objective: "Adoption",
		Posts: []CampaignPostInput{{Channel: "x", Copy: "Fast screenshots"}}})
	if err != nil {
		t.Fatal(err)
	}
	blocked(repo.SaveCampaignCopy(ctx, owner, campaign.ID, SaveCampaignCopyInput{Angles: []CampaignAngleInput{{Hook: "h", Title: "t"}},
		Posts: []CampaignPostInput{{Channel: "x", Copy: "Not cheapest, best"}}}), "cheap", "save copy")
	_, err = repo.SaveLaunchPosts(ctx, owner, campaign.ID, SaveLaunchPostsInput{Posts: []LaunchPostInput{
		{AngleKey: "G1", Channel: "x", Copy: "Fine copy", Title: "Beats Acme"}}})
	blocked(err, "Acme", "save launch posts")
	postID := campaign.Posts[0].ID
	revision, err := repo.CreateLaunchRevision(ctx, owner, campaign.ID, CreateLaunchRevisionInput{Comment: "Name them",
		Proposal: json.RawMessage(`{"primary":{"targetType":"post","targetId":"` + postID + `","label":"Post",` +
			`"before":{"copy":"Fast screenshots"},"after":{"copy":"Faster than acme"}},"related":[]}`)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.ApplyLaunchRevision(ctx, owner, revision.ID, ApplyLaunchRevisionInput{})
	blocked(err, "Acme", "apply revision")
	// A term added after approval blocks scheduling.
	w.exec(t, `UPDATE campaign_post SET status='APPROVED', copy='Acme who?' WHERE id=$1`, postID)
	_, err = repo.ScheduleCampaignPost(ctx, owner, campaign.ID, postID, ScheduleCampaignPostInput{ChannelConnectionID: "connection"})
	blocked(err, "Acme", "schedule")
	if post := w.db.Client.CampaignPost.GetX(ctx, postID); post.Status != campaignpost.StatusAPPROVED {
		t.Fatalf("blocked schedule changed the post: %+v", post)
	}
}
