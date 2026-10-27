package product

import (
	"errors"
	"fmt"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/draftdoc"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

func TestMentionDirectorySurvivesDraftDeletionAndBoundsSearch(t *testing.T) {
	w := newTestWorkspace(t)
	ctx, repo, owner := w.ctx, w.repo, w.owner
	subscribe(t, ctx, repo, w.org, "pro")
	set, err := repo.CreateSocialSet(ctx, owner, SocialSetInput{Name: "Directory", Visibility: "PRIVATE"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := repo.CreateSocialSet(ctx, owner, SocialSetInput{Name: "Other"})
	if err != nil {
		t.Fatal(err)
	}
	w.addMember(t, "writer", "creator")
	mention := func(id, label, kind string) any {
		return map[string]any{"type": "social_mention", "platform": "linkedin", "kind": kind, "providerId": id, "label": label, "children": []any{map[string]any{"text": ""}}}
	}
	children := []any{mention("urn:li:person:abc_123", "Anne 100%", "person")}
	for i := 1; i <= 35; i++ {
		children = append(children, mention(fmt.Sprintf("urn:li:organization:%d", i), fmt.Sprintf("Company %02d", i), "organization"))
	}
	body := []any{map[string]any{"type": "p", "children": children}}
	draft, err := repo.CreateContentDraft(ctx, owner, ContentDraftInput{SocialSetID: set.ID, PlatformVersions: &draftdoc.PlatformVersions{SchemaVersion: 1, Versions: []draftdoc.PlatformVersion{{Channel: "linkedin", Mode: "manual", Body: body}}}})
	if err != nil {
		t.Fatal(err)
	}
	// A stale write must not replace a remembered label.
	stale := []any{map[string]any{"type": "p", "children": []any{mention("urn:li:person:abc_123", "Unaccepted label", "person")}}}
	if _, err := repo.UpdateContentDraft(ctx, owner, draft.ID, ContentDraftUpdate{BaseVersion: 0, Body: &stale}); err == nil {
		t.Fatal("stale write accepted")
	}
	if err := repo.DeleteContentDraft(ctx, owner, draft.ID); err != nil {
		t.Fatal(err)
	}
	// Read through a fresh repository value to rule out process-local history.
	fresh := *repo
	found, err := fresh.LookupMentions(ctx, owner, set.ID, "linkedin", "")
	if err != nil || len(found) != 30 {
		t.Fatalf("bounded recents=%+v err=%v", found, err)
	}
	found, err = fresh.LookupMentions(ctx, owner, set.ID, "linkedin", "Company 35")
	if err != nil || len(found) != 1 || found[0].ProviderID != "urn:li:organization:35" {
		t.Fatalf("late saved identity=%+v err=%v", found, err)
	}
	people, err := fresh.LookupPeopleMentions(ctx, owner, set.ID, "100%")
	if err != nil || len(people) != 1 || people[0].Label != "Anne 100%" {
		t.Fatalf("literal search=%+v err=%v", people, err)
	}
	if found, err := fresh.LookupMentions(ctx, owner, other.ID, "linkedin", ""); err != nil || len(found) != 0 {
		t.Fatalf("set isolation=%+v err=%v", found, err)
	}
	if _, err := fresh.LookupMentions(ctx, w.actor("writer"), set.ID, "linkedin", ""); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("private directory leaked: %v", err)
	}
	// Copying into a new set also remembers its primary-body mentions immediately.
	source, err := repo.CreateContentDraft(ctx, owner, ContentDraftInput{SocialSetID: set.ID, Body: body})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CopyContentDraftToSet(ctx, owner, source.ID, ContentDraftCopyInput{SocialSetID: &other.ID, TagMode: "drop"}); err != nil {
		t.Fatal(err)
	}
	if found, err := repo.LookupMentions(ctx, owner, other.ID, "linkedin", "Company 35"); err != nil || len(found) != 1 {
		t.Fatalf("copied directory=%+v err=%v", found, err)
	}

}

func TestFinishersHaveNoFiftyTemplateCap(t *testing.T) {
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	set, err := w.repo.CreateSocialSet(w.ctx, w.owner, SocialSetInput{Name: "Templates"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 51; i++ {
		if _, err := w.repo.CreateContentDraftFinisher(w.ctx, w.owner, set.ID, ContentDraftFinisherInput{Name: ptr(fmt.Sprintf("Finisher %d", i)), Text: ptr("Follow for more")}); err != nil {
			t.Fatalf("template %d: %v", i, err)
		}
	}
	items, err := w.repo.ListContentDraftFinishers(w.ctx, w.owner, set.ID)
	if err != nil || len(items) != 51 {
		t.Fatalf("templates=%d err=%v", len(items), err)
	}
}
