package publishing

import (
	"context"
	"regexp"
	"strconv"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/approval"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/creativevariant"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/publicationattempt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspacedeletion"
	"github.com/lucsky/cuid"
)

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

func (r *Repository) Ping(ctx context.Context) error {
	_, err := r.client.ChannelConnection.Query().Limit(1).IDs(ctx)
	return err
}

func (r *Repository) CreateConnection(ctx context.Context, actor Actor, input CreateConnectionInput) (*ent.ChannelConnection, error) {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	connection, err := tx.ChannelConnection.Create().
		SetID(cuid.New()).
		SetOrganizationID(actor.Organization).
		SetProvider("postiz").
		SetExternalAccountID(input.ExternalAccountID).
		SetPlatform(input.Platform).
		SetProviderSettings(input.ProviderSettings).
		SetSecretReference(input.SecretReference).
		SetStatus(channelconnection.StatusACTIVE).
		SetCreatedByUserID(actor.UserID).
		Save(ctx)
	if err != nil {
		if ent.IsConstraintError(err) {
			return nil, ErrConflict
		}
		return nil, err
	}
	if err := appendAudit(ctx, tx, auditInput{
		Action: "post.connection_created", Actor: actor, EntityID: connection.ID,
		EntityType: "channel_connection", Organization: actor.Organization, Outcome: auditlog.OutcomeSUCCEEDED,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return connection.Unwrap(), nil
}

func (r *Repository) ListConnections(ctx context.Context, organizationID string) ([]*ent.ChannelConnection, error) {
	return r.client.ChannelConnection.Query().
		Where(channelconnection.OrganizationID(organizationID)).
		Order(ent.Desc(channelconnection.FieldCreatedAt)).
		All(ctx)
}

func (r *Repository) CreateScheduledPost(ctx context.Context, actor Actor, input CreateScheduledPostInput) (CreateScheduledPostResult, error) {
	existing, err := r.client.ScheduledPost.Query().Where(
		scheduledpost.OrganizationID(actor.Organization),
		scheduledpost.ChannelConnectionID(input.ChannelConnectionID),
		scheduledpost.IdempotencyKey(input.IdempotencyKey),
	).Only(ctx)
	if err == nil {
		return CreateScheduledPostResult{Created: false, Post: existing}, nil
	}
	if !ent.IsNotFound(err) {
		return CreateScheduledPostResult{}, err
	}

	eligible, err := r.isEligible(ctx, actor.Organization, input.VariantID, input.ChannelConnectionID)
	if err != nil {
		return CreateScheduledPostResult{}, err
	}
	if !eligible {
		return CreateScheduledPostResult{}, ErrNotEligible
	}

	tx, err := r.client.Tx(ctx)
	if err != nil {
		return CreateScheduledPostResult{}, err
	}
	defer tx.Rollback()
	post, err := tx.ScheduledPost.Create().
		SetID(cuid.New()).
		SetOrganizationID(actor.Organization).
		SetVariantID(input.VariantID).
		SetChannelConnectionID(input.ChannelConnectionID).
		SetScheduledFor(input.ScheduledFor.UTC()).
		SetStatus(scheduledpost.StatusSCHEDULED).
		SetCaption(input.Caption).
		SetIdempotencyKey(input.IdempotencyKey).
		Save(ctx)
	if err != nil {
		if ent.IsConstraintError(err) {
			existing, findErr := r.client.ScheduledPost.Query().Where(
				scheduledpost.ChannelConnectionID(input.ChannelConnectionID),
				scheduledpost.IdempotencyKey(input.IdempotencyKey),
			).Only(ctx)
			if findErr == nil {
				return CreateScheduledPostResult{Created: false, Post: existing}, nil
			}
			return CreateScheduledPostResult{}, ErrConflict
		}
		return CreateScheduledPostResult{}, err
	}
	if err := appendAudit(ctx, tx, auditInput{
		Action: "post.scheduled", Actor: actor, EntityID: post.ID, EntityType: "scheduled_post",
		Organization: actor.Organization, Outcome: auditlog.OutcomeSUCCEEDED,
	}); err != nil {
		return CreateScheduledPostResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return CreateScheduledPostResult{}, err
	}
	return CreateScheduledPostResult{Created: true, Post: post.Unwrap()}, nil
}

func (r *Repository) isEligible(ctx context.Context, organizationID, variantID, connectionID string) (bool, error) {
	connectionExists, err := r.client.ChannelConnection.Query().Where(
		channelconnection.ID(connectionID),
		channelconnection.OrganizationID(organizationID),
		channelconnection.Provider("postiz"),
		channelconnection.StatusEQ(channelconnection.StatusACTIVE),
	).Exist(ctx)
	if err != nil || !connectionExists {
		return false, err
	}
	return r.client.CreativeVariant.Query().Where(
		creativevariant.ID(variantID),
		creativevariant.OrganizationID(organizationID),
		creativevariant.StatusEQ(creativevariant.StatusAPPROVED),
		creativevariant.HasApprovalWith(approval.StatusEQ(approval.StatusAPPROVED)),
	).Exist(ctx)
}

func (r *Repository) ListScheduledPosts(ctx context.Context, organizationID string, limit int) ([]*ent.ScheduledPost, error) {
	return r.client.ScheduledPost.Query().
		Where(scheduledpost.OrganizationID(organizationID)).
		WithChannelConnection().
		Order(ent.Desc(scheduledpost.FieldScheduledFor), ent.Desc(scheduledpost.FieldID)).
		Limit(limit).
		All(ctx)
}

func (r *Repository) CancelScheduledPost(ctx context.Context, actor Actor, id string) (*ent.ScheduledPost, error) {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	post, err := tx.ScheduledPost.Query().Where(
		scheduledpost.ID(id), scheduledpost.OrganizationID(actor.Organization),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if post.Status == scheduledpost.StatusPUBLISHED || post.Status == scheduledpost.StatusPROCESSING {
		return nil, ErrInvalidState
	}
	if post.Status != scheduledpost.StatusCANCELLED {
		updated, updateErr := tx.ScheduledPost.Update().Where(
			scheduledpost.ID(post.ID),
			scheduledpost.OrganizationID(actor.Organization),
			scheduledpost.StatusIn(scheduledpost.StatusDRAFT, scheduledpost.StatusSCHEDULED, scheduledpost.StatusFAILED),
		).SetStatus(scheduledpost.StatusCANCELLED).Save(ctx)
		if updateErr != nil {
			return nil, updateErr
		}
		if updated != 1 {
			return nil, ErrInvalidState
		}
		post, err = tx.ScheduledPost.Query().Where(scheduledpost.ID(post.ID)).Only(ctx)
		if err != nil {
			return nil, err
		}
		if err := appendAudit(ctx, tx, auditInput{
			Action: "post.cancelled", Actor: actor, EntityID: post.ID, EntityType: "scheduled_post",
			Organization: actor.Organization, Outcome: auditlog.OutcomeSUCCEEDED,
		}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return post.Unwrap(), nil
}

func (r *Repository) Claim(ctx context.Context, id, runID string, now time.Time) (bool, error) {
	count, err := r.client.ScheduledPost.Update().Where(
		scheduledpost.ID(id),
		scheduledpost.StatusEQ(scheduledpost.StatusSCHEDULED),
		scheduledpost.ScheduledForLTE(now),
	).SetStatus(scheduledpost.StatusPROCESSING).SetTriggerRunID(runID).Save(ctx)
	if err != nil || count == 1 {
		return count == 1, err
	}
	return r.client.ScheduledPost.Query().Where(
		scheduledpost.ID(id),
		scheduledpost.StatusEQ(scheduledpost.StatusPROCESSING),
		scheduledpost.TriggerRunIDEQ(runID),
	).Exist(ctx)
}

func (r *Repository) LoadPublishJob(ctx context.Context, id, runID string) (PublishJob, error) {
	post, err := r.client.ScheduledPost.Query().Where(
		scheduledpost.ID(id),
		scheduledpost.StatusEQ(scheduledpost.StatusPROCESSING),
		scheduledpost.TriggerRunIDEQ(runID),
	).WithChannelConnection().Only(ctx)
	if ent.IsNotFound(err) {
		return PublishJob{}, ErrNotFound
	}
	if err != nil {
		return PublishJob{}, err
	}
	connection, err := post.Edges.ChannelConnectionOrErr()
	if err != nil {
		return PublishJob{Post: post, WorkspaceActive: false}, nil
	}
	variant, err := r.client.CreativeVariant.Query().Where(
		creativevariant.ID(post.VariantID), creativevariant.OrganizationID(post.OrganizationID),
	).WithApproval().WithSourceAsset().Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return PublishJob{Post: post, Connection: connection, WorkspaceActive: false}, nil
		}
		return PublishJob{}, err
	}
	approved := variant.Status == creativevariant.StatusAPPROVED
	if approvalEntity, edgeErr := variant.Edges.ApprovalOrErr(); edgeErr != nil || approvalEntity.Status != approval.StatusAPPROVED {
		approved = false
	}
	asset, err := variant.Edges.SourceAssetOrErr()
	if err != nil {
		return PublishJob{Post: post, Connection: connection, WorkspaceActive: false}, nil
	}
	approved = approved && asset.OrganizationID == post.OrganizationID
	deletion, err := r.client.WorkspaceDeletion.Query().Where(
		workspacedeletion.OrganizationID(post.OrganizationID),
	).Only(ctx)
	workspaceActive := ent.IsNotFound(err) || (err == nil && deletion.Status == workspacedeletion.StatusCANCELLED)
	if err != nil && !ent.IsNotFound(err) {
		return PublishJob{}, err
	}
	return PublishJob{
		AssetObjectKey: asset.ObjectKey, AssetMediaType: asset.MediaType,
		Connection: connection, Post: post, WorkspaceActive: workspaceActive && approved && connection.Status == channelconnection.StatusACTIVE,
	}, nil
}

func (r *Repository) StartAttempt(ctx context.Context, post *ent.ScheduledPost, runID string, attemptNumber int) (Attempt, error) {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return Attempt{}, err
	}
	defer tx.Rollback()
	owned, err := tx.ScheduledPost.Update().Where(
		scheduledpost.ID(post.ID),
		scheduledpost.StatusEQ(scheduledpost.StatusPROCESSING),
		scheduledpost.TriggerRunIDEQ(runID),
	).SetUpdatedAt(time.Now().UTC()).Save(ctx)
	if err != nil {
		return Attempt{}, err
	}
	if owned != 1 {
		return Attempt{}, ErrInvalidState
	}
	existing, err := tx.PublicationAttempt.Query().Where(
		publicationattempt.ScheduledPostID(post.ID),
		publicationattempt.AttemptNumber(attemptNumber),
	).Only(ctx)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return Attempt{}, err
		}
		return Attempt{ID: existing.ID, Number: existing.AttemptNumber}, nil
	}
	if !ent.IsNotFound(err) {
		return Attempt{}, err
	}
	attempt, err := tx.PublicationAttempt.Create().
		SetID(cuid.New()).
		SetOrganizationID(post.OrganizationID).
		SetScheduledPostID(post.ID).
		SetAttemptNumber(attemptNumber).
		Save(ctx)
	if err != nil {
		return Attempt{}, err
	}
	if err := tx.Commit(); err != nil {
		return Attempt{}, err
	}
	return Attempt{ID: attempt.ID, Number: attempt.AttemptNumber}, nil
}

