package product

import (
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/schema"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/brand"
)

// RFC 043: daylight saving resolves the same way every time.
func TestResolveWallTimeAcrossDaylightSaving(t *testing.T) {
	newYork, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name  string
		day   int
		month time.Month
		hour  int
		want  string
	}{
		// 2026-03-08 jumps from 02:00 to 03:00: 02:30 does not exist and fires at 03:30 EDT.
		{"spring-forward gap", 8, time.March, 2, "2026-03-08T07:30:00Z"},
		// 2026-11-01 repeats 01:00 to 02:00: 01:30 fires at its first occurrence, EDT.
		{"fall-back repeat", 1, time.November, 1, "2026-11-01T05:30:00Z"},
		{"ordinary day", 2, time.November, 12, "2026-11-02T17:30:00Z"},
	}
	for _, tc := range cases {
		got := resolveWallTime(2026, tc.month, tc.day, tc.hour, 30, newYork).UTC().Format(time.RFC3339)
		if got != tc.want {
			t.Errorf("%s: got %s, want %s", tc.name, got, tc.want)
		}
	}
}

// RFC 043: a slot template lists each enabled weekday and time once, and a
// time zone change moves only future occurrences.
func TestSlotTimesFollowTheSetTimeZone(t *testing.T) {
	slots := []schema.QueueSlot{}
	for day := 1; day <= 5; day++ {
		slots = append(slots, schema.QueueSlot{Weekday: day, Time: "12:00"}, schema.QueueSlot{Weekday: day, Time: "17:00"})
	}
	checked, err := queueSlots(slots)
	if err != nil || len(checked) != 10 {
		t.Fatalf("two rows on weekdays are ten slots: %d %v", len(checked), err)
	}
	monday := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	paris, _ := time.LoadLocation("Europe/Paris")
	week := slotTimes(checked, paris, monday, 10)
	if len(week) != 10 || week[0].Format(time.RFC3339) != "2026-11-02T11:00:00Z" {
		t.Fatalf("first Paris slot: %v", week)
	}
	if empty := slotTimes(nil, paris, monday, 10); len(empty) != 0 {
		t.Fatalf("an empty schedule has no slots: %v", empty)
	}
}

// RFC 043: the natural offset is bounded and the same for the same intent.
func TestNaturalOffsetIsBoundedAndStable(t *testing.T) {
	base := time.Date(2026, 11, 2, 17, 0, 0, 0, time.UTC)
	seen := map[int]bool{}
	for version := 1; version <= 500; version++ {
		offset := naturalOffset("draftabcdefghij", version, base)
		if offset < -240 || offset > 240 {
			t.Fatalf("offset %d is outside four minutes", offset)
		}
		if again := naturalOffset("draftabcdefghij", version, base); again != offset {
			t.Fatalf("offset changed on retry: %d then %d", offset, again)
		}
		seen[offset] = true
	}
	if len(seen) < 100 {
		t.Fatalf("offsets barely vary: %d distinct", len(seen))
	}
}

func TestAccountHealth(t *testing.T) {
	now := time.Now()
	past := now.Add(-time.Hour)
	active := channelconnection.StatusACTIVE
	cases := [][2]string{
		{accountHealth(active, true, false, false, false, false, nil, now), AccountConnected},
		{accountHealth(active, false, false, false, false, false, nil, now), AccountUnverified},
		{accountHealth(channelconnection.StatusDISABLED, true, false, false, false, false, nil, now), AccountRemoved},
		{accountHealth(channelconnection.StatusREVOKED, true, false, false, false, false, nil, now), AccountRevoked},
		{accountHealth(active, true, true, false, false, false, nil, now), AccountRevoked},
		{accountHealth(active, true, false, false, true, false, nil, now), AccountReconnectRequired},
		{accountHealth(active, true, false, true, false, false, nil, now), AccountReconnectRequired},
		{accountHealth(active, true, false, false, false, true, nil, now), AccountPermissionRequired},
		{accountHealth(active, true, false, false, false, false, &past, now), AccountExpired},
		{accountHealth(active, true, false, false, false, false, &now, now), AccountExpired},
		{accountHealth(channelconnection.StatusDISABLED, false, false, false, false, false, nil, now), AccountRemoved},
		{accountHealth(channelconnection.StatusREVOKED, false, false, false, false, false, nil, now), AccountRevoked},
	}
	for index, tc := range cases {
		if tc[0] != tc[1] {
			t.Errorf("case %d: got %s, want %s", index, tc[0], tc[1])
		}
	}
}

// RFC 043: a set refines the brand voice and never removes a brand rule.
func TestWritingContextPrecedence(t *testing.T) {
	brandProfile := &ent.BrandProfile{Tone: "Plain", Audience: "Finance leads",
		ProhibitedTerms: []brand.ProhibitedTerm{{Term: "guaranteed"}}}
	set := &ent.SocialSet{Name: "Founder", WritingAssistant: schema.WritingAssistant{Status: "configured",
		StyleGuide: schema.StyleGuide{Tone: "Warm and direct", ProhibitedPhrases: []string{"Guaranteed", "synergy"},
			PlatformGuidance: map[string]string{"linkedin": "Open with a question."}}}}
	merged := mergeWritingContext(brandProfile, set, []string{"Sample one", "Sample two"}, "linkedin")
	if merged.Tone != "Warm and direct" || merged.Audience != "Finance leads" || merged.Source != "social_set" {
		t.Fatalf("tone and audience: %+v", merged)
	}
	if len(merged.ProhibitedPhrases) != 2 || merged.ProhibitedPhrases[0] != "guaranteed" || merged.ProhibitedPhrases[1] != "synergy" {
		t.Fatalf("prohibited: %v", merged.ProhibitedPhrases)
	}
	if merged.PlatformGuidance != "Open with a question." || len(merged.Samples) != 2 {
		t.Fatalf("guidance and samples: %+v", merged)
	}
	set.WritingAssistant.Status = "disabled"
	off := mergeWritingContext(brandProfile, set, []string{"Sample"}, "linkedin")
	if off.Tone != "Plain" || len(off.Samples) != 0 || off.Source != "brand" {
		t.Fatalf("a turned-off assistant still shaped the context: %+v", off)
	}
	if _, err := validStyleGuide(schema.StyleGuide{PlatformGuidance: map[string]string{"myspace": "x"}}); err == nil {
		t.Fatal("guidance for an unknown platform was accepted")
	}
}
