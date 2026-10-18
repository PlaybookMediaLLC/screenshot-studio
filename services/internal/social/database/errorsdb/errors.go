// Package errorsdb ports database/prisma/errors (the admin error log).
package errorsdb

import (
	"bytes"
	"context"
	"encoding/json"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	enterrors "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/errors"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/organization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/predicate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/userorganization"
)

const unknownToken = "An unknown error occurred"

// ListErrorsParams are listErrors' optional filters (zero = undefined).
type ListErrorsParams struct {
	Page         int
	Limit        int
	Platform     string
	Email        string
	UnknownFirst bool
}

type ErrorUser struct {
	ID    string  `json:"id"`
	Email string  `json:"email"`
	Name  *string `json:"name"`
}

type ErrorOrganizationUser struct {
	User ErrorUser `json:"user"`
}

type ErrorOrganization struct {
	ID    string                  `json:"id"`
	Name  string                  `json:"name"`
	Users []ErrorOrganizationUser `json:"users"`
}

type ErrorPost struct {
	ID      string `json:"id"`
	Content string `json:"content"`
}

// ErrorItem is an Errors row with organization {id, name, users: [{user:
// {id, email, name}}]} and post {id, content}.
type ErrorItem struct {
	*ent.Errors
	Organization ErrorOrganization
	Post         ErrorPost
}

func (e ErrorItem) MarshalJSON() ([]byte, error) {
	row := *e.Errors
	row.Edges = ent.ErrorsEdges{}
	base, err := json.Marshal(&row)
	if err != nil {
		return nil, err
	}
	org, err := json.Marshal(e.Organization)
	if err != nil {
		return nil, err
	}
	post, err := json.Marshal(e.Post)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	buf.Write(base[:len(base)-1])
	buf.WriteString(`,"organization":`)
	buf.Write(org)
	buf.WriteString(`,"post":`)
	buf.Write(post)
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

type ListErrorsResponse struct {
	Items   []ErrorItem `json:"items"`
	Total   int         `json:"total"`
	Page    int         `json:"page"`
	Limit   int         `json:"limit"`
	HasMore bool        `json:"hasMore"`
}

type Repository struct{ client *ent.Client }

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

func buildWhere(params ListErrorsParams) []predicate.Errors {
	var where []predicate.Errors
	if params.Platform != "" {
		where = append(where, enterrors.Platform(params.Platform))
	}
	if params.Email != "" {
		where = append(where, enterrors.HasOrganizationWith(organization.HasUsersWith(
			userorganization.HasUserWith(user.EmailContainsFold(params.Email)),
		)))
	}
	return where
}

func (r *Repository) ListPlatforms(ctx context.Context) ([]string, error) {
	return r.client.Errors.Query().Unique(true).Order(ent.Asc(enterrors.FieldPlatform)).
		Select(enterrors.FieldPlatform).Strings(ctx)
}

func (r *Repository) find(ctx context.Context, where []predicate.Errors, skip, take int) ([]ErrorItem, error) {
	rows, err := r.client.Errors.Query().Where(where...).
		Order(ent.Desc(enterrors.FieldCreatedAt)).Offset(skip).Limit(take).
		WithOrganization(func(q *ent.OrganizationQuery) {
			q.WithUsers(func(q *ent.UserOrganizationQuery) { q.WithUser() })
		}).
		WithPost().
		All(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]ErrorItem, 0, len(rows))
	for _, row := range rows {
		item := ErrorItem{Errors: row, Organization: ErrorOrganization{Users: []ErrorOrganizationUser{}}}
		if org := row.Edges.Organization; org != nil {
			item.Organization.ID, item.Organization.Name = org.ID, org.Name
			for _, membership := range org.Edges.Users {
				if u := membership.Edges.User; u != nil {
					item.Organization.Users = append(item.Organization.Users, ErrorOrganizationUser{ErrorUser{ID: u.ID, Email: u.Email, Name: u.Name}})
				}
			}
		}
		if p := row.Edges.Post; p != nil {
			item.Post = ErrorPost{ID: p.ID, Content: p.Content}
		}
		items = append(items, item)
	}
	return items, nil
}

func (r *Repository) ListErrors(ctx context.Context, params ListErrorsParams) (*ListErrorsResponse, error) {
	page := max(0, params.Page)
	limit := params.Limit
	if limit == 0 {
		limit = 20
	}
	limit = min(max(1, limit), 100)
	skip := page * limit
	where := buildWhere(params)

	if !params.UnknownFirst {
		items, err := r.find(ctx, where, skip, limit)
		if err != nil {
			return nil, err
		}
		total, err := r.client.Errors.Query().Where(where...).Count(ctx)
		if err != nil {
			return nil, err
		}
		return &ListErrorsResponse{Items: items, Total: total, Page: page, Limit: limit, HasMore: skip+len(items) < total}, nil
	}

	unknownWhere := append(append([]predicate.Errors{}, where...), enterrors.MessageContains(unknownToken))
	knownWhere := append(append([]predicate.Errors{}, where...), enterrors.Not(enterrors.MessageContains(unknownToken)))

	unknownTotal, err := r.client.Errors.Query().Where(unknownWhere...).Count(ctx)
	if err != nil {
		return nil, err
	}
	knownTotal, err := r.client.Errors.Query().Where(knownWhere...).Count(ctx)
	if err != nil {
		return nil, err
	}

	unknownItems, knownItems := []ErrorItem{}, []ErrorItem{}
	if skip < unknownTotal {
		takeUnknown := min(unknownTotal-skip, limit)
		if unknownItems, err = r.find(ctx, unknownWhere, skip, takeUnknown); err != nil {
			return nil, err
		}
		if remaining := limit - len(unknownItems); remaining > 0 {
			if knownItems, err = r.find(ctx, knownWhere, 0, remaining); err != nil {
				return nil, err
			}
		}
	} else {
		if knownItems, err = r.find(ctx, knownWhere, skip-unknownTotal, limit); err != nil {
			return nil, err
		}
	}

	items := append(unknownItems, knownItems...)
	total := unknownTotal + knownTotal
	return &ListErrorsResponse{Items: items, Total: total, Page: page, Limit: limit, HasMore: skip+len(items) < total}, nil
}

type Service struct{ repo *Repository }

func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func (s *Service) ListErrors(ctx context.Context, params ListErrorsParams) (*ListErrorsResponse, error) {
	return s.repo.ListErrors(ctx, params)
}

func (s *Service) ListPlatforms(ctx context.Context) ([]string, error) {
	return s.repo.ListPlatforms(ctx)
}
