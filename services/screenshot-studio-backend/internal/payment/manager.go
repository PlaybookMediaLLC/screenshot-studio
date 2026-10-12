package payment

import (
	"fmt"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// NamedProvider is {name, provider}.
type NamedProvider struct {
	Name     string
	Provider Provider
}

// ProviderManager is PaymentProviderManager. Registration order replaces the
// @PaymentProvider decorator metadata order.
type ProviderManager struct {
	providers []NamedProvider
}

func NewProviderManager() *ProviderManager { return &ProviderManager{} }

// Register is the @PaymentProvider({provider: name}) decorator.
func (m *ProviderManager) Register(name string, p Provider) {
	m.providers = append(m.providers, NamedProvider{Name: name, Provider: p})
}

func (m *ProviderManager) GetProvider(provider string) (Provider, error) {
	for _, p := range m.providers {
		if p.Name == provider {
			return p.Provider, nil
		}
	}
	return nil, httpx.HTTPException(fmt.Sprintf("Payment provider %s not found", provider), 400)
}

func (m *ProviderManager) GetProviders() []NamedProvider { return m.providers }

// GetDefaultProvider returns the first registered provider of a platform: the
// one new subscriptions use.
func (m *ProviderManager) GetDefaultProvider(platform Platform) (NamedProvider, error) {
	for _, p := range m.providers {
		if p.Provider.Platform() == platform {
			return p, nil
		}
	}
	return NamedProvider{}, fmt.Errorf("No payment provider registered for %s", platform)
}
