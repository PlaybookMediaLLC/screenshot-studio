package product

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/organization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspacedeletion"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

func (c *Configuration) RequestDeletion(ctx context.Context, actor Actor, confirmation string) (*ent.WorkspaceDeletion, error) {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	requester, err := tx.Member.Query().Where(member.OrganizationID(actor.OrganizationID), member.UserID(actor.UserID)).Only(ctx)
	if ent.IsNotFound(err) || (err == nil && requester.Role != "owner") {
		return nil, forbidden("Only the workspace owner can delete this workspace.")
	}
	if err != nil {
		return nil, err
	}
	org, err := tx.Organization.Query().Where(organization.ID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if org.Name != confirmation {
		return nil, invalid("Enter the exact workspace name to continue.")
	}
	scheduledFor := time.Now().UTC().Add(14 * 24 * time.Hour)
	current, err := tx.WorkspaceDeletion.Query().Where(workspacedeletion.OrganizationID(actor.OrganizationID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	var deletion *ent.WorkspaceDeletion
	if current == nil {
		deletion, err = tx.WorkspaceDeletion.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
			SetRequestedByUserID(actor.UserID).SetStatus(workspacedeletion.StatusPENDING).SetScheduledFor(scheduledFor).Save(ctx)
	} else {
		deletion, err = tx.WorkspaceDeletion.UpdateOneID(current.ID).SetRequestedByUserID(actor.UserID).
			SetStatus(workspacedeletion.StatusPENDING).SetScheduledFor(scheduledFor).
			ClearCancelledAt().ClearProcessingAt().ClearLastError().Save(ctx)
	}
	if ent.IsConstraintError(err) {
		return nil, publishing.ErrConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.workspace_deletion_scheduled", "workspace_deletion", deletion.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return deletion.Unwrap(), nil
}

func (c *Configuration) CancelDeletion(ctx context.Context, actor Actor) (*ent.WorkspaceDeletion, error) {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	currentSession, err := tx.Session.Get(ctx, actor.SessionID)
	if ent.IsNotFound(err) || (err == nil && currentSession.UserID != actor.UserID) {
		return nil, publishing.ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	if currentSession.ActiveOrganizationID == nil {
		return nil, notFound("No active workspace is available to restore.")
	}
	deletion, err := tx.WorkspaceDeletion.Query().Where(
		workspacedeletion.OrganizationID(*currentSession.ActiveOrganizationID),
		workspacedeletion.RequestedByUserID(actor.UserID),
		workspacedeletion.StatusEQ(workspacedeletion.StatusPENDING),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, notFound("No scheduled workspace deletion was found.")
	}
	if err != nil {
		return nil, err
	}
	count, err := tx.WorkspaceDeletion.Update().Where(
		workspacedeletion.ID(deletion.ID), workspacedeletion.StatusEQ(workspacedeletion.StatusPENDING),
	).SetStatus(workspacedeletion.StatusCANCELLED).SetCancelledAt(time.Now().UTC()).Save(ctx)
	if err != nil {
		return nil, err
	}
	if count != 1 {
		return nil, conflict("The workspace changed. Please retry.")
	}
	updated, err := tx.WorkspaceDeletion.Get(ctx, deletion.ID)
	if err != nil {
		return nil, err
	}
	actor.OrganizationID = updated.OrganizationID
	if err := appendConfigurationAudit(ctx, tx, actor, "product.workspace_deletion_cancelled", "workspace_deletion", updated.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return updated.Unwrap(), nil
}
