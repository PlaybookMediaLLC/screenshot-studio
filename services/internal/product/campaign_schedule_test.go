package product

import (
	"testing"
	"time"
)

func TestNextCampaignPublishTimeUsesWorkspaceZone(t *testing.T) {
	now := time.Date(2026, time.October, 14, 13, 0, 0, 0, time.UTC)
	result, err := nextCampaignPublishTime(now, "America/New_York", "09:30")
	if err != nil || !result.Equal(time.Date(2026, time.October, 14, 13, 30, 0, 0, time.UTC)) {
		t.Fatalf("today's workspace time=%v err=%v", result, err)
	}
	result, err = nextCampaignPublishTime(now, "America/New_York", "08:30")
	if err != nil || !result.Equal(time.Date(2026, time.October, 15, 12, 30, 0, 0, time.UTC)) {
		t.Fatalf("tomorrow's workspace time=%v err=%v", result, err)
	}
}
