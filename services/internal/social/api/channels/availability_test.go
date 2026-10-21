package channels

import (
	"context"
	"net/http"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/redis"
)

func TestLegacyStartCannotBypassProviderAvailability(t *testing.T) {
	t.Setenv("PLATFORM_SOCIAL_ENCRYPTION_KEY", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=")
	t.Setenv("X_API_KEY", "")
	t.Setenv("X_API_SECRET", "")
	store := redis.NewMemory()
	provider := &fakeProvider{Base: integrations.NewBase("x", nil), id: "x"}
	h := &integrationsController{manager: integrations.NewManager([]integrations.Provider{provider}), store: store}
	router := httpx.NewRouter()
	router.Group("/integrations", asOrg(&ent.Organization{ID: "org"})).Get("/social/:integration", h.getIntegrationURL)
	if status, _ := do(t, router, http.MethodGet, "/integrations/social/x", ""); status != 503 {
		t.Fatalf("legacy start status %d", status)
	}
	if _, exists, _ := store.Get(context.Background(), "login:state1"); exists {
		t.Fatal("unconfigured legacy start persisted state")
	}
}
