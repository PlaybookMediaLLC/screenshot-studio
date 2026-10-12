package workflows

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/orchestrator/activities"
)

type stateCall struct {
	id, state string
	errValue  json.RawMessage
}

type notice struct {
	subject, message, kind string
}

// harness runs a post workflow against fake activities registered by name.
type harness struct {
	t       *testing.T
	env     *testsuite.TestWorkflowEnvironment
	posts   []activities.Post
	states  []stateCall
	notices []notice
	updates [][3]string
	publish int
}

func newHarness(t *testing.T) *harness {
	var suite testsuite.WorkflowTestSuite
	h := &harness{t: t, env: suite.NewTestWorkflowEnvironment()}
	Register(h.env)

	settings := "{}"
	h.posts = []activities.Post{{
		ID: "root", State: activities.StateQueue, PublishDate: activities.JSDate{Time: time.Now().Add(-time.Minute)},
		OrganizationID: "org", IntegrationID: "int", Content: "hello", Settings: &settings,
		Integration: &activities.Integration{ID: "int", OrganizationID: "org", Name: "My Page", ProviderIdentifier: "linkedin-page", Token: "old"},
	}}

	h.on(activities.GetPost, func(context.Context, string, string) (activities.OrFalse[activities.Post], error) {
		return activities.OrFalse[activities.Post]{V: &h.posts[0]}, nil
	})
	h.on(activities.GetPostsList, func(context.Context, string, string) ([]activities.Post, error) {
		return h.posts, nil
	})
	h.on(activities.IsCommentable, func(context.Context, *activities.Integration) (bool, error) { return true, nil })
	h.on(activities.PostSocialPending, func(_ context.Context, _ *activities.Integration, posts []activities.Post) ([]integrations.PostResponse, error) {
		h.publish++
		return []integrations.PostResponse{{ID: posts[0].ID, PostID: "p1", ReleaseURL: "https://x/p1", Status: "success"}}, nil
	})
	h.on(activities.UpdatePost, func(_ context.Context, id, postID, releaseURL string) error {
		h.updates = append(h.updates, [3]string{id, postID, releaseURL})
		return nil
	})
	h.on(activities.InAppNotification, func(_ context.Context, _, subject, message string, _, _ bool, kind string) error {
		h.notices = append(h.notices, notice{subject, message, kind})
		return nil
	})
	h.on(activities.ChangeState, func(_ context.Context, id, state string, errValue, _ json.RawMessage) error {
		h.states = append(h.states, stateCall{id, state, errValue})
		return nil
	})
	h.on(activities.SendWebhooks, func(context.Context, string, string, string) error { return nil })
	h.on(activities.InternalPlugs, func(context.Context, *activities.Integration, json.RawMessage) ([]activities.InternalPlug, error) {
		return nil, nil
	})
	h.on(activities.GlobalPlugs, func(context.Context, *activities.Integration) ([]activities.GlobalPlug, error) {
		return nil, nil
	})
	return h
}

func (h *harness) on(name string, fn any) {
	h.env.RegisterActivityWithOptions(fn, activity.RegisterOptions{Name: name, DisableAlreadyRegisteredCheck: true})
}

func (h *harness) run(workflowName string) {
	h.env.ExecuteWorkflow(workflowName, PostWorkflowInput{TaskQueue: "linkedin", PostID: "root", OrganizationID: "org"})
	if !h.env.IsWorkflowCompleted() {
		h.t.Fatal("workflow did not complete")
	}
	if err := h.env.GetWorkflowError(); err != nil {
		h.t.Fatal(err)
	}
}

