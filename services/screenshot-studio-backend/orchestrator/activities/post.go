package activities

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/posts"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/webhooks"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ssrf"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/upload"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

var _ PostActivity = (*PostActivities)(nil)

// PostActivities is post.activity.ts.
type PostActivities struct {
	posts         *posts.Service
	notifications *notifications.Service
	manager       *integrations.Manager
	integrations  *integration.Service
	refresh       *integration.RefreshIntegrationService
	webhooks      *webhooks.Service
	temporal      client.Client
	subscriptions *subscriptions.Service
}

func NewPostActivities(postsService *posts.Service, notificationService *notifications.Service, manager *integrations.Manager,
	integrationService *integration.Service, refresh *integration.RefreshIntegrationService, webhookService *webhooks.Service,
	temporalClient client.Client, subscriptionService *subscriptions.Service) *PostActivities {
	return &PostActivities{
		posts: postsService, notifications: notificationService, manager: manager, integrations: integrationService,
		refresh: refresh, webhooks: webhookService, temporal: temporalClient, subscriptions: subscriptionService,
	}
}

// postWorkflowInput is the postWorkflowV112 argument.
type postWorkflowInput struct {
	TaskQueue      string `json:"taskQueue"`
	PostID         string `json:"postId"`
	OrganizationID string `json:"organizationId"`
}

// provider is getSocialIntegration; TypeScript throws a TypeError on the
// first use of an unknown provider.
func (a *PostActivities) provider(identifier string) (integrations.Provider, error) {
	if p := a.manager.GetSocialIntegration(identifier); p != nil {
		return p, nil
	}
	return nil, fmt.Errorf("Cannot read properties of undefined (provider %s)", identifier)
}

// hasSubscription is false when STRIPE_SECRET_KEY is set and the organization
// has no subscription.
func (a *PostActivities) hasSubscription(ctx context.Context, orgID string) (bool, error) {
	if os.Getenv("STRIPE_SECRET_KEY") == "" {
		return true, nil
	}
	sub, err := a.subscriptions.GetSubscription(ctx, orgID)
	return sub != nil, err
}

func (a *PostActivities) GetIntegrationByID(ctx context.Context, orgID, id string) (*Integration, error) {
	i, err := a.integrations.GetIntegrationByID(ctx, orgID, id)
	return toIntegration(i), err
}

