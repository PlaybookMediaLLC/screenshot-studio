// Package tenantpublishing calls the social provider adapters from the tenant
// Temporal worker. The canonical scheduled_post is the only local post state.
package tenantpublishing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/notifications"
	managedslack "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/slack"
	"log/slog"
	"net/http"
	"strings"
	"time"

	productent "github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	socialdatabase "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database"
	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialapi"
)

type BindingLookup interface {
	Binding(context.Context, string) (*productent.SocialTenantBinding, error)
}

type IntegrationLookup interface {
	FindIntegration(context.Context, string, string, string) (*socialent.Integration, error)
}

type MediaSigner interface {
	SignDelivery(context.Context, string, string) (string, error)
}

type poster interface {
	Post(context.Context, string, string, []integrations.PostDetails, *socialent.Integration) ([]integrations.PostResponse, error)
}

type Publisher struct {
	bindings     BindingLookup
	integrations IntegrationLookup
	signer       MediaSigner
	resolve      func(string) poster
	now          func() time.Time
}

func New(bindings BindingLookup, socialClient *socialent.Client, signer MediaSigner, lifecycle ...managedslack.Lifecycle) *Publisher {
	manager := social.NewManager(lifecycle...)
	return &Publisher{
		bindings: bindings, integrations: EntIntegrationLookup{Client: socialClient},
		signer: signer, resolve: func(platform string) poster { return manager.GetSocialIntegration(platform) }, now: time.Now,
	}
}

// OpenShared reads social integrations from the same DSN as canonical product
// data. The caller owns the returned close function.
func OpenShared(ctx context.Context, databaseURL string, bindings BindingLookup, signer MediaSigner) (*Publisher, func() error, error) {
	db, err := socialdatabase.Open(ctx, databaseURL)
	if err != nil {
		return nil, nil, err
	}
	return New(bindings, db.Client, signer, notifications.New(db.SQL, nil)), db.Close, nil
}

type EntIntegrationLookup struct{ Client *socialent.Client }

func (r EntIntegrationLookup) FindIntegration(ctx context.Context, orgID, destinationID, platform string) (*socialent.Integration, error) {
	item, err := r.Client.Integration.Query().Where(
		integration.ID(destinationID), integration.OrganizationID(orgID),
		integration.ProviderIdentifier(platform), integration.DeletedAtIsNil(),
	).Only(ctx)
	if socialent.IsNotFound(err) {
		return nil, socialapi.NewError(http.StatusNotFound, false, "social destination was not found")
	}
	return item, err
}

// PublishesSynchronously tells the Temporal activity that Publish returns the
// real provider receipt, so it must complete the canonical attempt directly.
func (*Publisher) PublishesSynchronously() bool { return true }

func (p *Publisher) Publish(ctx context.Context, input socialapi.PublishInput) (string, error) {
	receipt, err := p.PublishThread(ctx, input)
	return receipt.PostID, err
}

// account resolves the workspace's connected account and its provider for a
// publication, refusing a credential that is not the workspace's or has lapsed.
func (p *Publisher) account(ctx context.Context, organizationID, destinationID, platform, secretReference string,
	providerSettings map[string]any) (*socialent.Integration, poster, json.RawMessage, error) {
	if p.bindings == nil || p.integrations == nil || p.signer == nil || p.resolve == nil {
		return nil, nil, nil, socialapi.NewError(http.StatusServiceUnavailable, false, "direct publisher is not configured")
	}
	binding, err := p.bindings.Binding(ctx, organizationID)
	if err != nil {
		return nil, nil, nil, socialapi.NewError(http.StatusConflict, false, "workspace has no social connection binding")
	}
	if binding == nil || binding.SecretReference != secretReference {
		return nil, nil, nil, socialapi.NewError(http.StatusForbidden, false, "social credential does not belong to workspace")
	}
	account, err := p.integrations.FindIntegration(ctx, binding.GoOrganizationID, destinationID, platform)
	if err != nil {
		return nil, nil, nil, err
	}
	if account == nil || account.ID != destinationID || account.OrganizationID != binding.GoOrganizationID || account.ProviderIdentifier != platform || account.DeletedAt != nil || account.InBetweenSteps || account.Disabled || account.RefreshNeeded || account.Token == "" ||
		account.TokenExpiration != nil && !account.TokenExpiration.After(p.currentTime()) {
		return nil, nil, nil, socialapi.NewError(http.StatusConflict, false, "social credentials have expired or been disabled")
	}
	if integrations.RequireVerifiedIdentity(account) != nil {
		return nil, nil, nil, socialapi.NewError(http.StatusConflict, false, "reconnect this account to verify its identity, publishing permissions and limits")
	}
	provider := p.resolve(platform)
	if provider == nil || !directPlatformAllowed(platform) {
		return nil, nil, nil, socialapi.NewError(http.StatusBadRequest, false, "social provider is unsupported")
	}
	if providerSettings == nil {
		providerSettings = map[string]any{}
	}
	settings, err := json.Marshal(providerSettings)
	if err != nil {
		return nil, nil, nil, socialapi.NewError(http.StatusBadRequest, false, "invalid provider settings")
	}
	return account, provider, settings, nil
}

