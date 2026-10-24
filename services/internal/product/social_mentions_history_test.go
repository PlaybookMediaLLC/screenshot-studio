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
