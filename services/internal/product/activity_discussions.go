package product

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
)

type activityComment struct {
	ID          string `json:"id"`
	UserID      string `json:"userId"`
	ContentRich any    `json:"contentRich"`
}
type activityThread struct {
	ID       string            `json:"id"`
	UserID   string            `json:"userId"`
	Resolved bool              `json:"isResolved"`
	Comments []activityComment `json:"comments"`
}
type activityDiscussions struct {
	Threads []activityThread `json:"threads"`
}

func parseActivityDiscussions(raw map[string]any) (activityDiscussions, error) {
	var doc activityDiscussions
	encoded, err := json.Marshal(raw)
	if err != nil || len(encoded) > contentDraftThreadsLimit {
		return doc, invalid("Keep the draft's comments under 256 KB.")
	}
	if err = json.Unmarshal(encoded, &doc); err != nil {
		return doc, invalid("Invalid discussion data.")
	}
	return doc, nil
}

// mentionedMembers reads the editor's explicit user keys; display names and email matches confer no identity.
func mentionedMembers(value any) []string {
	found := map[string]bool{}
	var walk func(any)
	walk = func(value any) {
		switch v := value.(type) {
		case []any:
			for _, child := range v {
				walk(child)
			}
		case map[string]any:
			if v["type"] == "mention" {
				if key, ok := v["key"].(string); ok && key != "" && !strings.HasPrefix(key, "/") {
					found[key] = true
				}
			}
			for _, child := range v {
				walk(child)
			}
		}
	}
	walk(value)
	result := []string{}
	for id := range found {
		result = append(result, id)
	}
	return result
}

// recordDiscussionActivity compares committed identities, so autosaving a document is not activity.
func recordDiscussionActivity(ctx context.Context, tx *ent.Tx, actor Actor, draft *ent.ContentDraft, next map[string]any) error {
	before, err := parseActivityDiscussions(draft.Discussions)
	if err != nil {
		return err
	}
	after, err := parseActivityDiscussions(next)
	if err != nil {
		return err
	}
	previous := map[string]activityThread{}
	oldComments := map[string]activityComment{}
	oldThread := map[string]string{}
	for _, thread := range before.Threads {
		previous[thread.ID] = thread
		for _, comment := range thread.Comments {
			oldComments[comment.ID] = comment
			oldThread[comment.ID] = thread.ID
		}
	}
	members, err := tx.Member.Query().Where(member.OrganizationID(actor.OrganizationID)).All(ctx)
	if err != nil {
		return err
	}
	eligible := map[string]bool{}
	for _, m := range members {
		eligible[m.UserID] = true
	}
	seen := map[string]bool{}
	for _, thread := range after.Threads {
		if thread.ID == "" || len(thread.ID) > 128 || seen["thread:"+thread.ID] {
			return invalid("Every discussion needs a unique stable ID.")
		}
		seen["thread:"+thread.ID] = true
		old, exists := previous[thread.ID]
		if !exists && (thread.UserID != actor.UserID || !eligible[thread.UserID]) || exists && old.UserID != thread.UserID {
			return invalid("A discussion author cannot be changed.")
		}
		participants := []string{thread.UserID}
		for _, comment := range old.Comments {
			participants = append(participants, comment.UserID)
		}
		for _, comment := range thread.Comments {
			if comment.ID == "" || len(comment.ID) > 128 || seen["comment:"+comment.ID] {
				return invalid("Every comment needs a unique stable ID.")
			}
			seen["comment:"+comment.ID] = true
			prior, exists := oldComments[comment.ID]
			if exists && (prior.UserID != comment.UserID || oldThread[comment.ID] != thread.ID) {
				return invalid("A comment's author and discussion cannot be changed.")
			}
			if !exists && (comment.UserID != actor.UserID || !eligible[comment.UserID]) {
				return invalid("A new comment must belong to the current workspace member.")
			}
			if exists && comment.UserID != actor.UserID && !reflect.DeepEqual(prior.ContentRich, comment.ContentRich) {
				return invalid("Only the comment author can edit its content.")
			}
			payload := map[string]any{"commentId": comment.ID, "threadId": thread.ID, "participantUserIds": participants}
			if !exists {
				if err = activity.Emit(ctx, tx, actor.OrganizationID, "comment.created", "content_draft", draft.ID, actor.UserID, draft.ID+":"+comment.ID, payload); err != nil {
					return err
				}
			}
			oldMentions := map[string]bool{}
			for _, id := range mentionedMembers(prior.ContentRich) {
				oldMentions[id] = true
			}
			for _, id := range mentionedMembers(comment.ContentRich) {
				if oldMentions[id] {
					continue
				}
				if !eligible[id] {
					return invalid("Mention a current member of this workspace.")
				}
				if err = activity.Emit(ctx, tx, actor.OrganizationID, "member.mentioned", "content_draft", draft.ID, actor.UserID, draft.ID+":"+comment.ID+":"+id, map[string]any{"commentId": comment.ID, "mentionedUserIds": []string{id}}); err != nil {
					return err
				}
			}
			participants = append(participants, comment.UserID)
		}
		if thread.Resolved && !old.Resolved {
			if err = activity.Emit(ctx, tx, actor.OrganizationID, "comment.resolved", "content_draft", draft.ID, actor.UserID, fmt.Sprintf("%s:%s:%d", draft.ID, thread.ID, draft.Version+1), map[string]any{"threadId": thread.ID, "participantUserIds": participants}); err != nil {
				return err
			}
		}
	}
	// Display names come from the same verified users as authors, not caller-supplied profile maps.
	users := map[string]any{}
	for userID := range eligible {
		person, err := tx.User.Get(ctx, userID)
		if err != nil {
			return err
		}
		users[userID] = map[string]any{"id": person.ID, "name": person.Name, "avatarUrl": person.Image}
	}
	next["users"] = users
	return nil
}
