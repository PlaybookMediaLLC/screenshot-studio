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

// StartOAuth records an authorization attempt and its immutable target.
func (r *Repository) StartOAuth(ctx context.Context, actor Actor, sessionID, state, provider, secretReference string, options OAuthStartOptions) error {
	if options.ReturnPath != "" && !oauthReturnPath.MatchString(options.ReturnPath) {
		return ErrConflict
	}
	if err := r.AuthorizePublishing(ctx, actor.Organization, actor.UserID, sessionID); err != nil {
		return err
	}
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := lockOAuthAuthority(ctx, tx, actor, sessionID); err != nil {
		return err
	}
	if err := authorizeOAuthTarget(ctx, tx.Client(), actor, options.SocialSetID); err != nil {
		return err
	}
	if options.ExpectedConnectionID != nil {
		connection, err := tx.ChannelConnection.Query().Where(channelconnection.ID(*options.ExpectedConnectionID), channelconnection.OrganizationID(actor.Organization)).Only(ctx)
		if ent.IsNotFound(err) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if connection.Platform != provider || connection.SocialSetID == nil || options.SocialSetID == nil || *connection.SocialSetID != *options.SocialSetID {
			return ErrConflict
		}
	}
	_, err = tx.SocialOAuthStart.Create().
		SetID(state).SetOrganizationID(actor.Organization).SetUserID(actor.UserID).SetSessionID(sessionID).
		SetProvider(provider).SetSecretReference(secretReference).SetNillableSocialSetID(options.SocialSetID).
		SetNillableExpectedConnectionID(options.ExpectedConnectionID).SetReturnPath(options.ReturnPath).
		SetExpiresAt(time.Now().UTC().Add(oauthLifetime)).Save(ctx)
	if ent.IsConstraintError(err) {
		return ErrConflict
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) OAuthStart(ctx context.Context, actor Actor, sessionID, state, provider string, integrationID *string) (*ent.SocialOAuthStart, error) {
	if err := r.authorizeOAuth(ctx, actor, sessionID); err != nil {
		return nil, err
	}
	query := r.client.SocialOAuthStart.Query().Where(
		socialoauthstart.ID(state),
		socialoauthstart.OrganizationID(actor.Organization),
		socialoauthstart.UserID(actor.UserID),
		socialoauthstart.SessionID(sessionID),
		socialoauthstart.Provider(provider),
	)
	if integrationID != nil {
		query.Where(socialoauthstart.IntegrationID(*integrationID))
	}
	start, err := query.Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !oauthAttemptCurrent(start) {
		return nil, ErrNotFound
	}
	if err := authorizeOAuthTarget(ctx, r.client, actor, start.SocialSetID); err != nil {
		return nil, err
	}
	return start, nil
}

func (r *Repository) RememberInstagramIntegration(ctx context.Context, actor Actor, sessionID, state, integrationID string) error {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	start, err := lockOAuthStart(ctx, tx, actor, sessionID, state, "instagram")
	if err != nil {
		return err
	}
	if start.ExchangeReceipt.ID != integrationID || (start.IntegrationID != nil && *start.IntegrationID != integrationID) {
		return ErrConflict
	}
	if err := tx.SocialOAuthStart.UpdateOneID(state).SetIntegrationID(integrationID).Exec(ctx); err != nil {
		return err
	}
	return tx.Commit()
}

// FinishOAuth commits the connection and its replay receipt together.
// The caller verifies the remote integration before entering this transaction.
func (r *Repository) FinishOAuth(ctx context.Context, actor Actor, sessionID, state, provider, integrationID string) (*ent.ChannelConnection, error) {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	start, err := lockOAuthStart(ctx, tx, actor, sessionID, state, provider)
	if err != nil {
		return nil, err
	}
	if start.ExchangeReceipt.ID != integrationID || (provider == "instagram" && (start.IntegrationID == nil || *start.IntegrationID != integrationID)) {
		return nil, ErrConflict
	}
	if start.ExchangeStatus == socialoauthstart.ExchangeStatusCOMPLETED {
		if start.CompletedConnectionID == nil {
			return nil, ErrConflict
		}
		connection, err := tx.ChannelConnection.Query().Where(channelconnection.ID(*start.CompletedConnectionID), channelconnection.OrganizationID(actor.Organization),
			channelconnection.ExternalAccountID(integrationID), channelconnection.Platform(provider), channelconnection.StatusEQ(channelconnection.StatusACTIVE)).Only(ctx)
		if ent.IsNotFound(err) {
			return nil, ErrConflict
		}
		if err != nil {
			return nil, err
		}
		if start.SocialSetID != nil && (connection.SocialSetID == nil || *connection.SocialSetID != *start.SocialSetID) {
			return nil, ErrConflict
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return connection.Unwrap(), nil
	}
	if start.ExchangeStatus != socialoauthstart.ExchangeStatusEXCHANGED {
		return nil, ErrOAuthExchangeUncertain
	}
	connection, err := tx.ChannelConnection.Query().Where(
		channelconnection.OrganizationID(actor.Organization),
		channelconnection.Provider("social"),
		channelconnection.ExternalAccountID(integrationID),
	).Only(ctx)
	if ent.IsNotFound(err) {
		if start.ExpectedConnectionID != nil {
			return nil, ErrOAuthIdentityMismatch
		}
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
	} else if start.ExpectedConnectionID != nil && connection.ID != *start.ExpectedConnectionID {
		return nil, ErrOAuthIdentityMismatch
	} else if connection.Platform != provider || connection.SecretReference != start.SecretReference {
		return nil, ErrConflict
	} else if connection, err = reconnect(ctx, tx, actor, connection, start.SocialSetID); err != nil {
		return nil, err
	}
	if err := tx.SocialOAuthStart.UpdateOneID(state).SetExchangeStatus(socialoauthstart.ExchangeStatusCOMPLETED).
		SetCompletedConnectionID(connection.ID).SetCompletedAt(time.Now().UTC()).Exec(ctx); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return connection.Unwrap(), nil
}

// reconnect renews an account the workspace already holds. An active account
// stays in its set, and asking to add it to a different set is refused rather
// than silently moving it. A removed account keeps its original set and
// lineage; choosing another set requires an explicit transfer.
func reconnect(ctx context.Context, tx *ent.Tx, actor Actor, connection *ent.ChannelConnection, requested *string) (*ent.ChannelConnection, error) {
	if requested != nil && (connection.SocialSetID == nil || *connection.SocialSetID != *requested) {
		return nil, ErrAccountInAnotherSet
	}
	if err := authorizeOAuthTarget(ctx, tx.Client(), actor, connection.SocialSetID); err != nil {
		return nil, err
	}
	if connection.Status == channelconnection.StatusACTIVE {
		return connection, nil
	}
	setID, err := targetSocialSet(ctx, tx, actor.Organization, connection.Platform, connection.SocialSetID)
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
