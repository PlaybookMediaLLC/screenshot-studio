// Package notifications ports database/prisma/notifications: the
// NotificationsRepository and NotificationService.
package notifications

import (
	"context"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/user"
)

type Repository struct {
	client *ent.Client
}

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

// GetLastReadNotification returns the user's lastReadNotifications; it fails
// with a not found error for an unknown user (the TS `!` then throws).
func (r *Repository) GetLastReadNotification(ctx context.Context, userID string) (time.Time, error) {
	u, err := r.client.User.Query().Where(user.ID(userID)).Select(user.FieldLastReadNotifications).First(ctx)
	if err != nil {
		return time.Time{}, err
	}
	return u.LastReadNotifications, nil
}

// MainPageCount is getMainPageCount's result.
type MainPageCount struct {
	Total int `json:"total"`
}

func (r *Repository) GetMainPageCount(ctx context.Context, organizationID, userID string) (*MainPageCount, error) {
	_, err := r.GetLastReadNotification(ctx, userID)
	if err != nil {
		return nil, err
	}
	total, err := r.client.Notifications.Query().
		Where(notifications.OrganizationID(organizationID), notifications.DeletedAtIsNil()).Count(ctx)
	if err != nil {
		return nil, err
	}
	return &MainPageCount{Total: total}, nil
}

func (r *Repository) CreateNotification(ctx context.Context, organizationID, content string) error {
	return r.client.Notifications.Create().SetOrganizationID(organizationID).SetContent(content).Exec(ctx)
}

func (r *Repository) GetNotificationsSince(ctx context.Context, organizationID string, since time.Time) ([]*ent.Notifications, error) {
	return r.client.Notifications.Query().
		Where(notifications.OrganizationID(organizationID), notifications.CreatedAtGTE(since)).All(ctx)
}

// PaginatedNotification is one row of getNotificationsPaginated's select.
type PaginatedNotification struct {
	ID        string               `json:"id"`
	Content   string               `json:"content"`
	Link      *string              `json:"link"`
	CreatedAt organizations.JSTime `json:"createdAt"`
}

type PaginatedNotifications struct {
	Notifications []PaginatedNotification `json:"notifications"`
	Total         int                     `json:"total"`
	Page          int                     `json:"page"`
	Limit         int                     `json:"limit"`
	HasMore       bool                    `json:"hasMore"`
}

func (r *Repository) GetNotificationsPaginated(ctx context.Context, organizationID string, page int) (*PaginatedNotifications, error) {
	const limit = 100
	skip := page * limit

	rows, err := r.client.Notifications.Query().
		Where(notifications.OrganizationID(organizationID), notifications.DeletedAtIsNil()).
		Order(ent.Desc(notifications.FieldCreatedAt)).
		Offset(skip).Limit(limit).
		All(ctx)
	if err != nil {
		return nil, err
	}
	total, err := r.client.Notifications.Query().
		Where(notifications.OrganizationID(organizationID), notifications.DeletedAtIsNil()).Count(ctx)
	if err != nil {
		return nil, err
	}

	out := &PaginatedNotifications{
		Notifications: make([]PaginatedNotification, 0, len(rows)),
		Total:         total, Page: page, Limit: limit,
		HasMore: skip+len(rows) < total,
	}
	for _, n := range rows {
		out.Notifications = append(out.Notifications, PaginatedNotification{
			ID: n.ID, Content: n.Content, Link: n.Link, CreatedAt: organizations.JSTime{Time: n.CreatedAt},
		})
	}
	return out, nil
}

// RecentNotification is one row of getNotifications' select.
type RecentNotification struct {
	CreatedAt organizations.JSTime `json:"createdAt"`
	Content   string               `json:"content"`
}

type RecentNotifications struct {
	LastReadNotifications organizations.JSTime `json:"lastReadNotifications"`
	Notifications         []RecentNotification `json:"notifications"`
}

// GetNotifications is read-only. The global timestamp cannot establish per-workspace read status.
func (r *Repository) GetNotifications(ctx context.Context, organizationID, userID string) (*RecentNotifications, error) {
	lastRead, err := r.GetLastReadNotification(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := r.client.Notifications.Query().
		Where(notifications.OrganizationID(organizationID), notifications.DeletedAtIsNil()).
		Order(ent.Desc(notifications.FieldCreatedAt)).
		Limit(10).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := &RecentNotifications{
		LastReadNotifications: organizations.JSTime{Time: lastRead},
		Notifications:         make([]RecentNotification, 0, len(rows)),
	}
	for _, n := range rows {
		out.Notifications = append(out.Notifications, RecentNotification{CreatedAt: organizations.JSTime{Time: n.CreatedAt}, Content: n.Content})
	}
	return out, nil
}
