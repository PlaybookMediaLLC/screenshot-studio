package main

import (
	"strings"
	"testing"
)

func TestPublishingEnvKeepsTenantCredentialsSeparate(t *testing.T) {
	environ := []string{
		"DATABASE_URL=postiz-database",
		"TEMPORAL_NAMESPACE=postiz-namespace",
		"TENANT_DATABASE_URL=tenant-database",
		"TENANT_TEMPORAL_ADDRESS=tenant-temporal:7233",
		"TENANT_TEMPORAL_NAMESPACE=tenant-namespace",
		"TENANT_AUDIT_RETENTION_DATABASE_URL=retention-database",
		"TENANT_RUN_MAINTENANCE=true",
		"TENANT_RUN_CRON=true",
		"TENANT_PUBLISHING_SERVICE_TOKEN=private-token",
		"TENANT_PORT=9999",
	}
	result, err := publishingEnv(environ)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"DATABASE_URL=tenant-database", "TEMPORAL_NAMESPACE=tenant-namespace", "AUDIT_RETENTION_DATABASE_URL=retention-database", "PORT=8081"} {
		if !hasEntry(result, expected) {
			t.Errorf("missing %s", strings.SplitN(expected, "=", 2)[0])
		}
	}
	for _, forbidden := range []string{"DATABASE_URL=postiz-database", "TEMPORAL_NAMESPACE=postiz-namespace", "PORT=9999"} {
		if hasEntry(result, forbidden) {
			t.Errorf("unexpected %s", forbidden)
		}
	}
	if !hasEntry(withPort(result, "8082"), "PORT=8082") {
		t.Fatal("publishing API port is missing")
	}
}

func TestPublishingEnvRequiresMaintenance(t *testing.T) {
	base := []string{
		"TENANT_DATABASE_URL=tenant-database", "TENANT_TEMPORAL_ADDRESS=tenant-temporal:7233",
		"TENANT_TEMPORAL_NAMESPACE=tenant-namespace", "TENANT_AUDIT_RETENTION_DATABASE_URL=retention-database",
		"TENANT_RUN_CRON=true", "TENANT_RUN_MAINTENANCE=false",
		"TENANT_PUBLISHING_SERVICE_TOKEN=private-token",
	}
	if _, err := publishingEnv(base); err == nil || !strings.Contains(err.Error(), "TENANT_RUN_MAINTENANCE=true") {
		t.Fatalf("expected maintenance configuration failure, got %v", err)
	}
}

func TestDirectPublisherRequiresOneLogicalDatabase(t *testing.T) {
	base := []string{
		"DATABASE_URL=postgresql://social:one@db:5432/screenshot_studio",
		"TENANT_DATABASE_URL=postgresql://tenant:two@db/screenshot_studio",
		"TENANT_TEMPORAL_ADDRESS=temporal:7233", "TENANT_TEMPORAL_NAMESPACE=tenant",
		"TENANT_AUDIT_RETENTION_DATABASE_URL=retention",
		"TENANT_RUN_CRON=true", "TENANT_RUN_MAINTENANCE=true",
		"TENANT_PUBLISHING_SERVICE_TOKEN=private-token",
		"TENANT_PUBLISHING_DIRECT_PROVIDER=true",
	}
	if _, err := publishingEnv(base); err != nil {
		t.Fatalf("different database roles on one database must be accepted: %v", err)
	}
	base[1] = "TENANT_DATABASE_URL=postgresql://tenant:two@db:5432/another_database"
	if _, err := publishingEnv(base); err == nil || !strings.Contains(err.Error(), "one PostgreSQL database") {
		t.Fatalf("different database accepted: %v", err)
	}
}

func hasEntry(entries []string, value string) bool {
	for _, entry := range entries {
		if entry == value {
			return true
		}
	}
	return false
}
