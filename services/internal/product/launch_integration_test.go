package product

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/launchrun"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/releasespec"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// The launch pipeline end to end on the product database: versioned specs
// and plans, posts with provenance, revisions applied all or nothing, and
// background runs, each scoped to its workspace.
func TestLaunchPipeline(t *testing.T) {
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
	org, other := "org_"+id, "other_"+id
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	actors := map[string]Actor{}
	for _, organization := range []string{org, other} {
		userID := "user_" + organization
		exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Owner',$2,true,now(),now())`, userID, organization+"@example.test")
		exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, organization)
		exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`,
			"session_"+organization, userID, organization)
		exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,'owner',now())`, "member_"+organization, organization, userID)
		actors[organization] = Actor{OrganizationID: organization, UserID: userID, SessionID: "session_" + organization, RequestID: "request_" + id}
	}
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1 OR id=$2`, org, other)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1 OR id=$2`, "user_"+org, "user_"+other)
	})
	releaseID, campaignID, designID := "release_"+id, "campaign_"+id, "design_"+id
	exec(`INSERT INTO release (id,"organizationId",title,"benefitStatement","sourceUrls","updatedAt") VALUES ($1,$2,'Launch','Faster','["https://example.test"]',now())`, releaseID, org)
	exec(`INSERT INTO campaign (id,"organizationId",name,objective,"releaseId","updatedAt") VALUES ($1,$2,'Campaign','Adoption',$3,now())`, campaignID, org, releaseID)
	exec(`INSERT INTO design (id,"organizationId","campaignId",name,document,"renderKey","updatedAt") VALUES ($1,$2,$3,'Hero','{"version":1,"image":{}}','old',now())`, designID, org, campaignID)
	exec(`INSERT INTO brand_kit (id,"organizationId",name,version,definition,status,"updatedAt") VALUES ($1,$2,'Brand',1,'{}','ACTIVE',now())`, "kit_"+id, org)
	repo := NewConfiguration(db.Client)
	subscribe(t, ctx, repo, org, "pro")
	subscribe(t, ctx, repo, other, "pro")
	owner, foreign := actors[org], actors[other]
	expect := func(err, kind error, what string) {
		t.Helper()
		if !errors.Is(err, kind) {
			t.Fatalf("%s: got %v, want %v", what, err, kind)
		}
	}

	launchCampaign, err := repo.GetLaunchCampaign(ctx, owner, campaignID)
	if err != nil || launchCampaign.Release == nil || launchCampaign.Release.ID != releaseID || len(launchCampaign.Release.SourceURLs) != 1 {
		t.Fatalf("launch campaign=%+v err=%v", launchCampaign, err)
	}
	_, err = repo.GetLaunchCampaign(ctx, foreign, campaignID)
	expect(err, publishing.ErrNotFound, "foreign campaign")
	if kit, _, err := repo.GetLaunchBrand(ctx, owner); err != nil || kit == nil || kit.ID != "kit_"+id {
		t.Fatalf("brand kit=%+v err=%v", kit, err)
	}
	if kit, profile, err := repo.GetLaunchBrand(ctx, foreign); err != nil || kit != nil || profile != nil {
		t.Fatalf("foreign brand kit=%+v profile=%+v err=%v", kit, profile, err)
	}

	// Specs: versions count up, approval supersedes, audit in the same transaction.
	content := json.RawMessage(`{"summary":{"sources":["brief"],"text":"Old"},"problem":[{"sources":["brief"],"text":"Slow"}],"openQuestions":[]}`)
	first, err := repo.SaveLaunchSpec(ctx, owner, releaseID, SaveLaunchSpecInput{ChangeSummary: "Drafted", Content: content,
		Metadata: map[string]any{"steps": 2}, Origin: "ai"})
	if err != nil || first.Version != 1 || first.Status != "DRAFT" || string(first.Sources) != "[]" {
		t.Fatalf("first spec=%+v err=%v", first, err)
	}
	generated, err := db.Client.AuditLog.Query().Where(auditlog.OrganizationID(org), auditlog.Action("product.release_spec_generated")).Only(ctx)
	if err != nil || generated.Metadata["version"] != float64(1) || generated.Metadata["steps"] != float64(2) || generated.Metadata["releaseId"] != releaseID {
		t.Fatalf("spec audit=%+v err=%v", generated, err)
	}
	_, err = repo.SaveLaunchSpec(ctx, foreign, releaseID, SaveLaunchSpecInput{Content: content, Origin: "human"})
	expect(err, publishing.ErrNotFound, "foreign spec save")
	_, err = repo.SaveLaunchSpec(ctx, owner, releaseID, SaveLaunchSpecInput{Content: content, Origin: "robot"})
	expect(err, ErrInvalidInput, "unknown origin")
	second, err := repo.SaveLaunchSpec(ctx, owner, releaseID, SaveLaunchSpecInput{ChangeSummary: "Edited", Content: content, Origin: "human"})
	if err != nil || second.Version != 2 {
		t.Fatalf("second spec=%+v err=%v", second, err)
	}
	if _, err := repo.ApproveLaunchSpec(ctx, owner, first.ID); err != nil {
		t.Fatal(err)
	}
	approved, err := repo.ApproveLaunchSpec(ctx, owner, second.ID)
	if err != nil || approved.Status != "APPROVED" || approved.ApprovedAt == nil {
		t.Fatalf("approved spec=%+v err=%v", approved, err)
	}
	if superseded, err := repo.GetLaunchSpec(ctx, owner, first.ID); err != nil || superseded.Status != "SUPERSEDED" {
		t.Fatalf("superseded spec=%+v err=%v", superseded, err)
	}
	_, err = repo.ApproveLaunchSpec(ctx, foreign, second.ID)
	expect(err, publishing.ErrNotFound, "foreign spec approval")
	if specs, err := repo.ListLaunchSpecs(ctx, owner, releaseID); err != nil || len(specs) != 2 || specs[0].Version != 2 {
		t.Fatalf("specs=%+v err=%v", specs, err)
	}
	if specs, err := repo.ListLaunchSpecs(ctx, foreign, releaseID); err != nil || len(specs) != 0 {
		t.Fatalf("foreign specs=%+v err=%v", specs, err)
	}

	// Plans.
	plan, err := repo.SaveLaunchPlan(ctx, owner, campaignID, SaveLaunchPlanInput{ChangeSummary: "Planned",
		Content: json.RawMessage(`{"angles":[]}`), Origin: "ai", SpecID: &second.ID})
	if err != nil || plan.Version != 1 || plan.SpecID == nil || *plan.SpecID != second.ID {
		t.Fatalf("plan=%+v err=%v", plan, err)
	}
	_, err = repo.SaveLaunchPlan(ctx, foreign, campaignID, SaveLaunchPlanInput{Content: json.RawMessage(`{}`), Origin: "ai"})
	expect(err, publishing.ErrNotFound, "foreign plan save")
	if approvedPlan, err := repo.ApproveLaunchPlan(ctx, owner, plan.ID); err != nil || approvedPlan.Status != "APPROVED" {
		t.Fatalf("approved plan=%+v err=%v", approvedPlan, err)
	}
	_, err = repo.GetLaunchPlan(ctx, foreign, campaignID, plan.ID)
	expect(err, publishing.ErrNotFound, "foreign plan")

	// Posts: only angles with posts become content angles.
	posts := []LaunchPostInput{
		{AngleKey: "G1", Channel: "linkedin", Claims: []map[string]any{{"ref": "summary", "text": "Old"}}, Copy: "Updated post", Phase: "launch"},
		{AngleKey: "G1", Channel: "x", Claims: []map[string]any{{"ref": "problem.0", "text": "Slow"}}, Copy: "Other section", Phase: "launch"},
		{AngleKey: "G1", Channel: "product_hunt", Claims: []map[string]any{{"ref": "summary", "text": "Old"}}, Copy: "Cites summary", Phase: "launch"},
	}
	saved, err := repo.SaveLaunchPosts(ctx, owner, campaignID, SaveLaunchPostsInput{Angles: []LaunchAngleInput{
		{Hook: "Hook", Key: "G1", Title: "Speed"}, {Hook: "Unused", Key: "G2", Title: "Unused"}},
		PlanVersion: 1, Posts: posts, SpecVersion: 2})
	if err != nil || saved.AngleCount != 1 || saved.PostCount != 3 {
		t.Fatalf("saved posts=%+v err=%v", saved, err)
	}
	_, err = repo.SaveLaunchPosts(ctx, foreign, campaignID, SaveLaunchPostsInput{Posts: posts})
	expect(err, publishing.ErrNotFound, "foreign posts")
	postIDs := map[string]string{}
	for _, post := range db.Client.CampaignPost.Query().Where(campaignpost.CampaignID(campaignID)).AllX(ctx) {
		postIDs[post.Copy] = post.ID
		if post.AngleID == nil || post.Status != campaignpost.StatusDRAFT || post.SpecVersion == nil || *post.SpecVersion != 2 {
			t.Fatalf("post=%+v", post)
		}
	}

	// A spec revision with one related post update, all or nothing.
	revision, err := repo.CreateLaunchRevision(ctx, owner, campaignID, CreateLaunchRevisionInput{Comment: "Say it plainly",
		Proposal: json.RawMessage(`{"summary":"Plainer","primary":{"targetType":"spec_section","targetId":"` + second.ID +
			`","targetKey":"summary","label":"Summary","reason":"r","before":{},"after":{"sources":["brief"],"text":"New"}},` +
			`"related":[{"targetType":"post","targetId":"` + postIDs["Updated post"] + `","label":"LinkedIn post","reason":"r",` +
			`"before":{"copy":"Updated post"},"after":{"callToAction":"","claims":[{"ref":"summary","text":"New"}],"copy":"Revised post","title":""}}]}`)})
	if err != nil || revision.TargetType != "spec_section" || revision.TargetKey == nil || revision.Status != "PROPOSED" {
		t.Fatalf("revision=%+v err=%v", revision, err)
	}
	_, err = repo.ApplyLaunchRevision(ctx, owner, revision.ID, ApplyLaunchRevisionInput{Related: []int{3}})
	expect(err, ErrInvalidInput, "unknown related change")
	if unchanged, _ := repo.GetLaunchRevision(ctx, owner, revision.ID); unchanged.Status != "PROPOSED" {
		t.Fatalf("failed apply kept status %s", unchanged.Status)
	}
	_, err = repo.ApplyLaunchRevision(ctx, foreign, revision.ID, ApplyLaunchRevisionInput{})
	expect(err, publishing.ErrNotFound, "foreign apply")
	applied, err := repo.ApplyLaunchRevision(ctx, owner, revision.ID, ApplyLaunchRevisionInput{Related: []int{0}})
	if err != nil || applied.Revision.Status != "APPLIED" || applied.Revision.DecidedAt == nil || len(applied.DesignIDs) != 0 {
		t.Fatalf("applied=%+v err=%v", applied, err)
	}
	third, err := db.Client.ReleaseSpec.Query().Where(releasespec.ReleaseID(releaseID), releasespec.Version(3)).Only(ctx)
	if err != nil || third.Origin != "revision" || !strings.Contains(string(third.Content), `"New"`) ||
		!strings.Contains(string(third.Content), `"Slow"`) || *third.ChangeSummary != "Revised summary: Say it plainly" {
		t.Fatalf("revised spec=%+v err=%v", third, err)
	}
	for text, version := range map[string]int{"Revised post": 3, "Other section": 3, "Cites summary": 2} {
		post, err := db.Client.CampaignPost.Query().Where(campaignpost.CampaignID(campaignID), campaignpost.Copy(text)).Only(ctx)
		if err != nil || *post.SpecVersion != version {
			t.Fatalf("post %q=%+v err=%v", text, post, err)
		}
	}
	_, err = repo.ApplyLaunchRevision(ctx, owner, revision.ID, ApplyLaunchRevisionInput{})
	expect(err, publishing.ErrConflict, "second apply")
	// The spec moved on, so a proposal against version 2 is stale.
	stale, err := repo.CreateLaunchRevision(ctx, owner, campaignID, CreateLaunchRevisionInput{Comment: "Again",
		Proposal: json.RawMessage(`{"primary":{"targetType":"spec_section","targetId":"` + second.ID + `","targetKey":"summary","label":"Summary","after":{}},"related":[]}`)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.ApplyLaunchRevision(ctx, owner, stale.ID, ApplyLaunchRevisionInput{})
	expect(err, publishing.ErrConflict, "stale spec revision")

	// A design revision clears the old render and its review.
	if err := repo.SetLaunchDesignCritique(ctx, owner, designID, map[string]any{"verdict": "pass"}); err != nil {
		t.Fatal(err)
	}
	expect(repo.SetLaunchDesignCritique(ctx, foreign, designID, map[string]any{"verdict": "pass"}), publishing.ErrNotFound, "foreign critique")
	current := db.Client.Design.GetX(ctx, designID)
	before, _ := json.Marshal(map[string]any{"updatedAt": current.UpdatedAt})
	designRevision, err := repo.CreateLaunchRevision(ctx, owner, campaignID, CreateLaunchRevisionInput{Comment: "Bigger",
		Proposal: json.RawMessage(`{"primary":{"targetType":"design","targetId":"` + designID + `","label":"Hero","before":` + string(before) + `,"after":{}},"related":[]}`)})
	if err != nil {
		t.Fatal(err)
	}
	staleDesign, err := repo.CreateLaunchRevision(ctx, owner, campaignID, CreateLaunchRevisionInput{Comment: "Old",
		Proposal: json.RawMessage(`{"primary":{"targetType":"design","targetId":"` + designID + `","label":"Hero","before":{"updatedAt":"2020-01-01T00:00:00.000Z"},"after":{}},"related":[]}`)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.ApplyLaunchRevision(ctx, owner, designRevision.ID, ApplyLaunchRevisionInput{})
	expect(err, ErrInvalidInput, "design revision without a document")
	document := map[string]any{"version": 1, "image": map[string]any{}, "texts": []any{}}
	appliedDesign, err := repo.ApplyLaunchRevision(ctx, owner, designRevision.ID, ApplyLaunchRevisionInput{
		DesignDocuments: map[string]map[string]any{designID: document}})
	if err != nil || len(appliedDesign.DesignIDs) != 1 || appliedDesign.DesignIDs[0] != designID {
		t.Fatalf("applied design=%+v err=%v", appliedDesign, err)
	}
	if revised := db.Client.Design.GetX(ctx, designID); revised.Critique != nil || revised.RenderKey != nil || revised.Document["texts"] == nil {
		t.Fatalf("revised design=%+v", revised)
	}
	_, err = repo.ApplyLaunchRevision(ctx, owner, staleDesign.ID, ApplyLaunchRevisionInput{
		DesignDocuments: map[string]map[string]any{designID: document}})
	expect(err, publishing.ErrConflict, "stale design revision")

	// Discard.
	_, err = repo.DiscardLaunchRevision(ctx, foreign, staleDesign.ID)
	expect(err, publishing.ErrNotFound, "foreign discard")
	if discarded, err := repo.DiscardLaunchRevision(ctx, owner, staleDesign.ID); err != nil || discarded.Status != "DISCARDED" {
		t.Fatalf("discarded=%+v err=%v", discarded, err)
	}
	_, err = repo.DiscardLaunchRevision(ctx, owner, staleDesign.ID)
	expect(err, publishing.ErrConflict, "second discard")
	if revisions, err := repo.ListLaunchRevisions(ctx, owner, campaignID); err != nil || len(revisions) != 4 {
		t.Fatalf("revisions=%d err=%v", len(revisions), err)
	}
	if examples, err := repo.GetLaunchPreferences(ctx, owner); err != nil || len(examples.Revisions) != 2 || len(examples.Approved) != 0 {
		t.Fatalf("preferences=%+v err=%v", examples, err)
	}

	// Runs: one of each kind at a time, except revisions.
	run, err := repo.StartLaunchRun(ctx, owner, campaignID, "spec")
	if err != nil || run.Status != "RUNNING" {
		t.Fatalf("run=%+v err=%v", run, err)
	}
	_, err = repo.StartLaunchRun(ctx, owner, campaignID, "spec")
	expect(err, publishing.ErrConflict, "second spec run")
	for range 2 {
		if _, err := repo.StartLaunchRun(ctx, owner, campaignID, "revision"); err != nil {
			t.Fatal(err)
		}
	}
	_, err = repo.StartLaunchRun(ctx, foreign, campaignID, "plan")
	expect(err, publishing.ErrNotFound, "foreign run")
	_, err = repo.GetLaunchRun(ctx, foreign, run.ID)
	expect(err, publishing.ErrNotFound, "foreign run read")
	expect(repo.FinishLaunchRun(ctx, foreign, run.ID, FinishLaunchRunInput{Status: "FAILED"}), publishing.ErrNotFound, "foreign finish")
	resultID := second.ID
	if err := repo.FinishLaunchRun(ctx, owner, run.ID, FinishLaunchRunInput{ResultID: &resultID, Status: "SUCCEEDED"}); err != nil {
		t.Fatal(err)
	}
	if finished, err := repo.GetLaunchRun(ctx, owner, run.ID); err != nil || finished.Status != "SUCCEEDED" || finished.FinishedAt == nil || *finished.ResultID != resultID {
		t.Fatalf("finished=%+v err=%v", finished, err)
	}
	if _, err := repo.StartLaunchRun(ctx, owner, campaignID, "spec"); err != nil {
		t.Fatalf("spec run after finish: %v", err)
	}
	if runs, err := repo.ListLaunchRuns(ctx, owner, campaignID); err != nil || len(runs) != 4 {
		t.Fatalf("runs=%d err=%v", len(runs), err)
	}
}

// A run holds its slot while it heartbeats: concurrent starts admit exactly
// one, a dead run gives the slot up, and a cancelled run stops its worker.
func TestLaunchRunLease(t *testing.T) {
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
	org, userID, campaignID := "org_"+id, "user_"+id, "campaign_"+id
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Owner',$2,true,now(),now())`, []any{userID, id + "@example.test"}},
		{`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, []any{org}},
		{`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`, []any{"session_" + id, userID, org}},
		{`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,'owner',now())`, []any{"member_" + id, org, userID}},
		{`INSERT INTO campaign (id,"organizationId",name,objective,"updatedAt") VALUES ($1,$2,'Campaign','Adoption',now())`, []any{campaignID, org}},
	} {
		if _, err := db.SQL.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1`, org)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1`, userID)
	})
	repo := NewConfiguration(db.Client)
	subscribe(t, ctx, repo, org, "pro")
	owner := Actor{OrganizationID: org, UserID: userID, SessionID: "session_" + id}

	results := make(chan error, 8)
	var started sync.WaitGroup
	for range cap(results) {
		started.Add(1)
		go func() {
			defer started.Done()
			_, err := repo.StartLaunchRun(ctx, owner, campaignID, "produce")
			results <- err
		}()
	}
	started.Wait()
	close(results)
	won := 0
	for err := range results {
		if err == nil {
			won++
		} else if !errors.Is(err, publishing.ErrConflict) {
			t.Fatal(err)
		}
	}
	running, err := db.Client.LaunchRun.Query().Where(launchrun.CampaignID(campaignID), launchrun.StatusEQ(launchrun.StatusRUNNING)).All(ctx)
	if won != 1 || err != nil || len(running) != 1 {
		t.Fatalf("concurrent starts won=%d running=%d err=%v", won, len(running), err)
	}
	run := running[0]

	if alive, err := repo.HeartbeatLaunchRun(ctx, owner, run.ID); err != nil || !alive {
		t.Fatalf("heartbeat alive=%v err=%v", alive, err)
	}
	// A run that stopped heartbeating gives its slot to a new start.
	if _, err := db.SQL.ExecContext(ctx, `UPDATE launch_run SET "heartbeatAt"=now()-interval '3 minutes' WHERE id=$1`, run.ID); err != nil {
		t.Fatal(err)
	}
	next, err := repo.StartLaunchRun(ctx, owner, campaignID, "produce")
	if err != nil {
		t.Fatalf("start after a dead run: %v", err)
	}
	if expired, err := repo.GetLaunchRun(ctx, owner, run.ID); err != nil || expired.Status != "FAILED" || expired.FinishedAt == nil {
		t.Fatalf("dead run=%+v err=%v", expired, err)
	}
	if alive, err := repo.HeartbeatLaunchRun(ctx, owner, run.ID); err != nil || alive {
		t.Fatalf("dead run heartbeat alive=%v err=%v", alive, err)
	}
	// Finishing an expired run changes nothing.
	if err := repo.FinishLaunchRun(ctx, owner, run.ID, FinishLaunchRunInput{Status: "SUCCEEDED"}); err != nil {
		t.Fatal(err)
	}
	if expired, err := repo.GetLaunchRun(ctx, owner, run.ID); err != nil || expired.Status != "FAILED" {
		t.Fatalf("finished dead run=%+v err=%v", expired, err)
	}

	// Cancel fails the run once; its worker learns on the next heartbeat.
	for _, want := range []bool{true, false} {
		if cancelled, err := repo.CancelLaunchRun(ctx, owner, next.ID); err != nil || cancelled != want {
			t.Fatalf("cancel=%v want %v err=%v", cancelled, want, err)
		}
	}
	if cancelled, err := repo.GetLaunchRun(ctx, owner, next.ID); err != nil || cancelled.Status != "FAILED" || cancelled.Error == nil || *cancelled.Error != "Cancelled." {
		t.Fatalf("cancelled run=%+v err=%v", cancelled, err)
	}
	if alive, err := repo.HeartbeatLaunchRun(ctx, owner, next.ID); err != nil || alive {
		t.Fatalf("cancelled run heartbeat alive=%v err=%v", alive, err)
	}
	if _, err := repo.CancelLaunchRun(ctx, owner, "missing_"+id); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("cancel of a missing run: %v", err)
	}
	if _, err := repo.StartLaunchRun(ctx, owner, campaignID, "produce"); err != nil {
		t.Fatalf("start after cancel: %v", err)
	}
}
