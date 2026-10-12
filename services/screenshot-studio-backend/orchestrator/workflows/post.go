package workflows

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/orchestrator/activities"
)

// PostWorkflowInput is the argument of every postWorkflowV1xx.
type PostWorkflowInput struct {
	TaskQueue      string `json:"taskQueue"`
	PostID         string `json:"postId"`
	OrganizationID string `json:"organizationId"`
	PostNow        bool   `json:"postNow,omitempty"`
}

// The twelve post workflow versions (post-workflows/post.workflow.v1.0.1.ts
// ... v1.1.2.ts). Runs stay on the version they started with, so each keeps
// its own behavior; postWorkflow branches on the version where they differ.
// They return undefined (nil) or false, like TypeScript.

func PostWorkflowV101(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 101, in)
}

func PostWorkflowV102(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 102, in)
}

func PostWorkflowV103(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 103, in)
}

func PostWorkflowV104(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 104, in)
}

func PostWorkflowV105(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 105, in)
}

func PostWorkflowV106(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 106, in)
}

func PostWorkflowV107(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 107, in)
}

func PostWorkflowV108(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 108, in)
}

func PostWorkflowV109(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 109, in)
}

func PostWorkflowV110(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 110, in)
}

func PostWorkflowV111(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 111, in)
}

func PostWorkflowV112(ctx workflow.Context, in PostWorkflowInput) (any, error) {
	return postWorkflow(ctx, 112, in)
}

// The publishing activities heartbeat every 15s (withHeartbeat sends its first
// heartbeat at the first interval tick, not at entry), so a heartbeat timeout
// whose failure carries no heartbeat details means the server never received
// one: the worker never ran the activity, or it died within its first seconds.
const heartbeatTimeout = 3 * time.Minute

// iterate is the `for (const _ of iterate)` retry budget.
const iterate = 5

// ~30 minutes at 20s interval (longer than the old in-activity loop, timers are
// free). Multi-item flows (stories, chunked uploads) consume several checks per
// item, so the budget must cover the largest realistic post, not one poll cycle.
const maxPendingChecks = 90

// publishContexts returns the proxies postComment and the main publish call
// (postSocial up to V105, postSocialPending / finalizePost from V106) run on.
func publishContexts(ctx workflow.Context, version int, taskQueue string, queueCtx workflow.Context) (comment, mutation workflow.Context) {
	switch {
	case version <= 105:
		return queueCtx, queueCtx
	// postSocialPending / finalizePost run irreversible publishing mutations,
	// so no automatic retries - a retried activity whose previous (timed-out)
	// attempt still completed in the background would publish twice. The
	// workflow retries deliberately, and treats timeouts as "outcome unknown".
	case version == 106:
		return queueCtx, activityCtx(ctx, taskQueue, 10*time.Minute, 0, once)
	// postComment publishes through providers that can legitimately run long
	// (media conversion + upload), so it gets a large time budget; the
	// heartbeatTimeout detects a dead worker.
	case version == 107:
		return activityCtx(ctx, taskQueue, 30*time.Minute, 3*time.Minute, retry3x2m),
			activityCtx(ctx, taskQueue, 30*time.Minute, 3*time.Minute, once)
	case version == 108:
		return activityCtx(ctx, taskQueue, 30*time.Minute, 10*time.Minute, retry3x2m),
			activityCtx(ctx, taskQueue, 30*time.Minute, 10*time.Minute, once)
	// No heartbeatTimeout: heartbeat reporting proved unreliable in production.
	case version <= 110:
		return activityCtx(ctx, taskQueue, 30*time.Minute, 0, retry3x2m),
			activityCtx(ctx, taskQueue, 30*time.Minute, 0, once)
	// The heartbeatTimeout exists to detect an activity that was never
	// started. No SDK retries: an automatic retry of a heartbeat timeout would
	// run again even when the first attempt did publish. The workflow decides
	// whether a failure is safe to retry (see classify).
	default:
		return activityCtx(ctx, taskQueue, 30*time.Minute, heartbeatTimeout, once),
			activityCtx(ctx, taskQueue, 30*time.Minute, heartbeatTimeout, once)
	}
}

