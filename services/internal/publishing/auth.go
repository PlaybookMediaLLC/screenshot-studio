package publishing

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/apikey"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/organization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/session"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/supportaccessgrant"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspacedeletion"
)

// AuthorizePublishing verifies the web session and role against Ent. Headers
// from the web tier provide identifiers, but do not establish authorization.
func (r *Repository) AuthorizePublishing(ctx context.Context, organizationID, userID, sessionID string) error {
	return r.AuthorizeRole(ctx, organizationID, userID, sessionID, "owner", "admin", "publisher")
}

// AuthorizeRole rechecks the session, active workspace, membership, and
// deletion state in the backend. A forwarded role header is never trusted.
func (r *Repository) AuthorizeRole(ctx context.Context, organizationID, userID, sessionID string, allowedRoles ...string) error {
	if organizationID == "" || userID == "" || sessionID == "" {
		return ErrUnauthorized
	}
	current, err := r.AuthorizeSession(ctx, userID, sessionID)
	if err != nil {
		return err
	}
	if current.ActiveOrganizationID != nil && *current.ActiveOrganizationID != organizationID {
		return ErrForbidden
	}
	participants, err := r.client.Member.Query().Where(
		member.OrganizationID(organizationID), member.UserID(userID),
	).All(ctx)
	if err != nil {
		return err
	}
	if len(participants) != 1 {
		return ErrForbidden
	}
	allowed := false
	for _, role := range allowedRoles {
		if participants[0].Role == role {
			allowed = true
			break
		}
	}
	if !allowed {
		return ErrForbidden
	}
	return r.requireOperational(ctx, organizationID)
}

// requireOperational rejects a workspace that is scheduled for deletion.
func (r *Repository) requireOperational(ctx context.Context, organizationID string) error {
	deletion, err := r.client.WorkspaceDeletion.Query().Where(
		workspacedeletion.OrganizationID(organizationID),
	).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	if deletion != nil && deletion.Status != workspacedeletion.StatusCANCELLED {
		return ErrForbidden
	}
	return nil
}

// AuthorizeSession validates a user session without requiring an active
// workspace. Workspace creation and switching use this entry point.
func (r *Repository) AuthorizeSession(ctx context.Context, userID, sessionID string) (*ent.Session, error) {
	if userID == "" || sessionID == "" {
		return nil, ErrUnauthorized
	}
	now := time.Now().UTC()
	current, err := r.client.Session.Query().Where(
		session.ID(sessionID), session.UserID(userID), session.ExpiresAtGT(now),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	person, err := r.client.User.Query().Where(user.ID(userID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	if person.Banned != nil && *person.Banned {
		return nil, ErrForbidden
	}
	return current, nil
}

// AuthorizeWorkspace admits a service caller acting for an existing,
// operational workspace. The web facade authenticated the caller with a
// webhook signature, render token, or job identity before forwarding it.
func (r *Repository) AuthorizeWorkspace(ctx context.Context, organizationID string) error {
	if organizationID == "" {
		return ErrUnauthorized
	}
	exists, err := r.client.Organization.Query().Where(organization.ID(organizationID)).Exist(ctx)
	if err != nil {
		return err
	}
	if !exists {
		return ErrForbidden
	}
	return r.requireOperational(ctx, organizationID)
}

// AuthorizeAPIKey rechecks that an organization API key is still enabled,
// unexpired, and issued for this workspace. The facade checked its scope.
func (r *Repository) AuthorizeAPIKey(ctx context.Context, organizationID, keyID string) error {
	_, err := r.apiKey(ctx, organizationID, keyID)
	return err
}

// AuthorizeAPIKeyScope also requires the key to hold scope, read from Better
// Auth's {"resource": ["action"]} permissions. Scheduling uses it so the
// backend checks the scope itself rather than trust the facade (RFC 037).
func (r *Repository) AuthorizeAPIKeyScope(ctx context.Context, organizationID, keyID, scope string) error {
	key, err := r.apiKey(ctx, organizationID, keyID)
	if err != nil {
		return err
	}
	var permissions map[string][]string
	if key.Permissions != nil {
		_ = json.Unmarshal([]byte(*key.Permissions), &permissions)
	}
	resource, action, _ := strings.Cut(scope, ":")
	if !slices.Contains(permissions[resource], action) {
		return ErrForbidden
	}
	return nil
}

func (r *Repository) apiKey(ctx context.Context, organizationID, keyID string) (*ent.Apikey, error) {
	if organizationID == "" || keyID == "" {
		return nil, ErrUnauthorized
	}
	key, err := r.client.Apikey.Query().Where(apikey.ID(keyID), apikey.ReferenceID(organizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	if (key.Enabled != nil && !*key.Enabled) || (key.ExpiresAt != nil && !key.ExpiresAt.After(time.Now().UTC())) {
		return nil, ErrUnauthorized
	}
	return key, r.requireOperational(ctx, organizationID)
}

// AuthorizeSupportGrant rechecks a time-bound support grant for its user.
func (r *Repository) AuthorizeSupportGrant(ctx context.Context, organizationID, userID, grantID string) error {
	if organizationID == "" || userID == "" || grantID == "" {
		return ErrUnauthorized
	}
	exists, err := r.client.SupportAccessGrant.Query().Where(
		supportaccessgrant.ID(grantID), supportaccessgrant.OrganizationID(organizationID),
		supportaccessgrant.UserID(userID), supportaccessgrant.ExpiresAtGT(time.Now().UTC()),
		supportaccessgrant.RevokedAtIsNil(),
	).Exist(ctx)
	if err != nil {
		return err
	}
	if !exists {
		return ErrForbidden
	}
	return nil
}
