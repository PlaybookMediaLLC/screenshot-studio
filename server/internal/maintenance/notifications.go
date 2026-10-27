package maintenance

import (
	"context"
	"os"
)

// Notifications runs by default, unless legacy senders are explicitly enabled.
func (s *Store) Notifications(ctx context.Context) (int, error) {
	if os.Getenv("PLATFORM_ACTIVITY_LEGACY_PAUSED") == "false" || s.Activity == nil {
		return 0, nil
	}
	if err := s.Activity.Process(ctx); err != nil {
		return 0, err
	}
	return 0, s.Activity.Maintain(ctx)
}
