package product

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
	"github.com/lucsky/cuid"
)

type timelineFixture struct {
	analyticsFixture
	posts       []postoptions.ObservedPost
	timelineErr error
	reads       int
	org         string
}

func (f *timelineFixture) RecentPostMetrics(_ context.Context, org string, _ string, _ string, _ string) ([]postoptions.ObservedPost, error) {
	if org != f.org {
		return nil, postoptions.ErrMetricsUnavailable
	}
	f.reads++
	return f.posts, f.timelineErr
}

func TestExternalPostObservationLifecycle(t *testing.T) {
	w := newTestWorkspace(t)
	subscribe(t, w.ctx, w.repo, w.org, "pro")
	set, err := w.repo.defaultSocialSet(w.ctx, w.org)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := w.db.Client.ChannelConnection.Create().SetID(cuid.New()).SetOrganizationID(w.org).SetExternalAccountID("observed").SetPlatform("x").SetSecretReference("fixture").SetCreatedByUserID(w.owner.UserID).SetSocialSetID(set.ID).Save(w.ctx)
	if err != nil {
		t.Fatal(err)
	}
	item := postoptions.ObservedPost{ID: "42", URL: "https://x.com/i/status/42", Caption: "Published elsewhere", PublishedAt: time.Now().Add(-time.Hour), Metrics: postoptions.Metrics{"likes": 0}}
	fixture := &timelineFixture{org: w.org, posts: []postoptions.ObservedPost{item, item}}
	w.repo.WithPostMetrics(fixture)
	for batch := 0; batch < 30 && fixture.reads == 0; batch++ {
		if _, err := w.repo.CollectSocialAnalytics(w.ctx); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := w.repo.CollectSocialAnalytics(w.ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := w.repo.CollectSocialAnalytics(w.ctx); err != nil {
		t.Fatal(err)
	}
	if fixture.reads != 1 {
		t.Fatalf("timeline reads=%d", fixture.reads)
	}
	rows, err := w.repo.ListSocialObservations(w.ctx, w.owner, set.ID, time.Now().Add(-time.Hour), time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows=%+v", rows)
	}
	for _, row := range rows {
		if row.Kind == "post" && (row.Caption != item.Caption || row.URL == nil || *row.URL != item.URL || row.DraftID != "" || len(row.Metrics) != 1) {
			t.Fatalf("external row=%+v", row)
		}
	}
	if n, _ := w.db.Client.ScheduledPost.Query().Where(scheduledpost.OrganizationID(w.org)).Count(w.ctx); n != 0 {
		t.Fatal("timeline created a publishing command")
	}
	// Failure retries after an hour and does not erase the last successful post observation.
	w.exec(t, `DELETE FROM platform_social_observation WHERE "organizationId"=$1 AND kind='feed'`, w.org)
	fixture.timelineErr = errors.New("rate limited")
	if _, err := w.repo.CollectSocialAnalytics(w.ctx); err != nil {
		t.Fatal(err)
	}
	rows, _ = w.repo.ListSocialObservations(w.ctx, w.owner, set.ID, time.Now().Add(-time.Hour), time.Now().Add(time.Minute))
	for _, row := range rows {
		if row.Kind == "feed" && row.Status != "failed" {
			t.Fatal("read failure lost")
		}
	}
	fixture.timelineErr = nil
	w.exec(t, `UPDATE platform_social_observation SET "observedAt"=now()-interval '2 hours' WHERE "organizationId"=$1 AND kind='feed'`, w.org)
	draft, err := w.repo.CreateContentDraft(w.ctx, w.owner, ContentDraftInput{Title: "Known published draft"})
	if err != nil {
		t.Fatal(err)
	}
	post, err := w.db.Client.ScheduledPost.Create().SetID(cuid.New()).SetOrganizationID(w.org).SetChannelConnectionID(connection.ID).SetContentDraftID(draft.ID).SetSocialSetID(set.ID).SetScheduledFor(item.PublishedAt).SetPublishedAt(item.PublishedAt).SetStatus(scheduledpost.StatusPUBLISHED).SetRemotePostID(item.ID).SetCaption(item.Caption).SetIdempotencyKey(cuid.New()).Save(w.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.repo.CollectSocialAnalytics(w.ctx); err != nil {
		t.Fatal(err)
	}
	rows, _ = w.repo.ListSocialObservations(w.ctx, w.owner, set.ID, time.Now().Add(-3*time.Hour), time.Now().Add(time.Minute))
	posts := 0
	for _, row := range rows {
		if row.Kind == "post" {
			posts++
			if row.SubjectID != post.ID || row.DraftID != draft.ID {
				t.Fatalf("known post double identity: %+v", row)
			}
		}
	}
	if posts != 1 {
		t.Fatalf("counted %d posts", posts)
	}
	foreign := newTestWorkspace(t)
	subscribe(t, foreign.ctx, foreign.repo, foreign.org, "pro")
	if _, err := w.repo.ListSocialObservations(w.ctx, foreign.owner, set.ID, time.Now().Add(-time.Hour), time.Now()); err == nil {
		t.Fatal("foreign timeline leaked")
	}
}
