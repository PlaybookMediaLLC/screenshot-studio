package product

import (
	"testing"
)

// A retried create with the same idempotency key returns the first campaign,
// and the key is scoped to the workspace.
func TestCampaignCreateIdempotencyKey(t *testing.T) {
	w := newTestWorkspace(t)
	other := newTestWorkspace(t)
	key := "launch-" + w.id
	input := CreateCampaignInput{Name: "Launch", Objective: "Adoption", IdempotencyKey: &key,
		Posts: []CampaignPostInput{{Channel: "x", Copy: "One"}}}
	first, err := w.repo.CreateCampaign(w.ctx, w.owner, input)
	if err != nil || first.Created == nil || !*first.Created {
		t.Fatalf("first create: %+v %v", first, err)
	}
	input.Name = "A different name"
	replay, err := w.repo.CreateCampaign(w.ctx, w.owner, input)
	if err != nil || replay.Created == nil || *replay.Created || replay.ID != first.ID || replay.Name != "Launch" {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	elsewhere, err := other.repo.CreateCampaign(other.ctx, other.owner, input)
	if err != nil || elsewhere.ID == first.ID || !*elsewhere.Created {
		t.Fatalf("another workspace with the same key: %+v %v", elsewhere, err)
	}
	empty := ""
	if _, err := w.repo.CreateCampaign(w.ctx, w.owner, CreateCampaignInput{Name: "Launch", Objective: "Adoption",
		IdempotencyKey: &empty}); err != ErrInvalidInput {
		t.Fatalf("empty key: %v", err)
	}
}

// The review queue holds only this workspace's posts waiting for review,
// oldest first, and pages with an opaque cursor.
func TestListPendingApprovals(t *testing.T) {
	w := newTestWorkspace(t)
	other := newTestWorkspace(t)
	create := func(ws *testWorkspace, copies ...string) *CampaignDetail {
		t.Helper()
		posts := make([]CampaignPostInput, 0, len(copies))
		for _, copy := range copies {
			posts = append(posts, CampaignPostInput{Channel: "x", Copy: copy})
		}
		created, err := ws.repo.CreateCampaign(ws.ctx, ws.owner, CreateCampaignInput{Name: "Launch", Objective: "Adoption", Posts: posts})
		if err != nil {
			t.Fatal(err)
		}
		return created
	}
	mine := create(w, "One", "Two", "Three")
	theirs := create(other, "Foreign")
	for _, ws := range []struct {
		w  *testWorkspace
		id string
	}{{w, mine.ID}, {other, theirs.ID}} {
		if _, err := ws.w.repo.TransitionCampaignPosts(ws.w.ctx, ws.w.owner, ws.id, CampaignPostDecision{Decision: "submit"}); err != nil {
			t.Fatal(err)
		}
	}
	// A draft stays out of the queue.
	create(w, "Draft")

	first, err := w.repo.ListPendingApprovals(w.ctx, w.owner, 2, "")
	if err != nil || len(first.Items) != 2 || first.NextCursor == nil {
		t.Fatalf("first page: %+v %v", first, err)
	}
	second, err := w.repo.ListPendingApprovals(w.ctx, w.owner, 2, *first.NextCursor)
	if err != nil || len(second.Items) != 1 || second.NextCursor != nil {
		t.Fatalf("second page: %+v %v", second, err)
	}
	for _, item := range append(first.Items, second.Items...) {
		if item.Campaign.ID != mine.ID || item.Post.Status != "READY_FOR_REVIEW" || item.Post.OrganizationID != w.org {
			t.Fatalf("queue item from the wrong place: %+v", item)
		}
	}
	if _, err := w.repo.ListPendingApprovals(w.ctx, w.owner, 0, ""); err != ErrInvalidInput {
		t.Fatalf("limit 0: %v", err)
	}
}
