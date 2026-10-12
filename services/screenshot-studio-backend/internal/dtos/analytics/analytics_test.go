package analytics

import "testing"

func TestIsISO8601(t *testing.T) {
	for _, ok := range []string{"2026-01-02", "2026-01-02T03:04:05Z", "2026-01-02T03:04:05.123+02:00", "20260102", "2026-W05-3"} {
		if !IsISO8601(ok) {
			t.Errorf("%s should be valid", ok)
		}
	}
	for _, bad := range []string{"", "yesterday", "2026-13-01", "2026-01-02T25:00"} {
		if IsISO8601(bad) {
			t.Errorf("%s should be invalid", bad)
		}
	}
}
