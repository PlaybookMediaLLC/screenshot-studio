package product

import (
	"context"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"testing"
	"time"
)

func TestNaturalTimeNeverTurnsANearFutureScheduleIntoImmediatePublication(t *testing.T) {
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	base := now.Add(time.Second)
	draft := &ent.ContentDraft{ID: "draft-natural-boundary", NaturalPostingTime: true}
	for version := 1; version <= 500; version++ {
		input := ScheduleContentDraftInput{ScheduledFor: base, Version: version}
		placed, err := placeDraftSchedule(context.Background(), nil, &ent.SocialSet{}, draft, input, now)
		if err != nil || !placed.at.After(now.Add(30*time.Second)) || placed.at.Sub(base) > 4*time.Minute || placed.at.Sub(base) < -4*time.Minute || !placed.base.Equal(base) {
			t.Fatalf("unsafe natural placement: %+v %v", placed, err)
		}
		again, err := placeDraftSchedule(context.Background(), nil, &ent.SocialSet{}, draft, input, now)
		if err != nil || !placed.at.Equal(again.at) {
			t.Fatal("same request produced different time")
		}
	}
	draft.NaturalPostingTime = false
	if _, err := placeDraftSchedule(context.Background(), nil, &ent.SocialSet{}, draft, ScheduleContentDraftInput{ScheduledFor: base, Version: 1}, now); err == nil {
		t.Fatal("non-natural near-immediate schedule accepted")
	}
}
