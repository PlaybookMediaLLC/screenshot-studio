// Package media is database/prisma/media (MediaRepository, MediaService).
package media

import (
	"context"
	"math"
	"strings"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	mediadto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	entmedia "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/predicate"
)

// JSTime marshals like JavaScript's Date#toJSON, the way Prisma rows reach
// clients, for the shaped (select) results below.
type JSTime time.Time

func (t JSTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).UTC().Format(ent.JSTime) + `"`), nil
}

// SavedMedia is saveFile's select. getMediaStatus adds processingError: it is
// only serialized when ProcessingError is set (a nil inner pointer is null),
// so both shapes stay exact.
type SavedMedia struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	OriginalName    *string  `json:"originalName"`
	Path            string   `json:"path"`
	Thumbnail       *string  `json:"thumbnail"`
	Alt             *string  `json:"alt"`
	Status          string   `json:"status"`
	ProcessingError **string `json:"processingError,omitempty"`
}

// StatusResult is a `select: {id, status}` result.
type StatusResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// MediaInformation is saveMediaInformation's select.
type MediaInformation struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	OriginalName       *string `json:"originalName"`
	Alt                *string `json:"alt"`
	Thumbnail          *string `json:"thumbnail"`
	Path               string  `json:"path"`
	ThumbnailTimestamp *int    `json:"thumbnailTimestamp"`
}

// MediaItem is a getMedia result row.
type MediaItem struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	OriginalName       *string `json:"originalName"`
	Path               string  `json:"path"`
	Thumbnail          *string `json:"thumbnail"`
	Alt                *string `json:"alt"`
	ThumbnailTimestamp *int    `json:"thumbnailTimestamp"`
	CreatedAt          JSTime  `json:"createdAt"`
}

type MediaPage struct {
	Pages   int         `json:"pages"`
	Results []MediaItem `json:"results"`
}

// FinishProcessingData: zero values are left out like TypeScript's undefined.
type FinishProcessingData struct {
	Name     string
	Path     string
	FileSize int
	Error    string
}

type Repository struct {
	client *ent.Client
}

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

func saved(m *ent.Media) *SavedMedia {
	return &SavedMedia{ID: m.ID, Name: m.Name, OriginalName: m.OriginalName, Path: m.Path, Thumbnail: m.Thumbnail, Alt: m.Alt, Status: m.Status}
}

func (r *Repository) SaveFile(ctx context.Context, org, fileName, filePath, originalName string) (*SavedMedia, error) {
	create := r.client.Media.Create().SetOrganizationID(org).SetName(fileName).SetPath(filePath)
	if originalName != "" {
		create.SetOriginalName(originalName)
	}
	m, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	return saved(m), nil
}

func (r *Repository) updateOne(org, id string) *ent.MediaUpdateOne {
	return r.client.Media.UpdateOneID(id).Where(entmedia.OrganizationID(org))
}

func (r *Repository) StartProcessing(ctx context.Context, org, id string) (*StatusResult, error) {
	m, err := r.updateOne(org, id).SetStatus("processing").ClearProcessingError().Save(ctx)
	if err != nil {
		return nil, err
	}
	return &StatusResult{ID: m.ID, Status: m.Status}, nil
}

func (r *Repository) FinishProcessing(ctx context.Context, org, id string, data FinishProcessingData) (*StatusResult, error) {
	u := r.updateOne(org, id)
	if data.Name != "" {
		u.SetName(data.Name)
	}
	if data.Path != "" {
		u.SetPath(data.Path)
	}
	if data.FileSize != 0 {
		u.SetFileSize(data.FileSize)
	}
	if data.Error != "" {
		u.SetStatus("failed").SetProcessingError(data.Error)
	} else {
		u.SetStatus("ready").ClearProcessingError()
	}
	m, err := u.Save(ctx)
	if err != nil {
		return nil, err
	}
	return &StatusResult{ID: m.ID, Status: m.Status}, nil
}

// GetMediaStatus returns nil when the media does not exist or was deleted.
func (r *Repository) GetMediaStatus(ctx context.Context, org, id string) (*SavedMedia, error) {
	m, err := r.client.Media.Query().
		Where(entmedia.ID(id), entmedia.OrganizationID(org), entmedia.DeletedAtIsNil()).First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out := saved(m)
	processingError := m.ProcessingError
	out.ProcessingError = &processingError
	return out, nil
}

// GetMediaByID returns nil when the media does not exist (deleted ones included).
func (r *Repository) GetMediaByID(ctx context.Context, id string) (*ent.Media, error) {
	m, err := r.client.Media.Get(ctx, id)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return m, err
}

func (r *Repository) DeleteMedia(ctx context.Context, org, id string) (*ent.Media, error) {
	return r.updateOne(org, id).SetDeletedAt(time.Now()).Save(ctx)
}

func (r *Repository) SaveMediaInformation(ctx context.Context, org string, data mediadto.SaveMediaInformationDto) (*MediaInformation, error) {
	u := r.updateOne(org, data.ID).SetAlt(data.Alt)
	if data.Thumbnail != nil {
		u.SetThumbnail(*data.Thumbnail)
	}
	if data.ThumbnailTimestamp != nil {
		u.SetThumbnailTimestamp(*data.ThumbnailTimestamp)
	}
	m, err := u.Save(ctx)
	if err != nil {
		return nil, err
	}
	return &MediaInformation{ID: m.ID, Name: m.Name, OriginalName: m.OriginalName, Alt: m.Alt, Thumbnail: m.Thumbnail, Path: m.Path, ThumbnailTimestamp: m.ThumbnailTimestamp}, nil
}

func (r *Repository) GetMedia(ctx context.Context, org string, page int, search string) (*MediaPage, error) {
	if page == 0 {
		page = 1
	}
	pageNum := page - 1
	where := []predicate.Media{
		entmedia.OrganizationID(org),
		entmedia.DeletedAtIsNil(),
		// still being normalized: it shows up once the workflow releases it
		entmedia.StatusNEQ("processing"),
	}
	if trimmed := strings.TrimSpace(search); trimmed != "" {
		// Prisma's `contains` + insensitive: ILIKE without escaping
		where = append(where, func(s *entsql.Selector) {
			s.Where(entsql.P(func(b *entsql.Builder) {
				b.Ident(s.C(entmedia.FieldOriginalName)).WriteString(" ILIKE ").Arg("%" + trimmed + "%")
			}))
		})
	}
	total, err := r.client.Media.Query().Where(where...).Count(ctx)
	if err != nil {
		return nil, err
	}
	list, err := r.client.Media.Query().Where(where...).
		Order(entmedia.ByCreatedAt(entsql.OrderDesc())).
		Offset(pageNum * 18).Limit(18).All(ctx)
	if err != nil {
		return nil, err
	}
	results := make([]MediaItem, 0, len(list))
	for _, m := range list {
		results = append(results, MediaItem{ID: m.ID, Name: m.Name, OriginalName: m.OriginalName, Path: m.Path,
			Thumbnail: m.Thumbnail, Alt: m.Alt, ThumbnailTimestamp: m.ThumbnailTimestamp, CreatedAt: JSTime(m.CreatedAt)})
	}
	return &MediaPage{Pages: int(math.Ceil(float64(total) / 18)), Results: results}, nil
}