// pollDetails is a poll as providers take it: whole hours, at least one.
func pollDetails(poll *postoptions.Poll) *integrations.PollDetails {
	if poll == nil || len(poll.Options) < 2 {
		return nil
	}
	return &integrations.PollDetails{Options: poll.Options, Duration: max(1, (poll.DurationMinutes+59)/60)}
}

// publicationOutcome maps a provider failure: reconnect, or an outcome the
// remote account must be checked for before any retry.
func publicationOutcome(err error) error {
	if temporalx.FailureType(err) == temporalx.TypeRefreshToken || temporalx.FailureType(err) == temporalx.TypeDisconnect {
		return socialapi.NewError(http.StatusConflict, false, "social credentials must be reconnected")
	}
	// The provider may have accepted the post before the call failed. A
	// reconciliation step must inspect the remote account before retrying.
	return socialapi.NewError(http.StatusBadGateway, true, "social publication outcome is unknown")
}

// PublishThread publishes the post, or answers ReplyTo when it resumes a
// thread, then its replies; the receipt says how far the thread got.
func (p *Publisher) PublishThread(ctx context.Context, input socialapi.PublishInput) (socialapi.Receipt, error) {
	if input.OrganizationID == "" || input.DestinationID == "" || input.Platform == "" || input.PostID == "" {
		return socialapi.Receipt{}, socialapi.NewError(http.StatusBadRequest, false, "incomplete publication request")
	}
	account, provider, settings, err := p.account(ctx, input.OrganizationID, input.DestinationID, input.Platform,
		input.SecretReference, input.ProviderSettings)
	if err != nil {
		return socialapi.Receipt{}, err
	}
	// A content draft post without an image publishes as text (RFC 037); a
	// LinkedIn document goes out as the post's one media (RFC 042).
	assets := input.Media()
	if input.Document != nil {
		assets = []publishing.MediaAsset{*input.Document}
	}
	media, err := p.signedMedia(ctx, input.OrganizationID, assets)
	if err != nil {
		return socialapi.Receipt{}, err
	}
	if settings, err = postSettings(input.Platform, input.ProviderSettings, input.Options, ""); err != nil {
		return socialapi.Receipt{}, socialapi.NewError(http.StatusBadRequest, false, "invalid post settings")
	}
	if settings, err = p.articleCover(ctx, input, settings); err != nil {
		return socialapi.Receipt{}, socialapi.NewError(http.StatusServiceUnavailable, false, "article cover could not be signed")
	}
	// Signing media can take time. Reload the grant immediately before handoff,
	// allowing credential refresh but never a different destination identity.
	account, provider, err = p.publicationAccount(ctx, input, account)
	if err != nil {
		return socialapi.Receipt{}, err
	}
	details := []integrations.PostDetails{{
		ID: input.PostID, Message: input.Caption, Settings: settings, Media: media, Poll: pollFor(input.Poll, input.Options),
	}}
	var response []integrations.PostResponse
	if input.ReplyTo != "" {
		commenter, ok := provider.(integrations.Commenter)
		if !ok {
			return socialapi.Receipt{}, socialapi.NewError(http.StatusBadRequest, false, "this provider cannot continue a thread")
		}
		response, err = commenter.Comment(ctx, account.InternalID, input.ReplyTo, "", account.Token, details, account)
		if err == nil && len(response) == 1 && response[0].PostID != "" && response[0].Status == "" {
			response[0].Status = "posted"
		}
	} else {
		response, err = provider.Post(ctx, account.InternalID, account.Token, details, account)
	}
	if err != nil {
		return socialapi.Receipt{}, publicationOutcome(err)
	}
	if len(response) != 1 || response[0].PostID == "" ||
		response[0].Status != "posted" && response[0].Status != "success" && response[0].Status != "completed" {
		return socialapi.Receipt{}, socialapi.NewError(http.StatusBadGateway, true, "provider returned no confirmed post receipt")
	}
	progress := p.postReplies(ctx, provider, account, input, response[0].PostID)
	return socialapi.Receipt{PostID: response[0].PostID, Thread: progress}, nil
}

