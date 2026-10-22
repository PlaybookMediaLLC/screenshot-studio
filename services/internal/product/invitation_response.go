package product

import (
	"context"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/session"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
)

// RecipientInvitation is safe invitation metadata, visible only to its recipient.
type RecipientInvitation struct {
	WorkspaceInvitation
	OrganizationID   string `json:"organizationId"`
	OrganizationName string `json:"organizationName"`
	OrganizationSlug string `json:"organizationSlug"`
	InviterID        string `json:"inviterId"`
	InviterEmail     string `json:"inviterEmail"`
}

// InvitationResponse commits membership and invitation use as one operation.
type InvitationResponse struct {
	Invitation *RecipientInvitation     `json:"invitation"`
	Member     *WorkspaceCreationMember `json:"member"`
}

func (c *Configuration) recipientInvitation(ctx context.Context, client *ent.Client, actor Actor, id string) (*ent.Invitation, error) {
	if !actor.IsSession() {
		return nil, publishing.ErrForbidden
	}
	if id == "" || len(id) > 128 {
		return nil, ErrInvalidInput
	}
	auth := publishing.NewRepository(client)
	if _, err := auth.AuthorizeSession(ctx, actor.UserID, actor.SessionID); err != nil {
		return nil, err
	}
	person, err := client.User.Get(ctx, actor.UserID)
	if err != nil {
		return nil, err
	}
	item, err := client.Invitation.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	// Do not reveal another recipient's organization, email, role or use state.
	if !strings.EqualFold(person.Email, item.Email) {
		return nil, publishing.ErrNotFound
	}
	if c.requireInvitationEmailVerification && !person.EmailVerified {
		return nil, forbidden("Verify your email before responding to this invitation.")
	}
	if err := auth.AuthorizeWorkspace(ctx, item.OrganizationID); err != nil {
		return nil, err
	}
	return item, nil
}

func recipientInvitationRecord(ctx context.Context, client *ent.Client, item *ent.Invitation) (*RecipientInvitation, error) {
	org, err := client.Organization.Get(ctx, item.OrganizationID)
	if err != nil {
		return nil, err
	}
	inviter, err := client.User.Get(ctx, item.InviterID)
	if err != nil {
		return nil, err
	}
	status := item.Status
	if status == "pending" && !item.ExpiresAt.After(time.Now().UTC()) {
		status = "expired"
	}
	return &RecipientInvitation{
		WorkspaceInvitation: WorkspaceInvitation{ID: item.ID, Email: item.Email, Role: item.Role, Status: status, CreatedAt: item.CreatedAt, ExpiresAt: item.ExpiresAt},
		OrganizationID:      org.ID, OrganizationName: org.Name, OrganizationSlug: org.Slug,
		InviterID: inviter.ID, InviterEmail: inviter.Email,
	}, nil
}

// GetRecipientInvitation returns current state so expired and consumed links have
// distinct explanations and a lost successful response can be reconciled by read.
func (c *Configuration) GetRecipientInvitation(ctx context.Context, actor Actor, id string) (*RecipientInvitation, error) {
	item, err := c.recipientInvitation(ctx, c.client, actor, id)
	if err != nil {
		return nil, err
	}
	return recipientInvitationRecord(ctx, c.client, item)
}

