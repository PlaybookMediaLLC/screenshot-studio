// Package auth ports apps/backend/src/services/auth: the auth middlewares,
// guards, permissions, throttling, the AuthService and the login providers.
package auth

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/getsentry/sentry-go"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// UsersService is the part of users.Service auth uses.
type UsersService interface {
	GetUserByID(ctx context.Context, id string) (*ent.User, error)
	GetUserByEmail(ctx context.Context, email string) (*ent.User, error)
	GetUserByProvider(ctx context.Context, providerID string, provider user.ProviderName) (*ent.User, error)
	ActivateUser(ctx context.Context, id string) (*ent.User, error)
	UpdatePassword(ctx context.Context, id, password string) (*ent.User, error)
}

// CreateOrgAndUserBody is what organizationService.createOrgAndUser reads
// (Omit<CreateOrgUserDto, 'providerToken'> & { providerId }).
type CreateOrgAndUserBody struct {
	Company           string
	Email             string
	Password          string
	Provider          user.ProviderName
	ProviderID        string
	DatafastVisitorID string
}

// OrganizationService is the part of organizations.Service auth uses.
type OrganizationService interface {
	GetCount(ctx context.Context) (int, error)
	// CreateOrgAndUser returns the organization with Edges.Users[0].Edges.User.
	CreateOrgAndUser(ctx context.Context, body CreateOrgAndUserBody, ip, userAgent string) (*ent.Organization, error)
	// AddUserToOrg returns nil when Postiz returns false.
	AddUserToOrg(ctx context.Context, userID, id, orgID string, role userorganization.Role) (*ent.UserOrganization, error)
	// GetUserOrg returns the membership with Edges.User and Edges.Organization
	// (its Edges.Users and Edges.Subscription loaded).
	GetUserOrg(ctx context.Context, id string) (*ent.UserOrganization, error)
	// GetOrgsByUserID returns orgs with Edges.Users holding only this user's membership.
	GetOrgsByUserID(ctx context.Context, userID string) ([]*ent.Organization, error)
	UpdateAPIKey(ctx context.Context, orgID string) (*ent.Organization, error)
	GetOrgByAPIKey(ctx context.Context, apiKey string) (*ent.Organization, error)
	CanUseSuperAdminAPI(ctx context.Context, orgID string) (bool, error)
	GetOrgByIDWithSubscription(ctx context.Context, id string) (*ent.Organization, error)
}

// OAuthService is the part of oauth.Service auth uses.
type OAuthService interface {
	// GetOrgByOAuthToken returns the authorization with Edges.Organization
	// (and its Edges.Subscription) loaded, or nil.
	GetOrgByOAuthToken(ctx context.Context, token string) (*ent.OAuthAuthorization, error)
}

// UploadTicket is media.getUploadTicket's { org, sessionId }.
type UploadTicket struct {
	Org       string `json:"org"`
	SessionID string `json:"sessionId"`
}

// MediaService is the part of media.Service auth uses.
type MediaService interface {
	GetUploadTicket(ctx context.Context, ticket string) (*UploadTicket, error)
}

// ClippingTicket is clipping.getWidgetTicket's { org, id }.
type ClippingTicket struct {
	Org string `json:"org"`
	ID  string `json:"id"`
}

// ClippingService is the part of clipping.Service auth uses.
type ClippingService interface {
	GetWidgetTicket(ctx context.Context, ticket string) (*ClippingTicket, error)
}

// header-or-cookie lookups keep Postiz's precedence per value.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// AuthMiddleware authenticates the app routes from the auth cookie/header.
// Every failure answers like HttpForbiddenException (cookie cleared, 401).
func AuthMiddleware(orgs OrganizationService, users UsersService) httpx.Middleware {
	return func(c *httpx.Ctx) error {
		auth := firstNonEmpty(c.Header("auth"), c.Cookie("auth"))
		if auth == "" {
			return HTTPForbiddenException()
		}
		if err := authenticate(c, auth, orgs, users); err != nil {
			return HTTPForbiddenException()
		}
		return nil
	}
}

