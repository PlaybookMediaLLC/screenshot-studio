package product

import (
	"encoding/json"
	"strings"
	"testing"

	automation "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
)

func TestAutomationHistorySummaryExcludesFullEvidence(t *testing.T) {
	item := AutomationHistoryItem{
		Event: AutomationEvent{Mode: "legacy", ID: "event", SourceAppID: "source", Snapshot: automation.Event{
			Family: automation.Published, Title: "Release", Notes: strings.Repeat("large release notes", 1000),
			Fields: map[string]automation.Value{"release.tag": automation.StringValue("v1.2"), "pr.files": automation.StringValue("private/file")},
		}, Enrichment: map[string]automation.Value{"pr.files": automation.StringValue("enrichment")}},
		Run: AutomationRun{ID: "run", Status: "succeeded", Outputs: automation.Outputs{CampaignID: "campaign"}},
	}
	summary := SummarizeAutomationRun(item)
	body, err := json.Marshal(summary)
	if err != nil {
		t.Fatal(err)
	}
	for _, excluded := range []string{"notes", "enrichment", "private/file", "pr.files"} {
		if strings.Contains(string(body), excluded) {
			t.Fatalf("summary includes %s", excluded)
		}
	}
	if summary.Event.Mode != "legacy" || summary.Run.ID != "run" || summary.Run.Outputs.CampaignID != "campaign" || summary.Event.Snapshot.Fields["release.tag"].Values[0] != "v1.2" {
		t.Fatalf("lost list evidence: %+v", summary)
	}
	if item.Event.Snapshot.Notes == "" || len(item.Event.Snapshot.Fields) != 2 {
		t.Fatal("summary mutated full detail")
	}
	if len(body) > 1500 {
		t.Fatalf("summary unexpectedly large: %d", len(body))
	}
}
