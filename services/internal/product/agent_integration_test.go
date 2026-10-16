package product

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// The AI kill switch, agent runs with their step trace, and conversations,
// each scoped to its workspace (docs/rfcs/016 and 017).
func TestAgentRunsAndConversations(t *testing.T) {
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
	actor := func(organization, label, role string) Actor {
		userID := "user_" + label + "_" + id
		exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'Person',$2,true,now(),now())`, userID, userID+"@example.test")
		exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`,
			"session_"+userID, userID, organization)
		exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())`, "member_"+userID, organization, userID, role)
		t.Cleanup(func() { _, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1`, userID) })
		return Actor{OrganizationID: organization, UserID: userID, SessionID: "session_" + userID, RequestID: "request_" + id}
	}
	for _, organization := range []string{org, other} {
		exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, organization)
	}
	t.Cleanup(func() { _, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1 OR id=$2`, org, other) })
	owner, viewer, viewer2, foreign := actor(org, "owner", "owner"), actor(org, "viewer", "viewer"), actor(org, "viewer2", "viewer"), actor(other, "foreign", "owner")
	campaignID := "campaign_" + id
	exec(`INSERT INTO campaign (id,"organizationId",name,objective,"updatedAt") VALUES ($1,$2,'Campaign','Adoption',now())`, campaignID, org)
	repo := NewConfiguration(db.Client)
	expect := func(err, kind error, what string) {
		t.Helper()
		if !errors.Is(err, kind) {
			t.Fatalf("%s: got %v, want %v", what, err, kind)
		}
	}
	audited := func(action string) int {
		t.Helper()
		count, err := db.Client.AuditLog.Query().Where(auditlog.OrganizationID(org), auditlog.Action(action)).Count(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return count
	}

	// Kill switch: on by default, off blocks agent runs, toggles are audited.
	if snapshot, err := repo.Bootstrap(ctx, owner); err != nil || !snapshot.Capabilities.AIAgent {
		t.Fatalf("bootstrap aiAgent=%+v err=%v", snapshot, err)
	}
	off, on := false, true
	if _, err := repo.UpdateWorkspace(ctx, owner, UpdateWorkspaceInput{AIAgentEnabled: &off, Name: org, Slug: org}); err != nil {
		t.Fatal(err)
	}
	if snapshot, err := repo.Bootstrap(ctx, owner); err != nil || snapshot.Capabilities.AIAgent || audited("product.workspace_ai_agent_disabled") != 1 {
		t.Fatalf("disabled bootstrap=%+v err=%v", snapshot, err)
	}
	_, err = repo.StartAgentRun(ctx, owner, StartAgentRunInput{Kind: "agent"})
	expect(err, publishing.ErrForbidden, "agent run while AI is off")
	_, err = repo.StartAgentRun(ctx, viewer, StartAgentRunInput{Kind: "conversation"})
	expect(err, publishing.ErrForbidden, "conversation run while AI is off")
	_, err = repo.StartLaunchRun(ctx, owner, campaignID, "spec")
	expect(err, publishing.ErrForbidden, "pipeline run while AI is off")
	if _, err := repo.UpdateWorkspace(ctx, owner, UpdateWorkspaceInput{AIAgentEnabled: &on, Name: org, Slug: org}); err != nil || audited("product.workspace_ai_agent_enabled") != 1 {
		t.Fatalf("re-enable err=%v", err)
	}
	if enabled, err := repo.AIAgentEnabled(ctx, other); err != nil || !enabled {
		t.Fatalf("workspace without settings enabled=%v err=%v", enabled, err)
	}

	// Agent runs: no campaign needed, roles and kinds enforced.
	run, err := repo.StartAgentRun(ctx, owner, StartAgentRunInput{Kind: "agent"})
	if err != nil || run.CampaignID != nil || run.Status != "RUNNING" {
		t.Fatalf("agent run=%+v err=%v", run, err)
	}
	_, err = repo.StartAgentRun(ctx, viewer, StartAgentRunInput{Kind: "agent"})
	expect(err, publishing.ErrForbidden, "viewer agent run")
	_, err = repo.StartAgentRun(ctx, owner, StartAgentRunInput{Kind: "spec"})
	expect(err, ErrInvalidInput, "pipeline kind as agent run")
	_, err = repo.StartAgentRun(ctx, foreign, StartAgentRunInput{CampaignID: &campaignID, Kind: "conversation"})
	expect(err, publishing.ErrNotFound, "foreign campaign agent run")
	turn, err := repo.StartAgentRun(ctx, owner, StartAgentRunInput{CampaignID: &campaignID, Kind: "conversation"})
	if err != nil || turn.CampaignID == nil || *turn.CampaignID != campaignID {
		t.Fatalf("conversation run=%+v err=%v", turn, err)
	}
	if _, err := db.SQL.ExecContext(ctx, `INSERT INTO launch_run (id,"organizationId",kind) VALUES ($1,$2,'spec')`, "nocampaign_"+id, org); err == nil {
		t.Fatal("a pipeline run without a campaign was stored")
	}

	// Steps: appended once per index, redacted, workspace scoped.
	toolName, effect := "getProduct", "read"
	if _, err := repo.AppendLaunchRunStep(ctx, owner, run.ID, LaunchRunStepInput{Index: 0, Kind: "model", Status: "SUCCEEDED", TokensIn: 120, TokensOut: 40}); err != nil {
		t.Fatal(err)
	}
	step, err := repo.AppendLaunchRunStep(ctx, owner, run.ID, LaunchRunStepInput{Index: 1, Kind: "tool", ToolName: &toolName, Effect: &effect,
		Status: "SUCCEEDED", InputSummary: json.RawMessage(`{"query":"invoices","headers":{"Authorization":"Bearer x"},"items":[{"apiKey":"k"}]}`)})
	if err != nil || strings.Contains(string(step.InputSummary), "Bearer") || strings.Contains(string(step.InputSummary), `"k"`) || !strings.Contains(string(step.InputSummary), "invoices") {
		t.Fatalf("step=%+v err=%v", step, err)
	}
	_, err = repo.AppendLaunchRunStep(ctx, owner, run.ID, LaunchRunStepInput{Index: 1, Kind: "model", Status: "FAILED"})
	expect(err, publishing.ErrConflict, "duplicate step index")
	_, err = repo.AppendLaunchRunStep(ctx, owner, run.ID, LaunchRunStepInput{Index: 2, Kind: "tool", Status: "DENIED"})
	expect(err, ErrInvalidInput, "tool step without a tool name")
	_, err = repo.AppendLaunchRunStep(ctx, owner, run.ID, LaunchRunStepInput{Index: 2, Kind: "model", Status: "SUCCEEDED", InputSummary: json.RawMessage(`{`)})
	expect(err, ErrInvalidInput, "malformed summary")
	_, err = repo.AppendLaunchRunStep(ctx, viewer, run.ID, LaunchRunStepInput{Index: 2, Kind: "model", Status: "SUCCEEDED"})
	expect(err, publishing.ErrForbidden, "viewer step")
	_, err = repo.AppendLaunchRunStep(ctx, foreign, run.ID, LaunchRunStepInput{Index: 2, Kind: "model", Status: "SUCCEEDED"})
	expect(err, publishing.ErrNotFound, "foreign step")
	if steps, err := repo.ListLaunchRunSteps(ctx, viewer, run.ID); err != nil || len(steps) != 2 || steps[0].Index != 0 || steps[1].ToolName == nil || *steps[1].Effect != "read" {
		t.Fatalf("steps=%+v err=%v", steps, err)
	}
	_, err = repo.ListLaunchRunSteps(ctx, foreign, run.ID)
	expect(err, publishing.ErrNotFound, "foreign steps")

	// Finishing records the counters; cancelling an agent run ends CANCELLED.
	steps, tokensIn, tokensOut, cents := 2, 120, 40, 3
	if err := repo.FinishLaunchRun(ctx, owner, run.ID, FinishLaunchRunInput{Status: "BUDGET_EXHAUSTED", StepCount: &steps,
		TokensIn: &tokensIn, TokensOut: &tokensOut, CostCents: &cents}); err != nil {
		t.Fatal(err)
	}
	if finished, err := repo.GetLaunchRun(ctx, owner, run.ID); err != nil || finished.Status != "BUDGET_EXHAUSTED" || finished.StepCount != 2 ||
		finished.TokensIn != 120 || finished.TokensOut != 40 || finished.CostCents != 3 || finished.FinishedAt == nil {
		t.Fatalf("finished=%+v err=%v", finished, err)
	}
	expect(repo.FinishLaunchRun(ctx, owner, turn.ID, FinishLaunchRunInput{Status: "CANCELLED"}), ErrInvalidInput, "finish as cancelled")
	if cancelled, err := repo.CancelLaunchRun(ctx, owner, turn.ID); err != nil || !cancelled {
		t.Fatalf("cancel=%v err=%v", cancelled, err)
	}
	if cancelled, err := repo.GetLaunchRun(ctx, owner, turn.ID); err != nil || cancelled.Status != "CANCELLED" {
		t.Fatalf("cancelled=%+v err=%v", cancelled, err)
	}

	// Conversations: the workspace reads them, members talk, editors record agent output.
	conversation, err := repo.CreateConversation(ctx, viewer, CreateConversationInput{CampaignID: &campaignID, Title: "  Recurring invoices  "})
	if err != nil || conversation.Title != "Recurring invoices" || conversation.Status != "ACTIVE" || audited("product.conversation_created") != 1 {
		t.Fatalf("conversation=%+v err=%v", conversation, err)
	}
	_, err = repo.CreateConversation(ctx, foreign, CreateConversationInput{CampaignID: &campaignID})
	expect(err, publishing.ErrNotFound, "foreign campaign conversation")
	if _, err := repo.AppendConversationMessage(ctx, viewer, conversation.ID, AppendConversationMessageInput{Role: "user", Kind: "text", Content: "Market it."}); err != nil {
		t.Fatal(err)
	}
	_, err = repo.AppendConversationMessage(ctx, viewer, conversation.ID, AppendConversationMessageInput{Role: "assistant", Kind: "text", Content: "Done."})
	expect(err, publishing.ErrForbidden, "viewer assistant message")
	_, err = repo.AppendConversationMessage(ctx, owner, conversation.ID, AppendConversationMessageInput{Role: "user", Kind: "text", Content: strings.Repeat("a", 20_001)})
	expect(err, ErrInvalidInput, "oversized message")
	foreignRun, err := repo.StartAgentRun(ctx, foreign, StartAgentRunInput{Kind: "agent"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.AppendConversationMessage(ctx, owner, conversation.ID, AppendConversationMessageInput{Role: "assistant", Kind: "text", Content: "x", LaunchRunID: &foreignRun.ID})
	expect(err, publishing.ErrNotFound, "foreign run reference")
	_, err = repo.AppendConversationMessage(ctx, foreign, conversation.ID, AppendConversationMessageInput{Role: "user", Kind: "text", Content: "x"})
	expect(err, publishing.ErrNotFound, "foreign message")
	if _, err := repo.AppendConversationMessage(ctx, owner, conversation.ID, AppendConversationMessageInput{Role: "assistant", Kind: "clarification",
		Content: "Which screen?", LaunchRunID: &turn.ID, Metadata: json.RawMessage(`{"options":["a","b"]}`)}); err != nil {
		t.Fatal(err)
	}
	detail, err := repo.GetConversation(ctx, viewer2, conversation.ID)
	if err != nil || len(detail.Messages) != 2 || detail.Messages[0].Role != "user" || detail.Messages[1].Kind != "clarification" || *detail.Messages[1].LaunchRunID != turn.ID {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}
	_, err = repo.GetConversation(ctx, foreign, conversation.ID)
	expect(err, publishing.ErrNotFound, "foreign conversation")
	if listed, err := repo.ListConversations(ctx, viewer2, ListConversationsInput{CampaignID: &campaignID}); err != nil || len(listed) != 1 {
		t.Fatalf("listed=%+v err=%v", listed, err)
	}
	if listed, err := repo.ListConversations(ctx, foreign, ListConversationsInput{}); err != nil || len(listed) != 0 {
		t.Fatalf("foreign listed=%+v err=%v", listed, err)
	}

	// Viewers converse: a member runs their own conversation turn end to end;
	// another person's run, or another author's conversation, stays closed.
	viewerTurn, err := repo.StartAgentRun(ctx, viewer, StartAgentRunInput{Kind: "conversation"})
	if err != nil {
		t.Fatalf("viewer conversation run err=%v", err)
	}
	if _, err := repo.AppendConversationMessage(ctx, viewer, conversation.ID, AppendConversationMessageInput{Role: "assistant", Kind: "text",
		Content: "Here is a draft.", LaunchRunID: &viewerTurn.ID}); err != nil {
		t.Fatalf("viewer assistant message on own run: %v", err)
	}
	if _, err := repo.AppendLaunchRunStep(ctx, viewer, viewerTurn.ID, LaunchRunStepInput{Index: 0, Kind: "tool", ToolName: &toolName, Status: "DENIED"}); err != nil {
		t.Fatalf("viewer step on own run: %v", err)
	}
	if running, err := repo.HeartbeatLaunchRun(ctx, viewer, viewerTurn.ID); err != nil || !running {
		t.Fatalf("viewer heartbeat running=%v err=%v", running, err)
	}
	_, err = repo.AppendConversationMessage(ctx, viewer, conversation.ID, AppendConversationMessageInput{Role: "assistant", Kind: "text",
		Content: "x", LaunchRunID: &turn.ID})
	expect(err, publishing.ErrForbidden, "viewer citing another person's run")
	_, err = repo.AppendConversationMessage(ctx, viewer2, conversation.ID, AppendConversationMessageInput{Role: "tool", Kind: "tool",
		Content: "x", LaunchRunID: &viewerTurn.ID})
	expect(err, publishing.ErrForbidden, "viewer citing a run they did not start")
	viewer2Turn, err := repo.StartAgentRun(ctx, viewer2, StartAgentRunInput{Kind: "conversation"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.AppendConversationMessage(ctx, viewer2, conversation.ID, AppendConversationMessageInput{Role: "assistant", Kind: "clarification",
		Content: "x", LaunchRunID: &viewer2Turn.ID})
	expect(err, publishing.ErrForbidden, "viewer recording into another author's conversation")
	expect(repo.FinishLaunchRun(ctx, viewer2, viewerTurn.ID, FinishLaunchRunInput{Status: "SUCCEEDED"}), publishing.ErrForbidden, "viewer finishing another's run")
	if err := repo.FinishLaunchRun(ctx, viewer, viewerTurn.ID, FinishLaunchRunInput{Status: "SUCCEEDED"}); err != nil {
		t.Fatalf("viewer finish own run: %v", err)
	}
	if cancelled, err := repo.CancelLaunchRun(ctx, viewer2, viewer2Turn.ID); err != nil || !cancelled {
		t.Fatalf("viewer cancel own run=%v err=%v", cancelled, err)
	}

	// The author or an admin renames, links, and archives.
	title := "Invoices launch"
	if renamed, err := repo.UpdateConversation(ctx, viewer, conversation.ID, UpdateConversationInput{Title: &title}); err != nil || renamed.Title != title {
		t.Fatalf("renamed=%+v err=%v", renamed, err)
	}
	_, err = repo.UpdateConversation(ctx, viewer2, conversation.ID, UpdateConversationInput{Title: &title})
	expect(err, publishing.ErrForbidden, "non-author rename")
	archived := "ARCHIVED"
	if updated, err := repo.UpdateConversation(ctx, owner, conversation.ID, UpdateConversationInput{Status: &archived,
		CampaignID: NullableString{Set: true}}); err != nil || updated.Status != "ARCHIVED" || updated.CampaignID != nil || audited("product.conversation_archived") != 1 {
		t.Fatalf("archived=%+v err=%v", updated, err)
	}
	_, err = repo.AppendConversationMessage(ctx, owner, conversation.ID, AppendConversationMessageInput{Role: "user", Kind: "text", Content: "More."})
	expect(err, publishing.ErrConflict, "message to archived conversation")
	if listed, err := repo.ListConversations(ctx, owner, ListConversationsInput{}); err != nil || len(listed) != 0 {
		t.Fatalf("active listed=%+v err=%v", listed, err)
	}
	if listed, err := repo.ListConversations(ctx, owner, ListConversationsInput{Status: "ARCHIVED"}); err != nil || len(listed) != 1 {
		t.Fatalf("archived listed=%+v err=%v", listed, err)
	}

	// Deleting a run unlinks its messages instead of deleting them.
	exec(`DELETE FROM launch_run WHERE id=$1`, turn.ID)
	if detail, err := repo.GetConversation(ctx, owner, conversation.ID); err != nil || detail.Messages[1].LaunchRunID != nil {
		t.Fatalf("after run delete=%+v err=%v", detail, err)
	}
}
