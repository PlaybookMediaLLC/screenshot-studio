package product

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/releaseautomationnode"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/releaseautomationrun"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/platformai"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	automation "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
)

// scriptedCopyModel answers every requested post and records what it was sent.
type scriptedCopyModel struct {
	calls   int
	prompts []string
	systems []string
}

func (m *scriptedCopyModel) Structured(_ context.Context, request platformai.Request, out any) (platformai.Usage, error) {
	m.calls++
	m.prompts, m.systems = append(m.prompts, request.Prompt), append(m.systems, request.System)
	posts := []map[string]string{}
	for _, line := range strings.Split(request.Prompt, "\n") {
		if id, ok := strings.CutPrefix(line, "- postId "); ok {
			posts = append(posts, map[string]string{"postId": strings.SplitN(id, ":", 2)[0], "copy": "Exports now finish faster. Try them today."})
		}
	}
	body, _ := json.Marshal(map[string]any{"posts": posts})
	return platformai.Usage{CostUSD: 0.042, InputTokens: 900, OutputTokens: 80}, json.Unmarshal(body, out)
}

// generationFixture runs release → campaign → generate_copy → review on v2.
func generationFixture(t *testing.T) (*automationFixture, *scriptedCopyModel, *recordingMonthlyMeter) {
	t.Helper()
	f := newAutomationFixture(t)
	f.graph.SchemaVersion = 2
	f.graph.Nodes = append(f.graph.Nodes, automation.Node{ID: "copy", Type: "action", Action: &automation.Action{Type: "generate_copy", Input: &automation.Reference{NodeID: "campaign", Output: "campaignId"}, CreditLimit: 25}})
	f.graph.Nodes[4].Action.Input.NodeID = "copy"
	f.graph.Edges[4].To = "copy"
	f.graph.Edges = append(f.graph.Edges, automation.Edge{From: "copy", To: "review", Branch: "next"})
	model, meter := &scriptedCopyModel{}, &recordingMonthlyMeter{}
	f.repo.WithAutomationModel(model).WithMonthlyMeter(meter)
	return f, model, meter
}

func (f *automationFixture) runUntil(t *testing.T, active *AutomationDefinition, delivery string, release int, nodes ...string) (string, error) {
	t.Helper()
	if _, err := f.repo.AcceptGitHubEvent(f.ctx, f.delivery(release, delivery)); err != nil {
		t.Fatal(err)
	}
	history, _ := f.repo.ListAutomationHistory(f.ctx, f.owner, AutomationHistoryFilter{})
	runID := history[0].Run.ID
	if _, err := f.repo.LoadReleaseAutomation(f.ctx, f.org, runID, 0); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.SelectReleaseAutomation(f.ctx, f.org, runID, *active.ActiveVersionID, 0); err != nil {
		t.Fatal(err)
	}
	for _, node := range nodes {
		if _, err := f.repo.AutomationNode(f.ctx, f.org, runID, node, nil, 0); err != nil {
			return runID, err
		}
	}
	return runID, nil
}

