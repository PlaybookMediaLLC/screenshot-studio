package product

import (
	"strings"
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

func TestCampaignPostLengthMatchesChannelRules(t *testing.T) {
	cases := []struct {
		channel, copy, cta string
		fits               bool
	}{
		{"x", strings.Repeat("a", 280), "", true},
		{"x", strings.Repeat("a", 270), "Try it now", false}, // 270 + space + 10
		{"x", strings.Repeat("a", 269), "Try it now", true},
		{"x", strings.Repeat("😀", 140), "", true}, // two UTF-16 units each, as the web counts
		{"x", strings.Repeat("😀", 141), "", false},
		{"instagram", strings.Repeat("a", 2200), "", true},
		{"instagram", strings.Repeat("a", 2201), "", false},
		{"linkedin", strings.Repeat("a", 3000), "", true},
		{"linkedin", strings.Repeat("a", 3001), "", false},
		{"email", strings.Repeat("a", 3000), "", true},
	}
	for _, tc := range cases {
		if fits := campaignPostLength(tc.copy, tc.cta) <= campaignChannelLimit(tc.channel); fits != tc.fits {
			t.Errorf("%s copy=%d cta=%q fits=%v want %v", tc.channel, len(tc.copy), tc.cta, fits, tc.fits)
		}
	}
}
