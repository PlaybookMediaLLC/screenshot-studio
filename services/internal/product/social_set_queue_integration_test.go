package product

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/schema"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

func TestAgentQueueDefaultsDoNotPublishOrMoveExistingWork(t *testing.T) {
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "business")
	set, err := w.repo.CreateSocialSet(w.ctx, w.owner, SocialSetInput{Name: "Public queue"})
	if err != nil {
		t.Fatal(err)
	}
	keyID := "queue_" + w.id
	w.exec(t, `INSERT INTO apikey(id,name,"referenceId",key,enabled,permissions,"createdAt","updatedAt") VALUES($1,'Queue client',$2,'hashed',true,'{"artifact":["read"],"draft":["write"]}',now(),now())`, keyID, w.org)
	key := Actor{Kind: "api_key", KeyID: keyID, OrganizationID: w.org}
	zone, natural := "America/New_York", true
	slots := []schema.QueueSlot{{Weekday: 1, Time: "09:15"}, {Weekday: 4, Time: "16:35"}}
	input := SocialSetQueueUpdate{BaseVersion: set.Version, TimeZone: &zone, PostingSlots: &slots, NaturalPostingTimes: &natural}
	if _, err := w.repo.UpdateSocialSetQueue(w.ctx, key, set.ID, input); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatal("draft key changed queue", err)
	}
	w.exec(t, `UPDATE apikey SET permissions='{"artifact":["read"],"queue":["write"]}' WHERE id=$1`, keyID)
	draft, err := w.repo.CreateContentDraft(w.ctx, w.owner, ContentDraftInput{SocialSetID: set.ID, PlainText: "Keep this plan"})
	if err != nil {
		t.Fatal(err)
	}
	planned := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Second)
	draft, err = w.repo.PlanContentDraft(w.ctx, w.owner, draft.ID, ContentDraftPlanInput{PlannedFor: &planned, TimeZone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 6)
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := w.repo.UpdateSocialSetQueue(w.ctx, key, set.ID, input)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		} else if !errors.Is(err, publishing.ErrConflict) {
			t.Fatal(err)
		}
	}
	if wins != 1 {
		t.Fatalf("concurrent winners=%d", wins)
	}
	saved, err := w.repo.GetSocialSet(w.ctx, key, set.ID)
	if err != nil || saved.TimeZone != zone || !saved.NaturalPostingTimes || len(saved.PostingSlots) != 2 || saved.PostingSlots[0] != slots[0] {
		t.Fatalf("queue not persisted: %+v %v", saved, err)
	}
	current, err := w.repo.GetContentDraft(w.ctx, key, draft.ID)
	if err != nil || current.PlannedFor == nil || !current.PlannedFor.Equal(planned) || current.Version != draft.Version || current.ReviewStatus != draft.ReviewStatus {
		t.Fatal("queue edit changed draft", current, err)
	}
	posts, err := w.repo.ListContentDraftPosts(w.ctx, key, draft.ID)
	if err != nil || len(posts) != 0 {
		t.Fatal("queue edit published", posts, err)
	}
	if _, err := w.repo.UpdateSocialSet(w.ctx, key, set.ID, SocialSetUpdate{BaseVersion: saved.Version, Name: &zone}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatal("queue key renamed identity", err)
	}
	private, err := w.repo.CreateSocialSet(w.ctx, w.owner, SocialSetInput{Name: "Private", Visibility: "PRIVATE"})
	if err != nil {
		t.Fatal(err)
	}
	input.BaseVersion = private.Version
	if _, err := w.repo.UpdateSocialSetQueue(w.ctx, key, private.ID, input); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("private queue exposed", err)
	}
	foreign := newTestWorkspace(t)
	subscribe(t, foreign.ctx, foreign.repo, foreign.org, "business")
	other, err := foreign.repo.CreateSocialSet(foreign.ctx, foreign.owner, SocialSetInput{Name: "Foreign"})
	if err != nil {
		t.Fatal(err)
	}
	input.BaseVersion = other.Version
	if _, err := w.repo.UpdateSocialSetQueue(w.ctx, key, other.ID, input); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("foreign queue exposed", err)
	}
	input.BaseVersion = saved.Version
	bad := []schema.QueueSlot{{Weekday: 7, Time: "25:60"}}
	input.PostingSlots = &bad
	if _, err := w.repo.UpdateSocialSetQueue(w.ctx, key, set.ID, input); !errors.Is(err, ErrInvalidInput) {
		t.Fatal("invalid slots accepted", err)
	}
	if _, err := w.repo.UpdateSocialSetQueue(w.ctx, key, set.ID, SocialSetQueueUpdate{BaseVersion: saved.Version}); !errors.Is(err, ErrInvalidInput) {
		t.Fatal("empty change accepted", err)
	}
	w.exec(t, `UPDATE apikey SET enabled=false WHERE id=$1`, keyID)
	input.PostingSlots = &slots
	if _, err := w.repo.UpdateSocialSetQueue(w.ctx, key, set.ID, input); !errors.Is(err, publishing.ErrUnauthorized) {
		t.Fatal("revoked key edited queue", err)
	}
}

func TestAgentMentionLookupRequiresReadScopeAndSetVisibility(t *testing.T) {
	w := newTestWorkspace(t)
	w.repo.WithAccountStanding(standings{})
	subscribe(t, w.ctx, w.repo, w.org, "business")
	set, err := w.repo.CreateSocialSet(w.ctx, w.owner, SocialSetInput{Name: "Mention account"})
	if err != nil {
		t.Fatal(err)
	}
	addCredential := socialCredentialFixture(t, w.ctx, w.db.SQL, w.org)
	addCredential("mentions-"+w.id, "linkedin")
	_, err = w.repo.auth.CreateConnection(w.ctx, publishing.Actor{Organization: w.org, UserID: w.owner.UserID, Type: "USER"}, publishing.CreateConnectionInput{ExternalAccountID: "mentions-" + w.id, Platform: "linkedin", SecretReference: "SOCIAL_API_KEY", ProviderSettings: map[string]any{}, SocialSetID: &set.ID})
	if err != nil {
		t.Fatal(err)
	}
	keyID := "mentions_" + w.id
	w.exec(t, `INSERT INTO apikey(id,"referenceId",key,enabled,permissions,"createdAt","updatedAt") VALUES($1,$2,'hashed',true,'{"draft":["write"]}',now(),now())`, keyID, w.org)
	key := Actor{Kind: "api_key", KeyID: keyID, OrganizationID: w.org}
	if _, err = w.repo.LookupMentions(w.ctx, key, set.ID, "linkedin", "acme"); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatal("lookup without read scope", err)
	}
	w.exec(t, `UPDATE apikey SET permissions='{"artifact":["read"]}' WHERE id=$1`, keyID)
	items, err := w.repo.LookupMentions(w.ctx, key, set.ID, "linkedin", "https://www.linkedin.com/company/acme/")
	if err != nil || len(items) != 1 || items[0].ProviderID != "linkedin:acme" || items[0].Label != "mentions-"+w.id {
		t.Fatal("wrong account or query", items, err)
	}
	w.exec(t, `UPDATE social_set SET visibility='PRIVATE',"ownerUserId"=$2 WHERE id=$1`, set.ID, w.owner.UserID)
	if _, err = w.repo.LookupMentions(w.ctx, key, set.ID, "linkedin", "acme"); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatal("private lookup exposed", err)
	}
}