// What the workflow does with a failed activity (handleActivityError):
// retry - the token was refreshed, or the activity never started (heartbeat
// timeout with no heartbeat), run the action again; stop - the token could not
// be refreshed; badBody - the platform rejected the action; timeout - the
// activity timed out, its outcome is unknown (V106+); unknown - anything else.
type outcome int

const (
	outcomeUnknown outcome = iota
	outcomeRetry
	outcomeStop
	outcomeBadBody
	outcomeTimeout
)

// plugTask is one entry of the post-publish action list.
type plugTask struct {
	kind     string // internal-plug | global | repeat-post
	delay    *float64
	internal activities.InternalPlug
	global   activities.GlobalPlug
}

// sortByDelay is lodash sortBy(list, 'delay'): stable, null delays last.
func sortByDelay(list []plugTask) {
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i].delay, list[j].delay
		if a == nil || b == nil {
			return a != nil && b == nil
		}
		return *a < *b
	})
}

func postWorkflow(ctx workflow.Context, version int, in PostWorkflowInput) (any, error) {
	name := fmt.Sprintf("postWorkflowV%d", version)

	mainCtx := activityCtx(ctx, "", 10*time.Minute, 0, retry3x2m)
	// Dynamic task queue, for concurrency
	queueCtx := activityCtx(ctx, in.TaskQueue, 10*time.Minute, 0, retry3x2m)
	// checkPostStatus is a single read-only status call, so it gets a short
	// timeout and fast retries - retrying it can never duplicate a post.
	checkCtx := activityCtx(ctx, in.TaskQueue, 2*time.Minute, 0, retry(3, 1, 10*time.Second))
	commentCtx, mutationCtx := publishContexts(ctx, version, in.TaskQueue, queueCtx)

	poke := workflow.GetSignalChannel(ctx, PokeSignal)
	workflow.Go(ctx, func(ctx workflow.Context) {
		for {
			poke.Receive(ctx, nil)
		}
	})

	changeState := func(id, state string, reason any, body ...any) error {
		return call(mainCtx, nil, activities.ChangeState, append([]any{id, state, errorValue(reason)}, body...)...)
	}
	notify := func(orgID, subject, message string, flags ...any) error {
		return call(mainCtx, nil, activities.InAppNotification, append([]any{orgID, subject, message}, flags...)...)
	}

	var startTime time.Time
	if version < 110 {
		startTime = workflow.Now(ctx)
	}

	// get all the posts and comments to post
	var postsListBefore []activities.Post
	if version < 105 {
		if err := call(mainCtx, &postsListBefore, activities.GetPostsList, in.OrganizationID, in.PostID); err != nil {
			return nil, err
		}
		switch {
		case version < 104:
			if len(postsListBefore) == 0 || (!in.PostNow && postsListBefore[0].State != activities.StateQueue) {
				if version == 103 {
					if len(postsListBefore) == 0 {
						// postsListBefore[0].id throws in TypeScript: the
						// workflow task fails and is retried.
						panic("Cannot read properties of undefined (reading 'id')")
					}
					if err := changeState(postsListBefore[0].ID, activities.StateError, "Already posted", postsListBefore); err != nil {
						return nil, err
					}
				}
				return nil, nil
			}
		default:
			// in case doesn't exists for some reason, fail it
			if len(postsListBefore) == 0 {
				return nil, changeState(in.PostID, activities.StateError, "No Post")
			}
			if !in.PostNow && postsListBefore[0].State != activities.StateQueue {
				return nil, changeState(postsListBefore[0].ID, activities.StateError, "Already posted", postsListBefore)
			}
		}

		// if it's a repeatable post, we should ignore this.
		if !in.PostNow {
			if err := sleepUntil(ctx, postsListBefore[0].PublishDate.Time); err != nil {
				return nil, err
			}
		}
	} else {
		var firstPost activities.OrFalse[activities.Post]
		if err := call(mainCtx, &firstPost, activities.GetPost, in.OrganizationID, in.PostID); err != nil {
			return nil, err
		}

		// in case doesn't exists for some reason, fail it
		if firstPost.V == nil {
			return nil, changeState(in.PostID, activities.StateError, "No Post")
		}

		if !in.PostNow && firstPost.V.State != activities.StateQueue {
			return nil, changeState(firstPost.V.ID, activities.StateError, "Already posted", []activities.Post{*firstPost.V})
		}

		// wait for the scheduled publish date
		if !in.PostNow {
			if err := sleepUntil(ctx, firstPost.V.PublishDate.Time); err != nil {
				return nil, err
			}
		}

		// Captured AFTER the scheduling sleep: the repeat-post delay is
		// "interval minus time spent publishing", so it must be measured from
		// the publish time, not from when the workflow was started.
		if version >= 110 {
			startTime = workflow.Now(ctx)
		}

		if err := call(mainCtx, &postsListBefore, activities.GetPostsList, in.OrganizationID, in.PostID); err != nil {
			return nil, err
		}
		if len(postsListBefore) == 0 {
			return nil, changeState(in.PostID, activities.StateError, "No Post")
		}
	}

	post := &postsListBefore[0]
	integ := post.Integration

	// if refresh is needed from last time, let's inform the user
	if integ.RefreshNeeded {
		if err := notify(post.OrganizationID,
			fmt.Sprintf("We couldn't post to %s for %s", integ.ProviderIdentifier, integ.Name),
			fmt.Sprintf("We couldn't post to %s for %s because you need to reconnect it. Please enable it and try again.", integ.ProviderIdentifier, integ.Name),
			true, false, "info"); err != nil {
			return nil, err
		}
		if version >= 103 {
			return nil, changeState(postsListBefore[0].ID, activities.StateError, "Refresh channel needed", postsListBefore)
		}
		return nil, nil
	}

	// if it's disabled, inform the user
	if integ.Disabled {
		if err := notify(post.OrganizationID,
			fmt.Sprintf("We couldn't post to %s for %s", integ.ProviderIdentifier, integ.Name),
			fmt.Sprintf("We couldn't post to %s for %s because it's disabled. Please enable it and try again.", integ.ProviderIdentifier, integ.Name),
			true, false, "info"); err != nil {
			return nil, err
		}
		if version >= 103 {
			return nil, changeState(postsListBefore[0].ID, activities.StateError, "Channel disabled", postsListBefore)
		}
		return nil, nil
	}

	// Do we need to post comment for this social?
	postsList := postsListBefore[:1]
	if len(postsListBefore) != 1 {
		var toComment bool
		if err := call(mainCtx, &toComment, activities.IsCommentable, integ); err != nil {
			return nil, err
		}
		if toComment {
			postsList = postsListBefore
		}
	}

	// list of all the saved results
	var postsResults []integrations.PostResponse

	// classify is handleActivityError (V106+), and the inline checks of the
	// older versions, which behave the same minus the timeout outcome.
	// getIntegration loads the channel to refresh; without it the post's
	// channel is refreshed and its token updated. startedAt is set right
	// before a heartbeating publish call (zero otherwise).
	classify := func(err error, getIntegration func() (*activities.Integration, error), startedAt time.Time) (outcome, string, error) {
		cause, isActivity := activityCause(err)
		if !isActivity {
			return outcomeUnknown, "", nil
		}

		if timeout, ok := cause.(*temporal.TimeoutError); ok && version >= 106 {
			// The server copies the last heartbeat details it received into
			// the timeout failure. None at all means it never received a
			// heartbeat: the worker never ran the activity, so nothing was
			// published and it is safe to run again (V112). V111 instead
			// treated a heartbeat timeout firing right at the heartbeat window
			// after the call as never started.
			if !startedAt.IsZero() && timeout.TimeoutType() == enumspb.TIMEOUT_TYPE_HEARTBEAT {
				if version == 111 && workflow.Now(ctx).Sub(startedAt) <= heartbeatTimeout+10*time.Second {
					return outcomeRetry, "", nil
				}
				if version >= 112 && !timeout.HasLastHeartbeatDetails() {
					return outcomeRetry, "", nil
				}
			}
			return outcomeTimeout, "", nil
		}

		app, ok := cause.(*temporal.ApplicationError)
		if !ok {
			return outcomeUnknown, "", nil
		}

		switch app.Type() {
		case temporalx.TypeRefreshToken:
			target := integ
			if getIntegration != nil {
				var err error
				if target, err = getIntegration(); err != nil {
					return 0, "", err
				}
			}
			var refresh activities.OrFalse[integrations.AuthTokenDetails]
			if version == 101 {
				err = call(queueCtx, &refresh, activities.RefreshToken, target)
			} else {
				err = call(queueCtx, &refresh, activities.RefreshTokenWithCause, target, app.Message())
			}
			if err != nil {
				return 0, "", err
			}
			if refresh.V == nil || refresh.V.AccessToken == "" {
				return outcomeStop, app.Message(), nil
			}
			if getIntegration == nil {
				integ.Token = refresh.V.AccessToken
			}
			return outcomeRetry, app.Message(), nil
		case temporalx.TypeBadBody:
			return outcomeBadBody, app.Message(), nil
		}
		return outcomeUnknown, "", nil
	}

	// The platform may have accepted the post but we can't confirm it was
	// published - mark the error with a distinct message so the user checks
	// the account before reposting manually and duplicating it.
	markUnconfirmed := func(reason any) error {
		if err := changeState(postsList[0].ID, activities.StateError, reason, postsList); err != nil {
			return err
		}
		return notify(post.OrganizationID,
			fmt.Sprintf("We couldn't confirm your post on %s", capitalize(integ.ProviderIdentifier)),
			fmt.Sprintf("Your post was sent to %s, but we couldn't confirm it was published. Please check your %s account before posting again to avoid duplicates.", capitalize(integ.ProviderIdentifier), integ.Name),
			true, false, "fail")
	}

	badBodyNotice := func(comments bool, message string) error {
		where := " "
		if comments {
			where = " comments "
		}
		suffix := ""
		if message != "" {
			suffix = ": " + message
		}
		return notify(post.OrganizationID,
			fmt.Sprintf("Error posting%son %s for %s", where, integ.ProviderIdentifier, integ.Name),
			fmt.Sprintf("An error occurred while posting%son %s%s", where, integ.ProviderIdentifier, suffix),
			true, false, "fail")
	}

	// The post/comment was already accepted by the platform but returned as
	// "pending": poll the read-only status check with durable timers until it
	// completes. Outcomes are handled here; a returned error is an activity
	// that failed while handling one.
	resolvePending := func(pending integrations.PostResponse) (*integrations.PostResponse, error) {
		pendingData := pending.PendingData
		errorAttempts := 0

		for check := 0; check < maxPendingChecks; check++ {
			// only finalizePost heartbeats, so a checkPostStatus failure must
			// never be classified as never started
			var startedAt time.Time
			result, err := func() (integrations.PendingCheckResponse, error) {
				var result integrations.PendingCheckResponse
				if err := call(checkCtx, &result, activities.CheckPostStatus, integ, pendingData); err != nil {
					return result, err
				}

				// commit the check's state BEFORE finalizePost runs: if
				// finalize dies mid-mutation, the next check must see what it
				// had already authorized
				if result.Status != "completed" {
					pendingData = result.PendingData
				}

				// polling is done, run the remaining provider mutations
				if result.Status == "ready" {
					startedAt = workflow.Now(ctx)
					data := result.PendingData
					result = integrations.PendingCheckResponse{}
					if err := call(mutationCtx, &result, activities.FinalizePost, integ, data); err != nil {
						return result, err
					}
				}
				return result, nil
			}()

			if err == nil {
				if result.Status == "completed" {
					return &integrations.PostResponse{ID: pending.ID, PostID: result.PostID, ReleaseURL: result.ReleaseURL, Status: "success"}, nil
				}
				pendingData = result.PendingData

				// a fully successful iteration proves the platform is
				// reachable: the error budget bounds consecutive failures
				errorAttempts = 0
			} else {
				handle, message, herr := classify(err, nil, startedAt)
				if herr != nil {
					return nil, herr
				}

				// token refreshed, or finalize never started, check again right away
				if handle == outcomeRetry {
					continue
				}

				// the token could not be refreshed while checking, but the
				// platform already accepted the post - warn about a possible
				// live post
				if handle == outcomeStop {
					return nil, markUnconfirmed(err)
				}

				// the platform explicitly failed the post, it was not published
				if handle == outcomeBadBody {
					if err := changeState(postsList[0].ID, activities.StateError, err, postsList); err != nil {
						return nil, err
					}
					suffix := ""
					if message != "" {
						suffix = ": " + message
					}
					return nil, notify(post.OrganizationID,
						fmt.Sprintf("Error posting on %s for %s", integ.ProviderIdentifier, integ.Name),
						fmt.Sprintf("An error occurred while posting on %s%s", integ.ProviderIdentifier, suffix),
						true, false, "fail")
				}

				// unknown error on a read-only check, retry a few more times
				errorAttempts++
				if errorAttempts >= iterate {
					break
				}
			}

			// the platform is still processing, wait before the next check
			if err := sleep(ctx, 20*time.Second); err != nil {
				return nil, err
			}
		}

		// no verdict from the platform after all the checks
		return nil, markUnconfirmed("Could not confirm the post status")
	}

	// iterate over the posts
	for i := range postsList {
		before := len(postsResults)
		// once the platform accepted the post, the catch below must never
		// retry the publish - retrying after updatePost / notification errors
		// would duplicate the post (V106+)
		posted, updated := false, false

		// this is a small trick to repeat an action in case of token refresh
		for range iterate {
			// set right before a heartbeating publish call
			var startedAt time.Time
			stop, err := func() (bool, error) {
				var res []integrations.PostResponse
				if i == 0 {
					// first post the main post
					startedAt = workflow.Now(ctx)
					publish := activities.PostSocialPending
					if version < 106 {
						publish = activities.PostSocial
					}
					if err := call(mutationCtx, &res, publish, integ, []activities.Post{postsList[i]}); err != nil {
						return false, err
					}
				} else {
					// then post the comments if any
					if postsList[i].Delay != 0 {
						if err := sleep(ctx, time.Duration(max(0, postsList[i].Delay))*time.Minute); err != nil {
							return false, err
						}
					}
					var lastPostID *string
					if len(postsResults) != 1 {
						lastPostID = &postsResults[i-1].PostID
					}
					startedAt = workflow.Now(ctx)
					if err := call(commentCtx, &res, activities.PostComment, postsResults[0].PostID, lastPostID, integ, []activities.Post{postsList[i]}); err != nil {
						return false, err
					}
				}
				postsResults = append(postsResults, res...)
				posted = version >= 106

				// a provider that answered nothing: TypeScript throws a
				// TypeError reading postsResults[i]
				if len(postsResults) <= i {
					return false, errors.New("Cannot read properties of undefined")
				}

				// the platform accepted the post but is still processing it:
				// resolve it here before marking anything, a failed status
				// check can never re-run the publish above
				if version >= 106 && postsResults[i].Status == "pending" {
					resolved, err := resolvePending(postsResults[i])
					if err != nil {
						// never let a pending-resolution error reach the outer
						// catch, it would retry the post and duplicate it.
						// Best-effort error state, otherwise the post stays in
						// QUEUE and the missing-posts sweep would re-publish it.
						_ = markUnconfirmed(err)
						resolved = nil
					}
					if resolved == nil {
						return true, nil
					}
					postsResults[i] = *resolved
				}

				// mark post as successful
				if err := call(mainCtx, nil, activities.UpdatePost, postsList[i].ID, postsResults[i].PostID, postsResults[i].ReleaseURL); err != nil {
					return false, err
				}
				updated = true

				if i == 0 {
					// send notification on a sucessful post
					return false, notify(integ.OrganizationID,
						fmt.Sprintf("Your post has been published on %s", capitalize(integ.ProviderIdentifier)),
						fmt.Sprintf("Your post has been published on %s at %s", capitalize(integ.ProviderIdentifier), postsResults[0].ReleaseURL),
						true, true)
				}
				return false, nil
			}()
			if stop {
				return false, nil
			}
			// break the current while to move to the next post
			if err == nil {
				break
			}

			// the post is already live: never re-run the publish
			if posted {
				if !updated {
					// still marked QUEUE, record the error so the
					// missing-posts sweep doesn't re-publish it
					_ = markUnconfirmed(err)
					return false, nil
				}

				// already marked published, a failed notification shouldn't
				// abort the rest of the flow
				break
			}

			handle, message, herr := classify(err, nil, startedAt)
			if herr != nil {
				return nil, herr
			}

			// token refreshed, or the publish never started, repeat the action
			if handle == outcomeRetry {
				continue
			}

			// the activity timed out: the platform may still complete the
			// publish in the background, so never retry it
			if handle == outcomeTimeout {
				_ = markUnconfirmed(err)
				return false, nil
			}

			// for other errors, change state and inform the user if needed
			if err := changeState(postsList[0].ID, activities.StateError, err, postsList); err != nil {
				return nil, err
			}

			if handle == outcomeStop {
				return false, nil
			}

			// specific case for bad body errors
			if handle == outcomeBadBody {
				if err := badBodyNotice(i != 0, message); err != nil {
					return nil, err
				}
				return false, nil
			}
		}

		if len(postsResults) == before {
			// all retries exhausted without success: record it (V111+),
			// otherwise the post stays in QUEUE with no error and the
			// missing-posts sweep re-publishes it. A retried publish may have
			// run without reporting, so treat the outcome as unknown.
			if version >= 111 {
				_ = markUnconfirmed("Could not publish after several attempts")
			}
			return false, nil
		}
	}

	// send webhooks for the post
	if err := call(mainCtx, nil, activities.SendWebhooks, postsResults[0].PostID, post.OrganizationID, integ.ID); err != nil {
		return nil, err
	}

	// load internal plugs like repost by other users
	settings := json.RawMessage("null")
	if post.Settings != nil {
		settings = json.RawMessage(*post.Settings)
	}
	var internalPlugsList []activities.InternalPlug
	if err := call(queueCtx, &internalPlugsList, activities.InternalPlugs, integ, settings); err != nil {
		return nil, err
	}

	// load global plugs, like repost a post if it gets to a certain number of likes
	var globalPlugsList []activities.GlobalPlug
	if err := call(queueCtx, &globalPlugsList, activities.GlobalPlugs, integ); err != nil {
		return nil, err
	}

	list := make([]plugTask, 0, len(internalPlugsList)+len(globalPlugsList)+1)
	for _, p := range internalPlugsList {
		list = append(list, plugTask{kind: p.Type, delay: p.Delay, internal: p})
	}
	for _, p := range globalPlugsList {
		for run := 1; run <= p.TotalRuns; run++ {
			g := p
			g.Delay = p.Delay * float64(run)
			list = append(list, plugTask{kind: p.Type, delay: &g.Delay, global: g})
		}
	}

	// Check if the post is repeatable
	if post.IntervalInDays != nil && *post.IntervalInDays != 0 {
		delay := float64(int64(*post.IntervalInDays)*24*60*60*1000 - workflow.Now(ctx).Sub(startTime).Milliseconds())
		list = append(list, plugTask{kind: "repeat-post", delay: &delay})
	}

	// Sort all the actions by delay, so we can process them in order
	sortByDelay(list)

	// The older versions refresh a global plug's channel without updating the
	// post's token.
	var globalIntegration func() (*activities.Integration, error)
	if version < 106 {
		globalIntegration = func() (*activities.Integration, error) { return integ, nil }
	}

	// process all the plugs in order, we are using while because in some
	// cases we need to remove items from the list
	for len(list) > 0 {
		// get the next to process
		todo := list[0]
		list = list[1:]

		// wait for the delay
		delay := 0.0
		if todo.delay != nil {
			delay = max(0, *todo.delay)
		}
		if err := sleep(ctx, ms(delay)); err != nil {
			return nil, err
		}

		switch todo.kind {
		// process internal plug
		case "internal-plug":
			data := todo.internal
			data.Post = postsResults[0].PostID
			for range iterate {
				err := call(queueCtx, nil, activities.ProcessInternalPlug, data)
				if err == nil {
					break
				}
				handle, _, herr := classify(err, func() (*activities.Integration, error) {
					var found *activities.Integration
					return found, call(queueCtx, &found, activities.GetIntegrationByID, in.OrganizationID, data.Integration)
				}, time.Time{})
				if herr != nil {
					return nil, herr
				}
				if handle == outcomeStop || handle == outcomeBadBody {
					break
				}
			}

		// process global plug
		case "global":
			data := activities.ProcessPlugInput{
				Type: todo.global.Type, PlugID: todo.global.PlugID, Delay: todo.global.Delay,
				TotalRuns: todo.global.TotalRuns, PostID: postsResults[0].PostID,
			}
			for range iterate {
				var process bool
				err := call(queueCtx, &process, activities.ProcessPlug, data)
				if err == nil {
					if process {
						kept := list[:0]
						for _, current := range list {
							if current.kind != "global" || current.global.PlugID != todo.global.PlugID {
								kept = append(kept, current)
							}
						}
						list = kept
					}
					break
				}
				handle, _, herr := classify(err, globalIntegration, time.Time{})
				if herr != nil {
					return nil, herr
				}
				if handle == outcomeStop || handle == outcomeBadBody {
					break
				}
			}

		// process repeat post in a new workflow, this is important so the
		// other plugs can keep running
		case "repeat-post":
			var suffix string
			if err := workflow.SideEffect(ctx, func(workflow.Context) any { return ids.Make(10) }).Get(&suffix); err != nil {
				return nil, err
			}
			childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
				WorkflowID:            fmt.Sprintf("post_%s_%s", post.ID, suffix),
				ParentClosePolicy:     enumspb.PARENT_CLOSE_POLICY_ABANDON,
				TypedSearchAttributes: temporal.NewSearchAttributes(temporalx.PostID.ValueSet(in.PostID)),
			})
			child := workflow.ExecuteChildWorkflow(childCtx, name, PostWorkflowInput{
				TaskQueue: in.TaskQueue, PostID: in.PostID, OrganizationID: in.OrganizationID, PostNow: true,
			})
			if err := child.GetChildWorkflowExecution().Get(ctx, nil); err != nil {
				return nil, err
			}
		}
	}

	return nil, nil
}

// sleepUntil waits for the publish date: dayjs(date).isBefore(dayjs()) ? 0 :
// dayjs(date).diff(dayjs(), 'millisecond').
func sleepUntil(ctx workflow.Context, at time.Time) error {
	return sleep(ctx, max(0, at.Sub(workflow.Now(ctx)).Truncate(time.Millisecond)))
}