func authenticate(c *httpx.Ctx, auth string, orgs OrganizationService, users UsersService) error {
	ctx := c.R.Context()
	// Verify the JWT signature only. Never trust authorization-relevant
	// claims (id, isSuperAdmin, activated) from the token body — always
	// re-resolve the user from the database using the id.
	payload, err := helpers.VerifyJWT(auth)
	if err != nil {
		return err
	}
	orgHeader := firstNonEmpty(c.Cookie("showorg"), c.Header("showorg"))

	id, _ := payload["id"].(string)
	if id == "" {
		return errForbidden
	}
	u, err := users.GetUserByID(ctx, id)
	if err != nil {
		return err
	}
	if u == nil || !u.Activated {
		return errForbidden
	}

	impersonate := firstNonEmpty(c.Cookie("impersonate"), c.Header("impersonate"))
	if u.IsSuperAdmin && impersonate != "" {
		loaded, err := orgs.GetUserOrg(ctx, impersonate)
		if err != nil {
			return err
		}
		if loaded != nil && loaded.Edges.User != nil && loaded.Edges.Organization != nil {
			u = loaded.Edges.User
			u.IsSuperAdmin = true
			u.Password = nil
			org := loaded.Edges.Organization
			members := []*ent.UserOrganization{}
			for _, m := range org.Edges.Users {
				if m.UserID == u.ID {
					members = append(members, m)
				}
			}
			org.Edges.Users = members
			c.User = u
			c.Org = org
			setSentryUserContext(c, u.ID, u.Email, org)
			return nil
		}
	}

	u.Password = nil
	all, err := orgs.GetOrgsByUserID(ctx, u.ID)
	if err != nil {
		return err
	}
	var organizations []*ent.Organization
	for _, o := range all {
		if len(o.Edges.Users) > 0 && !o.Edges.Users[0].Disabled {
			organizations = append(organizations, o)
		}
	}
	if len(organizations) == 0 {
		return errForbidden
	}
	setOrg := organizations[0]
	for _, o := range organizations {
		if o.ID == orgHeader {
			setOrg = o
			break
		}
	}

	if setOrg.APIKey == nil || *setOrg.APIKey == "" {
		if _, err := orgs.UpdateAPIKey(ctx, setOrg.ID); err != nil {
			return err
		}
	}

	c.User = u
	c.Org = setOrg
	setSentryUserContext(c, u.ID, u.Email, setOrg)
	return nil
}

var errForbidden = httpx.HTTPException("Forbidden", http.StatusForbidden)

// setSentryUserContext is initialize.sentry.ts setSentryUserContext, scoped to
// the request's hub so concurrent requests don't share a user.
func setSentryUserContext(c *httpx.Ctx, userID, email string, org *ent.Organization) {
	ctx := c.R.Context()
	hub := sentry.GetHubFromContext(ctx)
	if hub == nil {
		hub = sentry.CurrentHub().Clone()
		c.R = c.R.WithContext(sentry.SetHubOnContext(ctx, hub))
	}
	hub.ConfigureScope(func(scope *sentry.Scope) {
		if userID != "" {
			scope.SetUser(sentry.User{ID: userID, Email: email})
		} else {
			scope.SetUser(sentry.User{})
		}
		if org.ID != "" {
			scope.SetTag("organization.id", org.ID)
		}
		if org.PaymentID != nil && strings.HasPrefix(*org.PaymentID, "cus_") {
			scope.SetTag("stripe.customer_id", *org.PaymentID)
		}
	})
}

// publicOrg mirrors `req.org = { ...org, users: [{ users: { role: 'SUPERADMIN' } }] }`:
// the membership object has no role of its own, so org.users[0].role is
// empty, exactly as in Postiz.
func publicOrg(org *ent.Organization) *ent.Organization {
	cp := *org
	cp.Edges.Users = []*ent.UserOrganization{{}}
	return &cp
}

func msg(status int, text string) *httpx.Error {
	return httpx.NewError(status, map[string]string{"msg": text})
}

// PublicAuthMiddleware authenticates the public API with an organization API
// key or a `pos_` OAuth access token.
func PublicAuthMiddleware(orgs OrganizationService, oauth OAuthService) httpx.Middleware {
	return func(c *httpx.Ctx) error {
		auth := c.Header("Authorization")
		if auth == "" {
			return msg(http.StatusUnauthorized, "No API Key found")
		}
		if err := publicAuthenticate(c, auth, orgs, oauth); err != nil {
			if _, ok := err.(*httpx.Error); ok {
				return err
			}
			return HTTPForbiddenException()
		}
		setSentryUserContext(c, "", "", c.Org)
		return nil
	}
}

func publicAuthenticate(c *httpx.Ctx, auth string, orgs OrganizationService, oauth OAuthService) error {
	ctx := c.R.Context()
	var org *ent.Organization
	isOAuthApp := strings.HasPrefix(auth, "pos_")
	c.IsOAuthApp = isOAuthApp

	if isOAuthApp {
		authorization, err := oauth.GetOrgByOAuthToken(ctx, auth)
		if err != nil {
			return err
		}
		if authorization == nil || authorization.Edges.Organization == nil {
			return msg(http.StatusUnauthorized, "Invalid OAuth token")
		}
		org = authorization.Edges.Organization
		// The user who approved the OAuth app, so /me can show who is connected
		c.OAuthUserID = authorization.UserID
	} else {
		found, err := orgs.GetOrgByAPIKey(ctx, auth)
		if err != nil {
			return err
		}
		if found == nil {
			return msg(http.StatusUnauthorized, "Invalid API key")
		}
		org = found
	}

	if os.Getenv("STRIPE_SECRET_KEY") != "" && org.Edges.Subscription == nil {
		return msg(http.StatusUnauthorized, "No subscription found")
	}

	c.Org = publicOrg(org)
	includeDeleted := strings.TrimSpace(c.Header("x-postiz-include-deleted")) == "true"
	c.AuthOrgID = org.ID
	c.IncludeDeleted = includeDeleted

	overrideOrgID := strings.TrimSpace(c.Header("x-postiz-org"))
	if overrideOrgID == "" {
		return nil
	}
	if isOAuthApp {
		return msg(http.StatusForbidden, "Unauthorized")
	}
	allowed, err := orgs.CanUseSuperAdminAPI(ctx, org.ID)
	if err != nil {
		return err
	}
	if !allowed {
		return msg(http.StatusForbidden, "Unauthorized")
	}

	overrideOrg, err := orgs.GetOrgByIDWithSubscription(ctx, overrideOrgID)
	if err != nil {
		return err
	}
	if overrideOrg == nil || (overrideOrg.DeletedAt != nil && !includeDeleted) {
		return msg(http.StatusNotFound, "Organization not found")
	}
	c.Org = publicOrg(overrideOrg)
	slog.Info("Organization override performed by organization "+org.ID+": acting as "+overrideOrg.ID+" on "+c.R.Method+" "+c.R.URL.Path,
		"context", "PublicAuthMiddleware")
	return nil
}

