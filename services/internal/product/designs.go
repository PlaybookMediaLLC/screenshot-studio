package product

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaign"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/design"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
	"github.com/lucsky/cuid"
)

var designBuiltinPath = regexp.MustCompile(`^/[\w./-]+$`)

type CreateDesignInput struct {
	CampaignID     *string        `json:"campaignId"`
	Document       map[string]any `json:"document"`
	Name           string         `json:"name"`
	ParentDesignID *string        `json:"parentDesignId"`
	PlanAssetKey   *string        `json:"planAssetKey"`
	PlanVersion    *int           `json:"planVersion"`
	TemplateID     *string        `json:"templateId"`
	VariantLabel   *string        `json:"variantLabel"`
}

type DesignAsset struct {
	Height    *int   `json:"height"`
	ID        string `json:"id"`
	ObjectKey string `json:"objectKey"`
	Width     *int   `json:"width"`
}

type DesignRecord struct {
	CampaignID      *string        `json:"campaignId"`
	CreatedAt       time.Time      `json:"createdAt"`
	CreatedByUserID *string        `json:"createdByUserId"`
	Critique        map[string]any `json:"critique"`
	Document        map[string]any `json:"document"`
	ID              string         `json:"id"`
	Name            string         `json:"name"`
	OrganizationID  string         `json:"organizationId"`
	ParentDesignID  *string        `json:"parentDesignId"`
	PlanAssetKey    *string        `json:"planAssetKey"`
	PlanVersion     *int           `json:"planVersion"`
	RenderedAsset   *DesignAsset   `json:"renderedAsset"`
	RenderedAssetID *string        `json:"renderedAssetId"`
	RenderKey       *string        `json:"renderKey"`
	TemplateID      *string        `json:"templateId"`
	UpdatedAt       time.Time      `json:"updatedAt"`
	VariantLabel    *string        `json:"variantLabel"`
}

func designRecord(row *ent.Design) DesignRecord {
	return DesignRecord{CampaignID: row.CampaignID, CreatedAt: row.CreatedAt, CreatedByUserID: row.CreatedByUserID,
		Critique: row.Critique, Document: row.Document, ID: row.ID, Name: row.Name,
		OrganizationID: row.OrganizationID, ParentDesignID: row.ParentDesignID,
		PlanAssetKey: row.PlanAssetKey, PlanVersion: row.PlanVersion, RenderedAssetID: row.RenderedAssetID,
		RenderKey: row.RenderKey, TemplateID: row.TemplateID, UpdatedAt: row.UpdatedAt, VariantLabel: row.VariantLabel}
}

func designSource(value any, ids map[string]bool) bool {
	if value == nil {
		return true
	}
	ref, ok := value.(string)
	if !ok {
		return false
	}
	if strings.HasPrefix(ref, "asset:") {
		id := strings.TrimPrefix(ref, "asset:")
		if _, err := uuid.Parse(id); err != nil {
			return false
		}
		ids[id] = true
		return true
	}
	return designBuiltinPath.MatchString(ref) && !strings.Contains(ref, "..")
}

