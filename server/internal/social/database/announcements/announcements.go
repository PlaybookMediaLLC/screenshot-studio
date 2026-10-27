// Package announcements ports database/prisma/announcements.
package announcements

import (
	"context"

	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/announcements"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/announcement"
)

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

func (r *Repository) GetAnnouncements(ctx context.Context) ([]*ent.Announcement, error) {
	return r.client.Announcement.Query().Order(ent.Desc(announcement.FieldCreatedAt)).All(ctx)
}

func (r *Repository) CreateAnnouncement(ctx context.Context, body dto.AnnouncementDto) (*ent.Announcement, error) {
	color := announcement.ColorINFO
	if body.Color != "" {
		color = announcement.Color(body.Color)
	}
	return r.client.Announcement.Create().SetTitle(body.Title).SetDescription(body.Description).SetColor(color).Save(ctx)
}

// DeleteAnnouncement returns the deleted row, like Prisma's delete.
func (r *Repository) DeleteAnnouncement(ctx context.Context, id string) (*ent.Announcement, error) {
	row, err := r.client.Announcement.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return row, r.client.Announcement.DeleteOneID(id).Exec(ctx)
}

type Service struct{ repo *Repository }

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func (s *Service) GetAnnouncements(ctx context.Context) ([]*ent.Announcement, error) {
	return s.repo.GetAnnouncements(ctx)
}

func (s *Service) CreateAnnouncement(ctx context.Context, body dto.AnnouncementDto) (*ent.Announcement, error) {
	return s.repo.CreateAnnouncement(ctx, body)
}

func (s *Service) DeleteAnnouncement(ctx context.Context, id string) (*ent.Announcement, error) {
	return s.repo.DeleteAnnouncement(ctx, id)
}
