package notifications

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

func (s *Service) renderReview(ctx context.Context, e *Envelope, org, campaignID string, payload map[string]any) error {
	var name string
	if err := s.DB.QueryRowContext(ctx, `SELECT name FROM campaign WHERE id=$1 AND "organizationId"=$2`, campaignID, org).Scan(&name); err != nil {
		return err
	}
	actor := textValue(payload, "actorDisplay")
	if actor == "" && textValue(payload, "actorUserId") != "" {
		err := s.DB.QueryRowContext(ctx, `SELECT u.name FROM "user" u JOIN member m ON m."userId"=u.id WHERE u.id=$1 AND m."organizationId"=$2`, textValue(payload, "actorUserId"), org).Scan(&actor)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if actor == "" {
			actor = "A workspace member"
		}
	}
	if actor == "" {
		actor = "An automation"
	}
	count := len(stringsFrom(payload["postIds"]))
	posts := fmt.Sprintf("%d posts", count)
	if count == 1 {
		posts = "1 post"
	}
	switch textValue(payload, "decision") {
	case "submit":
		e.Subject = posts + " to review in " + name
		e.Text = actor + " submitted " + posts + " in " + name + " for review."
	case "approve":
		e.Subject = posts + " approved in " + name
		e.Text = actor + " approved " + posts + " in " + name + "."
	case "reject":
		e.Subject = posts + " rejected in " + name
		e.Text = actor + " rejected " + posts + " in " + name + "."
	default:
		e.Subject = "Changes requested in " + name
		e.Text = actor + " asked for changes to " + posts + " in " + name + "."
	}
	if note := strings.TrimSpace(textValue(payload, "note")); note != "" {
		e.Text += "\n\n" + note
	}
	return nil
}
