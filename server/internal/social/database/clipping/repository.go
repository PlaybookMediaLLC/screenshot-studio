// Package clipping is database/prisma/clipping (ClippingRepository,
// ClippingService).
package clipping

import (
	"context"
	"encoding/json"
	"math"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	entclipping "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/clipping"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/clippingclip"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/predicate"
)

// JSTime marshals like JavaScript's Date#toJSON, the way Prisma rows reach
// clients, for the shaped (select) results below.
type JSTime time.Time

func (t JSTime) MarshalJSON() ([]byte, error) {
	return []byte(`"` + time.Time(t).UTC().Format(ent.JSTime) + `"`), nil
}

// StatusResult is a `select: {id, status}` result.
type StatusResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type ClipDetails struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Content   string  `json:"content"`
	Start     float64 `json:"start"`
	End       float64 `json:"end"`
	Status    string  `json:"status"`
	Error     *string `json:"error"`
	MediaID   *string `json:"mediaId"`
	Path      *string `json:"path"`
	Thumbnail *string `json:"thumbnail"`
}

// ClippingDetails is getClipping's select.
type ClippingDetails struct {
	ID        string        `json:"id"`
	URL       string        `json:"url"`
	Status    string        `json:"status"`
	Error     *string       `json:"error"`
	Title     *string       `json:"title"`
	Thumbnail *string       `json:"thumbnail"`
	Duration  *int          `json:"duration"`
	CreatedAt JSTime        `json:"createdAt"`
	Clips     []ClipDetails `json:"clips"`
}

type ClipProgress struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Status    string  `json:"status"`
	Error     *string `json:"error"`
	MediaID   *string `json:"mediaId"`
	Path      *string `json:"path"`
	Thumbnail *string `json:"thumbnail"`
}

// ClippingProgress is getClippingProgress's select: only what the widget
// shows and reports.
type ClippingProgress struct {
	ID     string         `json:"id"`
	Status string         `json:"status"`
	Error  *string        `json:"error"`
	Title  *string        `json:"title"`
	Clips  []ClipProgress `json:"clips"`
}

// ClippingSummary is a getClippings row.
type ClippingSummary struct {
	ID        string  `json:"id"`
	URL       string  `json:"url"`
	Status    string  `json:"status"`
	Error     *string `json:"error"`
	Title     *string `json:"title"`
	Thumbnail *string `json:"thumbnail"`
	Duration  *int    `json:"duration"`
	CreatedAt JSTime  `json:"createdAt"`
}

type ClippingsPage struct {
	Pages   int               `json:"pages"`
	Results []ClippingSummary `json:"results"`
}

// NewClip is a clip picked by the model.
type NewClip struct {
	Title   string
	Content string
	Start   float64
	End     float64
}

type Repository struct {
	client *ent.Client
}

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

func (r *Repository) CreateClipping(ctx context.Context, org, url string, maxClips int, fit string, integrations []string) (*StatusResult, error) {
	if integrations == nil {
		integrations = []string{}
	}
	data, err := json.Marshal(integrations)
	if err != nil {
		return nil, err
	}
	c, err := r.client.Clipping.Create().
		SetOrganizationID(org).SetURL(url).SetMaxClips(maxClips).SetFit(fit).SetIntegrations(string(data)).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	return &StatusResult{ID: c.ID, Status: c.Status}, nil
}

// GetRunningClippings selects id, status and createdAt.
func (r *Repository) GetRunningClippings(ctx context.Context, org string) ([]*ent.Clipping, error) {
	return r.client.Clipping.Query().
		Where(entclipping.OrganizationID(org), entclipping.DeletedAtIsNil(), entclipping.StatusNotIn("completed", "failed")).
		Select(entclipping.FieldID, entclipping.FieldStatus, entclipping.FieldCreatedAt).All(ctx)
}

func (r *Repository) CountClippingsSince(ctx context.Context, org string, since time.Time) (int, error) {
	return r.client.Clipping.Query().
		Where(entclipping.OrganizationID(org), entclipping.CreatedAtGTE(since)).Count(ctx)
}

func clipsByStart(q *ent.ClippingClipQuery) { q.Order(clippingclip.ByStart()) }

// GetClippingByID returns the clipping with its clips (by start), or nil.
func (r *Repository) GetClippingByID(ctx context.Context, id string) (*ent.Clipping, error) {
	c, err := r.client.Clipping.Query().
		Where(entclipping.ID(id), entclipping.DeletedAtIsNil()).
		WithClips(clipsByStart).First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return c, err
}

func (r *Repository) find(ctx context.Context, org, id string) (*ent.Clipping, error) {
	c, err := r.client.Clipping.Query().
		Where(entclipping.ID(id), entclipping.OrganizationID(org), entclipping.DeletedAtIsNil()).
		WithClips(clipsByStart).First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return c, err
}

func (r *Repository) GetClipping(ctx context.Context, org, id string) (*ClippingDetails, error) {
	c, err := r.find(ctx, org, id)
	if err != nil || c == nil {
		return nil, err
	}
	out := &ClippingDetails{ID: c.ID, URL: c.URL, Status: c.Status, Error: c.Error, Title: c.Title, Thumbnail: c.Thumbnail,
		Duration: c.Duration, CreatedAt: JSTime(c.CreatedAt), Clips: []ClipDetails{}}
	for _, clip := range c.Edges.Clips {
		out.Clips = append(out.Clips, ClipDetails{ID: clip.ID, Title: clip.Title, Content: clip.Content, Start: clip.Start,
			End: clip.End, Status: clip.Status, Error: clip.Error, MediaID: clip.MediaID, Path: clip.Path, Thumbnail: clip.Thumbnail})
	}
	return out, nil
}