func TestPostWorkflowV112PublishesPostAndComments(t *testing.T) {
	h := newHarness(t)
	comment := h.posts[0]
	comment.ID, comment.Integration = "comment", nil
	h.posts = append(h.posts, comment)

	var commentParent string
	var commentLast *string
	h.on(activities.PostComment, func(_ context.Context, postID string, lastPostID *string, _ *activities.Integration, posts []activities.Post) ([]integrations.PostResponse, error) {
		commentParent, commentLast = postID, lastPostID
		return []integrations.PostResponse{{ID: posts[0].ID, PostID: "c1", ReleaseURL: "https://x/c1", Status: "success"}}, nil
	})
	h.run("postWorkflowV112")

	if commentParent != "p1" || commentLast != nil {
		t.Fatalf("comment parent=%q last=%v", commentParent, commentLast)
	}
	want := [][3]string{{"root", "p1", "https://x/p1"}, {"comment", "c1", "https://x/c1"}}
	if len(h.updates) != 2 || h.updates[0] != want[0] || h.updates[1] != want[1] {
		t.Fatalf("updates = %v", h.updates)
	}
	// success notifications send 5 arguments: the type defaults activity side
	if len(h.notices) != 1 || h.notices[0] != (notice{"Your post has been published on Linkedin-page", "Your post has been published on Linkedin-page at https://x/p1", ""}) {
		t.Fatalf("notices = %#v", h.notices)
	}
	if len(h.states) != 0 {
		t.Fatalf("states = %#v", h.states)
	}
}

func TestPostWorkflowV112RefreshesTokenAndRetries(t *testing.T) {
	h := newHarness(t)
	var tokens []string
	h.on(activities.PostSocialPending, func(_ context.Context, integration *activities.Integration, posts []activities.Post) ([]integrations.PostResponse, error) {
		tokens = append(tokens, integration.Token)
		if len(tokens) == 1 {
			return nil, temporalx.RefreshToken("linkedin-page", "{}", "{}", "token expired")
		}
		return []integrations.PostResponse{{ID: posts[0].ID, PostID: "p1", ReleaseURL: "u", Status: "success"}}, nil
	})
	var cause string
	h.on(activities.RefreshTokenWithCause, func(_ context.Context, _ *activities.Integration, c string) (activities.OrFalse[integrations.AuthTokenDetails], error) {
		cause = c
		return activities.OrFalse[integrations.AuthTokenDetails]{V: &integrations.AuthTokenDetails{AccessToken: "new"}}, nil
	})
	h.run("postWorkflowV112")

	if cause != "token expired" || len(tokens) != 2 || tokens[1] != "new" || len(h.updates) != 1 {
		t.Fatalf("cause=%q tokens=%v updates=%v", cause, tokens, h.updates)
	}
}