func TestAutomationGenerationNeedsCapableWorkerAndChargesOnce(t *testing.T) {
	f, model, meter := generationFixture(t)
	f.exec(t, `DELETE FROM release_automation_executor`)
	if err := f.repo.AdvertiseReleaseAutomationExecutor(f.ctx, "base-"+f.id); err != nil {
		t.Fatal(err)
	}
	draft, err := f.repo.SaveReleaseAutomation(f.ctx, f.owner, SaveAutomationInput{SourceAppID: f.source.ID, Name: "Generated", Priority: 1, Graph: f.graph, Layout: map[string]automation.Position{}})
	if err != nil || len(draft.Issues) > 0 {
		t.Fatalf("draft=%+v err=%v", draft, err)
	}
	if _, err := f.repo.ActivateReleaseAutomation(f.ctx, f.owner, draft.ID, draft.Revision); !errors.Is(err, publishing.ErrConflict) {
		t.Fatalf("activated without an AI-capable worker: %v", err)
	}
	overview, err := f.repo.ReleaseAutomationOverview(f.ctx, f.owner)
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range overview.Actions {
		if action.Type == "generate_copy" && (action.Available || !strings.Contains(action.Reason, "OPENROUTER_API_KEY")) {
			t.Fatalf("generation availability=%+v", action)
		}
	}
	if err := f.repo.AdvertiseReleaseAutomationExecutor(f.ctx, "ai-"+f.id, f.repo.AutomationCapabilities()...); err != nil {
		t.Fatal(err)
	}
	active, err := f.repo.ActivateReleaseAutomation(f.ctx, f.owner, draft.ID, draft.Revision)
	if err != nil {
		t.Fatal(err)
	}
	runID, err := f.runUntil(t, active, "generation", 21, "release", "campaign", "copy")
	if err != nil {
		t.Fatal(err)
	}
	// A lost acknowledgement re-runs the node: the stored output and the
	// charge flag are reused, so the model and the meter see it once.
	f.exec(t, `UPDATE release_automation_node SET status='running' WHERE "runId"=$1 AND "nodeId"='copy'`, runID)
	outputs, err := f.repo.AutomationNode(f.ctx, f.org, runID, "copy", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if model.calls != 1 || outputs.CreditsCharged != 5 {
		t.Fatalf("model calls=%d credits=%d", model.calls, outputs.CreditsCharged)
	}
	var charged int64
	for key, used := range meter.used {
		if strings.HasPrefix(key, QuotaAICredits+":"+f.org) {
			charged += used
		}
	}
	if charged != 5 {
		t.Fatalf("meter charged %d credits", charged)
	}
	post := f.db.Client.CampaignPost.Query().Where(campaignpost.OrganizationID(f.org), campaignpost.CampaignID(outputs.CampaignID)).OnlyX(f.ctx)
	if post.Copy != "Exports now finish faster. Try them today." || post.Status != campaignpost.StatusDRAFT {
		t.Fatalf("post=%q %s", post.Copy, post.Status)
	}
	if !strings.Contains(model.prompts[0], "<source trust=\"untrusted\">") || strings.Contains(model.systems[0], "Faster exports.") {
		t.Fatal("untrusted release notes left their fence")
	}
	if _, err := f.repo.AutomationNode(f.ctx, f.org, runID, "review", nil, 0); err != nil {
		t.Fatal(err)
	}
	run := f.db.Client.ReleaseAutomationRun.GetX(f.ctx, runID)
	if run.Outputs.CreditsCharged != 5 || f.db.Client.CampaignPost.GetX(f.ctx, post.ID).Status != campaignpost.StatusREADY_FOR_REVIEW {
		t.Fatalf("run outputs=%+v", run.Outputs)
	}
}

func TestAutomationGenerationRefusesWithoutCredits(t *testing.T) {
	f, model, meter := generationFixture(t)
	if err := f.repo.AdvertiseReleaseAutomationExecutor(f.ctx, "ai-"+f.id, f.repo.AutomationCapabilities()...); err != nil {
		t.Fatal(err)
	}
	active := f.activate(t)
	// The pro allowance is spent and no credit pack was bought.
	meter.used = map[string]int64{monthlyMeterKey(QuotaAICredits, f.org, time.Now()): int64(planQuotas["pro"][QuotaAICredits]) - 10}
	runID, err := f.runUntil(t, active, "no-credits", 22, "release", "campaign", "copy")
	if !errors.Is(err, ErrQuotaExceeded) || !PermanentAutomationError(err) || model.calls != 0 {
		t.Fatalf("err=%v calls=%d", err, model.calls)
	}
	node := f.db.Client.ReleaseAutomationNode.Query().Where(releaseautomationnode.RunID(runID), releaseautomationnode.NodeID("copy")).OnlyX(f.ctx)
	if node.Status != "failed" || node.FailureCode != "insufficient_credits" || node.Charged {
		t.Fatalf("node=%+v", node)
	}
}

func TestAutomationHistoryFiltersVersionsAndNotificationsStayInTenant(t *testing.T) {
	f := newAutomationFixture(t)
	first := f.activate(t)
	firstRun, err := f.runUntil(t, first, "filter-1", 31)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := f.repo.SaveReleaseAutomation(f.ctx, f.owner, SaveAutomationInput{ID: first.ID, SourceAppID: f.source.ID, Name: "Release v2", Priority: 10, ExpectedRevision: first.Revision, Graph: f.graph, Layout: map[string]automation.Position{}})
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.repo.ActivateReleaseAutomation(f.ctx, f.owner, saved.ID, saved.Revision)
	if err != nil {
		t.Fatal(err)
	}
	secondRun, err := f.runUntil(t, second, "filter-2", 32)
	if err != nil {
		t.Fatal(err)
	}
	versions, err := f.repo.ListReleaseAutomationVersions(f.ctx, f.owner, first.ID)
	if err != nil || len(versions) != 2 || versions[0].ID != *second.ActiveVersionID || versions[0].Revision <= versions[1].Revision {
		t.Fatalf("versions=%+v err=%v", versions, err)
	}
	for name, test := range map[string]struct {
		filter AutomationHistoryFilter
		want   []string
	}{
		"first version":  {AutomationHistoryFilter{VersionID: *first.ActiveVersionID}, []string{firstRun}},
		"definition":     {AutomationHistoryFilter{DefinitionID: first.ID}, []string{secondRun, firstRun}},
		"family":         {AutomationHistoryFilter{Family: automation.Published, SourceAppID: f.source.ID}, []string{secondRun, firstRun}},
		"other family":   {AutomationHistoryFilter{Family: automation.Merged}, nil},
		"other source":   {AutomationHistoryFilter{SourceAppID: "missing"}, nil},
		"status":         {AutomationHistoryFilter{Status: "running"}, []string{secondRun, firstRun}},
		"before cursor":  {AutomationHistoryFilter{Before: secondRun}, []string{firstRun}},
		"future window":  {AutomationHistoryFilter{Since: new(time.Now().Add(time.Hour))}, nil},
	} {
		t.Run(name, func(t *testing.T) {
			items, err := f.repo.ListAutomationHistory(f.ctx, f.owner, test.filter)
			if err != nil {
				t.Fatal(err)
			}
			got := []string{}
			for _, item := range items {
				got = append(got, item.Run.ID)
			}
			if strings.Join(got, ",") != strings.Join(test.want, ",") {
				t.Fatalf("got %v want %v", got, test.want)
			}
		})
	}
	items, _ := f.repo.ListAutomationHistory(f.ctx, f.owner, AutomationHistoryFilter{VersionID: *second.ActiveVersionID})
	if len(items) != 1 || items[0].Run.VersionRevision == nil || *items[0].Run.VersionRevision != versions[0].Revision {
		t.Fatalf("run version revision missing: %+v", items)
	}
	if _, err := f.repo.ListAutomationHistory(f.ctx, f.owner, AutomationHistoryFilter{Status: "approved"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown status accepted: %v", err)
	}

	other := newTestWorkspace(t)
	if _, err := f.repo.ListReleaseAutomationVersions(f.ctx, other.owner, first.ID); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("foreign versions exposed: %v", err)
	}
	if foreign, err := f.repo.ListAutomationHistory(f.ctx, other.owner, AutomationHistoryFilter{DefinitionID: first.ID}); err != nil || len(foreign) != 0 {
		t.Fatalf("foreign runs exposed: %+v %v", foreign, err)
	}

	if err := f.repo.FinishReleaseAutomation(f.ctx, f.org, firstRun, "succeeded", "", "Done.", 0); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.FinishReleaseAutomation(f.ctx, f.org, secondRun, "needs_attention", "missing", "Evidence missing.", 0); err != nil {
		t.Fatal(err)
	}
	for kind, runID := range map[string]string{"activity.workflow.completed": firstRun, "activity.workflow.needs_attention": secondRun} {
		events := f.db.Client.OutboxEvent.Query().Where(outboxevent.OrganizationID(f.org), outboxevent.Type(kind)).AllX(f.ctx)
		if len(events) != 1 || events[0].AggregateID != runID || events[0].AggregateType != "release_automation_run" {
			t.Fatalf("%s events=%+v", kind, events)
		}
	}
	overview, err := f.repo.ReleaseAutomationOverview(f.ctx, f.owner)
	if err != nil {
		t.Fatal(err)
	}
	if overview.RunCounts["succeeded"] != 1 || overview.RunCounts["needs_attention"] != 1 || overview.Definitions[0].RecentRuns != 2 ||
		overview.Definitions[0].LastRun == nil || overview.Definitions[0].LastRun.ID != secondRun {
		t.Fatalf("counts=%+v definition=%+v", overview.RunCounts, overview.Definitions[0])
	}
	if n := f.db.Client.ReleaseAutomationRun.Query().Where(releaseautomationrun.OrganizationID(f.org)).CountX(f.ctx); n != 2 {
		t.Fatalf("runs=%d", n)
	}
}

func TestAutomationSourceBranchFiltersMergedPullRequests(t *testing.T) {
	f := newAutomationFixture(t)
	f.graph.Family = automation.Merged
	f.graph.Qualification = automation.Condition{Field: "pr.number", Operator: "exists"}
	f.graph.Nodes[1].Condition = &automation.Condition{Field: "pr.bot", Operator: "is_false"}
	f.activate(t)
	member := f.actor("owner")
	member.Kind = "api_key"
	if err := f.repo.SetReleaseAutomationMode(f.ctx, member, f.source.ID, true, nil, new("release")); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("API key configured a source: %v", err)
	}
	if err := f.repo.SetReleaseAutomationMode(f.ctx, f.owner, f.source.ID, true, nil, new("bad..name")); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid branch accepted: %v", err)
	}
	if err := f.repo.SetReleaseAutomationMode(f.ctx, f.owner, f.source.ID, true, nil, new("release")); err != nil {
		t.Fatal(err)
	}
	merged := func(number int, base string) AcceptGitHubEventInput {
		body, _ := json.Marshal(map[string]any{"action": "closed", "installation": map[string]any{"id": f.installation}, "repository": map[string]any{"id": 1001, "full_name": "acme/app", "default_branch": "main"},
			"pull_request": map[string]any{"id": 5000 + number, "number": number, "title": "Branch change", "merged": true, "merged_at": "2026-10-19T10:00:00Z", "base": map[string]any{"ref": base}, "user": map[string]any{"login": "dev", "type": "User"}, "labels": []any{}}})
		return AcceptGitHubEventInput{DeliveryID: base, EventName: "pull_request", Body: body}
	}
	for _, base := range []string{"main", "release"} {
		if _, err := f.repo.AcceptGitHubEvent(f.ctx, merged(len(base), base)); err != nil {
			t.Fatal(err)
		}
	}
	history, _ := f.repo.ListAutomationHistory(f.ctx, f.owner, AutomationHistoryFilter{Family: automation.Merged})
	statuses := map[string]string{}
	for _, item := range history {
		statuses[item.Event.Snapshot.Fields["pr.base"].Values[0]] = item.Run.Status
	}
	if statuses["main"] != "skipped" || statuses["release"] != "queued" {
		t.Fatalf("branch filter statuses=%v", statuses)
	}
	overview, _ := f.repo.ReleaseAutomationOverview(f.ctx, f.owner)
	if overview.Sources[0].Branch != "release" {
		t.Fatalf("branch not reported: %+v", overview.Sources[0])
	}
}