func (p *Publisher) publicationAccount(ctx context.Context, input socialapi.PublishInput, expected *socialent.Integration) (*socialent.Integration, poster, error) {
	current, provider, _, err := p.account(ctx, input.OrganizationID, input.DestinationID, input.Platform, input.SecretReference, input.ProviderSettings)
	if err != nil {
		return nil, nil, err
	}
	if current.InternalID != expected.InternalID || current.OrganizationID != expected.OrganizationID {
		return nil, nil, socialapi.NewError(http.StatusConflict, false, "social destination identity changed before publication")
	}
	return current, provider, nil
}

// metricNames maps provider analytics labels to the draft's metric names.
var metricNames = map[string]string{
	"impressions": "impressions", "likes": "likes", "retweets": "reposts", "reposts": "reposts",
	"replies": "replies", "comments": "replies", "quotes": "quotes", "bookmarks": "bookmarks",
	"shares": "reposts", "reactions": "likes", "views": "impressions",
}

// PostMetrics reads a live post's engagement through its provider; a
// provider without post analytics has none.
func (p *Publisher) PostMetrics(ctx context.Context, organizationID, destinationID, platform, secretReference,
	remotePostID string) (postoptions.Metrics, error) {
	account, provider, _, err := p.account(ctx, organizationID, destinationID, platform, secretReference, nil)
	if err != nil {
		return nil, err
	}
	reader, ok := provider.(integrations.PostAnalytics)
	if !ok {
		return postoptions.Metrics{}, nil
	}
	series, err := reader.PostAnalytics(ctx, account.InternalID, account.Token, remotePostID, 0)
	if err != nil {
		return nil, err
	}
	metrics := postoptions.Metrics{}
	for _, item := range series {
		name, known := metricNames[strings.ToLower(item.Label)]
		if !known || len(item.Data) == 0 {
			continue
		}
		var total float64
		if _, err := fmt.Sscan(fmt.Sprint(item.Data[len(item.Data)-1].Total), &total); err == nil {
			metrics[name] += total
		}
	}
	return metrics, nil
}

// autoActor is a provider's like-gated follow-ups (X).
type autoActor interface {
	AutoRepostPost(context.Context, *socialent.Integration, string, map[string]string) (bool, error)
	AutoPlugPost(context.Context, *socialent.Integration, string, map[string]string) (bool, error)
}

// AutoAct runs a live post's follow-ups that are due: a repost and a plug
// reply once it has enough likes, and a quote (the text with a link to the
// post). One the provider cannot do reports done, so it is not tried again.
func (p *Publisher) AutoAct(ctx context.Context, input socialapi.AutoActionInput) (socialapi.AutoActionResult, error) {
	result := socialapi.AutoActionResult{Plugged: !input.Plug, Quoted: !input.Quote, Reposted: !input.Repost}
	account, provider, settings, err := p.account(ctx, input.OrganizationID, input.DestinationID, input.Platform,
		input.SecretReference, nil)
	if err != nil {
		return result, err
	}
	auto, ok := provider.(autoActor)
	if input.Repost {
		result.Reposted = !ok
		if ok {
			done, err := auto.AutoRepostPost(ctx, account, input.RemotePostID, map[string]string{"likesAmount": fmt.Sprint(input.RepostAtLikes)})
			result.Reposted = err == nil && done
		}
	}
	if input.Plug {
		result.Plugged = !ok
		if ok {
			done, err := auto.AutoPlugPost(ctx, account, input.RemotePostID,
				map[string]string{"likesAmount": fmt.Sprint(input.PlugAtLikes), "post": input.PlugText})
			result.Plugged = err == nil && done
		}
	}
	if input.Quote {
		link := input.PostURL
		if link == "" && input.Platform == "x" {
			link = "https://x.com/i/status/" + input.RemotePostID
		}
		_, err := provider.Post(ctx, account.InternalID, account.Token, []integrations.PostDetails{{
			ID: input.RemotePostID + "-quote", Message: strings.TrimSpace(input.QuoteText + " " + link), Settings: settings,
		}}, account)
		// Quoting once is the point: a failed quote is not retried into a duplicate.
		result.Quoted = true
		if err != nil {
			slog.ErrorContext(ctx, "quote post failed", "post", input.RemotePostID, "error", err)
		}
	}
	return result, nil
}

