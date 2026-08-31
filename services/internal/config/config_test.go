package config

import "testing"

func TestLoadBackendRequiresServiceToken(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://example")
	t.Setenv("PUBLISHING_SERVICE_TOKEN", "")
	if _, err := LoadBackend(); err == nil {
		t.Fatal("expected missing PUBLISHING_SERVICE_TOKEN to fail")
	}
}

func TestLoadOrchestratorRejectsInvalidTemporalConcurrency(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://example")
	t.Setenv("STORAGE_API_URL", "http://storage")
	t.Setenv("STORAGE_BUCKET", "assets")
	t.Setenv("STORAGE_SERVICE_KEY", "service-key")
	t.Setenv("TEMPORAL_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTORS", "0")
	t.Setenv("POSTIZ_REQUEST_TIMEOUT", "15s")
	if _, err := LoadOrchestrator(); err == nil {
		t.Fatal("expected nonpositive Temporal activity concurrency to fail")
	}
}

func TestLoadBackendRejectsInvalidTemporalTLS(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://example")
	t.Setenv("PUBLISHING_SERVICE_TOKEN", "secret")
	t.Setenv("TEMPORAL_TLS", "sometimes")
	if _, err := LoadBackend(); err == nil {
		t.Fatal("expected invalid TEMPORAL_TLS to fail")
	}
}
