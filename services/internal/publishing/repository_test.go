package publishing

import (
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/publicationattempt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
)

func TestSecretReferenceValidation(t *testing.T) {
	t.Parallel()
	tests := map[string]bool{
		"POSTIZ_API_KEY":             true,
		"POSTIZ_API_KEY_CUSTOMER_12": true,
		"POSTIZ_OAUTH_TOKEN":         true,
		"POSTIZ_OAUTH_TOKEN_TEAM":    true,
		"POSTIZ_API_KEY_":            false,
		"POSTIZ_api_key":             false,
		"DATABASE_URL":               false,
		"POSTIZ_OTHER":               false,
	}
	for value, expected := range tests {
		if actual := IsSecretReference(value); actual != expected {
			t.Fatalf("IsSecretReference(%q) = %v, want %v", value, actual, expected)
		}
	}
}

func TestEntMappingsMatchPrismaTables(t *testing.T) {
	t.Parallel()
	if channelconnection.Table != "channel_connection" || scheduledpost.Table != "scheduled_post" || publicationattempt.Table != "publication_attempt" {
		t.Fatalf("publishing Ent tables do not match Prisma mappings")
	}
	if channelconnection.FieldOrganizationID != "organizationId" || scheduledpost.FieldScheduledFor != "scheduledFor" || publicationattempt.FieldProviderPostID != "providerPostId" {
		t.Fatalf("publishing Ent columns do not match Prisma storage keys")
	}
}

func TestProviderFailureCode(t *testing.T) {
	t.Parallel()
	if got := ProviderFailureCode(429, false); got != "429" {
		t.Fatalf("got %q", got)
	}
	if got := ProviderFailureCode(0, true); got != "UNKNOWN_DELIVERY" {
		t.Fatalf("got %q", got)
	}
}
