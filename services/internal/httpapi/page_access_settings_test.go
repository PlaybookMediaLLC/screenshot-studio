package httpapi

import (
	"context"
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"net/http/httptest"
	"testing"
)

type pageSettingsFixture struct {
	ConfigurationStore
	snapshot *product.PageAccessSnapshot
}

func (f pageSettingsFixture) PageAccess(context.Context, product.Actor) (*product.PageAccessSnapshot, error) {
	return f.snapshot, nil
}
func TestPageAccessPreservesDisabledAIAndWorkspacePreferences(t *testing.T) {
	snapshot := &product.PageAccessSnapshot{Count: 1, Features: map[string]bool{"drafts": true}, Workspace: &product.Workspace{ID: "workspace", Name: "Workspace", WorkspaceSettings: &ent.WorkspaceSettings{ID: "workspace", AiAgentEnabled: false, TimeZone: "Europe/Paris", Locale: "fr", DefaultPublishTime: "15:30"}}}
	for _, hasWorkspace := range []bool{true, false} {
		if !hasWorkspace {
			snapshot.Workspace = nil
		}
		s := &Server{configuration: pageSettingsFixture{snapshot: snapshot}}
		result := httptest.NewRecorder()
		s.pageAccess(result, httptest.NewRequest("GET", "/v1/page-access", nil))
		var body map[string]any
		if err := json.Unmarshal(result.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if !hasWorkspace {
			if body["workspace"] != nil {
				t.Fatal("missing workspace was fabricated")
			}
			continue
		}
		settings := body["workspace"].(map[string]any)["workspaceSettings"].(map[string]any)
		if value, exists := settings["aiAgentEnabled"]; !exists || value != false {
			t.Fatal("disabled AI lost", settings)
		}
		if settings["timeZone"] != "Europe/Paris" || settings["defaultPublishTime"] != "15:30" || settings["locale"] != "fr" {
			t.Fatal("settings lost", settings)
		}
		if _, exists := settings["ai_agent_enabled"]; exists {
			t.Fatal("Ent wire fields escaped")
		}
	}
}
