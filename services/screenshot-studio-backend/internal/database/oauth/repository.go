// Package oauth ports database/prisma/oauth: Postiz as an OAuth provider
// (static apps, dynamic client registration, authorization codes with PKCE,
// access tokens, revocation, and codes relayed to self-hosted instances).
package oauth

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/oauthapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/oauthauthorization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/oauthselfhostedauthorization"
)

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

type CreateAppData struct {
	Name         string
	Description  *string
	PictureID    *string
	RedirectURL  string
	ClientID     string
	ClientSecret string
}

type CreateDynamicAppData struct {
	Name                    string
	RedirectURL             string
	RedirectURIs            string
	ClientID                string
	ClientSecret            *string
	TokenEndpointAuthMethod string
}

// UpdateAppData: nil fields are left untouched.
type UpdateAppData struct {
	Name        *string
	Description *string
	PictureID   *string
	RedirectURL *string
}

type CreateAuthorizationData struct {
	OauthAppID          string
	UserID              string
	OrganizationID      string
	AuthorizationCode   string
	CodeExpiresAt       time.Time
	CodeChallenge       string
	CodeChallengeMethod string
	RedirectURI         string
}

// ExchangedToken is exchangeCodeForToken's select {organizationId,
// organization: {paymentId}}.
type ExchangedToken struct {
	OrganizationID string
	PaymentID      *string
}

func first[T any](row T, err error) (T, error) {
	if ent.IsNotFound(err) {
		var zero T
		return zero, nil
	}
	return row, err
}