// RespondInvitation consumes exactly one pending invitation. All acceptance,
// creation and cancellation paths serialize on the original destination workspace.
func (c *Configuration) RespondInvitation(ctx context.Context, actor Actor, id, action string) (*InvitationResponse, error) {
	if action != "accept" && action != "reject" {
		return nil, ErrInvalidInput
	}
	item, err := c.recipientInvitation(ctx, c.client, actor, id)
	if err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := lockWorkspaceSession(ctx, tx, actor, item.OrganizationID); err != nil {
		return nil, err
	}
	if _, err := tx.PlatformExec(ctx, `SELECT id FROM invitation WHERE id=$1 FOR UPDATE`, id); err != nil {
		return nil, err
	}
	item, err = c.recipientInvitation(ctx, tx.Client(), actor, id)
	if err != nil {
		return nil, err
	}
	switch item.Status {
	case "accepted":
		return nil, conflict("This invitation has already been accepted.")
	case "rejected":
		return nil, conflict("This invitation has been declined.")
	case "canceled":
		return nil, conflict("This invitation has been revoked. Ask an administrator for a new invitation.")
	case "expired":
		return nil, conflict("This invitation has expired. Ask an administrator for a new invitation.")
	case "pending":
	default:
		return nil, conflict("This invitation is unavailable.")
	}
	if !item.ExpiresAt.After(time.Now().UTC()) {
		return nil, conflict("This invitation has expired. Ask an administrator for a new invitation.")
	}
	actor.OrganizationID = item.OrganizationID
	result := &InvitationResponse{}
	status, audit := "rejected", "product.member_invitation_rejected"
	if action == "accept" {
		// An invitation cannot retain an administrator's authority after removal
		// or demotion. Lock that membership until the admission commits.
		if _, err := tx.PlatformExec(ctx, `SELECT id FROM member WHERE "organizationId"=$1 AND "userId"=$2 FOR SHARE`, item.OrganizationID, item.InviterID); err != nil {
			return nil, err
		}
		role, err := memberRole(ctx, tx.Client(), item.OrganizationID, item.InviterID)
		if err != nil {
			return nil, err
		}
		if role != "owner" && role != "admin" {
			return nil, forbidden("The inviter can no longer invite members. Ask an administrator for a new invitation.")
		}
		if item.Role != nil && *item.Role == "member" {
			role := "viewer"
			item.Role = &role
		}
		if item.Role == nil || !ValidAssignableRole(*item.Role) {
			return nil, invalid("This invitation has an unsupported role. Ask an administrator for a new invitation.")
		}
		if exists, err := tx.Member.Query().Where(member.OrganizationID(item.OrganizationID), member.UserID(actor.UserID)).Exist(ctx); err != nil {
			return nil, err
		} else if exists {
			return nil, conflict("You are already a member of this workspace.")
		}
		if err := NewConfiguration(tx.Client()).RequireSeat(ctx, item.OrganizationID, false); err != nil {
			return nil, err
		}
		if _, err := tx.PlatformExec(ctx, `SELECT set_config('platform.membership_explicit','true',true)`); err != nil {
			return nil, err
		}
		created, err := tx.Member.Create().SetID(uuid.NewString()).SetOrganizationID(item.OrganizationID).SetUserID(actor.UserID).SetRole(*item.Role).SetCreatedAt(time.Now().UTC()).Save(ctx)
		if err != nil {
			return nil, err
		}
		result.Member = &WorkspaceCreationMember{ID: created.ID, OrganizationID: created.OrganizationID, UserID: created.UserID, Role: created.Role, CreatedAt: created.CreatedAt}
		if _, err := tx.Session.Update().Where(session.ID(actor.SessionID), session.UserID(actor.UserID)).SetActiveOrganizationID(item.OrganizationID).Save(ctx); err != nil {
			return nil, err
		}
		if err := recordProductActivity(ctx, tx, actor, "member.joined", "product.member_invitation_accepted", "member", created.ID, map[string]any{"invitationId": id, "role": created.Role, "userId": actor.UserID}); err != nil {
			return nil, err
		}
		status, audit = "accepted", ""
	}
	item, err = tx.Invitation.UpdateOneID(id).SetStatus(status).Save(ctx)
	if err != nil {
		return nil, err
	}
	if audit != "" {
		if err := appendConfigurationAudit(ctx, tx, actor, audit, "invitation", id); err != nil {
			return nil, err
		}
	}
	result.Invitation, err = recipientInvitationRecord(ctx, tx.Client(), item)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
