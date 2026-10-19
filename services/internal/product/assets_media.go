package product

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"regexp"
	"strings"
	"time"

	_ "golang.org/x/image/webp"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspaceentitlement"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/google/uuid"
	"github.com/lucsky/cuid"
)

var (
	ErrStorageUnavailable = errors.New("media storage is unavailable")
	ErrObjectMissing      = errors.New("the signed upload was not found in storage")
	ErrStorageQuota       = errors.New("workspace storage quota exceeded")
	assetSegmentPattern   = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
	assetHashPattern      = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)
)

type AssetObjectStore interface {
	SignUpload(context.Context, string, string) (string, error)
	SignDownload(context.Context, string) (string, error)
	Exists(context.Context, string) (bool, error)
	Put(context.Context, string, string, io.Reader) error
	Read(context.Context, string) ([]byte, error)
	Delete(context.Context, string) error
}

type GeneratedAssetInput struct {
	Body           []byte
	Classification string
	ContentType    string
	FileName       string
	Height         int
	ParentAssetID  string
	Width          int
}

type GeneratedAssetRecord struct {
	ID        string `json:"id"`
	MediaType string `json:"mediaType"`
	ObjectKey string `json:"objectKey"`
}

type AssetUploadInput struct {
	Bytes          int     `json:"bytes"`
	Classification string  `json:"classification"`
	ContentType    string  `json:"contentType"`
	FileName       string  `json:"fileName"`
	SHA256         *string `json:"sha256"`
}

type AssetRecord struct {
	ID        string `json:"id"`
	ObjectKey string `json:"objectKey"`
	Status    string `json:"status"`
}

type AssetUploadResult struct {
	Asset     AssetRecord `json:"asset"`
	UploadURL string      `json:"uploadUrl"`
}

func recordAsset(row *ent.Asset) AssetRecord {
	return AssetRecord{ID: row.ID, ObjectKey: row.ObjectKey, Status: string(row.Status)}
}

func validAssetSegment(value string) bool {
	return value != "" && value != "." && value != ".." && assetSegmentPattern.MatchString(value)
}

func validAssetUpload(input AssetUploadInput) bool {
	if input.Bytes < 1 || input.Bytes > 50<<20 || len(input.FileName) > 128 || !validAssetSegment(input.FileName) ||
		(input.SHA256 != nil && !assetHashPattern.MatchString(*input.SHA256)) {
		return false
	}
	switch input.Classification {
	case "capture", "derived", "export", "input":
	default:
		return false
	}
	switch input.ContentType {
	case "image/gif", "image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm",
		// Audio for design timelines (music, voice-over).
		"audio/aac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm":
		return true
	default:
		return false
	}
}

