package product

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/platformworkspacecreation"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/session"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
)

var creationSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func normalizeWorkspaceCreation(input CreateWorkspaceInput) (CreateWorkspaceInput, string, string, error) {
	input.Name, input.Slug = strings.TrimSpace(input.Name), strings.TrimSpace(input.Slug)
	if !utf8.ValidString(input.Name) || utf8.RuneCountInString(input.Name) < 2 || utf8.RuneCountInString(input.Name) > 100 ||
		len(input.Slug) < 2 || len(input.Slug) > 100 || !creationSlugPattern.MatchString(input.Slug) {
		return input, "", "", ErrInvalidInput
	}
	// Older clients have a stable, caller-chosen slug. Preserve their retry
	// identity independently of subsequent changes to the organization's slug.
	key := "slug:" + input.Slug
	if input.IdempotencyKey != "" {
		parsed, err := uuid.Parse(input.IdempotencyKey)
		if err != nil || parsed == uuid.Nil {
			return input, "", "", ErrInvalidInput
		}
		key = "key:" + parsed.String()
	}
	input.IdempotencyKey = ""
	encoded, err := json.Marshal(input)
	if err != nil {
		return input, "", "", err
	}
	hash := sha256.Sum256(encoded)
	return input, key, hex.EncodeToString(hash[:]), nil
}

// CreateWorkspace commits the organization, owner, settings, audit, and retry
// receipt together. Callers may preserve their current editor's workspace.
func (c *Configuration) CreateWorkspace(ctx context.Context, actor Actor, input CreateWorkspaceInput) (*Workspace, error) {
	if !actor.IsSession() {
		return nil, publishing.ErrForbidden
	}
	if err := c.AuthorizeSession(ctx, actor); err != nil {
		return nil, err
	}
	input, key, hash, err := normalizeWorkspaceCreation(input)
	if err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Serialize creations by actor, including requests in different sessions.
	// Lock the user before the session, matching account-deletion FK ordering.
	if _, err := tx.PlatformExec(ctx, `SELECT id FROM "user" WHERE id=$1 FOR UPDATE`, actor.UserID); err != nil {
		return nil, err
	}
	if _, err := tx.PlatformExec(ctx, `SELECT id FROM session WHERE id=$1 AND "userId"=$2 FOR UPDATE`, actor.SessionID, actor.UserID); err != nil {
		return nil, err
	}
	auth := publishing.NewRepository(tx.Client())
	if _, err := auth.AuthorizeSession(ctx, actor.UserID, actor.SessionID); err != nil {
		return nil, err
	}
	receipt, err := tx.PlatformWorkspaceCreation.Query().Where(
		platformworkspacecreation.UserID(actor.UserID), platformworkspacecreation.RequestKey(key),
	).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	if receipt != nil {
		if receipt.RequestHash != hash {
			return nil, conflict("This creation request was already used with different details.")
		}
		return replayWorkspaceCreation(ctx, tx, actor, receipt.OrganizationID)
	}
	now := time.Now().UTC()
	org, err := tx.Organization.Create().SetID(uuid.NewString()).SetName(input.Name).SetSlug(input.Slug).SetCreatedAt(now).Save(ctx)
	if ent.IsConstraintError(err) {
		return nil, conflict("This workspace slug is already taken.")
	}
	if err != nil {
		return nil, err
	}
	if _, err := tx.Member.Create().SetID(uuid.NewString()).SetOrganizationID(org.ID).
		SetUserID(actor.UserID).SetRole("owner").SetCreatedAt(now).Save(ctx); err != nil {
		return nil, err
	}
	settings, err := tx.WorkspaceSettings.Create().SetID(org.ID).Save(ctx)
	if err != nil {
		return nil, err
	}
	if !input.KeepCurrentActiveOrganization {
		updated, err := tx.Session.Update().Where(session.ID(actor.SessionID), session.UserID(actor.UserID), session.ExpiresAtGT(time.Now())).SetActiveOrganizationID(org.ID).Save(ctx)
		if err != nil {
			return nil, err
		}
		if updated != 1 {
			return nil, publishing.ErrUnauthorized
		}
	}
	actor.OrganizationID = org.ID
	if err := appendConfigurationAudit(ctx, tx, actor, "product.workspace_created", "organization", org.ID); err != nil {
		return nil, err
	}
	if _, err := tx.PlatformWorkspaceCreation.Create().SetID(uuid.NewString()).SetOrganizationID(org.ID).
		SetUserID(actor.UserID).SetRequestKey(key).SetRequestHash(hash).SetCreatedAt(now).Save(ctx); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &Workspace{ID: org.ID, CreatedAt: org.CreatedAt, Name: org.Name, Slug: org.Slug, WorkspaceSettings: settings.Unwrap()}, nil
}

func replayWorkspaceCreation(ctx context.Context, tx *ent.Tx, actor Actor, organizationID string) (*Workspace, error) {
	// A receipt grants no ongoing access: removed members and deleted workspaces
	// cannot be recovered through an old creation request.
	if _, err := tx.PlatformExec(ctx, `SELECT id FROM organization WHERE id=$1 FOR UPDATE`, organizationID); err != nil {
		return nil, err
	}
	if _, err := tx.PlatformExec(ctx, `SELECT id FROM member WHERE "organizationId"=$1 AND "userId"=$2 FOR SHARE`, organizationID, actor.UserID); err != nil {
		return nil, err
	}
	allowed, err := tx.Member.Query().Where(member.OrganizationID(organizationID), member.UserID(actor.UserID)).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, publishing.ErrForbidden
	}
	if err := publishing.NewRepository(tx.Client()).AuthorizeWorkspace(ctx, organizationID); err != nil {
		return nil, err
	}
	org, err := tx.Organization.Get(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	settings, err := tx.WorkspaceSettings.Get(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	// Never switch the current workspace on replay: the actor may have moved
	// to another editor while the original response was delayed or lost.
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &Workspace{ID: org.ID, CreatedAt: org.CreatedAt, Logo: org.Logo, Name: org.Name, Slug: org.Slug, WorkspaceSettings: settings.Unwrap()}, nil
}
