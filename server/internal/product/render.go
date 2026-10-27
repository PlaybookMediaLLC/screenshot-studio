package product

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/design"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/predicate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
)

// RenderAsset is what rendering and the storage proxy need to know about a
// workspace image: where its bytes live, what they are, and whether they
// are still usable.
type RenderAsset struct {
	Height    *int      `json:"height"`
	ID        string    `json:"id"`
	MediaType string    `json:"mediaType"`
	ObjectKey string    `json:"objectKey"`
	SHA256    *string   `json:"sha256"`
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updatedAt"`
	Width     *int      `json:"width"`
}

func renderAsset(row *ent.Asset) RenderAsset {
	return RenderAsset{Height: row.Height, ID: row.ID, MediaType: row.MediaType, ObjectKey: row.ObjectKey,
		SHA256: row.Sha256, Status: string(row.Status), UpdatedAt: row.UpdatedAt, Width: row.Width}
}

// FindAssets reads the actor's assets in any status, either by id (up to 100)
// or by object key. Callers decide which statuses they accept.
func (c *Configuration) FindAssets(ctx context.Context, actor Actor, ids []string, objectKey string) ([]RenderAsset, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	var where predicate.Asset
	switch {
	case objectKey != "" && len(ids) == 0:
		where = asset.ObjectKey(objectKey)
	case objectKey == "" && len(ids) > 0 && len(ids) <= 100:
		for _, id := range ids {
			if _, err := uuid.Parse(id); err != nil {
				return nil, ErrInvalidInput
			}
		}
		where = asset.IDIn(ids...)
	default:
		return nil, ErrInvalidInput
	}
	rows, err := c.client.Asset.Query().Where(where, asset.OrganizationID(actor.OrganizationID)).
		Order(ent.Asc(asset.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]RenderAsset, 0, len(rows))
	for _, row := range rows {
		items = append(items, renderAsset(row))
	}
	return items, nil
}

// FindDesignRender returns the image of the most recently updated design in
// the workspace rendered under renderKey, so an identical render is reused.
func (c *Configuration) FindDesignRender(ctx context.Context, actor Actor, renderKey string) (*RenderAsset, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	if !sha256Hex.MatchString(renderKey) {
		return nil, ErrInvalidInput
	}
	hit, err := c.client.Design.Query().Where(design.OrganizationID(actor.OrganizationID), design.RenderKey(renderKey),
		design.RenderedAssetIDNotNil()).Order(ent.Desc(design.FieldUpdatedAt), ent.Desc(design.FieldID)).First(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	row, err := c.client.Asset.Query().Where(asset.ID(*hit.RenderedAssetID), asset.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	result := renderAsset(row)
	return &result, nil
}
