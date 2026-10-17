// Package tenantpublishing calls the social provider adapters from the tenant
// Temporal worker. The canonical scheduled_post is the only local post state.
package tenantpublishing

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	productent "github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/integration"
	socialdatabase "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations/social"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

type BindingLookup interface {
	Binding(context.Context, string) (*productent.PostizTenantBinding, error)
}

type IntegrationLookup interface {
	FindIntegration(context.Context, string, string, string) (*socialent.Integration, error)
}

type MediaSigner interface {
	SignDelivery(context.Context, string, string) (string, error)
}

type poster interface {
	Post(context.Context, string, string, []integrations.PostDetails, *socialent.Integration) ([]integrations.PostResponse, error)
}

type Publisher struct {
	bindings     BindingLookup
	integrations IntegrationLookup
	signer       MediaSigner
	resolve      func(string) poster
	now          func() time.Time
}

func New(bindings BindingLookup, socialClient *socialent.Client, signer MediaSigner) *Publisher {
	manager := social.NewManager()
	return &Publisher{
		bindings: bindings, integrations: EntIntegrationLookup{Client: socialClient},
		signer: signer, resolve: func(platform string) poster { return manager.GetSocialIntegration(platform) }, now: time.Now,
	}
}

// OpenShared reads social integrations from the same DSN as canonical product
// data. The caller owns the returned close function.
func OpenShared(ctx context.Context, databaseURL string, bindings BindingLookup, signer MediaSigner) (*Publisher, func() error, error) {
	db, err := socialdatabase.Open(ctx, databaseURL)
	if err != nil {
		return nil, nil, err
	}
	return New(bindings, db.Client, signer), db.Close, nil
}

type EntIntegrationLookup struct{ Client *socialent.Client }

func (r EntIntegrationLookup) FindIntegration(ctx context.Context, orgID, destinationID, platform string) (*socialent.Integration, error) {
	item, err := r.Client.Integration.Query().Where(
		integration.ID(destinationID), integration.OrganizationID(orgID),
		integration.ProviderIdentifier(platform), integration.DeletedAtIsNil(),
	).Only(ctx)
	if socialent.IsNotFound(err) {
		return nil, postiz.NewError(http.StatusNotFound, false, "social destination was not found")
	}
	return item, err
}

// PublishesSynchronously tells the Temporal activity that Publish returns the
// real provider receipt, so it must complete the canonical attempt directly.
func (*Publisher) PublishesSynchronously() bool { return true }

func (p *Publisher) Publish(ctx context.Context, input postiz.PublishInput) (string, error) {
	if p.bindings == nil || p.integrations == nil || p.signer == nil || p.resolve == nil {
		return "", postiz.NewError(http.StatusServiceUnavailable, false, "direct publisher is not configured")
	}
	if input.OrganizationID == "" || input.DestinationID == "" || input.Platform == "" || input.PostID == "" {
		return "", postiz.NewError(http.StatusBadRequest, false, "incomplete publication request")
	}
	binding, err := p.bindings.Binding(ctx, input.OrganizationID)
	if err != nil {
		return "", postiz.NewError(http.StatusConflict, false, "workspace has no social connection binding")
	}
	if binding.SecretReference != input.SecretReference {
		return "", postiz.NewError(http.StatusForbidden, false, "social credential does not belong to workspace")
	}
	account, err := p.integrations.FindIntegration(ctx, binding.GoOrganizationID, input.DestinationID, input.Platform)
	if err != nil {
		return "", err
	}
	if account.Disabled || account.RefreshNeeded || account.Token == "" ||
		account.TokenExpiration != nil && !account.TokenExpiration.After(p.currentTime()) {
		return "", postiz.NewError(http.StatusConflict, false, "social credentials have expired or been disabled")
	}
	provider := p.resolve(input.Platform)
	if provider == nil || !directPlatformAllowed(input.Platform) {
		return "", postiz.NewError(http.StatusBadRequest, false, "social provider is unsupported")
	}
	providerSettings := input.ProviderSettings
	if providerSettings == nil {
		providerSettings = map[string]any{}
	}
	settings, err := json.Marshal(providerSettings)
	if err != nil {
		return "", postiz.NewError(http.StatusBadRequest, false, "invalid provider settings")
	}
	// A content draft post without an image publishes as text (RFC 037).
	var media []integrations.MediaContent
	if input.AssetObjectKey != "" {
		path, err := p.signer.SignDelivery(ctx, input.OrganizationID, input.AssetObjectKey)
		if err != nil {
			return "", postiz.NewError(http.StatusServiceUnavailable, false, "private asset could not be signed")
		}
		mediaType := "image"
		if strings.HasPrefix(input.AssetMediaType, "video/") {
			mediaType = "video"
		}
		media = []integrations.MediaContent{{Type: mediaType, Path: path}}
	}
	response, err := provider.Post(ctx, account.InternalID, account.Token, []integrations.PostDetails{{
		ID: input.PostID, Message: input.Caption, Settings: settings, Media: media,
	}}, account)
	if err != nil {
		if temporalx.FailureType(err) == temporalx.TypeRefreshToken || temporalx.FailureType(err) == temporalx.TypeDisconnect {
			return "", postiz.NewError(http.StatusConflict, false, "social credentials must be reconnected")
		}
		// The provider may have accepted the post before the call failed. A
		// reconciliation step must inspect the remote account before retrying.
		return "", postiz.NewError(http.StatusBadGateway, true, "social publication outcome is unknown")
	}
	if len(response) != 1 || response[0].PostID == "" ||
		response[0].Status != "posted" && response[0].Status != "success" {
		return "", postiz.NewError(http.StatusBadGateway, true, "provider returned no confirmed post receipt")
	}
	return response[0].PostID, nil
}

func (p *Publisher) Status(context.Context, postiz.StatusInput) (postiz.StatusResult, error) {
	return postiz.StatusResult{}, postiz.NewError(http.StatusConflict, false, "direct provider receipts do not require local status polling")
}

func (p *Publisher) currentTime() time.Time {
	if p.now != nil {
		return p.now().UTC()
	}
	return time.Now().UTC()
}