// orNil maps `value || null`.
func orNil(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func (r *Repository) GetAppByOrgID(ctx context.Context, orgID string) (*ent.OAuthApp, error) {
	return first(r.client.OAuthApp.Query().
		Where(oauthapp.OrganizationID(orgID), oauthapp.DeletedAtIsNil()).WithPicture().First(ctx))
}

func (r *Repository) GetAppByClientID(ctx context.Context, clientID string) (*ent.OAuthApp, error) {
	return first(r.client.OAuthApp.Query().
		Where(oauthapp.ClientID(clientID), oauthapp.DeletedAtIsNil()).WithPicture().First(ctx))
}

func (r *Repository) CreateApp(ctx context.Context, orgID string, data CreateAppData) (*ent.OAuthApp, error) {
	row, err := r.client.OAuthApp.Create().
		SetOrganizationID(orgID).SetName(data.Name).SetNillableDescription(data.Description).
		SetNillablePictureID(data.PictureID).SetRedirectURL(data.RedirectURL).SetClientID(data.ClientID).
		SetClientSecret(data.ClientSecret).Save(ctx)
	if err != nil {
		return nil, err
	}
	return r.client.OAuthApp.Query().Where(oauthapp.ID(row.ID)).WithPicture().Only(ctx)
}

func (r *Repository) CreateDynamicApp(ctx context.Context, data CreateDynamicAppData) (*ent.OAuthApp, error) {
	return r.client.OAuthApp.Create().
		SetName(data.Name).SetRedirectURL(data.RedirectURL).SetRedirectUris(data.RedirectURIs).
		SetClientID(data.ClientID).SetNillableClientSecret(data.ClientSecret).
		SetTokenEndpointAuthMethod(data.TokenEndpointAuthMethod).SetDynamic(true).Save(ctx)
}

// DeleteStaleDynamicApps: dynamic clients register before the consent
// screen, so abandoned flows leave orphan rows; prune the ones no user ever
// authorized.
func (r *Repository) DeleteStaleDynamicApps(ctx context.Context, olderThan time.Time) (int, error) {
	return r.client.OAuthApp.Delete().Where(
		oauthapp.Dynamic(true),
		oauthapp.CreatedAtLT(olderThan),
		oauthapp.Not(oauthapp.HasAuthorizations()),
		oauthapp.Not(oauthapp.HasSelfHostedAuthorizations()),
	).Exec(ctx)
}

// UpdateApp returns nil when the org has no app.
func (r *Repository) UpdateApp(ctx context.Context, orgID string, data UpdateAppData) (*ent.OAuthApp, error) {
	app, err := r.GetAppByOrgID(ctx, orgID)
	if err != nil || app == nil {
		return nil, err
	}
	update := r.client.OAuthApp.UpdateOneID(app.ID)
	if data.Name != nil {
		update.SetName(*data.Name)
	}
	if data.Description != nil {
		update.SetDescription(*data.Description)
	}
	if data.PictureID != nil {
		update.SetPictureID(*data.PictureID)
	}
	if data.RedirectURL != nil {
		update.SetRedirectURL(*data.RedirectURL)
	}
	if _, err := update.Save(ctx); err != nil {
		return nil, err
	}
	return r.client.OAuthApp.Query().Where(oauthapp.ID(app.ID)).WithPicture().Only(ctx)
}

// DeleteApp soft deletes the org's app; nil when it has none.
func (r *Repository) DeleteApp(ctx context.Context, orgID string) (*ent.OAuthApp, error) {
	app, err := r.GetAppByOrgID(ctx, orgID)
	if err != nil || app == nil {
		return nil, err
	}
	return r.client.OAuthApp.UpdateOneID(app.ID).SetDeletedAt(time.Now()).Save(ctx)
}

// UpdateClientSecret returns nil when the org has no app.
func (r *Repository) UpdateClientSecret(ctx context.Context, orgID, newSecret string) (*ent.OAuthApp, error) {
	app, err := r.GetAppByOrgID(ctx, orgID)
	if err != nil || app == nil {
		return nil, err
	}
	return r.client.OAuthApp.UpdateOneID(app.ID).SetClientSecret(newSecret).Save(ctx)
}

// CreateAuthorization upserts the (app, user, org) authorization with a new
// code; re-authorizing clears the previous token and revocation.
func (r *Repository) CreateAuthorization(ctx context.Context, data CreateAuthorizationData) error {
	challenge, method, redirect := orNil(data.CodeChallenge), orNil(data.CodeChallengeMethod), orNil(data.RedirectURI)
	return r.client.OAuthAuthorization.Create().
		SetOauthAppID(data.OauthAppID).SetUserID(data.UserID).SetOrganizationID(data.OrganizationID).
		SetAuthorizationCode(data.AuthorizationCode).SetCodeExpiresAt(data.CodeExpiresAt).
		SetNillableCodeChallenge(challenge).SetNillableCodeChallengeMethod(method).SetNillableRedirectURI(redirect).
		OnConflictColumns(oauthauthorization.FieldOauthAppID, oauthauthorization.FieldUserID, oauthauthorization.FieldOrganizationID).
		Update(func(u *ent.OAuthAuthorizationUpsert) {
			u.SetAuthorizationCode(data.AuthorizationCode).SetCodeExpiresAt(data.CodeExpiresAt)
			setOrClear(challenge, u.SetCodeChallenge, u.ClearCodeChallenge)
			setOrClear(method, u.SetCodeChallengeMethod, u.ClearCodeChallengeMethod)
			setOrClear(redirect, u.SetRedirectURI, u.ClearRedirectURI)
			u.ClearAccessToken().ClearRevokedAt().UpdateUpdatedAt()
		}).
		Exec(ctx)
}

func setOrClear[T any](v *string, set func(string) T, clear func() T) {
	if v == nil {
		clear()
		return
	}
	set(*v)
}

func (r *Repository) FindByCode(ctx context.Context, encryptedCode string) (*ent.OAuthAuthorization, error) {
	return first(r.client.OAuthAuthorization.Query().
		Where(oauthauthorization.AuthorizationCode(encryptedCode), oauthauthorization.RevokedAtIsNil()).First(ctx))
}

func (r *Repository) ExchangeCodeForToken(ctx context.Context, id, encryptedToken string) (*ExchangedToken, error) {
	row, err := r.client.OAuthAuthorization.UpdateOneID(id).
		SetAccessToken(encryptedToken).
		ClearAuthorizationCode().ClearCodeExpiresAt().ClearCodeChallenge().ClearCodeChallengeMethod().ClearRedirectURI().
		Save(ctx)
	if err != nil {
		return nil, err
	}
	org, err := row.QueryOrganization().Only(ctx)
	if err != nil {
		return nil, err
	}
	return &ExchangedToken{OrganizationID: row.OrganizationID, PaymentID: org.PaymentID}, nil
}

// FindByAccessToken loads the authorization with its app, its organization
// (and subscription) and its user, for the public API auth middleware.
func (r *Repository) FindByAccessToken(ctx context.Context, encryptedToken string) (*ent.OAuthAuthorization, error) {
	return first(r.client.OAuthAuthorization.Query().
		Where(oauthauthorization.AccessToken(encryptedToken), oauthauthorization.RevokedAtIsNil()).
		WithOauthApp().
		WithOrganization(func(q *ent.OrganizationQuery) { q.WithSubscription() }).
		WithUser().
		First(ctx))
}

func (r *Repository) GetApprovedApps(ctx context.Context, userID string) ([]*ent.OAuthAuthorization, error) {
	return r.client.OAuthAuthorization.Query().
		Where(oauthauthorization.UserID(userID), oauthauthorization.RevokedAtIsNil(), oauthauthorization.AccessTokenNotNil()).
		WithOauthApp(func(q *ent.OAuthAppQuery) { q.WithPicture() }).
		Order(ent.Desc(oauthauthorization.FieldCreatedAt)).
		All(ctx)
}

// RevokeAuthorization fails when the authorization is not the user's, like
// Prisma's update.
func (r *Repository) RevokeAuthorization(ctx context.Context, userID, authID string) (*ent.OAuthAuthorization, error) {
	return r.client.OAuthAuthorization.UpdateOneID(authID).Where(oauthauthorization.UserID(userID)).
		SetRevokedAt(time.Now()).Save(ctx)
}

func (r *Repository) RevokeAllForApp(ctx context.Context, oauthAppID string) (int, error) {
	if _, err := r.client.OAuthSelfHostedAuthorization.Update().
		Where(oauthselfhostedauthorization.OauthAppID(oauthAppID), oauthselfhostedauthorization.RevokedAtIsNil()).
		SetRevokedAt(time.Now()).Save(ctx); err != nil {
		return 0, err
	}
	return r.client.OAuthAuthorization.Update().
		Where(oauthauthorization.OauthAppID(oauthAppID), oauthauthorization.RevokedAtIsNil()).
		SetRevokedAt(time.Now()).Save(ctx)
}
