package socialidentity

import "testing"

func TestMastodonPollsRequireServerLimits(t *testing.T) {
	var unknown *PollLimits
	if unknown.Check([]string{"A", "B"}, 60, 0) == nil {
		t.Fatal("unknown limits accepted")
	}
	limits := &PollLimits{MaxOptions: 6, MaxOptionCharacters: 80, MinDurationSeconds: 300, MaxDurationSeconds: 604800}
	if err := limits.Check([]string{"A", "B", "C", "D", "E"}, 5, 0); err != nil {
		t.Fatal(err)
	}
	for _, p := range []struct {
		options        []string
		minutes, media int
	}{{[]string{"A", "B"}, 4, 0}, {[]string{"A", "B"}, 10081, 0}, {[]string{"A", "a"}, 5, 0}, {[]string{"A", "B"}, 5, 1}, {[]string{"A"}, 5, 0}} {
		if limits.Check(p.options, p.minutes, p.media) == nil {
			t.Fatalf("accepted %+v", p)
		}
	}
}
