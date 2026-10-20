package product

import (
	"errors"
	"testing"
	"time"
)

func TestResolveLocalTime(t *testing.T) {
	at, err := resolveLocalTime("2026-07-01T12:00", "Europe/Paris", "")
	if err != nil || !at.Equal(time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("ordinary time: %v %v", at, err)
	}
	// US clocks skip 02:00–02:59 on 8 March 2026.
	var gap *LocalTimeError
	if _, err := resolveLocalTime("2026-03-08T02:30", "America/New_York", "earlier"); !errors.As(err, &gap) || gap.Kind != "gap" || !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("gap: %v", err)
	}
	// They repeat 01:00–01:59 on 1 November 2026.
	var repeated *LocalTimeError
	if _, err := resolveLocalTime("2026-11-01T01:30", "America/New_York", ""); !errors.As(err, &repeated) || repeated.Kind != "ambiguous" ||
		!repeated.Earlier.Equal(time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC)) || !repeated.Later.Equal(time.Date(2026, 11, 1, 6, 30, 0, 0, time.UTC)) {
		t.Fatalf("ambiguous: %v %+v", err, repeated)
	}
	if later, err := resolveLocalTime("2026-11-01T01:30", "America/New_York", "later"); err != nil || !later.Equal(time.Date(2026, 11, 1, 6, 30, 0, 0, time.UTC)) {
		t.Fatalf("later: %v %v", later, err)
	}
	if india, err := resolveLocalTime("2026-05-05T08:00", "Asia/Kolkata", ""); err != nil || !india.Equal(time.Date(2026, 5, 5, 2, 30, 0, 0, time.UTC)) {
		t.Fatalf("half-hour zone: %v %v", india, err)
	}
	for _, bad := range [][2]string{{"2026-07-01 12:00", "UTC"}, {"2026-07-01T12:00", "Mars/Olympus"}, {"2026-07-01T12:00", ""}} {
		if _, err := resolveLocalTime(bad[0], bad[1], ""); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("%v accepted: %v", bad, err)
		}
	}
}

// The web computes the same offsets (naturalOffsetMinutes); these values are
// what it returns for the same keys.
func TestNaturalOffsetMatchesTheWeb(t *testing.T) {
	for key, minutes := range map[string]int{"draft-1:v1": 4, "cmabc123:v7": 1, "x": -4} {
		if got := naturalOffset(key); got != time.Duration(minutes)*time.Minute {
			t.Errorf("%s: %v, the web says %d minutes", key, got, minutes)
		}
	}
	for index := range 1000 {
		if offset := naturalOffset(string(rune('a'+index%26)) + time.Duration(index).String()); offset < -4*time.Minute || offset > 4*time.Minute {
			t.Fatalf("offset out of range: %v", offset)
		}
	}
}
