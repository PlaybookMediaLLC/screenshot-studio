package notifications

import (
	"context"
	"database/sql"
	"errors"
)

// sharedDestination rechecks the current source set and per-draft publish
// preference at projection and delivery. Private-set filtering remains separate.
func sharedDestination(ctx context.Context, db queryer, pol Policy, event occurrence) (string, error) {
	setID := event.sourceSocialSetID
	var currentSet string
	var suppress bool
	switch event.resourceType {
	case "content_draft":
		err := db.QueryRowContext(ctx, `SELECT COALESCE("socialSetId",''),"suppressSlackOnPublish" FROM content_draft WHERE id=$1 AND "organizationId"=$2`, event.resourceID, event.org).Scan(&currentSet, &suppress)
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
	case "scheduled_post":
		err := db.QueryRowContext(ctx, `SELECT COALESCE(p."socialSetId",''),COALESCE(d."suppressSlackOnPublish",false) FROM scheduled_post p LEFT JOIN content_draft d ON d.id=p."contentDraftId" AND d."organizationId"=p."organizationId" WHERE p.id=$1 AND p."organizationId"=$2`, event.resourceID, event.org).Scan(&currentSet, &suppress)
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
	case "channel_connection":
		err := db.QueryRowContext(ctx, `SELECT COALESCE("socialSetId",'') FROM channel_connection WHERE id=$1 AND "organizationId"=$2`, event.resourceID, event.org).Scan(&currentSet)
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
	}
	// Skipping a success notice never suppresses a required failure alert.
	if suppress && event.kind == "post.published" {
		return "", nil
	}
	if setID == "" {
		setID = currentSet
	}
	if destination, ok := pol.SocialSetSlackChannels[setID]; ok {
		return destination.ChannelID, nil
	}
	return pol.SlackChannelID, nil
}
