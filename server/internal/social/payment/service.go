package payment

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// Service is PaymentService.
type Service struct {
	manager       *ProviderManager
	subscriptions SubscriptionService
}

func NewService(manager *ProviderManager, subscriptions SubscriptionService) *Service {
	return &Service{manager: manager, subscriptions: subscriptions}
}

func (s *Service) Webhook(ctx context.Context, provider string, rawBody []byte, headers http.Header) (any, error) {
	p, err := s.manager.GetProvider(provider)
	if err != nil {
		return nil, err
	}
	event, err := p.ValidateWebhook(ctx, rawBody, headers)
	if err != nil {
		return nil, err
	}
	return p.ProcessWebhook(ctx, event)
}

func (s *Service) SyncSubscription(ctx context.Context, provider, organizationID string) (*SyncResult, error) {
	p, err := s.manager.GetProvider(provider)
	if err != nil {
		return nil, err
	}
	return p.SyncSubscription(ctx, organizationID)
}

func (s *Service) GetDefaultProvider(platform Platform) (Provider, error) {
	p, err := s.manager.GetDefaultProvider(platform)
	return p.Provider, err
}

func (s *Service) GetDefaultProviderName(platform Platform) (string, error) {
	p, err := s.manager.GetDefaultProvider(platform)
	return p.Name, err
}

// GetSubscription returns the subscription row + the platform (web / mobile)
// of the provider that owns it, so clients can tell the user where to manage
// the subscription. nil when there is no subscription.
func (s *Service) GetSubscription(ctx context.Context, organizationID string) (json.RawMessage, error) {
	subscription, err := s.subscriptions.GetSubscriptionByOrganizationID(ctx, organizationID)
	if err != nil || subscription == nil {
		return nil, err
	}
	row, err := json.Marshal(subscription)
	if err != nil {
		return nil, err
	}

	// A dangling provider name (provider removed from the build) must not
	// break reading the subscription
	p, err := s.manager.GetProvider(subscription.Provider)
	if err != nil {
		return row, nil
	}
	platform, _ := json.Marshal(p.Platform())
	row = bytes.TrimSuffix(bytes.TrimSpace(row), []byte("}"))
	return append(append(append(row, `,"platform":`...), platform...), '}'), nil
}

func managedOn(platform Platform) error {
	return httpx.HTTPException(fmt.Sprintf("Your subscription is managed on %s, please use %s to manage it", platform, platform), 400)
}

// GetProviderForOrganization returns the provider that handles billing
// actions for this organization on the given platform: the one owning the
// current subscription, otherwise the platform default. Fails when the
// subscription lives on another platform.
func (s *Service) GetProviderForOrganization(ctx context.Context, organizationID string, platform Platform) (Provider, error) {
	subscription, err := s.subscriptions.GetSubscriptionByOrganizationID(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	if subscription == nil {
		return s.GetDefaultProvider(platform)
	}

	current, err := s.manager.GetProvider(subscription.Provider)
	if err != nil {
		return nil, err
	}
	if current.Platform() != platform {
		return nil, managedOn(current.Platform())
	}
	return current, nil
}

// AssertCanUseProvider: an organization subscribed through one provider
// cannot checkout, sync or manage the subscription through another one.
func (s *Service) AssertCanUseProvider(ctx context.Context, organizationID, provider string) error {
	subscription, err := s.subscriptions.GetSubscriptionByOrganizationID(ctx, organizationID)
	if err != nil {
		return err
	}
	if subscription == nil || subscription.Provider == provider {
		return nil
	}

	current, err := s.manager.GetProvider(subscription.Provider)
	if err != nil {
		return err
	}
	requested, err := s.manager.GetProvider(provider)
	if err != nil {
		return err
	}
	if current.Platform() != requested.Platform() {
		return managedOn(current.Platform())
	}
	return httpx.HTTPException("Your subscription is managed by "+subscription.Provider, 400)
}

// CancelAllSubscriptions (account deletion): the provider owning the org's
// subscription, or - when there is no row (missed webhook, cleaned up) -
// every provider, so nothing keeps charging a deleted account. Providers
// no-op when they own nothing.
func (s *Service) CancelAllSubscriptions(ctx context.Context, organizationID string) error {
	subscription, err := s.subscriptions.GetSubscriptionByOrganizationID(ctx, organizationID)
	if err != nil {
		return err
	}
	if subscription != nil {
		p, err := s.manager.GetProvider(subscription.Provider)
		if err != nil {
			return err
		}
		return p.CancelAllSubscriptions(ctx, organizationID)
	}

	for _, p := range s.manager.GetProviders() {
		if err := p.Provider.CancelAllSubscriptions(ctx, organizationID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) SyncCustomerEmailsAfterSwitch(ctx context.Context, accounts []Account) error {
	for _, p := range s.manager.GetProviders() {
		if err := p.Provider.SyncCustomerEmailsAfterSwitch(ctx, accounts); err != nil {
			return err
		}
	}
	return nil
}
