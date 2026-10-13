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
}

func TestPublishingEnvRequiresMaintenance(t *testing.T) {
	base := []string{
		"TENANT_DATABASE_URL=tenant-database", "TENANT_TEMPORAL_ADDRESS=tenant-temporal:7233",
		"TENANT_TEMPORAL_NAMESPACE=tenant-namespace", "TENANT_AUDIT_RETENTION_DATABASE_URL=retention-database",
		"TENANT_RUN_CRON=true", "TENANT_RUN_MAINTENANCE=false",
	}
	if _, err := publishingEnv(base); err == nil || !strings.Contains(err.Error(), "TENANT_RUN_MAINTENANCE=true") {
		t.Fatalf("expected maintenance configuration failure, got %v", err)
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