func designAssetIDs(document map[string]any) ([]string, error) {
	if document == nil || (document["version"] != float64(1) && document["version"] != 1) {
		return nil, ErrInvalidInput
	}
	image, ok := document["image"].(map[string]any)
	if !ok {
		return nil, ErrInvalidInput
	}
	ids := map[string]bool{}
	if !designSource(image["src"], ids) {
		return nil, ErrInvalidInput
	}
	if background, ok := document["background"].(map[string]any); ok && background["type"] == "image" {
		if background["value"] == nil || !designSource(background["value"], ids) {
			return nil, ErrInvalidInput
		}
	}
	if devices, ok := document["devices"].(map[string]any); ok {
		if mockups, ok := devices["mockups"].([]any); ok {
			for _, value := range mockups {
				mockup, ok := value.(map[string]any)
				if !ok {
					return nil, ErrInvalidInput
				}
				screen, ok := mockup["screen"].(map[string]any)
				if ok && !designSource(screen["src"], ids) {
					return nil, ErrInvalidInput
				}
			}
		}
	}
	if overlays, ok := document["overlays"].([]any); ok {
		for _, value := range overlays {
			overlay, ok := value.(map[string]any)
			if !ok || overlay["src"] == nil || !designSource(overlay["src"], ids) {
				return nil, ErrInvalidInput
			}
		}
	}
	result := make([]string, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	return result, nil
}

func requireDesignAssets(ctx context.Context, tx *ent.Tx, organizationID string, document map[string]any) error {
	encoded, err := json.Marshal(document)
	if err != nil || len(encoded) > 1<<20 {
		return ErrInvalidInput
	}
	ids, err := designAssetIDs(document)
	if err != nil || len(ids) == 0 {
		return err
	}
	count, err := tx.Asset.Query().Where(asset.IDIn(ids...), asset.OrganizationID(organizationID),
		asset.StatusEQ(asset.StatusUPLOADED)).Count(ctx)
	if err != nil {
		return err
	}
	if count != len(ids) {
		return publishing.ErrNotFound
	}
	return nil
}

func (c *Configuration) CreateDesign(ctx context.Context, actor Actor, input CreateDesignInput) (*DesignRecord, error) {
	if err := c.authorizeRoles(ctx, actor,
		"owner", "admin", "creator"); err != nil {
		return nil, err
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || utf8.RuneCountInString(input.Name) > 200 ||
		(input.PlanVersion != nil && *input.PlanVersion < 1) {
		return nil, ErrInvalidInput
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := requireDesignAssets(ctx, tx, actor.OrganizationID, input.Document); err != nil {
		return nil, err
	}
	if input.CampaignID != nil {
		owned, err := tx.Campaign.Query().Where(campaign.ID(*input.CampaignID),
			campaign.OrganizationID(actor.OrganizationID)).Exist(ctx)
		if err != nil || !owned {
			if err != nil {
				return nil, err
			}
			return nil, publishing.ErrNotFound
		}
	}
	if input.ParentDesignID != nil {
		owned, err := tx.Design.Query().Where(design.ID(*input.ParentDesignID),
			design.OrganizationID(actor.OrganizationID)).Exist(ctx)
		if err != nil || !owned {
			if err != nil {
				return nil, err
			}
			return nil, publishing.ErrNotFound
		}
	}
	create := tx.Design.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
		SetName(input.Name).SetDocument(input.Document)
	if input.CampaignID != nil {
		create.SetCampaignID(*input.CampaignID)
	}
	if input.ParentDesignID != nil {
		create.SetParentDesignID(*input.ParentDesignID)
	}
	if input.PlanAssetKey != nil {
		create.SetPlanAssetKey(*input.PlanAssetKey)
	}
	if input.PlanVersion != nil {
		create.SetPlanVersion(*input.PlanVersion)
	}
	if input.VariantLabel != nil {
		create.SetVariantLabel(*input.VariantLabel)
	}
	templateID := input.TemplateID
	if templateID == nil {
		if value, ok := input.Document["template"].(string); ok {
			templateID = &value
		}
	}
	if templateID != nil {
		create.SetTemplateID(*templateID)
	}
	if actor.UserID != "" {
		create.SetCreatedByUserID(actor.UserID)
	}
	row, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.design_created", "design", row.ID,
		map[string]any{"campaignId": input.CampaignID, "parentDesignId": input.ParentDesignID, "templateId": templateID}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	result := designRecord(row.Unwrap())
	return &result, nil
}

func (c *Configuration) GetDesign(ctx context.Context, actor Actor, id string) (*DesignRecord, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	row, err := c.client.Design.Query().Where(design.ID(id), design.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	result := designRecord(row)
	return &result, nil
}

func (c *Configuration) UpdateDesignDocument(ctx context.Context, actor Actor, id string, document map[string]any) error {
	if err := c.authorizeRoles(ctx, actor,
		"owner", "admin", "creator"); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := requireDesignAssets(ctx, tx, actor.OrganizationID, document); err != nil {
		return err
	}
	update := tx.Design.Update().Where(design.ID(id), design.OrganizationID(actor.OrganizationID)).SetDocument(document)
	if template, ok := document["template"].(string); ok && template != "" {
		update.SetTemplateID(template)
	} else {
		update.ClearTemplateID()
	}
	count, err := update.Save(ctx)
	if err != nil {
		return err
	}
	if count == 0 {
		return publishing.ErrNotFound
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.design_updated", "design", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (c *Configuration) SetDesignRender(ctx context.Context, actor Actor, id, assetID string, renderKey *string) error {
	if err := c.authorizeRoles(ctx, actor,
		"owner", "admin", "creator"); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ownedAsset, err := tx.Asset.Query().Where(asset.ID(assetID), asset.OrganizationID(actor.OrganizationID),
		asset.StatusEQ(asset.StatusUPLOADED)).Exist(ctx)
	if err != nil {
		return err
	}
	if !ownedAsset {
		return publishing.ErrNotFound
	}
	update := tx.Design.Update().Where(design.ID(id), design.OrganizationID(actor.OrganizationID)).SetRenderedAssetID(assetID)
	if renderKey == nil {
		update.ClearRenderKey()
	} else {
		update.SetRenderKey(*renderKey)
	}
	count, err := update.Save(ctx)
	if err != nil {
		return err
	}
	if count == 0 {
		return publishing.ErrNotFound
	}
	return tx.Commit()
}

func (c *Configuration) ListCampaignDesigns(ctx context.Context, actor Actor, campaignID string) ([]DesignRecord, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	rows, err := c.client.Design.Query().Where(design.CampaignID(campaignID), design.OrganizationID(actor.OrganizationID)).
		Order(ent.Asc(design.FieldCreatedAt), ent.Asc(design.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]DesignRecord, 0, len(rows))
	for _, row := range rows {
		item := designRecord(row)
		if row.RenderedAssetID != nil {
			media, err := c.client.Asset.Query().Where(asset.ID(*row.RenderedAssetID), asset.OrganizationID(actor.OrganizationID)).Only(ctx)
			if err != nil && !ent.IsNotFound(err) {
				return nil, err
			}
			if media != nil {
				item.RenderedAsset = &DesignAsset{Height: media.Height, ID: media.ID, ObjectKey: media.ObjectKey, Width: media.Width}
			}
		}
		items = append(items, item)
	}
	return items, nil
}
