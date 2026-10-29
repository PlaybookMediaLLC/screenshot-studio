package product

import (
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/authstore"
)

// Only auth store writes that can take access away re-authorize live sessions.
func TestRevokesCollabAccess(t *testing.T) {
	for _, scenario := range []struct {
		model, op string
		want      bool
	}{
		{"session", "delete", true},
		{"session", "update", true},
		{"member", "deleteMany", true},
		{"member", "update", true},
		{"user", "update", true},
		{"organization", "delete", true},
		{"session", "create", false},
		{"member", "create", false},
		{"member", "findMany", false},
		{"account", "update", false},
		{"twoFactor", "delete", false},
	} {
		if got := revokesCollabAccess(authstore.Request{Model: scenario.model, Op: scenario.op}); got != scenario.want {
			t.Errorf("%s %s: %v, want %v", scenario.op, scenario.model, got, scenario.want)
		}
	}
}
