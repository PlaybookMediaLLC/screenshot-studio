package product

import (
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/userpreference"
	"testing"
)

func TestNavigationPreferenceDefaultsAndExistingValues(t *testing.T) {
	if got := userPreferencesRecord(nil).Navigation; got != "expanded" {
		t.Fatalf("new user navigation = %q", got)
	}
	for _, value := range []userpreference.Navigation{userpreference.NavigationCompact, userpreference.NavigationDynamic, userpreference.NavigationExpanded} {
		got := userPreferencesRecord(&ent.UserPreference{Navigation: value, Version: 2})
		if got.Navigation != string(value) || got.Version != 2 {
			t.Fatalf("stored preference changed: %+v", got)
		}
	}
}
