package product

import (
	"time"

	automation "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
)

// AutomationHistorySummary carries only the evidence used by run lists.
type AutomationHistorySummary struct {
	Event AutomationEventSummary `json:"event"`
	Run   AutomationRun          `json:"run"`
}

type AutomationEventSummary struct {
	ID          string                    `json:"id"`
	SourceAppID string                    `json:"sourceAppId"`
	ReceivedAt  time.Time                 `json:"receivedAt"`
	Snapshot    AutomationSnapshotSummary `json:"snapshot"`
}

type AutomationSnapshotSummary struct {
	Family         automation.Family           `json:"family"`
	RepositoryName string                      `json:"repositoryName"`
	ObjectID       string                      `json:"objectId"`
	Number         int                         `json:"number,omitempty"`
	Title          string                      `json:"title"`
	Fields         map[string]automation.Value `json:"fields"`
}

// SummarizeAutomationRun excludes notes, enrichment, and unrelated event fields.
func SummarizeAutomationRun(item AutomationHistoryItem) AutomationHistorySummary {
	snapshot := item.Event.Snapshot
	fields := map[string]automation.Value{}
	for _, key := range []string{"release.tag", "tag.name", "deployment.environment"} {
		if value, ok := snapshot.Fields[key]; ok {
			fields[key] = value
		}
	}
	return AutomationHistorySummary{
		Event: AutomationEventSummary{ID: item.Event.ID, SourceAppID: item.Event.SourceAppID, ReceivedAt: item.Event.ReceivedAt,
			Snapshot: AutomationSnapshotSummary{Family: snapshot.Family, RepositoryName: snapshot.RepositoryName, ObjectID: snapshot.ObjectID, Number: snapshot.Number, Title: snapshot.Title, Fields: fields}},
		Run: item.Run,
	}
}
