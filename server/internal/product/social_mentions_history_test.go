package product

import "testing"

func TestCompanyMentionsUsesOnlyNativeLinkedInOrganizationsAndDeduplicates(t *testing.T) {
	mention := func(id, label, channel, kind string) any {
		return map[string]any{"type": "social_mention", "providerId": id, "label": label, "platform": channel, "kind": kind}
	}
	bodies := [][]any{{map[string]any{"type": "p", "children": []any{mention("urn:li:organization:123", "Acme Labs", "linkedin", "organization"), mention("urn:li:organization:123", "Acme", "linkedin", "organization"), mention("urn:li:person:123", "Person", "linkedin", "person"), mention("urn:li:organization:456", "Wrong channel", "x", "organization")}}}}
	got := companyMentions(bodies, "labs")
	if len(got) != 1 || got[0].ProviderID != "urn:li:organization:123" {
		t.Fatalf("%+v", got)
	}
	if got := companyMentions(bodies, ""); len(got) != 1 {
		t.Fatalf("%+v", got)
	}
	if got := companyMentions(bodies, "absent"); len(got) != 0 {
		t.Fatalf("%+v", got)
	}
}

func TestPeopleMentionHistorySeparatesKindsAndRejectsGuessedIdentities(t *testing.T) {
	nodes := []any{}
	for _, entry := range []struct{ id, kind, platform string }{
		{"urn:li:person:abc_123", "person", "linkedin"},
		{"urn:li:person:abc_123", "person", "linkedin"},
		{"urn:li:organization:42", "organization", "linkedin"},
		{"urn:li:person:bad/path", "person", "linkedin"},
		{"urn:li:person:another", "organization", "linkedin"},
		{"urn:li:person:foreign", "person", "x"},
	} {
		nodes = append(nodes, map[string]any{"type": "social_mention", "providerId": entry.id, "label": "Anne", "platform": entry.platform, "kind": entry.kind})
	}
	found := storedMentions([][]any{nodes}, "ann", "person")
	if len(found) != 1 || found[0].ProviderID != "urn:li:person:abc_123" {
		t.Fatalf("people=%+v", found)
	}
}