func TestPostWorkflowV112BadBodyFailsAndNotifies(t *testing.T) {
	h := newHarness(t)
	h.on(activities.PostSocialPending, func(context.Context, *activities.Integration, []activities.Post) ([]integrations.PostResponse, error) {
		h.publish++
		return nil, temporalx.BadBody("linkedin-page", "{}", "{}", "Your post is too long")
	})
	h.run("postWorkflowV112")

	if h.publish != 1 || len(h.updates) != 0 || len(h.states) != 1 || h.states[0].state != activities.StateError {
		t.Fatalf("publish=%d updates=%v states=%#v", h.publish, h.updates, h.states)
	}
	// Post.error must keep what posts.repository curatedError reads
	var stored struct {
		ActivityType string `json:"activityType"`
		Cause        struct {
			Type    string `json:"type"`
			Failure struct {
				Message string `json:"message"`
			} `json:"failure"`
		} `json:"cause"`
		Failure struct {
			Cause struct {
				Message                string `json:"message"`
				ApplicationFailureInfo struct {
					Type string `json:"type"`
				} `json:"applicationFailureInfo"`
			} `json:"cause"`
		} `json:"failure"`
	}
	if err := json.Unmarshal(h.states[0].errValue, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.ActivityType != activities.PostSocialPending || stored.Cause.Type != "bad_body" || stored.Cause.Failure.Message != "Your post is too long" ||
		stored.Failure.Cause.ApplicationFailureInfo.Type != "bad_body" || stored.Failure.Cause.Message != "Your post is too long" {
		t.Fatalf("stored error = %s", h.states[0].errValue)
	}
	want := notice{"Error posting on linkedin-page for My Page", "An error occurred while posting on linkedin-page: Your post is too long", "fail"}
	if len(h.notices) != 1 || h.notices[0] != want {
		t.Fatalf("notices = %#v", h.notices)
	}
}

func TestPostWorkflowV112ResolvesPendingPost(t *testing.T) {
	h := newHarness(t)
	h.on(activities.PostSocialPending, func(_ context.Context, _ *activities.Integration, posts []activities.Post) ([]integrations.PostResponse, error) {
		return []integrations.PostResponse{{ID: posts[0].ID, Status: "pending", PendingData: json.RawMessage(`{"step":1}`)}}, nil
	})
	var checked []string
	h.on(activities.CheckPostStatus, func(_ context.Context, _ *activities.Integration, data json.RawMessage) (*integrations.PendingCheckResponse, error) {
		checked = append(checked, string(data))
		if len(checked) == 1 {
			return &integrations.PendingCheckResponse{Status: "pending", PendingData: json.RawMessage(`{"step":2}`)}, nil
		}
		return &integrations.PendingCheckResponse{Status: "ready", PendingData: json.RawMessage(`{"step":3}`)}, nil
	})
	var finalized string
	h.on(activities.FinalizePost, func(_ context.Context, _ *activities.Integration, data json.RawMessage) (*integrations.PendingCheckResponse, error) {
		finalized = string(data)
		return &integrations.PendingCheckResponse{Status: "completed", PostID: "final", ReleaseURL: "https://x/final"}, nil
	})
	h.run("postWorkflowV112")

	if strings.Join(checked, ",") != `{"step":1},{"step":2}` || finalized != `{"step":3}` {
		t.Fatalf("checked=%v finalized=%s", checked, finalized)
	}
	if len(h.updates) != 1 || h.updates[0] != [3]string{"root", "final", "https://x/final"} {
		t.Fatalf("updates = %v", h.updates)
	}
}

func TestPostWorkflowV112HeartbeatTimeout(t *testing.T) {
	// no heartbeat details: the activity never ran, publishing again is safe
	h := newHarness(t)
	h.on(activities.PostSocialPending, func(_ context.Context, _ *activities.Integration, posts []activities.Post) ([]integrations.PostResponse, error) {
		h.publish++
		if h.publish == 1 {
			return nil, temporal.NewHeartbeatTimeoutError()
		}
		return []integrations.PostResponse{{ID: posts[0].ID, PostID: "p1", ReleaseURL: "u", Status: "success"}}, nil
	})
	h.run("postWorkflowV112")
	if h.publish != 2 || len(h.updates) != 1 || len(h.states) != 0 {
		t.Fatalf("never started: publish=%d updates=%v states=%#v", h.publish, h.updates, h.states)
	}

	// heartbeat details: it ran and stalled, the outcome is unknown
	h = newHarness(t)
	h.on(activities.PostSocialPending, func(context.Context, *activities.Integration, []activities.Post) ([]integrations.PostResponse, error) {
		h.publish++
		return nil, temporal.NewHeartbeatTimeoutError("linkedin-page: publish")
	})
	h.run("postWorkflowV112")
	if h.publish != 1 || len(h.updates) != 0 || len(h.states) != 1 || h.states[0].state != activities.StateError {
		t.Fatalf("stalled: publish=%d updates=%v states=%#v", h.publish, h.updates, h.states)
	}
	want := notice{
		"We couldn't confirm your post on Linkedin-page",
		"Your post was sent to Linkedin-page, but we couldn't confirm it was published. Please check your My Page account before posting again to avoid duplicates.",
		"fail",
	}
	if len(h.notices) != 1 || h.notices[0] != want {
		t.Fatalf("notices = %#v", h.notices)
	}
}

func TestPostWorkflowV112StartsRepeatPostChild(t *testing.T) {
	h := newHarness(t)
	// the child (postNow) publishes the same post; only the parent repeats
	lists := 0
	h.on(activities.GetPostsList, func(context.Context, string, string) ([]activities.Post, error) {
		lists++
		root := h.posts[0]
		if lists == 1 {
			interval := 1
			root.IntervalInDays = &interval
		}
		return []activities.Post{root}, nil
	})

	var childID, childType string
	var childInput PostWorkflowInput
	h.env.SetOnChildWorkflowStartedListener(func(info *workflow.Info, _ workflow.Context, args converter.EncodedValues) {
		childID, childType = info.WorkflowExecution.ID, info.WorkflowType.Name
		_ = args.Get(&childInput)
	})
	start := h.env.Now()
	h.run("postWorkflowV112")

	if childType != "postWorkflowV112" || !strings.HasPrefix(childID, "post_root_") || len(childID) != len("post_root_")+10 {
		t.Fatalf("child type=%q id=%q", childType, childID)
	}
	if childInput != (PostWorkflowInput{TaskQueue: "linkedin", PostID: "root", OrganizationID: "org", PostNow: true}) {
		t.Fatalf("child input = %#v", childInput)
	}
	if waited := h.env.Now().Sub(start); waited < 23*time.Hour {
		t.Fatalf("repeat started after %s", waited)
	}
	if len(h.updates) != 2 {
		t.Fatalf("updates = %v", h.updates)
	}
}

func TestPostWorkflowV101RefreshesWithRefreshToken(t *testing.T) {
	h := newHarness(t)
	var tokens []string
	h.on(activities.PostSocial, func(_ context.Context, integration *activities.Integration, posts []activities.Post) ([]integrations.PostResponse, error) {
		tokens = append(tokens, integration.Token)
		if len(tokens) == 1 {
			return nil, temporalx.RefreshToken("linkedin-page", "{}", "{}", "token expired")
		}
		return []integrations.PostResponse{{ID: posts[0].ID, PostID: "p1", ReleaseURL: "u", Status: "success"}}, nil
	})
	h.on(activities.RefreshToken, func(context.Context, *activities.Integration) (activities.OrFalse[integrations.AuthTokenDetails], error) {
		return activities.OrFalse[integrations.AuthTokenDetails]{V: &integrations.AuthTokenDetails{AccessToken: "new"}}, nil
	})
	h.run("postWorkflowV101")

	if len(tokens) != 2 || tokens[1] != "new" || len(h.updates) != 1 || len(h.notices) != 1 {
		t.Fatalf("tokens=%v updates=%v notices=%#v", tokens, h.updates, h.notices)
	}
}

func TestMissingPostWorkflowContinuesAsNewAfterADay(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	Register(env)
	searches := 0
	env.RegisterActivityWithOptions(func(context.Context) error {
		searches++
		return nil
	}, activity.RegisterOptions{Name: activities.SearchForMissingThreeHoursPosts})
	env.ExecuteWorkflow("missingPostWorkflow")

	if !workflow.IsContinueAsNewError(env.GetWorkflowError()) || searches != 24 {
		t.Fatalf("err=%v searches=%d", env.GetWorkflowError(), searches)
	}
}

func TestRefreshTokenWorkflowRefreshesUntilChannelNeedsReconnect(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	Register(env)
	expires := activities.JSDate{Time: env.Now().Add(time.Hour)}
	loads, refreshes := 0, 0
	env.RegisterActivityWithOptions(func(_ context.Context, id, orgID string) (*activities.Integration, error) {
		loads++
		if id != "int" || orgID != "org" {
			t.Errorf("getIntegrationsById(%q, %q)", id, orgID)
		}
		return &activities.Integration{ID: "int", TokenExpiration: &expires, RefreshNeeded: loads > 2}, nil
	}, activity.RegisterOptions{Name: activities.GetIntegrationsByID})
	env.RegisterActivityWithOptions(func(context.Context, *activities.Integration) (activities.OrFalse[integrations.AuthTokenDetails], error) {
		refreshes++
		return activities.OrFalse[integrations.AuthTokenDetails]{}, nil
	}, activity.RegisterOptions{Name: activities.RefreshToken})
	start := env.Now()
	env.ExecuteWorkflow("refreshTokenWorkflow", RefreshTokenInput{IntegrationID: "int", OrganizationID: "org"})

	var result bool
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if result || loads != 3 || refreshes != 1 || env.Now().Sub(start) < time.Hour-time.Second {
		t.Fatalf("result=%v loads=%d refreshes=%d waited=%s", result, loads, refreshes, env.Now().Sub(start))
	}
}

func TestSortByDelayIsStableWithNullsLast(t *testing.T) {
	one, two := 1.0, 2.0
	list := []plugTask{{kind: "a", delay: nil}, {kind: "b", delay: &two}, {kind: "c", delay: &one}, {kind: "d", delay: &two}}
	sortByDelay(list)
	var got []string
	for _, item := range list {
		got = append(got, item.kind)
	}
	if strings.Join(got, "") != "cbda" {
		t.Fatalf("order = %v", got)
	}
}
