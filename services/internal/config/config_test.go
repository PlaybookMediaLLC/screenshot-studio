package config

import "testing"

func TestLoadBackendRequiresServiceToken(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://example")
	t.Setenv("PUBLISHING_SERVICE_TOKEN", "")
	if _, err := LoadBackend(); err == nil {
		t.Fatal("expected missing PUBLISHING_SERVICE_TOKEN to fail")
	}
}

func TestLoadOrchestratorRejectsNonpositiveDurations(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://example")
	t.Setenv("STORAGE_API_URL", "http://storage")
	t.Setenv("STORAGE_BUCKET", "assets")
	t.Setenv("STORAGE_SERVICE_KEY", "service-key")
	t.Setenv("PUBLISHING_BATCH_SIZE", "100")
	t.Setenv("PUBLISHING_MAX_ATTEMPTS", "3")
	t.Setenv("PUBLISHING_POLL_INTERVAL", "0s")
	t.Setenv("POSTIZ_REQUEST_TIMEOUT", "15s")
	t.Setenv("PUBLISHING_RETRY_DELAY", "2m")
	t.Setenv("PUBLISHING_STALE_AFTER", "10m")
	if _, err := LoadOrchestrator(); err == nil {
		t.Fatal("expected nonpositive polling interval to fail")
	}
}
