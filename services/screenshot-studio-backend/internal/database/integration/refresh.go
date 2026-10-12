package integration

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
)

// RefreshIntegrationService is integrations/refresh.integration.service.ts.
type RefreshIntegrationService struct {
	manager  *integrations.Manager
	service  *Service
	temporal client.Client
}

func NewRefreshIntegrationService(manager *integrations.Manager, service *Service, temporal client.Client) *RefreshIntegrationService {
	return &RefreshIntegrationService{manager: manager, service: service, temporal: temporal}
}

// Refresh returns nil (TypeScript's false) when the token could not be
// refreshed; the channel is then flagged and the user notified.
func (r *RefreshIntegrationService) Refresh(ctx context.Context, integration *ent.Integration, cause string) (*integrations.AuthTokenDetails, error) {
	provider := r.manager.GetSocialIntegration(integration.ProviderIdentifier)
	if provider == nil {
		return nil, fmt.Errorf("unknown provider %s", integration.ProviderIdentifier)
	}

	refresh, err := r.refreshProcess(ctx, integration, provider, cause)
	if err != nil || refresh == nil {
		return nil, err
	}

	picture := ""
	if integration.Picture != nil {
		picture = *integration.Picture
	}
	var expiresIn *int64
	if refresh.ExpiresIn != 0 {
		expiresIn = &refresh.ExpiresIn
	}
	if _, err := r.service.CreateOrUpdateIntegration(ctx, CreateOrUpdateIntegrationParams{
		OneTimeToken: provider.Info().OneTimeToken,
		Org:          integration.OrganizationID,
		Name:         integration.Name,
		Picture:      picture,
		Type:         "social",
		InternalID:   integration.InternalID,
		Provider:     integration.ProviderIdentifier,
		Token:        refresh.AccessToken,
		RefreshToken: refresh.RefreshToken,
		ExpiresIn:    expiresIn,
	}); err != nil {
		return nil, err
	}

	return refresh, nil
}

func (r *RefreshIntegrationService) SetBetweenSteps(ctx context.Context, integration *ent.Integration, cause string) error {
	if _, err := r.service.SetBetweenRefreshSteps(ctx, integration.ID); err != nil {
		return err
	}
	return r.service.InformAboutRefreshError(ctx, integration.OrganizationID, integration, cause)
}

// StartRefreshWorkflow starts refreshTokenWorkflow for providers with
// refreshCron; it returns nil when the provider has none or Temporal is not
// connected.
func (r *RefreshIntegrationService) StartRefreshWorkflow(ctx context.Context, orgID, id string, provider integrations.Provider) (client.WorkflowRun, error) {
	if !provider.Info().RefreshCron || r.temporal == nil {
		return nil, nil
	}
	return r.temporal.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                       "refresh_" + id,
		TaskQueue:                temporalx.MainQueue,
		WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_TERMINATE_EXISTING,
	}, "refreshTokenWorkflow", map[string]string{"integrationId": id, "organizationId": orgID})
}

func (r *RefreshIntegrationService) refreshProcess(ctx context.Context, integration *ent.Integration, provider integrations.Provider, cause string) (*integrations.AuthTokenDetails, error) {
	refreshToken := ""
	if integration.RefreshToken != nil {
		refreshToken = *integration.RefreshToken
	}
	refresh, refreshError := provider.RefreshToken(ctx, refreshToken)

	if refreshError != nil || refresh == nil || refresh.AccessToken == "" {
		if refreshError != nil {
			slog.Error(fmt.Sprintf("Could not refresh %s integration %s", integration.ProviderIdentifier, integration.ID), "error", refreshError)
		}

		// informAboutRefreshError (with the failure cause) already notifies
		// the user, and refreshNeeded sets the same flag disconnectChannel
		// would — calling disconnectChannel here sent a second, cause-less
		// copy of the same email for every failed refresh.
		if _, err := r.service.RefreshNeeded(ctx, integration.OrganizationID, integration.ID); err != nil {
			return nil, err
		}

		message := ""
		if m, ok := provider.(integrations.RefreshErrorMessager); ok {
			message = m.RefreshErrorMessage(refreshError)
		}
		if message == "" {
			message = cause
		}
		return nil, r.service.InformAboutRefreshError(ctx, integration.OrganizationID, integration, message)
	}

	reconnector, ok := provider.(integrations.Reconnector)
	root := ""
	if integration.RootInternalID != nil {
		root = *integration.RootInternalID
	}
	if !ok || (integration.RootInternalID != nil && root == integration.InternalID) {
		return refresh, nil
	}

	reConnect, err := reconnector.ReConnect(ctx, root, integration.InternalID, refresh.AccessToken)
	if err != nil {
		slog.Error(fmt.Sprintf("Could not reconnect %s integration %s after a successful token refresh", integration.ProviderIdentifier, integration.ID), "error", err)
		return nil, err
	}

	return mergeAuth(*refresh, reConnect), nil
}

// mergeAuth is `{...refresh, ...reConnect}`: what reConnect sets wins.
func mergeAuth(out integrations.AuthTokenDetails, over *integrations.AuthTokenDetails) *integrations.AuthTokenDetails {
	if over == nil {
		return &out
	}
	if over.ID != "" {
		out.ID = over.ID
	}
	if over.Name != "" {
		out.Name = over.Name
	}
	if over.Error != "" {
		out.Error = over.Error
	}
	if over.AccessToken != "" {
		out.AccessToken = over.AccessToken
	}
	if over.RefreshToken != "" {
		out.RefreshToken = over.RefreshToken
	}
	if over.ExpiresIn != 0 {
		out.ExpiresIn = over.ExpiresIn
	}
	if over.Picture != "" {
		out.Picture = over.Picture
	}
	if over.Username != "" {
		out.Username = over.Username
	}
	if over.AdditionalSettings != nil {
		out.AdditionalSettings = over.AdditionalSettings
	}
	return &out
}
