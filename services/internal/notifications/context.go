package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
)

// ItemContext is an allowlisted snapshot for the authorized recipient, never a raw resource payload.
type ItemContext struct {
	EntityType   string `json:"entityType"`
	EntityID     string `json:"entityId"`
	Name         string `json:"name,omitempty"`
	Source       string `json:"source"`
	Status       string `json:"status,omitempty"`
	Message      string `json:"message,omitempty"`
	Repository   string `json:"repository,omitempty"`
	Branch       string `json:"branch,omitempty"`
	Tag          string `json:"tag,omitempty"`
	ActorName    string `json:"actorName,omitempty"`
	PullRequest  int    `json:"pullRequest,omitempty"`
	CampaignName string `json:"campaignName,omitempty"`
	StorySetName string `json:"storySetName,omitempty"`
}

func firstText(row map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := textValue(row, key); value != "" {
			return value
		}
	}
	return ""
}

func eventStatus(kind string) string {
	switch {
	case strings.HasSuffix(kind, "failed"):
		return "failed"
	case strings.HasSuffix(kind, "needs_attention"), strings.HasSuffix(kind, "recovery_required"), strings.HasSuffix(kind, "reconnect_required"), strings.HasSuffix(kind, "budget_exhausted"), strings.HasSuffix(kind, "changes_requested"), strings.HasSuffix(kind, "review_requested"), strings.HasSuffix(kind, "submitted"):
		return "needs_attention"
	case strings.HasSuffix(kind, "completed"), strings.HasSuffix(kind, "succeeded"), strings.HasSuffix(kind, "published"), strings.HasSuffix(kind, "approved"):
		return "succeeded"
	case strings.HasSuffix(kind, "cancelled"):
		return "cancelled"
	}
	return ""
}

func (s *Service) itemContext(ctx context.Context, kind, entityType, id, org string, row, payload map[string]any) (*ItemContext, error) {
	def, _ := activity.Lookup(kind)
	source := def.Group
	if source == "" {
		source = "Workspace"
	}
	c := &ItemContext{EntityType: entityType, EntityID: id, Source: source, Name: firstText(row, "name", "title", "displayName", "filename"), Status: eventStatus(kind), Message: firstText(row, "reason", "failureMessage", "errorMessage", "failureCode"), Repository: firstText(row, "repositoryFullName", "repository"), Branch: firstText(row, "branch", "ref"), Tag: firstText(row, "tagName", "tag")}
	if entityType == "release_automation_run" {
		c.Status = firstText(row, "status")
		var raw []byte
		err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(d.name,''),e.snapshot FROM release_automation_run r JOIN release_source_event e ON e.id=r."eventId" AND e."organizationId"=r."organizationId" LEFT JOIN release_automation d ON d.id=r."definitionId" AND d."organizationId"=r."organizationId" WHERE r.id=$1 AND r."organizationId"=$2`, id, org).Scan(&c.Name, &raw)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		var snapshot struct {
			RepositoryName string `json:"repositoryName"`
			Number         int    `json:"number"`
			Family         string `json:"family"`
			Fields         map[string]struct {
				Values []string `json:"values"`
			} `json:"fields"`
		}
		if len(raw) > 0 {
			if err = json.Unmarshal(raw, &snapshot); err != nil {
				return nil, err
			}
		}
		c.Repository = snapshot.RepositoryName
		if snapshot.Family == "pull_request.merged" {
			c.PullRequest = snapshot.Number
		}
		for key, target := range map[string]*string{"release.tag": &c.Tag, "tag.name": &c.Tag, "pr.base": &c.Branch} {
			if values := snapshot.Fields[key].Values; len(values) > 0 && *target == "" {
				*target = values[0]
			}
		}
	}
	for _, relation := range []struct {
		table, id string
		target    *string
	}{
		{"campaign", textValue(row, "campaignId"), &c.CampaignName},
		{"social_set", textValue(row, "socialSetId"), &c.StorySetName},
	} {
		if relation.id == "" {
			continue
		}
		err := s.DB.QueryRowContext(ctx, `SELECT name FROM `+relation.table+` WHERE id=$1 AND "organizationId"=$2`, relation.id, org).Scan(relation.target)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	if actor := textValue(payload, "actorUserId"); actor != "" {
		err := s.DB.QueryRowContext(ctx, `SELECT u.name FROM "user" u JOIN member m ON m."userId"=u.id WHERE u.id=$1 AND m."organizationId"=$2`, actor, org).Scan(&c.ActorName)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	return c, nil
}
