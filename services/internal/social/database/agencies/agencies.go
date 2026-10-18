// Package agencies ports database/prisma/agencies. SocialMediaAgencyNiche has
// a composite key and no Ent entity, so niches go through SQL.
package agencies

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"

	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/agencies"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/socialmediaagency"
)

// NotificationService is the part of notifications.Service agencies uses.
type NotificationService interface {
	SendEmail(ctx context.Context, to, subject, html, replyTo string) error
}

type Niche struct {
	AgencyID string `json:"agencyId"`
	Niche    string `json:"niche"`
}

// Agency is a SocialMediaAgency row with its niches (include: {niches: true}).
type Agency struct {
	*ent.SocialMediaAgency
	Niches []Niche
}

func (a Agency) MarshalJSON() ([]byte, error) {
	base, err := json.Marshal(a.SocialMediaAgency)
	if err != nil {
		return nil, err
	}
	niches := a.Niches
	if niches == nil {
		niches = []Niche{}
	}
	extra, err := json.Marshal(niches)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	buf.Write(base[:len(base)-1])
	buf.WriteString(`,"niches":`)
	buf.Write(extra)
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// Slug is getAllAgenciesSlug's select.
type Slug struct {
	Slug *string `json:"slug"`
}

// IDResponse is createAgency's select {id}.
type IDResponse struct {
	ID string `json:"id"`
}

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

func (r *Repository) niches(ctx context.Context, ids []string) (map[string][]Niche, error) {
	out := map[string][]Niche{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.client.QueryContext(ctx, `SELECT "agencyId", "niche" FROM "SocialMediaAgencyNiche" WHERE "agencyId" = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var n Niche
		if err := rows.Scan(&n.AgencyID, &n.Niche); err != nil {
			return nil, err
		}
		out[n.AgencyID] = append(out[n.AgencyID], n)
	}
	return out, rows.Err()
}

func (r *Repository) withNiches(ctx context.Context, rows []*ent.SocialMediaAgency) ([]Agency, error) {
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	niches, err := r.niches(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]Agency, 0, len(rows))
	for _, row := range rows {
		out = append(out, Agency{SocialMediaAgency: row, Niches: niches[row.ID]})
	}
	return out, nil
}

// one loads a single agency with niches; nil when not found.
func (r *Repository) one(ctx context.Context, q *ent.SocialMediaAgencyQuery) (*Agency, error) {
	row, err := q.First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	list, err := r.withNiches(ctx, []*ent.SocialMediaAgency{row})
	if err != nil {
		return nil, err
	}
	return &list[0], nil
}

func (r *Repository) GetAllAgencies(ctx context.Context) ([]Agency, error) {
	rows, err := r.client.SocialMediaAgency.Query().
		Where(socialmediaagency.DeletedAtIsNil(), socialmediaagency.Approved(true)).
		WithLogo().
		Order(ent.Desc(socialmediaagency.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	return r.withNiches(ctx, rows)
}

func (r *Repository) GetCount(ctx context.Context) (int, error) {
	return r.client.SocialMediaAgency.Query().
		Where(socialmediaagency.DeletedAtIsNil(), socialmediaagency.Approved(true)).Count(ctx)
}

func (r *Repository) GetAllAgenciesSlug(ctx context.Context) ([]Slug, error) {
	rows, err := r.client.SocialMediaAgency.Query().
		Where(socialmediaagency.DeletedAtIsNil(), socialmediaagency.Approved(true)).
		Select(socialmediaagency.FieldSlug).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Slug, 0, len(rows))
	for _, row := range rows {
		out = append(out, Slug{Slug: row.Slug})
	}
	return out, nil
}

func (r *Repository) ApproveOrDecline(ctx context.Context, action, id string) (*ent.SocialMediaAgency, error) {
	return r.client.SocialMediaAgency.UpdateOneID(id).SetApproved(action == "approve").Save(ctx)
}

func (r *Repository) GetAgencyByID(ctx context.Context, id string) (*Agency, error) {
	return r.one(ctx, r.client.SocialMediaAgency.Query().
		Where(socialmediaagency.ID(id), socialmediaagency.DeletedAtIsNil(), socialmediaagency.Approved(true)).
		WithLogo().WithUser())
}

func (r *Repository) GetAgencyInformation(ctx context.Context, agency string) (*Agency, error) {
	return r.one(ctx, r.client.SocialMediaAgency.Query().
		Where(socialmediaagency.Slug(agency), socialmediaagency.DeletedAtIsNil(), socialmediaagency.Approved(true)).
		WithLogo())
}

func (r *Repository) GetAgencyByUser(ctx context.Context, user *ent.User) (*Agency, error) {
	return r.one(ctx, r.client.SocialMediaAgency.Query().
		Where(socialmediaagency.UserID(user.ID), socialmediaagency.DeletedAtIsNil()).
		WithLogo())
}

// CreateAgency upserts the user's agency (approval resets), then syncs its
// niches: drop the ones not in body.niches and add the missing ones.
func (r *Repository) CreateAgency(ctx context.Context, user *ent.User, body dto.CreateAgencyDto) (IDResponse, error) {
	logoID := ""
	if body.Logo != nil {
		logoID = body.Logo.ID
	}
	create := r.client.SocialMediaAgency.Create().
		SetUserID(user.ID).SetName(body.Name).SetWebsite(body.Website).
		SetNillableInstagram(body.Instagram).SetNillableTwitter(body.Twitter).SetNillableTiktok(body.Tiktok).
		SetLogoID(logoID).SetShortDescription(body.ShortDescription).SetDescription(body.Description).
		SetSlug(strings.ReplaceAll(strings.ToLower(body.Name), " ", "-")).SetApproved(false)
	if body.Facebook != "" {
		create.SetFacebook(body.Facebook)
	}
	if body.LinkedIn != "" {
		create.SetLinkedIn(body.LinkedIn)
	}
	if body.Youtube != "" {
		create.SetYoutube(body.Youtube)
	}
	err := create.OnConflictColumns(socialmediaagency.FieldUserID).
		Update(func(u *ent.SocialMediaAgencyUpsert) {
			u.SetUserID(user.ID).SetName(body.Name).SetWebsite(body.Website).
				SetLogoID(logoID).SetShortDescription(body.ShortDescription).SetDescription(body.Description).
				SetApproved(false).UpdateUpdatedAt()
			if body.Facebook != "" {
				u.SetFacebook(body.Facebook)
			}
			if body.Instagram != nil {
				u.SetInstagram(*body.Instagram)
			}
			if body.Twitter != nil {
				u.SetTwitter(*body.Twitter)
			}
			if body.LinkedIn != "" {
				u.SetLinkedIn(body.LinkedIn)
			}
			if body.Youtube != "" {
				u.SetYoutube(body.Youtube)
			}
			if body.Tiktok != nil {
				u.SetTiktok(*body.Tiktok)
			}
		}).
		Exec(ctx)
	if err != nil {
		return IDResponse{}, err
	}
	id, err := r.client.SocialMediaAgency.Query().Where(socialmediaagency.UserID(user.ID)).OnlyID(ctx)
	if err != nil {
		return IDResponse{}, err
	}

	niches := body.Niches
	if niches == nil {
		niches = []string{}
	}
	if _, err := r.client.ExecContext(ctx, `DELETE FROM "SocialMediaAgencyNiche" WHERE "agencyId" = $1 AND NOT ("niche" = ANY($2))`, id, niches); err != nil {
		return IDResponse{}, err
	}
	current, err := r.niches(ctx, []string{id})
	if err != nil {
		return IDResponse{}, err
	}
	for _, n := range niches {
		exists := false
		for _, c := range current[id] {
			if c.Niche == n {
				exists = true
				break
			}
		}
		if exists {
			continue
		}
		if _, err := r.client.ExecContext(ctx, `INSERT INTO "SocialMediaAgencyNiche" ("agencyId", "niche") VALUES ($1, $2)`, id, n); err != nil {
			return IDResponse{}, err
		}
	}
	return IDResponse{ID: id}, nil
}

type Service struct {
	repo          *Repository
	notifications NotificationService
}

func NewService(repo *Repository, notifications NotificationService) *Service {
	return &Service{repo: repo, notifications: notifications}
}

func (s *Service) GetAgencyByUser(ctx context.Context, user *ent.User) (*Agency, error) {
	return s.repo.GetAgencyByUser(ctx, user)
}

func (s *Service) GetCount(ctx context.Context) (int, error) { return s.repo.GetCount(ctx) }

func (s *Service) GetAllAgencies(ctx context.Context) ([]Agency, error) {
	return s.repo.GetAllAgencies(ctx)
}

func (s *Service) GetAllAgenciesSlug(ctx context.Context) ([]Slug, error) {
	return s.repo.GetAllAgenciesSlug(ctx)
}

func (s *Service) GetAgencyInformation(ctx context.Context, agency string) (*Agency, error) {
	return s.repo.GetAgencyInformation(ctx, agency)
}

// jsString renders an optional value the way a template literal does.
func jsString(v *string) string {
	if v == nil {
		return "undefined"
	}
	return *v
}

func orUndefined(v string) string {
	if v == "" {
		return "undefined"
	}
	return v
}

func (s *Service) ApproveOrDecline(ctx context.Context, email, action, id string) error {
	if _, err := s.repo.ApproveOrDecline(ctx, action, id); err != nil {
		return err
	}
	agency, err := s.repo.GetAgencyByID(ctx, id)
	if err != nil {
		return err
	}
	var to string
	var name, slug *string
	if agency != nil {
		name, slug = &agency.Name, agency.Slug
		if agency.Edges.User != nil {
			to = agency.Edges.User.Email
		}
	}
	fill := strings.NewReplacer("{{agency?.name}}", jsString(name), "{{agency?.slug}}", jsString(slug))

	if action == "approve" {
		return s.notifications.SendEmail(ctx, to, "Your Agency has been approved and added to Postiz 🚀", fill.Replace(approvedEmail), "")
	}
	return s.notifications.SendEmail(ctx, to, "Your Agency has been declined 😔", fill.Replace(declinedEmail), "")
}

func (s *Service) CreateAgency(ctx context.Context, user *ent.User, body dto.CreateAgencyDto) (IDResponse, error) {
	agency, err := s.repo.CreateAgency(ctx, user, body)
	if err != nil {
		return IDResponse{}, err
	}
	logoPath := "undefined"
	if body.Logo != nil {
		logoPath = body.Logo.Path
	}
	html := strings.NewReplacer(
		"{{body.website}}", body.Website,
		"{{body.facebook}}", orUndefined(body.Facebook),
		"{{body.instagram}}", jsString(body.Instagram),
		"{{body.twitter}}", jsString(body.Twitter),
		"{{body.linkedIn}}", orUndefined(body.LinkedIn),
		"{{body.youtube}}", orUndefined(body.Youtube),
		"{{body.tiktok}}", jsString(body.Tiktok),
		"{{body.logo.path}}", logoPath,
		"{{body.name}}", body.Name,
		"{{body.shortDescription}}", body.ShortDescription,
		"{{body.description}}", body.Description,
		"{{body.niches.join(',')}}", strings.Join(body.Niches, ","),
		"{{agency.id}}", agency.ID,
	).Replace(newAgencyEmail)
	if err := s.notifications.SendEmail(ctx, "nevo@postiz.com", "New agency created", html, ""); err != nil {
		return IDResponse{}, err
	}
	return agency, nil
}
