//go:build !e2e

package social

import "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"

func e2eProviders() []integrations.Provider { return nil }
