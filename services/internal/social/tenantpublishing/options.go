package tenantpublishing

import (
	"context"
	"encoding/json"
	"log/slog"
	"maps"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialapi"
)

// Write (RFC 025): a post's settings become its adapter's settings JSON on
// top of the connection's own. Only fields the adapter reads are written.

// postSettings merges a post's options over the connection's settings for
// its platform. rootID is the thread's first post once it is live, for a
// reply that quotes it; empty while the first post does not exist yet.
func postSettings(platform string, base map[string]any, options *postoptions.PublishOptions, rootID string) (json.RawMessage, error) {
	settings := maps.Clone(base)
	if settings == nil {
		settings = map[string]any{}
	}
	if options != nil {
		switch platform {
		case "x":
			xSettings(settings, *options, rootID)
		case "linkedin":
			if options.Visibility != "" {
				settings["visibility"] = options.Visibility
			}
			if options.DocumentTitle != "" {
				settings["document_title"] = options.DocumentTitle
			}
			if options.QuoteRemoteID != "" {
				settings["reshare_parent"] = options.QuoteRemoteID
			}
		}
	}
	if platform == "x" {
		// The X adapter requires who can reply; unset is everyone.
		if _, ok := settings["who_can_reply_post"]; !ok {
			settings["who_can_reply_post"] = "everyone"
		}
	}
	return json.Marshal(settings)
}

func xSettings(settings map[string]any, options postoptions.PublishOptions, rootID string) {
	if options.ReplySettings != "" {
		settings["who_can_reply_post"] = options.ReplySettings
	}
	if options.MadeWithAI {
		settings["made_with_ai"] = true
	}
	if options.PaidPartnership {
		settings["paid_partnership"] = true
	}
	if options.CommunityID != "" {
		settings["community"] = "https://x.com/i/communities/" + options.CommunityID
		settings["share_with_followers"] = options.ShareWithFollowers
	}
	switch {
	case options.QuoteRemoteID != "":
		settings["quote_tweet_id"] = options.QuoteRemoteID
	case options.QuoteFirstPost && rootID != "":
		settings["quote_tweet_id"] = rootID
	}
	if options.ArticleTitle != "" {
		settings["post_type"] = "article"
		settings["article_title"] = options.ArticleTitle
		settings["article_status"] = "published"
	}
}

// articleCover signs an article's cover for the X adapter, which uploads it.
func (p *Publisher) articleCover(ctx context.Context, input socialapi.PublishInput, settings json.RawMessage) (json.RawMessage, error) {
	if input.Cover == nil {
		return settings, nil
	}
	media, err := p.signedMedia(ctx, input.OrganizationID, []publishing.MediaAsset{*input.Cover})
	if err != nil || len(media) == 0 {
		return nil, err
	}
	var decoded map[string]any
	if err := json.Unmarshal(settings, &decoded); err != nil {
		return nil, err
	}
	decoded["article_cover"] = map[string]any{"id": input.Cover.ObjectKey, "path": media[0].Path}
	return json.Marshal(decoded)
}

// pollFor is a post's poll as adapters take it: whole hours for those that
// read hours, the exact minutes for those that read minutes, and LinkedIn's
// question.
func pollFor(poll *postoptions.Poll, options *postoptions.PublishOptions) *integrations.PollDetails {
	details := pollDetails(poll)
	if details == nil {
		return nil
	}
	details.DurationMinutes = poll.DurationMinutes
	if options != nil {
		details.Question = strings.TrimSpace(options.PollQuestion)
	}
	return details
}

// AccountStanding projects verified account capabilities. Editable settings
// and workspace plans never establish account-specific publishing access.
func (p *Publisher) AccountStanding(ctx context.Context, organizationID, destinationID, platform, secretReference string) (product.AccountStanding, error) {
	if platform != "x" {
		return product.AccountStanding{}, nil
	}
	account, _, _, err := p.account(ctx, organizationID, destinationID, platform, secretReference, nil)
	if err != nil {
		return product.AccountStanding{}, err
	}
	caps := account.VerifiedCapabilities.X
	limit := caps.PostTextLimit()
	return product.AccountStanding{Premium: caps.LongPostMaxWeightedCharacters != nil, XCaptionLimit: &limit, XArticles: caps.Articles}, nil
}

// Mentions looks a mention up with the account (RFC 025): an X user by
// username, a LinkedIn organization by vanity name. A lookup that finds
// nothing returns none; a platform without a lookup returns none too.
func (p *Publisher) Mentions(ctx context.Context, organizationID, destinationID, platform, secretReference, query string) ([]product.Mention, error) {
	account, provider, _, err := p.account(ctx, organizationID, destinationID, platform, secretReference, nil)
	if err != nil {
		return nil, err
	}
	finder, ok := provider.(interface {
		Mention(context.Context, string, string, string, *socialent.Integration) ([]integrations.MentionResult, bool, error)
	})
	if !ok {
		return []product.Mention{}, nil
	}
	found, _, err := finder.Mention(ctx, account.Token, query, account.InternalID, account)
	if err != nil {
		// LinkedIn answers an unknown vanity name with an error, not an empty list.
		slog.InfoContext(ctx, "mention lookup found nothing", "platform", platform, "error", err)
		return []product.Mention{}, nil
	}
	mentions := make([]product.Mention, 0, len(found))
	for _, item := range found {
		mention := product.Mention{Image: item.Image, Label: item.Label}
		switch platform {
		case "x":
			mention.Kind, mention.Handle, mention.ProviderID = "person", item.ID, item.ID
		case "linkedin":
			mention.Kind, mention.ProviderID = "organization", "urn:li:organization:"+item.ID
		default:
			continue
		}
		mentions = append(mentions, mention)
	}
	return mentions, nil
}