// postReplies posts a thread's later posts, each answering the one before.
// The first post is already live, so a reply that fails ends the thread
// there rather than retrying the publication (which would post the first
// again). The progress it returns is kept on the post, and the composer
// offers to post the rest.
func (p *Publisher) postReplies(ctx context.Context, provider poster, account *socialent.Integration,
	input socialapi.PublishInput, postID string) postoptions.ThreadProgress {
	progress := postoptions.ThreadProgress{Total: len(input.Replies)}
	if len(input.Replies) == 0 {
		return progress
	}
	commenter, ok := provider.(integrations.Commenter)
	if !ok {
		slog.WarnContext(ctx, "provider cannot post thread replies", "platform", input.Platform, "post", input.PostID)
		return progress
	}
	last := ""
	for index, reply := range input.Replies {
		media, err := p.signedMedia(ctx, input.OrganizationID, reply.Assets)
		// A reply has only its own settings: never the first post's
		// community, quote or article.
		var replySettings json.RawMessage
		if err == nil {
			replySettings, err = postSettings(input.Platform, input.ProviderSettings, nil, "")
		}
		if err == nil && reply.Options != nil {
			// The first post is live now, so a reply quoting it can name it.
			replySettings, err = postSettings(input.Platform, input.ProviderSettings, reply.Options, postID)
		}
		if err == nil {
			account, provider, err = p.publicationAccount(ctx, input, account)
			if err == nil {
				commenter, ok = provider.(integrations.Commenter)
				if !ok {
					err = errors.New("provider cannot continue thread replies")
				}
			}
		}
		if err == nil {
			var response []integrations.PostResponse
			response, err = commenter.Comment(ctx, account.InternalID, postID, last, account.Token, []integrations.PostDetails{{
				ID: fmt.Sprintf("%s-reply-%d", input.PostID, index+1), Message: reply.Caption, Settings: replySettings, Media: media,
			}}, account)
			if err == nil && (len(response) == 0 || response[0].PostID == "") {
				err = errors.New("provider returned no reply receipt")
			}
			if err == nil {
				last = response[0].PostID
				progress.Posted, progress.LastReplyID = index+1, last
				continue
			}
		}
		slog.ErrorContext(ctx, "thread reply was not posted", "post", input.PostID, "reply", index+1, "error", err)
		return progress
	}
	return progress
}

// signedMedia signs each private file for the provider to fetch, in order.
func (p *Publisher) signedMedia(ctx context.Context, organizationID string, assets []publishing.MediaAsset) ([]integrations.MediaContent, error) {
	var media []integrations.MediaContent
	for _, asset := range assets {
		path, err := p.signer.SignDelivery(ctx, organizationID, asset.ObjectKey)
		if err != nil {
			return nil, socialapi.NewError(http.StatusServiceUnavailable, false, "private asset could not be signed")
		}
		mediaType := "image"
		if strings.HasPrefix(asset.MediaType, "video/") {
			mediaType = "video"
		}
		media = append(media, integrations.MediaContent{Alt: asset.Alt, Type: mediaType, Path: path})
	}
	return media, nil
}

func (p *Publisher) Status(context.Context, socialapi.StatusInput) (socialapi.StatusResult, error) {
	return socialapi.StatusResult{}, socialapi.NewError(http.StatusConflict, false, "direct provider receipts do not require local status polling")
}

func (p *Publisher) currentTime() time.Time {
	if p.now != nil {
		return p.now().UTC()
	}
	return time.Now().UTC()
}