func (a *PostActivities) SearchForMissingThreeHoursPosts(ctx context.Context) error {
	list, err := a.posts.SearchForMissingThreeHoursPosts(ctx)
	if err != nil {
		return err
	}
	for _, p := range list {
		// TypeScript sends no signal arguments; the Go client always sends
		// one (null), which the poke handler ignores.
		if _, err := a.temporal.SignalWithStartWorkflow(ctx, "post_"+p.ID, "poke", nil, client.StartWorkflowOptions{
			ID:                       "post_" + p.ID,
			TaskQueue:                temporalx.MainQueue,
			WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING,
			TypedSearchAttributes: temporal.NewSearchAttributes(
				temporalx.PostID.ValueSet(p.ID),
				temporalx.OrganizationID.ValueSet(p.OrganizationID),
			),
		}, "postWorkflowV112", postWorkflowInput{
			TaskQueue:      strings.ToLower(strings.Split(p.Integration.ProviderIdentifier, "-")[0]),
			PostID:         p.ID,
			OrganizationID: p.OrganizationID,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (a *PostActivities) UpdatePost(ctx context.Context, id, postID, releaseURL string) error {
	_, err := a.posts.UpdatePost(ctx, id, postID, releaseURL)
	return err
}

func (a *PostActivities) GetPost(ctx context.Context, orgID, postID string) (OrFalse[Post], error) {
	if ok, err := a.hasSubscription(ctx, orgID); err != nil || !ok {
		return OrFalse[Post]{}, err
	}
	p, err := a.posts.GetPostByID(ctx, postID, orgID)
	if err != nil {
		return OrFalse[Post]{}, err
	}
	if p == nil {
		return OrFalse[Post]{}, errors.New("Cannot read properties of null (reading 'deletedAt')")
	}
	if p.DeletedAt != nil {
		return OrFalse[Post]{}, nil
	}

	out := toPost(p, false)
	out.SubmittedForOrder = json.RawMessage("null")
	if p.Edges.SubmittedForOrder != nil {
		if out.SubmittedForOrder, err = json.Marshal(p.Edges.SubmittedForOrder); err != nil {
			return OrFalse[Post]{}, err
		}
	}
	out = reanchorInterval(out, time.Now())
	return OrFalse[Post]{V: &out}, nil
}

func (a *PostActivities) GetPostsList(ctx context.Context, orgID, postID string) ([]Post, error) {
	if ok, err := a.hasSubscription(ctx, orgID); err != nil || !ok {
		return []Post{}, err
	}

	getPosts, err := a.posts.GetPostsRecursively(ctx, postID, true, orgID)
	if err != nil {
		return nil, err
	}
	if len(getPosts) == 0 || getPosts[0].ParentPostID != nil {
		return []Post{}, nil
	}

	// only the root drives the pre-publish sleep and the repeat schedule,
	// the rest are comments
	out := make([]Post, 0, len(getPosts))
	for _, p := range getPosts {
		out = append(out, toPost(p, true))
	}
	out[0] = reanchorInterval(out[0], time.Now())
	return out, nil
}

func (a *PostActivities) IsCommentable(ctx context.Context, in *Integration) (bool, error) {
	provider, err := a.provider(in.ProviderIdentifier)
	if err != nil {
		return false, err
	}
	_, ok := provider.(integrations.Commenter)
	return ok, nil
}

func (a *PostActivities) PostComment(ctx context.Context, postID string, lastPostID *string, in *Integration, list []Post) ([]integrations.PostResponse, error) {
	// kept only for in-flight postWorkflowV108 runs, which set a
	// heartbeatTimeout on this activity - removing the sender would kill
	// them. Under V109+ (no heartbeatTimeout) this is a no-op and can be
	// dropped once all V108 executions have drained
	return temporalx.WithHeartbeat(ctx, func(ctx context.Context) ([]integrations.PostResponse, error) {
		return handleDisconnect(ctx, a, in, func() ([]integrations.PostResponse, error) {
			provider, err := a.provider(in.ProviderIdentifier)
			if err != nil {
				return nil, err
			}
			commenter, ok := provider.(integrations.Commenter)
			if !ok {
				return nil, errors.New("getIntegration.comment is not a function")
			}

			newPosts, err := a.updateTags(ctx, in.OrganizationID, list)
			if err != nil {
				return nil, err
			}
			mapped, err := a.mapPosts(ctx, provider, newPosts, false)
			if err != nil {
				return nil, err
			}

			last := ""
			if lastPostID != nil {
				last = *lastPostID
			}
			return commenter.Comment(ctx, in.InternalID, postID, last, in.Token, mapped, entIntegration(in))
		})
	})
}

func (a *PostActivities) PostSocial(ctx context.Context, in *Integration, list []Post) ([]integrations.PostResponse, error) {
	return a.postSocialInternal(ctx, in, list, false)
}

// PostSocialPending is used by postWorkflowV106 and up: providers that
// implement PostPending return a `pending` response the workflow resolves via
// checkPostStatus / finalizePost. Older workflow versions keep calling
// postSocial and get the old blocking behavior.
func (a *PostActivities) PostSocialPending(ctx context.Context, in *Integration, list []Post) ([]integrations.PostResponse, error) {
	return a.postSocialInternal(ctx, in, list, true)
}

// handleDisconnect: a Disconnect error means the platform will keep rejecting
// this channel no matter how many token refreshes (e.g. TikTok's daily active
// user cap): mark the channel as needing a re-connect and notify the user,
// then rethrow as BadBody so every workflow version - frozen once on main -
// treats it as a terminal error without needing a new workflow.
func handleDisconnect[T any](ctx context.Context, a *PostActivities, in *Integration, fn func() (T, error)) (T, error) {
	out, err := fn()
	if err == nil || temporalx.FailureType(err) != temporalx.TypeDisconnect {
		return out, err
	}

	message := temporalx.FailureMessage(err)
	_ = a.integrations.DisconnectChannel(ctx, in.OrganizationID, entIntegration(in), message)

	var zero T
	return zero, temporalx.BadBody(in.ProviderIdentifier, "{}", "{}", message)
}

func (a *PostActivities) postSocialInternal(ctx context.Context, in *Integration, list []Post, allowPending bool) ([]integrations.PostResponse, error) {
	// kept only for in-flight postWorkflowV108 runs, which set a
	// heartbeatTimeout on this activity - removing the sender would kill
	// them. Under V109+ (no heartbeatTimeout) this is a no-op and can be
	// dropped once all V108 executions have drained
	return temporalx.WithHeartbeat(ctx, func(ctx context.Context) ([]integrations.PostResponse, error) {
		return handleDisconnect(ctx, a, in, func() ([]integrations.PostResponse, error) {
			return a.postSocialBody(ctx, in, list, allowPending)
		})
	})
}

func (a *PostActivities) postSocialBody(ctx context.Context, in *Integration, list []Post, allowPending bool) ([]integrations.PostResponse, error) {
	// Stage markers: whatever ran last is what a timed-out activity reports.
	// Providers that go through Fetch overwrite these with the exact URL; the
	// ones on their own HTTP client are still narrowed down to the step they
	// hung on.
	temporalx.SetHeartbeatDetails(ctx, "subscription lookup")
	if os.Getenv("STRIPE_SECRET_KEY") != "" {
		sub, err := a.subscriptions.GetSubscription(ctx, in.OrganizationID)
		if err != nil {
			return nil, err
		}
		if sub == nil {
			return nil, errors.New("No active subscription found for this organization.")
		}
	}

	provider, err := a.provider(in.ProviderIdentifier)
	if err != nil {
		return nil, err
	}

	temporalx.SetHeartbeatDetails(ctx, "update tags")
	newPosts, err := a.updateTags(ctx, in.OrganizationID, list)
	if err != nil {
		return nil, err
	}

	temporalx.SetHeartbeatDetails(ctx, "resolve media")
	mapped, err := a.mapPosts(ctx, provider, newPosts, true)
	if err != nil {
		return nil, err
	}

	temporalx.SetHeartbeatDetails(ctx, in.ProviderIdentifier+": publish")
	var postNow []integrations.PostResponse
	if pending, ok := provider.(integrations.PendingPoster); allowPending && ok {
		postNow, err = pending.PostPending(ctx, in.InternalID, in.Token, mapped, entIntegration(in))
	} else {
		postNow, err = provider.Post(ctx, in.InternalID, in.Token, mapped, entIntegration(in))
	}
	if err != nil {
		return nil, err
	}

	// The post is already published at this point: the streak is best-effort,
	// failing the activity here would retry it and publish again.
	temporalx.SetHeartbeatDetails(ctx, in.ProviderIdentifier+": published, streak")
	if a.temporal != nil {
		_, _ = a.temporal.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
			ID:        "streak_" + in.OrganizationID,
			TaskQueue: temporalx.MainQueue,
			// Keep a running streak, it checks for newer posts before it ends
			WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING,
			TypedSearchAttributes:    temporal.NewSearchAttributes(temporalx.OrganizationID.ValueSet(in.OrganizationID)),
		}, "streakWorkflowV2", map[string]string{"organizationId": in.OrganizationID})
	}

	return postNow, nil
}

func (a *PostActivities) updateTags(ctx context.Context, orgID string, list []Post) ([]*ent.Post, error) {
	rows := make([]*ent.Post, 0, len(list))
	for _, p := range list {
		rows = append(rows, entPost(p))
	}
	return a.posts.UpdateTags(ctx, orgID, rows)
}

var htmlTag = regexp.MustCompile(`(?i)</?[a-z][\s\S]*>`)

// mapPosts builds what the provider publishes: the message stripped for the
// provider's editor, the parsed settings and the resolved media.
// inlineImages is only asked by postSocial (postComment never passed it).
func (a *PostActivities) mapPosts(ctx context.Context, provider integrations.Provider, list []*ent.Post, inlineImages bool) ([]integrations.PostDetails, error) {
	info := provider.Info()
	mediaSigner, err := upload.NewPrivateMediaSigner()
	if err != nil {
		return nil, err
	}
	var mention func(string, string) string
	if m, ok := provider.(integrations.MentionFormatter); ok {
		mention = m.MentionFormat
	}

	out := make([]integrations.PostDetails, 0, len(list))
	for _, p := range list {
		settings := json.RawMessage("{}")
		if p.Settings != nil && *p.Settings != "" {
			settings = json.RawMessage(*p.Settings)
		}
		if !json.Valid(settings) {
			return nil, fmt.Errorf("post %s: settings is not valid JSON", p.ID)
		}

		inline := false
		if i, ok := provider.(integrations.InlineImager); ok && inlineImages {
			inline = i.InlineImages(settings)
		}

		image := "[]"
		if p.Image != nil && *p.Image != "" {
			image = *p.Image
		}
		var images []map[string]any
		if err := json.Unmarshal([]byte(image), &images); err != nil {
			return nil, err
		}
		media, err := mediaContent(a.posts.UpdateMedia(ctx, p.ID, images, info.ConvertToJPEG))
		if err != nil {
			return nil, err
		}
		for i := range media {
			if media[i].Path, err = mediaSigner.SignURL(ctx, media[i].Path); err != nil {
				return nil, err
			}
			if media[i].Thumbnail, err = mediaSigner.SignURL(ctx, media[i].Thumbnail); err != nil {
				return nil, err
			}
		}

		out = append(out, integrations.PostDetails{
			ID: p.ID,
			Message: helpers.StripHTMLValidation(info.Editor, p.Content, helpers.StripOptions{
				ReplaceBold: true, Plain: !htmlTag.MatchString(p.Content), ConvertMention: mention, InlineImages: inline,
			}),
			Settings: settings,
			Media:    media,
		})
	}
	return out, nil
}

func mediaContent(list []map[string]any) ([]integrations.MediaContent, error) {
	data, err := json.Marshal(list)
	if err != nil {
		return nil, err
	}
	var out []integrations.MediaContent
	return out, json.Unmarshal(data, &out)
}

func (a *PostActivities) CheckPostStatus(ctx context.Context, in *Integration, pendingData json.RawMessage) (*integrations.PendingCheckResponse, error) {
	provider, err := a.provider(in.ProviderIdentifier)
	if err != nil {
		return nil, err
	}
	return handleDisconnect(ctx, a, in, func() (*integrations.PendingCheckResponse, error) {
		return provider.CheckPostStatus(ctx, in.Token, pendingData, entIntegration(in))
	})
}

func (a *PostActivities) FinalizePost(ctx context.Context, in *Integration, pendingData json.RawMessage) (*integrations.PendingCheckResponse, error) {
	provider, err := a.provider(in.ProviderIdentifier)
	if err != nil {
		return nil, err
	}
	return temporalx.WithHeartbeat(ctx, func(ctx context.Context) (*integrations.PendingCheckResponse, error) {
		return handleDisconnect(ctx, a, in, func() (*integrations.PendingCheckResponse, error) {
			return provider.FinalizePost(ctx, in.Token, pendingData, entIntegration(in))
		})
	})
}

func (a *PostActivities) InAppNotification(ctx context.Context, orgID, subject, message string, sendEmail, digest bool, notificationType string) error {
	typ := notifications.TypeSuccess
	if notificationType != "" {
		typ = notifications.NotificationType(notificationType)
	}
	return a.notifications.InAppNotification(ctx, orgID, subject, message, sendEmail, digest, typ)
}

func (a *PostActivities) GlobalPlugs(ctx context.Context, in *Integration) ([]GlobalPlug, error) {
	list, err := a.posts.CheckPlugs(ctx, in.OrganizationID, in.ProviderIdentifier, in.ID)
	if err != nil {
		return nil, err
	}
	out := make([]GlobalPlug, 0, len(list))
	for _, p := range list {
		out = append(out, GlobalPlug{Type: p.Type, PlugID: p.PlugID, Delay: float64(p.Delay), TotalRuns: p.TotalRuns})
	}
	return out, nil
}

func (a *PostActivities) ChangeState(ctx context.Context, id, state string, errValue, body json.RawMessage) error {
	_, err := a.posts.ChangeState(ctx, id, post.State(state), jsArg(errValue), jsArg(body))
	return err
}

func (a *PostActivities) InternalPlugs(ctx context.Context, in *Integration, settings json.RawMessage) ([]InternalPlug, error) {
	list, err := a.posts.CheckInternalPlug(entIntegration(in), in.OrganizationID, in.ID, settings)
	if err != nil {
		return nil, err
	}
	out := make([]InternalPlug, 0, len(list))
	for _, p := range list {
		information, err := json.Marshal(p.Information)
		if err != nil {
			return nil, err
		}
		out = append(out, InternalPlug{
			Type: p.Type, Post: p.Post, OriginalIntegration: p.OriginalIntegration, Integration: p.Integration,
			PlugName: p.PlugName, OrgID: p.OrgID, Delay: &p.Delay, Information: information,
		})
	}
	return out, nil
}

// SendWebhooks: webhooks are best-effort and run after the post already
// published, so a failure here must not fail the workflow.
func (a *PostActivities) SendWebhooks(ctx context.Context, postID, orgID, integrationID string) error {
	list, err := a.webhooks.GetWebhooks(ctx, orgID)
	if err != nil {
		return nil
	}
	var urls []string
	for _, w := range list {
		match := len(w.Integrations) == 0
		for _, i := range w.Integrations {
			match = match || i.Integration.ID == integrationID
		}
		if match {
			urls = append(urls, w.URL)
		}
	}
	if len(urls) == 0 {
		return nil
	}

	found, err := a.posts.GetPostByForWebhookID(ctx, postID, integrationID)
	if err != nil {
		return nil
	}
	body, err := stringify(found)
	if err != nil {
		return nil
	}

	var wg sync.WaitGroup
	for _, url := range urls {
		wg.Go(func() {
			// webhook.url is validated at save time, but DNS can change
			// between then and now - pin resolution like every other
			// user-influenced outbound request.
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
			if err != nil {
				return
			}
			req.Header.Set("Content-Type", "application/json")
			if res, err := ssrf.Client().Do(req); err == nil {
				res.Body.Close()
			}
		})
	}
	wg.Wait()
	return nil
}

// stringify is JSON.stringify: no HTML escaping, no trailing newline.
func stringify(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

func (a *PostActivities) ProcessPlug(ctx context.Context, data ProcessPlugInput) (bool, error) {
	// the workflows never send currentRun: undefined never equals totalRuns
	currentRun := -1
	if data.CurrentRun != nil {
		currentRun = *data.CurrentRun
	}
	return a.integrations.ProcessPlugs(ctx, integration.PlugsData{
		PlugID: data.PlugID, PostID: data.PostID, Delay: int64(data.Delay), TotalRuns: data.TotalRuns, CurrentRun: currentRun,
	})
}

func (a *PostActivities) ProcessInternalPlug(ctx context.Context, data InternalPlug) error {
	var delay int64
	if data.Delay != nil {
		delay = int64(*data.Delay)
	}
	return a.integrations.ProcessInternalPlug(ctx, integration.InternalPlugData{
		Post: data.Post, OriginalIntegration: data.OriginalIntegration, Integration: data.Integration,
		PlugName: data.PlugName, OrgID: data.OrgID, Delay: delay, Information: data.Information,
	}, false)
}

func (a *PostActivities) RefreshToken(ctx context.Context, in *Integration) (OrFalse[integrations.AuthTokenDetails], error) {
	return a.RefreshTokenWithCause(ctx, in, "")
}

// RefreshTokenWithCause also serves refreshToken (cause ""): there the
// between-steps message is err.message, here cause || err.message.
func (a *PostActivities) RefreshTokenWithCause(ctx context.Context, in *Integration, cause string) (OrFalse[integrations.AuthTokenDetails], error) {
	row := entIntegration(in)
	refresh, err := a.refresh.Refresh(ctx, row, cause)
	if err != nil {
		message := cause
		if message == "" {
			message = temporalx.FailureMessage(err)
		}
		return OrFalse[integrations.AuthTokenDetails]{}, a.refresh.SetBetweenSteps(ctx, row, message)
	}
	if refresh == nil {
		return OrFalse[integrations.AuthTokenDetails]{}, nil
	}

	if p := a.manager.GetSocialIntegration(in.ProviderIdentifier); p != nil && p.Info().RefreshWait {
		t := time.NewTimer(10 * time.Second)
		select {
		case <-t.C:
		case <-ctx.Done():
			t.Stop()
		}
	}
	return OrFalse[integrations.AuthTokenDetails]{V: refresh}, nil
}
