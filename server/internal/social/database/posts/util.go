package posts

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf16"
)

// parseDate is dayjs(value) (loc = time.Local) or dayjs.utc(value) (loc =
// time.UTC): strings with a zone keep it, the others are read in loc.
func parseDate(value string, loc *time.Location) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.999999999Z0700", "2006-01-02T15:04Z07:00"} {
		if t, err := time.Parse(layout, value); err == nil {
			return t, nil
		}
	}
	for _, layout := range []string{
		"2006-01-02T15:04:05.999999999", "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02T15",
		"2006-01-02 15:04:05.999999999", "2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02",
		"2006-01", "2006",
	} {
		if t, err := time.ParseInLocation(layout, value, loc); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("Invalid Date: %q", value)
}

// jsLength and jsSlice measure and cut like JavaScript strings (UTF-16 units),
// which is what comment anchors count in.
func jsLength(s string) int { return len(utf16.Encode([]rune(s))) }

func jsSlice(s string, start, end int) string {
	units := utf16.Encode([]rune(s))
	clamp := func(i int) int {
		if i < 0 {
			i += len(units)
		}
		return min(max(i, 0), len(units))
	}
	start, end = clamp(start), clamp(end)
	if start >= end {
		return ""
	}
	return string(utf16.Decode(units[start:end]))
}

// splitFirst is value.split(sep)[0].
func splitFirst(value, sep string) string {
	before, _, _ := strings.Cut(value, sep)
	return before
}

// toMap renders v as its JSON object (a Prisma row for entities).
func toMap(v any) (map[string]any, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	return out, json.Unmarshal(data, &out)
}