func (r *Repository) GetClippingProgress(ctx context.Context, org, id string) (*ClippingProgress, error) {
	c, err := r.find(ctx, org, id)
	if err != nil || c == nil {
		return nil, err
	}
	out := &ClippingProgress{ID: c.ID, Status: c.Status, Error: c.Error, Title: c.Title, Clips: []ClipProgress{}}
	for _, clip := range c.Edges.Clips {
		out.Clips = append(out.Clips, ClipProgress{ID: clip.ID, Title: clip.Title, Status: clip.Status, Error: clip.Error,
			MediaID: clip.MediaID, Path: clip.Path, Thumbnail: clip.Thumbnail})
	}
	return out, nil
}

func (r *Repository) GetClippings(ctx context.Context, org string, page int) (*ClippingsPage, error) {
	pageNum := max(page, 1) - 1
	where := []predicate.Clipping{entclipping.OrganizationID(org), entclipping.DeletedAtIsNil()}
	total, err := r.client.Clipping.Query().Where(where...).Count(ctx)
	if err != nil {
		return nil, err
	}
	list, err := r.client.Clipping.Query().Where(where...).
		Order(entclipping.ByCreatedAt(entsql.OrderDesc())).
		Offset(pageNum * 20).Limit(20).All(ctx)
	if err != nil {
		return nil, err
	}
	results := make([]ClippingSummary, 0, len(list))
	for _, c := range list {
		results = append(results, ClippingSummary{ID: c.ID, URL: c.URL, Status: c.Status, Error: c.Error, Title: c.Title,
			Thumbnail: c.Thumbnail, Duration: c.Duration, CreatedAt: JSTime(c.CreatedAt)})
	}
	return &ClippingsPage{Pages: int(math.Ceil(float64(total) / 20)), Results: results}, nil
}

// UpdateClipping applies set (the Prisma `data`) to the organization's clipping.
func (r *Repository) UpdateClipping(ctx context.Context, org, id string, set func(*ent.ClippingUpdateOne)) (*StatusResult, error) {
	u := r.client.Clipping.UpdateOneID(id).Where(entclipping.OrganizationID(org))
	set(u)
	c, err := u.Save(ctx)
	if err != nil {
		return nil, err
	}
	return &StatusResult{ID: c.ID, Status: c.Status}, nil
}

// CreateClips stores the picked clips once and returns their ids. An attempt
// that timed out can still be running when its retry gets here, and only one
// may store clips. The look at what is there is not enough on its own (both
// can see nothing), so the update takes the row of the clipping first: the
// second attempt waits on it until the first commits and then finds its clips
func (r *Repository) CreateClips(ctx context.Context, clippingID string, clips []NewClip) ([]string, error) {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	ids, err := func() ([]string, error) {
		if err := tx.Clipping.UpdateOneID(clippingID).SetUpdatedAt(time.Now()).Exec(ctx); err != nil {
			return nil, err
		}
		existing, err := tx.ClippingClip.Query().Where(clippingclip.ClippingID(clippingID)).IDs(ctx)
		if err != nil || len(existing) > 0 {
			return existing, err
		}
		builders := make([]*ent.ClippingClipCreate, 0, len(clips))
		for _, clip := range clips {
			builders = append(builders, tx.ClippingClip.Create().
				SetClippingID(clippingID).SetTitle(clip.Title).SetContent(clip.Content).SetStart(clip.Start).SetEnd(clip.End))
		}
		if err := tx.ClippingClip.CreateBulk(builders...).Exec(ctx); err != nil {
			return nil, err
		}
		return tx.ClippingClip.Query().Where(clippingclip.ClippingID(clippingID)).IDs(ctx)
	}()
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return ids, tx.Commit()
}

func (r *Repository) FailUnfinishedClips(ctx context.Context, clippingID, message string) error {
	return r.client.ClippingClip.Update().
		Where(clippingclip.ClippingID(clippingID), clippingclip.Status("pending")).
		SetStatus("failed").SetError(message).Exec(ctx)
}

// ClaimClipDraft: only the attempt that moves draftedAt off null may create
// the draft
func (r *Repository) ClaimClipDraft(ctx context.Context, id string) (bool, error) {
	count, err := r.client.ClippingClip.Update().
		Where(clippingclip.ID(id), clippingclip.DraftedAtIsNil()).
		SetDraftedAt(time.Now()).Save(ctx)
	return count == 1, err
}

// GetClipByID returns the clip with its clipping, or nil.
func (r *Repository) GetClipByID(ctx context.Context, id string) (*ent.ClippingClip, error) {
	c, err := r.client.ClippingClip.Query().Where(clippingclip.ID(id)).WithClipping().Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return c, err
}

// UpdateClip applies set (the Prisma `data`) to the clip.
func (r *Repository) UpdateClip(ctx context.Context, id string, set func(*ent.ClippingClipUpdateOne)) (*StatusResult, error) {
	u := r.client.ClippingClip.UpdateOneID(id)
	set(u)
	c, err := u.Save(ctx)
	if err != nil {
		return nil, err
	}
	return &StatusResult{ID: c.ID, Status: c.Status}, nil
}
