//go:build e2e

package social

import (
	"os"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations/social/e2eprovider"
)

func e2eProviders() []integrations.Provider {
	if endpoint := os.Getenv("POSTIZ_E2E_SOCIAL_URL"); endpoint != "" {
		return []integrations.Provider{e2eprovider.New(endpoint)}
	}
	return nil
}