type ctxKey int

const (
	uploadSessionKey ctxKey = iota
	clippingIDKey
)

// UploadSession is req.uploadSession set by UploadWidgetAuthMiddleware.
func UploadSession(c *httpx.Ctx) string {
	v, _ := c.R.Context().Value(uploadSessionKey).(string)
	return v
}

// ClippingID is req.clippingId set by ClippingWidgetAuthMiddleware.
func ClippingID(c *httpx.Ctx) string {
	v, _ := c.R.Context().Value(clippingIDKey).(string)
	return v
}

// ticketQuery is `typeof req.query.ticket === 'string' && ...`: a single,
// non-empty value.
func ticketQuery(c *httpx.Ctx) string {
	values := c.R.URL.Query()["ticket"]
	if len(values) != 1 {
		return ""
	}
	return values[0]
}

// UploadWidgetAuthMiddleware: the MCP upload widget runs in the host's
// sandboxed iframe (a foreign origin without our cookies), so it
// authenticates with a short-lived ticket. It is checked here, before the
// multipart handler streams anything to storage.
func UploadWidgetAuthMiddleware(media MediaService) httpx.Middleware {
	return func(c *httpx.Ctx) error {
		// Not part of the global cors() allowlist on purpose: that one allows
		// credentials, and the sandbox origins are shared with every other connector.
		// The global cors() answers every preflight itself, so the widget has to stay
		// on "simple" requests (GET / multipart POST, no custom headers)
		c.SetHeader("Access-Control-Allow-Origin", "*")

		var ticket *UploadTicket
		if t := ticketQuery(c); t != "" {
			var err error
			if ticket, err = media.GetUploadTicket(c.R.Context(), t); err != nil {
				return err
			}
		}
		if ticket == nil {
			return msg(http.StatusUnauthorized, "Upload ticket not found or expired")
		}
		c.Org = &ent.Organization{ID: ticket.Org}
		c.R = c.R.WithContext(context.WithValue(c.R.Context(), uploadSessionKey, ticket.SessionID))
		return nil
	}
}

// ClippingWidgetAuthMiddleware: the MCP clipping widget runs in the host's
// sandboxed iframe (a foreign origin without our cookies), so it
// authenticates with a short-lived ticket that only opens the clipping it
// was made for.
func ClippingWidgetAuthMiddleware(clipping ClippingService) httpx.Middleware {
	return func(c *httpx.Ctx) error {
		// Not part of the global cors() allowlist on purpose: that one allows
		// credentials, and the sandbox origins are shared with every other connector.
		// The global cors() answers every preflight itself, so the widget has to stay
		// on "simple" requests (GET, no custom headers)
		c.SetHeader("Access-Control-Allow-Origin", "*")

		var ticket *ClippingTicket
		if t := ticketQuery(c); t != "" {
			var err error
			if ticket, err = clipping.GetWidgetTicket(c.R.Context(), t); err != nil {
				return err
			}
		}
		if ticket == nil {
			return msg(http.StatusUnauthorized, "Clipping ticket not found or expired")
		}
		c.Org = &ent.Organization{ID: ticket.Org}
		c.R = c.R.WithContext(context.WithValue(c.R.Context(), clippingIDKey, ticket.ID))
		return nil
	}
}

// SuperAdminGuard allows organizations that may use the super-admin public API.
func SuperAdminGuard(orgs OrganizationService) httpx.Middleware {
	return func(c *httpx.Ctx) error {
		orgID := c.AuthOrgID
		if orgID == "" && c.Org != nil {
			orgID = c.Org.ID
		}
		if orgID == "" || c.IsOAuthApp {
			return msg(http.StatusForbidden, "Unauthorized")
		}
		ok, err := orgs.CanUseSuperAdminAPI(c.R.Context(), orgID)
		if err != nil {
			return err
		}
		if !ok {
			return msg(http.StatusForbidden, "Unauthorized")
		}
		return nil
	}
}
