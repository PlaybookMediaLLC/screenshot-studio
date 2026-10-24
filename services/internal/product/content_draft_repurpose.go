package product

import (
	"context"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/draftdoc"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/webhooks"
	"github.com/lucsky/cuid"
)

// repurposePublishedDraft copies the receipted publication, not later edits to
// its source draft. The original job, receipts, approvals and comments stay put.
func (c *Configuration) repurposePublishedDraft(ctx context.Context, tx *ent.Tx, actor Actor, input ContentDraftInput) (*ContentDraftRecord, error) {
	source, err := visibleContentDraft(ctx, tx.Client(), actor, input.Target.SourceDraftID)
	if err != nil {
		return nil, err
	}
	query := tx.ScheduledPost.Query().Where(scheduledpost.OrganizationID(actor.OrganizationID),
		scheduledpost.ContentDraftID(source.ID), scheduledpost.StatusEQ(scheduledpost.StatusPUBLISHED), scheduledpost.RemotePostIDNotNil())
	if input.Target.SourcePostID != "" {
		query.Where(scheduledpost.ID(input.Target.SourcePostID))
	}
	published, err := query.WithChannelConnection().Order(ent.Desc(scheduledpost.FieldCreatedAt), ent.Desc(scheduledpost.FieldID)).First(ctx)
	if ent.IsNotFound(err) {
		return nil, conflict("Choose a post with a confirmed publication.")
	}
	if err != nil {
		return nil, err
	}
	setID := input.SocialSetID
	if setID == "" && source.SocialSetID != nil {
		setID = *source.SocialSetID
	}
	set, _, _, err := c.draftDefaults(ctx, tx, actor, setID)
	if err != nil {
		return nil, err
	}
	content := draftContent{kind: "repurpose", title: copiedTitle(source.Title, "(repurposed)"),
		primary: draftPlatformChannels[published.Edges.ChannelConnection.Platform], versions: draftdoc.PlatformVersions{SchemaVersion: draftdoc.SchemaVersion}}
	content.target = &draftdoc.Target{Kind: "repurpose", SourceDraftID: source.ID, SourcePostID: published.ID,
		Platform: content.primary, RemoteID: *published.RemotePostID}
	if url := livePostURL(published.Edges.ChannelConnection.Platform, published.RemotePostID); url != nil {
		content.target.URL = *url
	}
	add := func(caption string, assets []string, poll *postoptions.Poll, options *postoptions.PublishOptions) error {
		if _, err := contentDraftAssets(ctx, tx, actor.OrganizationID, assets); err != nil {
			return err
		}
		settings := map[string]any{"type": "post_break", "id": cuid.New(), "children": []any{map[string]any{"text": ""}}}
		if poll != nil && len(poll.Options) > 0 {
			value := map[string]any{"options": append([]string{}, poll.Options...), "durationMinutes": poll.DurationMinutes, "multiple": poll.Multiple}
			if options != nil && options.PollQuestion != "" {
				value["question"] = options.PollQuestion
			}
			settings["poll"] = value
		}
		if options != nil {
			if options.ReplySettings != "" {
				settings["replySettings"] = options.ReplySettings
			}
			if options.QuoteFirstPost {
				settings["quoteFirstPost"] = true
			}
			if options.MadeWithAI || options.PaidPartnership {
				settings["disclosures"] = map[string]bool{"madeWithAi": options.MadeWithAI, "paidPartnership": options.PaidPartnership}
			}
		}
		content.body = append(content.body, settings,
			map[string]any{"type": "p", "children": []any{map[string]any{"text": caption}}})
		if content.plainText != "" {
			content.plainText += "\n\n"
		}
		content.plainText += caption
		for _, id := range assets {
			asset, err := tx.Asset.Get(ctx, id)
			if err != nil {
				return err
			}
			kind := "img"
			if strings.HasPrefix(asset.MediaType, "video/") {
				kind = "video"
			}
			content.body = append(content.body, map[string]any{"type": kind, "assetId": id, "url": "/api/v1/assets/" + id + "/content", "children": []any{map[string]any{"text": ""}}})
			content.assetIDs = append(content.assetIDs, id)
		}
		return nil
	}
	assets := published.AssetIds
	if len(assets) == 0 && published.AssetID != nil {
		assets = []string{*published.AssetID}
	}
	if err := add(published.Caption, assets, &published.Poll, &published.PublishOptions); err != nil {
		return nil, err
	}
	for _, reply := range published.Replies[:min(published.ThreadProgress.Posted, len(published.Replies))] {
		if err := add(reply.Caption, reply.AssetIDs, reply.Poll, reply.Options); err != nil {
			return nil, err
		}
	}
	options := &draftdoc.VersionOptions{Visibility: published.PublishOptions.Visibility, FirstComment: published.PublishOptions.FirstComment}
	if preview := published.PublishOptions.LinkPreview; preview != nil {
		options.LinkPreviews = []postoptions.LinkPreview{*preview}
	}
	if published.PublishOptions.CommunityID != "" {
		options.Community = &draftdoc.Community{ID: published.PublishOptions.CommunityID}
	}
	if published.PublishOptions.DocumentAssetID != "" {
		options.Document = &draftdoc.Document{AssetID: published.PublishOptions.DocumentAssetID, Title: published.PublishOptions.DocumentTitle}
		content.assetIDs = append(content.assetIDs, published.PublishOptions.DocumentAssetID)
	}
	content.versions.Versions = []draftdoc.PlatformVersion{{Channel: content.primary, Mode: draftdoc.ModeSynced, Options: options}}
	// Preserve only the original account as the destination for this snapshot.
	copiedSource := *source
	copiedSource.ChannelConnectionIds = []string{published.ChannelConnectionID}
	row, _, err := c.copyDraft(ctx, tx, actor, &copiedSource, content, set, nil, "repurpose")
	if err != nil {
		return nil, err
	}
	if err := emitDraftEvent(ctx, tx, row, webhooks.DraftCreated, nil); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	result := contentDraftRecord(row)
	return &result, nil
}