func (c *Configuration) SignAssetUpload(ctx context.Context, actor Actor, input AssetUploadInput) (*AssetUploadResult, error) {
	if err := c.authorizeRoles(ctx, actor,
		"owner", "admin", "creator"); err != nil {
		return nil, err
	}
	if input.Classification == "" {
		input.Classification = "input"
	}
	input.FileName = strings.TrimSpace(input.FileName)
	if !validAssetUpload(input) || !validAssetSegment(actor.OrganizationID) {
		return nil, ErrInvalidInput
	}
	if c.objects == nil {
		return nil, ErrStorageUnavailable
	}
	entitlement, err := c.client.WorkspaceEntitlement.Query().Where(workspaceentitlement.ID(actor.OrganizationID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	plan, _, features := evaluateBootstrapEntitlement(entitlement, time.Now().UTC())
	if err := requireFeature(features, plan, "asset:create"); err != nil {
		return nil, err
	}
	used, err := c.client.Asset.Query().Where(asset.OrganizationID(actor.OrganizationID),
		asset.StatusNEQ(asset.StatusDELETED)).Aggregate(func(s *entsql.Selector) string {
		return fmt.Sprintf("COALESCE(SUM(%s), 0)", s.C(asset.FieldBytes))
	}).Int(ctx)
	if err != nil {
		return nil, err
	}
	limits := map[string]int64{"free": 0, "pro": 25 << 30, "business": 250 << 30, "enterprise": 5 << 40}
	if int64(used)+int64(input.Bytes) > limits[plan] {
		return nil, ErrStorageQuota
	}
	id := uuid.NewString()
	key := fmt.Sprintf("org/%s/%s/%s/1/%s", actor.OrganizationID, input.Classification, id, input.FileName)
	url, err := c.objects.SignUpload(ctx, key, input.ContentType)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	create := tx.Asset.Create().SetID(id).SetOrganizationID(actor.OrganizationID).
		SetObjectKey(key).SetMediaType(input.ContentType).SetBytes(input.Bytes)
	if input.SHA256 != nil {
		create.SetSha256(*input.SHA256)
	}
	row, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.asset_upload_signed", "asset", row.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &AssetUploadResult{Asset: recordAsset(row.Unwrap()), UploadURL: url}, nil
}

func (c *Configuration) CompleteAssetUpload(ctx context.Context, actor Actor, assetID string, sha256 *string) (*AssetRecord, error) {
	if err := c.authorizeRoles(ctx, actor,
		"owner", "admin", "creator"); err != nil {
		return nil, err
	}
	if sha256 != nil && !assetHashPattern.MatchString(*sha256) {
		return nil, ErrInvalidInput
	}
	row, err := c.client.Asset.Query().Where(asset.ID(assetID), asset.OrganizationID(actor.OrganizationID),
		asset.StatusNEQ(asset.StatusDELETED)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if row.Status == asset.StatusUPLOADED {
		result := recordAsset(row)
		return &result, nil
	}
	if row.Status != asset.StatusPENDING {
		return nil, publishing.ErrInvalidState
	}
	if c.objects == nil {
		return nil, ErrStorageUnavailable
	}
	exists, err := c.objects.Exists(ctx, row.ObjectKey)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
	}
	if !exists {
		return nil, ErrObjectMissing
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	update := tx.Asset.Update().Where(asset.ID(row.ID), asset.OrganizationID(actor.OrganizationID),
		asset.StatusEQ(asset.StatusPENDING)).SetStatus(asset.StatusUPLOADED)
	if sha256 != nil {
		update.SetSha256(*sha256)
	}
	count, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	if count == 1 {
		if _, err := tx.OutboxEvent.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
			SetType("asset.uploaded").SetAggregateType("asset").SetAggregateID(row.ID).
			SetPayload(map[string]any{"assetId": row.ID, "actorUserId": actor.UserID, "ownerUserId": actor.UserID}).SetIdempotencyKey("asset.uploaded:" + row.ID).Save(ctx); err != nil {
			return nil, err
		}
		if err := appendConfigurationAudit(ctx, tx, actor, "product.asset_uploaded", "asset", row.ID); err != nil {
			return nil, err
		}
	}
	current, err := tx.Asset.Query().Where(asset.ID(row.ID), asset.OrganizationID(actor.OrganizationID)).Only(ctx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	result := recordAsset(current)
	return &result, nil
}

func (c *Configuration) SignAssetDownload(ctx context.Context, actor Actor, assetID string) (string, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return "", err
	}
	row, err := c.client.Asset.Query().Where(asset.ID(assetID), asset.OrganizationID(actor.OrganizationID),
		asset.StatusEQ(asset.StatusUPLOADED)).Only(ctx)
	if ent.IsNotFound(err) {
		return "", publishing.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if c.objects == nil {
		return "", ErrStorageUnavailable
	}
	url, err := c.objects.SignDownload(ctx, row.ObjectKey)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
	}
	return url, nil
}

func (c *Configuration) ReadAsset(ctx context.Context, actor Actor, assetID string) ([]byte, string, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, "", err
	}
	row, err := c.client.Asset.Query().Where(asset.ID(assetID), asset.OrganizationID(actor.OrganizationID),
		asset.StatusEQ(asset.StatusUPLOADED)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, "", publishing.ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	if c.objects == nil {
		return nil, "", ErrStorageUnavailable
	}
	body, err := c.objects.Read(ctx, row.ObjectKey)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
	}
	return body, row.MediaType, nil
}

func (c *Configuration) StoreGeneratedAsset(ctx context.Context, actor Actor, input GeneratedAssetInput) (*GeneratedAssetRecord, error) {
	if err := c.authorizeRoles(ctx, actor,
		"owner", "admin", "creator"); err != nil {
		return nil, err
	}
	if c.objects == nil {
		return nil, ErrStorageUnavailable
	}
	if input.ContentType != "image/png" && input.ContentType != "image/jpeg" && input.ContentType != "image/webp" {
		return nil, ErrInvalidInput
	}
	if input.Classification != "capture" && input.Classification != "derived" &&
		input.Classification != "export" && input.Classification != "input" {
		return nil, ErrInvalidInput
	}
	if len(input.Body) == 0 || len(input.Body) > 50<<20 || !validAssetSegment(input.FileName) ||
		!validAssetSegment(actor.OrganizationID) || input.Width <= 0 || input.Height <= 0 {
		return nil, ErrInvalidInput
	}
	dimensions, _, err := image.DecodeConfig(bytes.NewReader(input.Body))
	if err != nil || dimensions.Width != input.Width || dimensions.Height != input.Height {
		return nil, ErrInvalidInput
	}
	if input.ParentAssetID != "" {
		exists, err := c.client.Asset.Query().Where(asset.ID(input.ParentAssetID),
			asset.OrganizationID(actor.OrganizationID), asset.StatusEQ(asset.StatusUPLOADED)).Exist(ctx)
		if err != nil {
			return nil, err
		}
		if !exists {
			return nil, publishing.ErrNotFound
		}
	}
	entitlement, err := c.client.WorkspaceEntitlement.Query().Where(workspaceentitlement.ID(actor.OrganizationID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	plan, _, features := evaluateBootstrapEntitlement(entitlement, time.Now().UTC())
	if err := requireFeature(features, plan, "asset:create"); err != nil {
		return nil, err
	}
	used, err := c.client.Asset.Query().Where(asset.OrganizationID(actor.OrganizationID),
		asset.StatusNEQ(asset.StatusDELETED)).Aggregate(func(s *entsql.Selector) string {
		return fmt.Sprintf("COALESCE(SUM(%s), 0)", s.C(asset.FieldBytes))
	}).Int(ctx)
	if err != nil {
		return nil, err
	}
	limits := map[string]int64{"free": 0, "pro": 25 << 30, "business": 250 << 30, "enterprise": 5 << 40}
	if int64(used)+int64(len(input.Body)) > limits[plan] {
		return nil, ErrStorageQuota
	}
	id := uuid.NewString()
	key := fmt.Sprintf("org/%s/%s/%s/1/%s", actor.OrganizationID, input.Classification, id, input.FileName)
	if err := c.objects.Put(ctx, key, input.ContentType, bytes.NewReader(input.Body)); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrStorageUnavailable, err)
	}
	committed := false
	defer func() {
		if !committed {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_ = c.objects.Delete(cleanupCtx, key)
		}
	}()
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	create := tx.Asset.Create().SetID(id).SetOrganizationID(actor.OrganizationID).
		SetObjectKey(key).SetMediaType(input.ContentType).SetBytes(len(input.Body)).
		SetSha256(fmt.Sprintf("%x", sha256.Sum256(input.Body))).SetStatus(asset.StatusUPLOADED).
		SetWidth(input.Width).SetHeight(input.Height)
	if input.ParentAssetID != "" {
		create.SetParentAssetID(input.ParentAssetID)
	}
	row, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := tx.OutboxEvent.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
		SetType("asset.uploaded").SetAggregateType("asset").SetAggregateID(row.ID).
		SetPayload(map[string]any{"activityKind": "asset.generated", "assetId": row.ID, "ownerUserId": actor.UserID, "background": true}).SetIdempotencyKey("asset.uploaded:" + row.ID).Save(ctx); err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.asset_generated", "asset", row.ID,
		map[string]any{"classification": input.Classification, "parentAssetId": input.ParentAssetID}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	return &GeneratedAssetRecord{ID: row.ID, MediaType: row.MediaType, ObjectKey: row.ObjectKey}, nil
}
