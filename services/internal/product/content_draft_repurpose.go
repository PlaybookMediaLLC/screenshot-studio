package product

import (
	"context"
	"slices"
	"strings"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/asset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/draftdoc"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// seedRepurposedDraft starts from confirmed publication snapshots, never the
// source's private later edits, approval, discussions, or unfinished replies.
func seedRepurposedDraft(ctx context.Context, tx *ent.Tx, actor Actor, input *ContentDraftInput, target *draftdoc.Target) error {
	if target == nil || target.SourceDraftID == "" {
		return nil
	} // An external URL remains a reference for writing.
	source, err := visibleContentDraft(ctx, tx.Client(), actor, target.SourceDraftID)
	if err != nil {
		return err
	}
	query := tx.ScheduledPost.Query().Where(scheduledpost.OrganizationID(actor.OrganizationID), scheduledpost.ContentDraftID(source.ID), scheduledpost.StatusEQ(scheduledpost.StatusPUBLISHED), scheduledpost.RemotePostIDNotNil())
	if target.SourcePostID != "" {
		query.Where(scheduledpost.ID(target.SourcePostID))
	} else if string(source.Kind) != "reply" {
		query.Where(scheduledpost.ReplyToIsNil())
	}
	post, err := query.Order(scheduledpost.ByPublishedAt(entsql.OrderDesc(), entsql.OrderNullsLast()), ent.Desc(scheduledpost.FieldCreatedAt)).First(ctx)
	if ent.IsNotFound(err) {
		return publishing.ErrNotFound
	}
	if err != nil {
		return err
	}
	target.SourcePostID = post.ID
	// Explicit caller-authored content is not replaced, but its source is checked.
	if len(input.Body) > 0 || strings.TrimSpace(input.PlainText) != "" || len(input.AssetIDs) > 0 {
		return nil
	}
	type part struct {
		text   string
		assets []string
	}
	parts := []part{}
	appendPost := func(row *ent.ScheduledPost) {
		ids := row.AssetIds
		if len(ids) == 0 && row.AssetID != nil {
			ids = []string{*row.AssetID}
		}
		parts = append(parts, part{row.Caption, ids})
		for _, reply := range row.Replies[:min(len(row.Replies), max(0, row.ThreadProgress.Posted))] {
			parts = append(parts, part{reply.Caption, reply.AssetIDs})
		}
	}
	appendPost(post)
	if cover := post.PublishOptions.ArticleCoverAssetID; cover != "" && !slices.Contains(parts[0].assets, cover) {
		parts[0].assets = append(parts[0].assets, cover)
	}
	resumed, err := tx.ScheduledPost.Query().Where(scheduledpost.OrganizationID(actor.OrganizationID), scheduledpost.ContentDraftID(source.ID), scheduledpost.ChannelConnectionID(post.ChannelConnectionID), scheduledpost.StatusEQ(scheduledpost.StatusPUBLISHED), scheduledpost.ReplyToNotNil(), scheduledpost.CreatedAtGTE(post.CreatedAt)).Order(ent.Asc(scheduledpost.FieldCreatedAt)).Limit(1000).All(ctx)
	if err != nil {
		return err
	}
	tail := post.ThreadProgress.LastReplyID
	if tail == "" {
		tail = *post.RemotePostID
	}
	seen := map[string]bool{post.ID: true}
	for tail != "" {
		var next *ent.ScheduledPost
		for _, candidate := range resumed {
			if !seen[candidate.ID] && candidate.ReplyTo != nil && *candidate.ReplyTo == tail {
				next = candidate
				break
			}
		}
		if next == nil {
			break
		}
		seen[next.ID] = true
		appendPost(next)
		tail = next.ThreadProgress.LastReplyID
		if tail == "" && next.RemotePostID != nil {
			tail = *next.RemotePostID
		}
	}
	ids := []string{}
	for _, p := range parts {
		for _, id := range p.assets {
			if !slices.Contains(ids, id) {
				ids = append(ids, id)
			}
		}
	}
	documentID := post.PublishOptions.DocumentAssetID
	if documentID != "" && !slices.Contains(ids, documentID) {
		ids = append(ids, documentID)
	}
	kinds := map[string]string{}
	if len(ids) > 0 {
		media, err := tx.Asset.Query().Where(asset.IDIn(ids...), asset.OrganizationID(actor.OrganizationID), asset.StatusEQ(asset.StatusUPLOADED)).All(ctx)
		if err != nil {
			return err
		}
		if len(media) != len(ids) {
			return conflict("Some published media is no longer available. Start a new draft and attach replacement media.")
		}
		for _, item := range media {
			kind := "img"
			if strings.HasPrefix(item.MediaType, "video/") {
				kind = "video"
			}
			if item.MediaType == "application/pdf" {
				kind = "file"
			}
			kinds[item.ID] = kind
		}
	}
	body := []any{}
	texts := []string{}
	for index, p := range parts {
		if index > 0 {
			body = append(body, map[string]any{"type": "post_break", "children": []any{map[string]any{"text": ""}}})
		}
		body = append(body, map[string]any{"type": "p", "children": []any{map[string]any{"text": p.text}}})
		texts = append(texts, p.text)
		for _, id := range p.assets {
			body = append(body, map[string]any{"type": kinds[id], "assetId": id, "url": "/api/v1/assets/" + id + "/content", "children": []any{map[string]any{"text": ""}}})
		}
	}
	if documentID != "" && input.PlatformVersions == nil {
		input.PlatformVersions = &draftdoc.PlatformVersions{SchemaVersion: draftdoc.SchemaVersion, Versions: []draftdoc.PlatformVersion{{Channel: "linkedin", Mode: draftdoc.ModeSynced, Options: &draftdoc.VersionOptions{Document: &draftdoc.Document{AssetID: documentID, Title: post.PublishOptions.DocumentTitle}}}}}
	}
	input.Body, input.PlainText, input.AssetIDs = body, strings.Join(texts, "\n\n"), ids
	if strings.TrimSpace(input.Title) == "" {
		input.Title = source.Title
	}
	return nil
}
