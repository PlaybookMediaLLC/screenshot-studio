package product

import (
	"context"
	"slices"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdrafttag"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/webhooksubscription"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/webhooks"
)

// Draft webhook events (RFC 043) are written in the transaction of the change
// they describe. Their data is redacted: identifiers, the title, status, tags,
// platforms and times; never the body, comments, reviewers or credentials.

// draftEventData describes a draft for a webhook event.
func draftEventData(ctx context.Context, tx *ent.Tx, draft *ent.ContentDraft) (map[string]any, error) {
	platforms := []string{}
	if ids := nonNilStrings(draft.ChannelConnectionIds); len(ids) > 0 {
		connections, err := tx.ChannelConnection.Query().Where(channelconnection.IDIn(ids...),
			channelconnection.OrganizationID(draft.OrganizationID)).All(ctx)
		if err != nil {
			return nil, err
		}
		byID := map[string]string{}
		for _, connection := range connections {
			byID[connection.ID] = connection.Platform
		}
		for _, id := range ids {
			if platform, ok := byID[id]; ok {
				platforms = append(platforms, platform)
			}
		}
	}
	tags, err := draftTagData(ctx, tx, draft.OrganizationID, draft.TagIds)
	if err != nil {
		return nil, err
	}
	return map[string]any{"createdAt": draft.CreatedAt, "id": draft.ID, "plannedFor": draft.PlannedFor,
		"platforms": platforms, "primaryPlatform": draft.PrimaryPlatform, "socialSetId": draft.SocialSetID,
		"status": string(draft.Status), "tags": tags, "title": draft.Title,
		"updatedAt": draft.UpdatedAt, "version": draft.Version}, nil
}

// draftTagData is tags as webhooks show them (RFC 042): each tag's id and
// name, in the draft's order; a tag deleted meanwhile is left out.
func draftTagData(ctx context.Context, tx *ent.Tx, organizationID string, ids []string) ([]map[string]string, error) {
	items := []map[string]string{}
	if len(ids) == 0 {
		return items, nil
	}
	rows, err := tx.ContentDraftTag.Query().Where(contentdrafttag.IDIn(ids...), contentdrafttag.OrganizationID(organizationID)).All(ctx)
	if err != nil {
		return nil, err
	}
	names := map[string]string{}
	for _, row := range rows {
		names[row.ID] = row.Name
	}
	for _, id := range ids {
		if name, ok := names[id]; ok {
			items = append(items, map[string]string{"id": id, "name": name})
		}
	}
	return items, nil
}

// emitDraftEvent writes one draft event, when any enabled subscription of the
// workspace could receive it. extra joins the draft under data.
func emitDraftEvent(ctx context.Context, tx *ent.Tx, draft *ent.ContentDraft, kind string, extra map[string]any) error {
	subscribed, err := tx.WebhookSubscription.Query().Where(webhooksubscription.OrganizationID(draft.OrganizationID),
		webhooksubscription.Enabled(true)).Exist(ctx)
	if err != nil || !subscribed {
		return err
	}
	data := map[string]any{}
	for key, value := range extra {
		data[key] = value
	}
	if kind == webhooks.DraftDeleted {
		data["draft"] = map[string]any{"id": draft.ID, "socialSetId": draft.SocialSetID, "title": draft.Title}
	} else {
		described, err := draftEventData(ctx, tx, draft)
		if err != nil {
			return err
		}
		data["draft"] = described
	}
	return webhooks.Emit(ctx, tx, webhooks.NewEnvelope(draft.OrganizationID, kind, draft.SocialSetID,
		webhooks.Resource{ID: draft.ID, Type: "draft"}, data))
}

// emitDraftChanges emits what an update changed: status, tags, planning.
func emitDraftChanges(ctx context.Context, tx *ent.Tx, before, after *ent.ContentDraft) error {
	if before.Status != after.Status {
		if err := emitDraftEvent(ctx, tx, after, webhooks.DraftStatusChanged,
			map[string]any{"previousStatus": string(before.Status), "status": string(after.Status)}); err != nil {
			return err
		}
	}
	if !slices.Equal(nonNilStrings(before.TagIds), nonNilStrings(after.TagIds)) {
		previous, err := draftTagData(ctx, tx, before.OrganizationID, before.TagIds)
		if err != nil {
			return err
		}
		if err := emitDraftEvent(ctx, tx, after, webhooks.DraftTagsChanged, map[string]any{"previousTags": previous}); err != nil {
			return err
		}
	}
	if after.PlannedFor != nil && (before.PlannedFor == nil || !before.PlannedFor.Equal(*after.PlannedFor)) {
		if err := emitDraftEvent(ctx, tx, after, webhooks.DraftPlanned, map[string]any{"plannedFor": after.PlannedFor}); err != nil {
			return err
		}
	}
	return nil
}

// scheduledPostsData lists posts as a draft.scheduled event shows them.
func scheduledPostsData(posts []ContentDraftPost) []map[string]any {
	items := make([]map[string]any, 0, len(posts))
	for _, post := range posts {
		items = append(items, map[string]any{"id": post.ID, "platform": post.Platform, "scheduledFor": post.ScheduledFor})
	}
	return items
}
