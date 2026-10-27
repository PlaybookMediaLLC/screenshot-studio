package notifications

import (
	"context"
	"database/sql"
	"errors"
)

// SourceSocialSet is current, authorized presentation of an event's stable source.
// Names are never copied into immutable events or used as authorization keys.
type SourceSocialSet struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func sourceSocialSet(ctx context.Context, db queryer, org, user, id string) (*SourceSocialSet, bool, error) {
	if id == "" {
		return nil, true, nil
	}
	var source SourceSocialSet
	err := db.QueryRowContext(ctx, `SELECT id,name FROM social_set WHERE id=$1 AND "organizationId"=$2 AND "deletedAt" IS NULL AND (visibility<>'PRIVATE' OR "ownerUserId"=$3)`, id, org, user).Scan(&source.ID, &source.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &source, true, nil
}
