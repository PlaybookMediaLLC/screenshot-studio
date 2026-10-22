package workflows

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/activities"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func TestUnknownDeliveryStopsRootReplyAndFinalization(t *testing.T) {
	for _, version := range []string{"postWorkflowV101", "postWorkflowV112"} {
		for _, phase := range []string{"root", "reply", "finalize"} {
			if version == "postWorkflowV101" && phase == "finalize" {
				continue
			}
			t.Run(version+"/"+phase, func(t *testing.T) {
				h := newHarness(t)
				mutations, checks := 0, 0
				unknown := func() error {
					mutations++
					return temporalx.UnknownDelivery("x", "Receipt was lost; check X before resending.")
				}
				root := func(_ context.Context, _ *activities.Integration, posts []activities.Post) ([]integrations.PostResponse, error) {
					if phase == "root" {
						return nil, unknown()
					}
					if phase == "finalize" {
						return []integrations.PostResponse{{ID: posts[0].ID, Status: "pending", PendingData: json.RawMessage(`{"articleDraftId":"91"}`)}}, nil
					}
					return []integrations.PostResponse{{ID: posts[0].ID, PostID: "42", ReleaseURL: "https://x/42", Status: "success"}}, nil
				}
				h.on(activities.PostSocial, root)
				h.on(activities.PostSocialPending, root)
				if phase == "reply" {
					reply := h.posts[0]
					reply.ID, reply.Integration = "reply", nil
					h.posts = append(h.posts, reply)
					h.on(activities.PostComment, func(context.Context, string, *string, *activities.Integration, []activities.Post) ([]integrations.PostResponse, error) {
						return nil, unknown()
					})
				}
				if phase == "finalize" {
					h.on(activities.CheckPostStatus, func(_ context.Context, _ *activities.Integration, data json.RawMessage) (*integrations.PendingCheckResponse, error) {
						checks++
						return &integrations.PendingCheckResponse{Status: "ready", PendingData: data}, nil
					})
					h.on(activities.FinalizePost, func(context.Context, *activities.Integration, json.RawMessage) (*integrations.PendingCheckResponse, error) {
						return nil, unknown()
					})
				}
				h.run(version)
				if mutations != 1 || len(h.states) != 1 || h.states[0].state != activities.StateError || !strings.Contains(string(h.states[0].errValue), temporalx.TypeUnknownDelivery) {
					t.Fatalf("mutations=%d states=%+v", mutations, h.states)
				}
				if phase == "finalize" && checks != 1 {
					t.Fatalf("uncertain mutation polled again: %d", checks)
				}
				last := h.notices[len(h.notices)-1]
				if !strings.Contains(last.subject, "couldn't confirm") || !strings.Contains(last.message, "avoid duplicates") {
					t.Fatalf("missing uncertainty notice: %+v", last)
				}
				wantUpdates := 0
				if phase == "reply" {
					wantUpdates = 1
				}
				if len(h.updates) != wantUpdates {
					t.Fatalf("unexpected success receipts: %+v", h.updates)
				}
			})
		}
	}
}

func TestUnknownFollowUpStopsLaterChecks(t *testing.T) {
	h := newHarness(t)
	h.on(activities.GlobalPlugs, func(context.Context, *activities.Integration) ([]activities.GlobalPlug, error) {
		return []activities.GlobalPlug{{Type: "global", PlugID: "plug", Delay: 1000, TotalRuns: 3}}, nil
	})
	calls := 0
	h.on(activities.ProcessPlug, func(context.Context, activities.ProcessPlugInput) (bool, error) {
		calls++
		return false, temporalx.UnknownDelivery("x", "Uncertain follow-up")
	})
	h.run("postWorkflowV112")
	if calls != 1 || len(h.states) != 0 || len(h.updates) != 1 {
		t.Fatalf("follow-up repeated or root changed: calls=%d states=%+v updates=%+v", calls, h.states, h.updates)
	}
	if len(h.notices) != 2 || !strings.Contains(h.notices[1].subject, "follow-up") {
		t.Fatalf("uncertainty not surfaced: %+v", h.notices)
	}
}
