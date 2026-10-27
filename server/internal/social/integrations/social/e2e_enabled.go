//go:build e2e

package social

import (
	"os"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/e2eprovider"
)

func e2eProviders() []integrations.Provider {
	if endpoint := os.Getenv("SOCIAL_E2E_URL"); endpoint != "" {
		return []integrations.Provider{e2eprovider.New(endpoint)}
	}
	return nil
}