func (r *Repository) FailUnknown(ctx context.Context, postID, runID string, attemptNumber int) error {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	post, err := tx.ScheduledPost.Query().Where(scheduledpost.ID(postID)).Only(ctx)
	if ent.IsNotFound(err) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if post.Status == scheduledpost.StatusPUBLISHED || post.Status == scheduledpost.StatusFAILED || post.Status == scheduledpost.StatusCANCELLED {
		return nil
	}
	updated, err := tx.ScheduledPost.Update().Where(
		scheduledpost.ID(postID),
		scheduledpost.StatusEQ(scheduledpost.StatusPROCESSING),
		scheduledpost.TriggerRunIDEQ(runID),
	).SetStatus(scheduledpost.StatusFAILED).Save(ctx)
	if err != nil || updated != 1 {
		if err == nil {
			err = ErrInvalidState
		}
		return err
	}
	updatedAttempts, err := tx.PublicationAttempt.Update().Where(
		publicationattempt.ScheduledPostID(postID),
		publicationattempt.AttemptNumber(attemptNumber),
		publicationattempt.CompletedAtIsNil(),
	).SetCompletedAt(time.Now().UTC()).SetOutcome(publicationattempt.OutcomeFAILED).SetFailureCode("UNKNOWN_DELIVERY").Save(ctx)
	if err != nil || updatedAttempts != 1 {
		if err == nil {
			err = ErrInvalidState
		}
		return err
	}
	if err := appendAudit(ctx, tx, auditInput{
		Action: "post.publish_recovery_required", Actor: serviceActor(post), EntityID: post.ID,
		EntityType: "scheduled_post", Organization: post.OrganizationID, Outcome: auditlog.OutcomeFAILED,
		Metadata: map[string]any{"failureCode": "UNKNOWN_DELIVERY"},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) Complete(ctx context.Context, post *ent.ScheduledPost, attempt Attempt, providerPostID, runID string) error {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	updated, err := tx.ScheduledPost.Update().Where(
		scheduledpost.ID(post.ID),
		scheduledpost.StatusEQ(scheduledpost.StatusPROCESSING),
		scheduledpost.TriggerRunIDEQ(runID),
	).SetStatus(scheduledpost.StatusPUBLISHED).Save(ctx)
	if err != nil || updated != 1 {
		if err == nil {
			err = ErrInvalidState
		}
		return err
	}
	if _, err = tx.PublicationAttempt.UpdateOneID(attempt.ID).
		SetCompletedAt(time.Now()).SetOutcome(publicationattempt.OutcomeSUCCEEDED).SetProviderPostID(providerPostID).Save(ctx); err != nil {
		return err
	}
	if err := appendAudit(ctx, tx, auditInput{
		Action: "post.published", Actor: serviceActor(post), EntityID: post.ID,
		EntityType: "scheduled_post", Organization: post.OrganizationID, Outcome: auditlog.OutcomeSUCCEEDED,
		Metadata: map[string]any{"providerPostId": providerPostID},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) Fail(ctx context.Context, post *ent.ScheduledPost, attempt Attempt, failureCode string, retryAt *time.Time, runID string) error {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	postUpdate := tx.ScheduledPost.Update().Where(
		scheduledpost.ID(post.ID),
		scheduledpost.StatusEQ(scheduledpost.StatusPROCESSING),
		scheduledpost.TriggerRunIDEQ(runID),
	)
	retry := retryAt != nil
	if retry {
		postUpdate.SetStatus(scheduledpost.StatusSCHEDULED).SetScheduledFor(retryAt.UTC()).ClearTriggerRunID()
	} else {
		postUpdate.SetStatus(scheduledpost.StatusFAILED)
	}
	updated, err := postUpdate.Save(ctx)
	if err != nil || updated != 1 {
		if err == nil {
			err = ErrInvalidState
		}
		return err
	}
	if _, err = tx.PublicationAttempt.UpdateOneID(attempt.ID).
		SetCompletedAt(time.Now()).SetOutcome(publicationattempt.OutcomeFAILED).SetFailureCode(failureCode).Save(ctx); err != nil {
		return err
	}
	if err := appendAudit(ctx, tx, auditInput{
		Action: "post.publish_failed", Actor: serviceActor(post), EntityID: post.ID,
		EntityType: "scheduled_post", Organization: post.OrganizationID, Outcome: auditlog.OutcomeFAILED,
		Metadata: map[string]any{"failureCode": failureCode, "retry": retry},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Repository) CancelIneligible(ctx context.Context, post *ent.ScheduledPost, reason, runID string) error {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	updated, err := tx.ScheduledPost.Update().Where(
		scheduledpost.ID(post.ID),
		scheduledpost.StatusEQ(scheduledpost.StatusPROCESSING),
		scheduledpost.TriggerRunIDEQ(runID),
	).SetStatus(scheduledpost.StatusCANCELLED).Save(ctx)
	if err != nil || updated == 0 {
		if err == nil {
			err = ErrInvalidState
		}
		return err
	}
	if err := appendAudit(ctx, tx, auditInput{
		Action: "post.cancelled", Actor: serviceActor(post), EntityID: post.ID,
		EntityType: "scheduled_post", Organization: post.OrganizationID, Outcome: auditlog.OutcomeSUCCEEDED,
		Metadata: map[string]any{"reason": reason},
	}); err != nil {
		return err
	}
	return tx.Commit()
}

func serviceActor(post *ent.ScheduledPost) Actor {
	requestID := post.ID
	if post.TriggerRunID != nil && *post.TriggerRunID != "" {
		requestID = *post.TriggerRunID
	}
	return Actor{Display: "publishing-orchestrator", Organization: post.OrganizationID, RequestID: requestID, Type: "SERVICE"}
}

func ProviderFailureCode(status int, unknown bool) string {
	if unknown {
		return "UNKNOWN_DELIVERY"
	}
	if status == 0 {
		return "NETWORK"
	}
	return strconv.Itoa(status)
}

var secretReferencePattern = regexp.MustCompile(`^POSTIZ_(?:API_KEY|OAUTH_TOKEN)(?:_[A-Z0-9_]+)?$`)

func IsSecretReference(value string) bool {
	return secretReferencePattern.MatchString(value)
}
