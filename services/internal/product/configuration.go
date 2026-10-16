package product

import (
	"context"
	"net/http"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/brandkit"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/brandprofile"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/productsurface"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/sourceapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/authstore"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

type Actor struct {
	OrganizationID string
	UserID         string
	SessionID      string
	RequestID      string
	// Kind is session (the default), api_key, support, webhook, or service.
	Kind    string
	KeyID   string
	GrantID string
	Display string
}

// IsSession reports whether a signed-in user, rather than a credential or a
// service, is acting.
func (a Actor) IsSession() bool { return a.Kind == "" || a.Kind == "session" }

func (a Actor) auditActor() publishing.Actor {
	actor := publishing.Actor{Display: a.Display, Organization: a.OrganizationID, RequestID: a.RequestID, Type: "SERVICE"}
	switch a.Kind {
	case "", "session":
		actor.Type, actor.UserID = "USER", a.UserID
	case "support":
		actor.Type, actor.UserID = "SUPPORT", a.UserID
	case "webhook":
		actor.Type = "WEBHOOK"
	}
	return actor
}

type Configuration struct {
	client      *ent.Client
	authStore   *authstore.Store
	auth        *publishing.Repository
	invitations InvitationMailer
	objects     AssetObjectStore
	quota       QuotaCounter
	meter       MonthlyMeter
	github      GitHubApp
	capture     Capturer
	// imageHost admits the hosts screenshots may be downloaded from; GitHub's by default.
	imageHost func(string) bool
	// web replaces the HTTP client for image downloads and readiness probes in tests.
	web *http.Client
}

func NewConfiguration(client *ent.Client) *Configuration {
	return &Configuration{client: client, auth: publishing.NewRepository(client), invitations: EnvInvitationMailer{}}
}

func (c *Configuration) WithInvitationMailer(mailer InvitationMailer) *Configuration {
	c.invitations = mailer
	return c
}

// WithAuthStore enables the Better Auth adapter endpoint.
func (c *Configuration) WithAuthStore(store *authstore.Store) *Configuration {
	c.authStore = store
	return c
}

func (c *Configuration) ExecuteAuthStore(ctx context.Context, request authstore.Request) (*authstore.Result, error) {
	if c.authStore == nil {
		return nil, ErrStorageUnavailable
	}
	return c.authStore.Execute(ctx, request)
}

func (c *Configuration) WithObjectStore(objects AssetObjectStore) *Configuration {
	c.objects = objects
	return c
}

func (c *Configuration) Authorize(ctx context.Context, actor Actor) error {
	return c.authorizeRoles(ctx, actor, "owner", "admin")
}

func (c *Configuration) AuthorizeRead(ctx context.Context, actor Actor) error {
	return c.authorizeRoles(ctx, actor, "owner", "admin", "creator", "approver", "publisher", "viewer", "member")
}

// authorizeRoles checks the actor against the workspace on every operation.
// A session must hold one of the roles. An API key, support grant, or service
// caller carries no role: the web facade enforced its scope, and the backend
// rechecks that the credential is still live for this workspace.
func (c *Configuration) authorizeRoles(ctx context.Context, actor Actor, roles ...string) error {
	switch actor.Kind {
	case "", "session":
		return c.auth.AuthorizeRole(ctx, actor.OrganizationID, actor.UserID, actor.SessionID, roles...)
	case "api_key":
		return c.auth.AuthorizeAPIKey(ctx, actor.OrganizationID, actor.KeyID)
	case "support":
		return c.auth.AuthorizeSupportGrant(ctx, actor.OrganizationID, actor.UserID, actor.GrantID)
	case "webhook", "service":
		return c.auth.AuthorizeWorkspace(ctx, actor.OrganizationID)
	}
	return publishing.ErrUnauthorized
}

type CreateBrandKitInput struct {
	Name       string         `json:"name"`
	Definition map[string]any `json:"definition"`
	Publish    bool           `json:"publish"`
}

func (c *Configuration) ListBrandKits(ctx context.Context, organizationID string) ([]*ent.BrandKit, error) {
	return c.client.BrandKit.Query().Where(brandkit.OrganizationID(organizationID)).
		Order(ent.Asc(brandkit.FieldName), ent.Desc(brandkit.FieldVersion)).All(ctx)
}

func (c *Configuration) CreateBrandKit(ctx context.Context, actor Actor, input CreateBrandKitInput) (*ent.BrandKit, error) {
	for attempt := 0; attempt < 3; attempt++ {
		tx, err := c.client.Tx(ctx)
		if err != nil {
			return nil, err
		}
		current, err := tx.BrandKit.Query().Where(
			brandkit.OrganizationID(actor.OrganizationID), brandkit.Name(input.Name),
		).Order(ent.Desc(brandkit.FieldVersion)).First(ctx)
		if err != nil && !ent.IsNotFound(err) {
			_ = tx.Rollback()
			return nil, err
		}
		version := 1
		if current != nil {
			version = current.Version + 1
		}
		status := brandkit.StatusDRAFT
		if input.Publish {
			status = brandkit.StatusACTIVE
		}
		created, err := tx.BrandKit.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
			SetName(input.Name).SetVersion(version).SetDefinition(input.Definition).SetStatus(status).Save(ctx)
		if ent.IsConstraintError(err) {
			_ = tx.Rollback()
			continue
		}
		if err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		if err := appendConfigurationAudit(ctx, tx, actor, "product.brand_kit_created", "brand_kit", created.ID); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return created.Unwrap(), nil
	}
	return nil, publishing.ErrConflict
}

func (c *Configuration) GetBrandProfile(ctx context.Context, organizationID string) (*ent.BrandProfile, error) {
	profile, err := c.client.BrandProfile.Query().Where(brandprofile.OrganizationID(organizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return profile, err
}

type UpsertBrandProfileInput struct {
	Audience           string            `json:"audience"`
	CtaConventions     *string           `json:"ctaConventions"`
	PreferredStyles    []string          `json:"preferredStyles"`
	ProductDescription string            `json:"productDescription"`
	ProhibitedTerms    []string          `json:"prohibitedTerms"`
	SocialHandles      map[string]string `json:"socialHandles"`
	Tagline            *string           `json:"tagline"`
	Tone               string            `json:"tone"`
}

func (c *Configuration) UpsertBrandProfile(ctx context.Context, actor Actor, input UpsertBrandProfileInput) (*ent.BrandProfile, error) {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	current, err := tx.BrandProfile.Query().Where(brandprofile.OrganizationID(actor.OrganizationID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	var profile *ent.BrandProfile
	if current == nil {
		profile, err = tx.BrandProfile.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
			SetAudience(input.Audience).SetProductDescription(input.ProductDescription).SetTone(input.Tone).
			SetNillableTagline(input.Tagline).SetNillableCtaConventions(input.CtaConventions).
			SetPreferredStyles(input.PreferredStyles).SetProhibitedTerms(input.ProhibitedTerms).
			SetSocialHandles(input.SocialHandles).Save(ctx)
	} else {
		update := tx.BrandProfile.UpdateOneID(current.ID).SetAudience(input.Audience).
			SetProductDescription(input.ProductDescription).SetTone(input.Tone).
			SetPreferredStyles(input.PreferredStyles).SetProhibitedTerms(input.ProhibitedTerms).
			SetSocialHandles(input.SocialHandles)
		if input.Tagline == nil {
			update.ClearTagline()
		} else {
			update.SetTagline(*input.Tagline)
		}
		if input.CtaConventions == nil {
			update.ClearCtaConventions()
		} else {
			update.SetCtaConventions(*input.CtaConventions)
		}
		profile, err = update.Save(ctx)
	}
	if ent.IsConstraintError(err) {
		return nil, publishing.ErrConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.brand_profile_updated", "brand_profile", profile.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return profile.Unwrap(), nil
}

type CreateSourceAppInput struct {
	AllowedHosts []string `json:"allowedHosts"`
	Branch       *string  `json:"branch"`
	ExternalID   *string  `json:"externalId"`
	// GitHubConnectionID is the workspace's link to the GitHub App installation
	// that delivers this repository's events; ExternalID is the repository ID.
	GitHubConnectionID        *string  `json:"githubConnectionId"`
	IgnoreBotPullRequests     *bool    `json:"ignoreBotPullRequests"`
	IgnoredPullRequestAuthors []string `json:"ignoredPullRequestAuthors"`
	Name                      string   `json:"name"`
	Provider                  string   `json:"provider"`
	SecretReference           *string  `json:"secretReference"`
	SkipPrereleases           *bool    `json:"skipPrereleases"`
}

// UpdateSourceAppInput changes the rules that decide which deliveries become
// releases. A nil field is left unchanged; ClearBranch returns the source to
// following the repository's default branch.
type UpdateSourceAppInput struct {
	Branch                    *string
	ClearBranch               bool
	IgnoreBotPullRequests     *bool
	IgnoredPullRequestAuthors *[]string
	SkipPrereleases           *bool
}

func (c *Configuration) CreateSourceApp(ctx context.Context, actor Actor, input CreateSourceAppInput) (*ent.SourceApp, error) {
	var installationRowID *string
	if input.GitHubConnectionID != nil {
		// The App's own secret signs its deliveries; a connected source names none.
		if input.Provider != "github" || input.ExternalID == nil || input.SecretReference != nil {
			return nil, ErrInvalidInput
		}
		row, err := c.linkedInstallation(ctx, actor.OrganizationID, *input.GitHubConnectionID)
		if err != nil {
			return nil, err
		}
		if err := c.checkGitHubSource(ctx, actor.OrganizationID, row.ID, *input.ExternalID); err != nil {
			return nil, err
		}
		installationRowID = &row.ID
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	created, err := tx.SourceApp.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).SetNillableGithubInstallationID(installationRowID).
		SetName(input.Name).SetProvider(input.Provider).SetNillableExternalID(input.ExternalID).
		SetNillableSecretReference(input.SecretReference).SetAllowedHosts(input.AllowedHosts).
		SetNillableBranch(input.Branch).SetNillableIgnoreBotPullRequests(input.IgnoreBotPullRequests).
		SetIgnoredPullRequestAuthors(nonNilStrings(input.IgnoredPullRequestAuthors)).
		SetNillableSkipPrereleases(input.SkipPrereleases).SetStatus("ACTIVE").Save(ctx)
	if ent.IsConstraintError(err) {
		return nil, publishing.ErrConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.source_app_created", "source_app", created.ID); err != nil {
		return nil, err
	}
	// A connected repository is backfilled with its recent releases and merges.
	if installationRowID != nil {
		if _, err := tx.OutboxEvent.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
			SetType("source_app.connected").SetAggregateType("source_app").SetAggregateID(created.ID).
			SetPayload(map[string]any{"sourceAppId": created.ID}).SetIdempotencyKey("connected:" + created.ID).Save(ctx); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return created.Unwrap(), nil
}

// UpdateSourceApp changes a workspace source's webhook rules.
func (c *Configuration) UpdateSourceApp(ctx context.Context, actor Actor, sourceAppID string, input UpdateSourceAppInput) (*ent.SourceApp, error) {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	current, err := tx.SourceApp.Query().Where(sourceapp.ID(sourceAppID), sourceapp.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	update := tx.SourceApp.UpdateOneID(current.ID)
	if input.ClearBranch {
		update.ClearBranch()
	} else if input.Branch != nil {
		update.SetBranch(*input.Branch)
	}
	if input.IgnoreBotPullRequests != nil {
		update.SetIgnoreBotPullRequests(*input.IgnoreBotPullRequests)
	}
	if input.IgnoredPullRequestAuthors != nil {
		update.SetIgnoredPullRequestAuthors(nonNilStrings(*input.IgnoredPullRequestAuthors))
	}
	if input.SkipPrereleases != nil {
		update.SetSkipPrereleases(*input.SkipPrereleases)
	}
	changed, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.source_app_updated", "source_app", changed.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return changed.Unwrap(), nil
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

type CreateProductSurfaceInput struct {
	Description        *string  `json:"description"`
	Environment        string   `json:"environment"`
	FeatureTags        []string `json:"featureTags"`
	Name               string   `json:"name"`
	ScreenshotAssetIDs []string `json:"screenshotAssetIds"`
	URL                string   `json:"url"`
}

type UpdateProductSurfaceInput struct {
	Description        *string   `json:"description"`
	Environment        *string   `json:"environment"`
	FeatureTags        *[]string `json:"featureTags"`
	Name               *string   `json:"name"`
	ScreenshotAssetIDs *[]string `json:"screenshotAssetIds"`
	URL                *string   `json:"url"`
}

func (c *Configuration) ListProductSurfaces(ctx context.Context, organizationID string) ([]*ent.ProductSurface, error) {
	return c.client.ProductSurface.Query().Where(productsurface.OrganizationID(organizationID)).
		Order(ent.Asc(productsurface.FieldName)).All(ctx)
}

func (c *Configuration) CreateProductSurface(ctx context.Context, actor Actor, input CreateProductSurfaceInput) (*ent.ProductSurface, error) {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	created, err := tx.ProductSurface.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
		SetName(input.Name).SetURL(input.URL).SetEnvironment(input.Environment).
		SetNillableDescription(input.Description).SetFeatureTags(input.FeatureTags).
		SetScreenshotAssetIds(input.ScreenshotAssetIDs).Save(ctx)
	if ent.IsConstraintError(err) {
		return nil, publishing.ErrConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.surface_created", "product_surface", created.ID,
		map[string]any{"environment": created.Environment}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return created.Unwrap(), nil
}

func (c *Configuration) UpdateProductSurface(ctx context.Context, actor Actor, surfaceID string, input UpdateProductSurfaceInput) (*ent.ProductSurface, error) {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	current, err := tx.ProductSurface.Query().Where(productsurface.ID(surfaceID), productsurface.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	update := tx.ProductSurface.UpdateOneID(current.ID)
	if input.Description != nil {
		update.SetDescription(*input.Description)
	}
	if input.Environment != nil {
		update.SetEnvironment(*input.Environment)
	}
	if input.FeatureTags != nil {
		update.SetFeatureTags(*input.FeatureTags)
	}
	if input.Name != nil {
		update.SetName(*input.Name)
	}
	if input.ScreenshotAssetIDs != nil {
		update.SetScreenshotAssetIds(*input.ScreenshotAssetIDs)
	}
	if input.URL != nil {
		update.SetURL(*input.URL)
	}
	changed, err := update.Save(ctx)
	if ent.IsConstraintError(err) {
		return nil, publishing.ErrConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.surface_updated", "product_surface", changed.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return changed.Unwrap(), nil
}

func (c *Configuration) DeleteProductSurface(ctx context.Context, actor Actor, surfaceID string) error {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	deleted, err := tx.ProductSurface.Delete().Where(productsurface.ID(surfaceID), productsurface.OrganizationID(actor.OrganizationID)).Exec(ctx)
	if err != nil {
		return err
	}
	if deleted == 0 {
		return publishing.ErrNotFound
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.surface_deleted", "product_surface", surfaceID); err != nil {
		return err
	}
	return tx.Commit()
}

func appendConfigurationAudit(ctx context.Context, tx *ent.Tx, actor Actor, action, entityType, entityID string, metadata ...map[string]any) error {
	data := map[string]any{}
	if len(metadata) > 0 {
		data = metadata[0]
	}
	return publishing.AppendAudit(ctx, tx, publishing.AuditInput{
		Action:   action,
		Actor:    actor.auditActor(),
		EntityID: entityID, EntityType: entityType, Organization: actor.OrganizationID,
		Outcome:  auditlog.OutcomeSUCCEEDED,
		Metadata: data,
	})
}

func TrimOptional(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
