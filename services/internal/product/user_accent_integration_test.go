package product

import (
	"errors"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

func TestPersonalAccentPersistsWithoutChangingAnotherMember(t *testing.T) {
	w := newTestWorkspace(t)
	w.addMember(t, "viewer", "viewer")
	before, err := w.repo.GetUserPreferences(w.ctx, w.owner)
	if err != nil || before.AccentColor != "" {
		t.Fatal("default palette", before, err)
	}
	color := "#A13BD4"
	saved, err := w.repo.UpdateUserPreferences(w.ctx, w.owner, UserPreferencesUpdate{AccentColor: &color, BaseVersion: &before.Version})
	if err != nil || saved.AccentColor != "#a13bd4" {
		t.Fatal("save accent", saved, err)
	}
	loaded, err := w.repo.GetUserPreferences(w.ctx, w.owner)
	if err != nil || loaded.AccentColor != saved.AccentColor {
		t.Fatal("reload", loaded, err)
	}
	other, err := w.repo.GetUserPreferences(w.ctx, w.actor("viewer"))
	if err != nil || other.AccentColor != "" {
		t.Fatal("another member changed", other, err)
	}
	for _, color := range []string{"red", "#fff", "#fffffff", "url(https://example.test)", "#123456;display:none"} {
		if _, err := w.repo.UpdateUserPreferences(w.ctx, w.owner, UserPreferencesUpdate{AccentColor: &color}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("accepted %q: %v", color, err)
		}
	}
	if _, err := w.repo.UpdateUserPreferences(w.ctx, w.owner, UserPreferencesUpdate{AccentColor: &color, BaseVersion: &before.Version}); !errors.Is(err, publishing.ErrConflict) {
		t.Fatal("stale save", err)
	}
	empty := ""
	reset, err := w.repo.UpdateUserPreferences(w.ctx, w.owner, UserPreferencesUpdate{AccentColor: &empty})
	if err != nil || reset.AccentColor != "" {
		t.Fatal("reset", reset, err)
	}
}
