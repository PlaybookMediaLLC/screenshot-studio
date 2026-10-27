//go:build e2e

package notifications

import (
	"net/url"
	"os"
)

// Provider fixtures are compiled only into E2E binaries and must be local.
func configureTestProviders(s *Service) {
	value := os.Getenv("NOTIFICATIONS_E2E_PROVIDER_URL")
	if value == "" {
		return
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil || u.RawQuery != "" || u.Path != "" {
		panic("notification E2E provider must be a loopback HTTP origin")
	}
	s.SlackBase, s.EmailBase = value, value
}
