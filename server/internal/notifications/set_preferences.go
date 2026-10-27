package notifications

import (
	"context"
	"database/sql"
	"errors"
	"reflect"
	"sort"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// SocialSetChannels stores explicit per-channel choices under stable set and event IDs.
// Omitted choices inherit the member's event defaults; legacy all-channel off wins.
type SocialSetChannels map[string]map[string]map[string]bool

var setPreferenceKinds = map[string]bool{"post.published": true, "post.auto_repost_published": true, "post.auto_plug_published": true, "post.publish_failed": true}

func preferenceChannel(channel string) string {
	switch channel {
	case "in_app":
		return "inApp"
	case "slack_dm":
		return "slack"
	case "email":
		return "email"
	}
	return ""
}

func (p Preferences) selected(kind, channel string, setIDs ...string) bool {
	defaults := p.Events[kind]
	fallback := channel == "in_app" && defaults.InApp || channel == "email" && defaults.Email || channel == "slack_dm" && defaults.Slack
	hasSet := false
	for _, id := range setIDs {
		if id == "" {
			continue
		}
		hasSet = true
		if !p.socialSetAllows(id, kind) {
			return false
		}
		selected, overridden := p.SocialSetChannels[id][kind][preferenceChannel(channel)]
		if !overridden {
			selected = fallback
		}
		if !selected {
			return false
		}
	}
	return hasSet || fallback
}

func validSocialSetChannels(sets SocialSetChannels) bool {
	if len(sets) > 200 {
		return false
	}
	for id, kinds := range sets {
		if !socialSetIDPattern.MatchString(id) || len(kinds) > len(setPreferenceKinds) {
			return false
		}
		for kind, channels := range kinds {
			if !setPreferenceKinds[kind] || len(channels) > 3 {
				return false
			}
			for channel := range channels {
				if channel != "inApp" && channel != "email" && channel != "slack" {
					return false
				}
			}
		}
	}
	return true
}

// New or changed references must name visible sets. Unchanged historical choices
// can survive deleted/transferred sets; clearing one's own preference needs no grant.
func validatePreferenceSets(ctx context.Context, tx *sql.Tx, p Principal, current, next Preferences) error {
	changed := map[string]bool{}
	for id, kinds := range next.SocialSets {
		if len(kinds) > 0 && !reflect.DeepEqual(kinds, current.SocialSets[id]) {
			changed[id] = true
		}
	}
	for id, kinds := range next.SocialSetChannels {
		if len(kinds) > 0 && !reflect.DeepEqual(kinds, current.SocialSetChannels[id]) {
			changed[id] = true
		}
	}
	ids := make([]string, 0, len(changed))
	for id := range changed {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		var found string
		err := tx.QueryRowContext(ctx, `SELECT id FROM social_set WHERE id=$1 AND "organizationId"=$2 AND "deletedAt" IS NULL AND (visibility='WORKSPACE' OR "ownerUserId"=$3) FOR SHARE`, id, p.OrganizationID, p.UserID).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return publishing.ErrNotFound
		}
		if err != nil {
			return err
		}
	}
	return nil
}
