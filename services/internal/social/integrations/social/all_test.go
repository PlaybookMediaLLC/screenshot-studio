package social

import "testing"

// Every provider must report a unique identifier and the registry must match
// Postiz's 35 providers.
func TestRegistry(t *testing.T) {
	seen := map[string]bool{}
	for _, p := range All() {
		id := p.Info().Identifier
		if id == "" || seen[id] {
			t.Fatalf("bad or duplicate identifier %q", id)
		}
		seen[id] = true
		if p.Info().Name == "" || p.Info().Editor == "" {
			t.Errorf("%s: missing name or editor", id)
		}
	}
	if len(seen) != 35 {
		t.Fatalf("got %d providers, want 35", len(seen))
	}
	if NewManager().GetSocialIntegration("linkedin-page") == nil {
		t.Fatal("linkedin-page not found")
	}
}
