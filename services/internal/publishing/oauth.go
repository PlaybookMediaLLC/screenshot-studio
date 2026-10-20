package publishing

import (
	"context"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/socialoauthstart"
	"github.com/lucsky/cuid"
)

const oauthLifetime = time.Hour

// StartOAuth records a single-use grant for a provider connection, bound to
// the set the account will join (nil for the default set), so the callback
// cannot attach it to whichever set happens to be selected later.
func (r *Repository) StartOAuth(ctx context.Context, actor Actor, sessionID, state, provider, secretReference string, socialSetID *string) error {
	_, err := r.client.SocialOAuthStart.Create().
		SetID(state).
		SetOrganizationID(actor.Organization).
		SetUserID(actor.UserID).
		SetSessionID(sessionID).
		SetProvider(provider).
		SetSecretReference(secretReference).
		SetNillableSocialSetID(socialSetID).
		SetExpiresAt(time.Now().UTC().Add(oauthLifetime)).
		Save(ctx)
	if ent.IsConstraintError(err) {
		return ErrConflict
	}
	return err
}

func (r *Repository) OAuthStart(ctx context.Context, actor Actor, sessionID, state, provider string, integrationID *string) (*ent.SocialOAuthStart, error) {
	query := r.client.SocialOAuthStart.Query().Where(
		socialoauthstart.ID(state),
		socialoauthstart.OrganizationID(actor.Organization),
		socialoauthstart.UserID(actor.UserID),
		socialoauthstart.SessionID(sessionID),
		socialoauthstart.Provider(provider),
		socialoauthstart.ExpiresAtGT(time.Now().UTC()),
	)
	if integrationID != nil {
		query.Where(socialoauthstart.IntegrationID(*integrationID))
	}
	start, err := query.Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	return start, err
}

func (r *Repository) RememberInstagramIntegration(ctx context.Context, actor Actor, sessionID, state, integrationID string) error {
	updated, err := r.client.SocialOAuthStart.Update().Where(
		socialoauthstart.ID(state),
		socialoauthstart.OrganizationID(actor.Organization),
		socialoauthstart.UserID(actor.UserID),
		socialoauthstart.SessionID(sessionID),
		socialoauthstart.Provider("instagram"),
		socialoauthstart.IntegrationIDIsNil(),
		socialoauthstart.ExpiresAtGT(time.Now().UTC()),
	).SetIntegrationID(integrationID).Save(ctx)
	if err != nil {
		return err
	}
	if updated != 1 {
		return ErrNotFound
	}
	return nil
}

// FinishOAuth commits the new connection and consumes the grant together.
// The caller verifies the remote integration before entering this transaction.
func (r *Repository) FinishOAuth(ctx context.Context, actor Actor, sessionID, state, provider, integrationID string) (*ent.ChannelConnection, error) {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	query := tx.SocialOAuthStart.Query().Where(
		socialoauthstart.ID(state),
		socialoauthstart.OrganizationID(actor.Organization),
		socialoauthstart.UserID(actor.UserID),
		socialoauthstart.SessionID(sessionID),
		socialoauthstart.Provider(provider),
		socialoauthstart.ExpiresAtGT(time.Now().UTC()),
	)
	if provider == "instagram" {
		query.Where(socialoauthstart.IntegrationID(integrationID))
	}
	start, err := query.Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	connection, err := tx.ChannelConnection.Query().Where(
		channelconnection.OrganizationID(actor.Organization),
		channelconnection.Provider("social"),
		channelconnection.ExternalAccountID(integrationID),
	).Only(ctx)
	if ent.IsNotFound(err) {
		setID, err := targetSocialSet(ctx, tx, actor.Organization, provider, start.SocialSetID)
		if err != nil {
			return nil, err
		}
		connection, err = tx.ChannelConnection.Create().
			SetID(cuid.New()).
			SetOrganizationID(actor.Organization).
			SetProvider("social").
			SetExternalAccountID(integrationID).
			SetPlatform(provider).
			SetProviderSettings(map[string]any{}).
			SetSecretReference(start.SecretReference).
			SetStatus(channelconnection.StatusACTIVE).
			SetNillableSocialSetID(setID).
			SetCreatedByUserID(actor.UserID).
			Save(ctx)
		if ent.IsConstraintError(err) {
			return nil, ErrConflict
		}
		if err != nil {
			return nil, err
		}
		if err := enableDefaultPlatform(ctx, tx, setID, provider); err != nil {
			return nil, err
		}
		if err := activity.Emit(ctx, tx, actor.Organization, "integration.connected", "channel_connection", connection.ID, actor.UserID, "connected:"+connection.ID, map[string]any{"ownerUserId": actor.UserID}); err != nil {
			return nil, err
		}
		if err := appendAudit(ctx, tx, auditInput{
			Action: "post.connection_created", Actor: actor, EntityID: connection.ID,
			EntityType: "channel_connection", Organization: actor.Organization, Outcome: auditlog.OutcomeSUCCEEDED,
		}); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else if connection.Platform != provider || connection.SecretReference != start.SecretReference {
		return nil, ErrConflict
	} else if connection, err = reconnect(ctx, tx, actor, connection, start.SocialSetID); err != nil {
		return nil, err
	}
	if err := tx.SocialOAuthStart.DeleteOneID(state).Exec(ctx); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return connection.Unwrap(), nil
}

// reconnect renews an account the workspace already holds. An active account
// stays in its set, and asking to add it to a different set is refused rather
// than silently moving it. A removed account comes back in the set the
// connection started from (or the default set), as the same connection.
func reconnect(ctx context.Context, tx *ent.Tx, actor Actor, connection *ent.ChannelConnection, requested *string) (*ent.ChannelConnection, error) {
	if connection.Status == channelconnection.StatusACTIVE {
		if requested != nil && (connection.SocialSetID == nil || *connection.SocialSetID != *requested) {
			return nil, ErrAccountInAnotherSet
		}
		return connection, nil
	}
	setID, err := targetSocialSet(ctx, tx, actor.Organization, connection.Platform, requested)
	if err != nil {
		return nil, err
	}
	update := tx.ChannelConnection.UpdateOneID(connection.ID).SetStatus(channelconnection.StatusACTIVE)
	if setID == nil {
		update.ClearSocialSetID()
	} else {
		update.SetSocialSetID(*setID)
	}
	restored, err := update.Save(ctx)
	if err != nil {
		if ent.IsConstraintError(err) {
			return nil, ErrSocialSetSlotTaken
		}
		return nil, err
	}
	if err := enableDefaultPlatform(ctx, tx, setID, connection.Platform); err != nil {
		return nil, err
	}
	if err := appendAudit(ctx, tx, auditInput{
		Action: "post.connection_restored", Actor: actor, EntityID: connection.ID,
		EntityType: "channel_connection", Organization: actor.Organization, Outcome: auditlog.OutcomeSUCCEEDED,
	}); err != nil {
		return nil, err
	}
	return restored, nil
}
