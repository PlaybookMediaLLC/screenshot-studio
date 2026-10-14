package publishing

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/session"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspacedeletion"
)

// AuthorizePublishing verifies the web session and role against Ent. Headers
// from the web tier provide identifiers, but do not establish authorization.
func (r *Repository) AuthorizePublishing(ctx context.Context, organizationID, userID, sessionID string) error {
	if organizationID == "" || userID == "" || sessionID == "" {
		return ErrUnauthorized
	}
	now := time.Now().UTC()
	current, err := r.client.Session.Query().Where(
		session.ID(sessionID), session.UserID(userID), session.ExpiresAtGT(now),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return ErrUnauthorized
	}
	if err != nil {
		return err
	}
	if current.ActiveOrganizationID != nil && *current.ActiveOrganizationID != organizationID {
		return ErrForbidden
	}
	person, err := r.client.User.Query().Where(user.ID(userID)).Only(ctx)
	if ent.IsNotFound(err) {
		return ErrUnauthorized
	}
	if err != nil {
		return err
	}
	if person.Banned != nil && *person.Banned {
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
	switch participants[0].Role {
	case "owner", "admin", "publisher":
	default:
		return ErrForbidden
	}
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
