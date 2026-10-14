//go:build !e2e

package social

import "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"

func e2eProviders() []integrations.Provider { return nil }
