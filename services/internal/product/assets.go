package product

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/creativevariant"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/predicate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspaceentitlement"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

type AssetListItem struct {
	ID        string    `json:"id"`
	Bytes     int       `json:"bytes"`
	CreatedAt time.Time `json:"createdAt"`
	Height    *int      `json:"height"`
	MediaType string    `json:"mediaType"`
	Width     *int      `json:"width"`
}

type AssetPage struct {
	Assets     []AssetListItem `json:"assets"`
	NextCursor *string         `json:"nextCursor"`
}

func (c *Configuration) ListAssets(ctx context.Context, actor Actor, limit int, cursorID string) (*AssetPage, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		return nil, ErrInvalidInput
	}
	conditions := []predicate.Asset{asset.OrganizationID(actor.OrganizationID), asset.StatusEQ(asset.StatusUPLOADED)}
	if cursorID != "" {
		cursor, err := c.client.Asset.Query().Where(asset.ID(cursorID), asset.OrganizationID(actor.OrganizationID),
			asset.StatusEQ(asset.StatusUPLOADED)).Only(ctx)
		if ent.IsNotFound(err) {
			return nil, publishing.ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		conditions = append(conditions, asset.Or(asset.CreatedAtLT(cursor.CreatedAt),
			asset.And(asset.CreatedAtEQ(cursor.CreatedAt), asset.IDLT(cursor.ID))))
	}
	rows, err := c.client.Asset.Query().Where(conditions...).
		Order(ent.Desc(asset.FieldCreatedAt), ent.Desc(asset.FieldID)).Limit(limit + 1).All(ctx)
	if err != nil {
		return nil, err
	}
	page := &AssetPage{Assets: make([]AssetListItem, 0, limit)}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	for _, row := range rows {
		page.Assets = append(page.Assets, AssetListItem{
			ID: row.ID, Bytes: row.Bytes, CreatedAt: row.CreatedAt,
			Height: row.Height, MediaType: row.MediaType, Width: row.Width,
		})
	}
	if hasMore {
		last := rows[len(rows)-1].ID
		page.NextCursor = &last
	}
	return page, nil
}

type AssetDeletionResult string

const (
	AssetDeleted  AssetDeletionResult = "deleted"
	AssetInUse    AssetDeletionResult = "in-use"
	AssetMissing  AssetDeletionResult = "not-found"
	AssetNotReady AssetDeletionResult = "not-ready"
)

func (c *Configuration) DeleteAsset(ctx context.Context, actor Actor, assetID string) (AssetDeletionResult, error) {
	if err := c.authorizeRoles(ctx, actor,
		"owner", "admin", "creator"); err != nil {
		return "", err
	}
	owned, err := c.client.Asset.Query().Where(asset.ID(assetID), asset.OrganizationID(actor.OrganizationID),
		asset.StatusNEQ(asset.StatusDELETED)).Only(ctx)
	if ent.IsNotFound(err) {
		return AssetMissing, nil
	}
	if err != nil {
		return "", err
	}
	entitlement, err := c.client.WorkspaceEntitlement.Query().Where(workspaceentitlement.ID(actor.OrganizationID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return "", err
	}
	plan, _, features := evaluateBootstrapEntitlement(entitlement, time.Now().UTC())
	if err := requireFeature(features, plan, "asset:delete"); err != nil {
		return "", err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	current, err := tx.Asset.Query().Where(asset.ID(owned.ID), asset.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return AssetMissing, nil
	}
	if err != nil {
		return "", err
	}
	if current.Status == asset.StatusDELETED {
		return AssetMissing, nil
	}
	if current.Status != asset.StatusUPLOADED {
		return AssetNotReady, nil
	}
	// Serialize against Story Set writes before testing their references.
	locked, err := tx.Asset.Update().Where(asset.ID(current.ID), asset.OrganizationID(actor.OrganizationID), asset.StatusEQ(asset.StatusUPLOADED)).SetStatus(asset.StatusUPLOADED).Save(ctx)
	if err != nil {
		return "", err
	}
	if locked != 1 {
		return AssetNotReady, nil
	}
	inSet, err := creativeSetUsesAsset(ctx, tx, actor.OrganizationID, current.ID)
	if err != nil {
		return "", err
	}
	if inSet {
		return AssetInUse, nil
	}
	variantCount, err := tx.CreativeVariant.Query().Where(
		creativevariant.OrganizationID(actor.OrganizationID), creativevariant.SourceAssetID(current.ID),
	).Count(ctx)
	if err != nil {
		return "", err
	}
	if variantCount > 0 {
		return AssetInUse, nil
	}
	changed, err := tx.Asset.Update().Where(asset.ID(current.ID), asset.OrganizationID(actor.OrganizationID),
		asset.StatusEQ(asset.StatusUPLOADED)).SetStatus(asset.StatusDELETED).Save(ctx)
	if err != nil {
		return "", err
	}
	if changed != 1 {
		return AssetMissing, nil
	}
	if _, err := tx.OutboxEvent.Delete().Where(outboxevent.OrganizationID(actor.OrganizationID),
		outboxevent.AggregateID(current.ID), outboxevent.AggregateType("asset"), outboxevent.DeliveredAtIsNil()).Exec(ctx); err != nil {
		return "", err
	}
	if _, err := tx.OutboxEvent.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
		SetType("asset.deleted").SetAggregateType("asset").SetAggregateID(current.ID).
		SetPayload(map[string]any{"assetId": current.ID}).SetIdempotencyKey("asset.deleted:" + current.ID).Save(ctx); err != nil {
		return "", err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.asset_deletion_requested", "asset", current.ID); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return AssetDeleted, nil
}
