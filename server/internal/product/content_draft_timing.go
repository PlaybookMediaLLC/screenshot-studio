package product

import (
	"sort"
	"time"
)

// Scheduling times (RFC 025). A schedule names a local wall time in a time
// zone; Go resolves it, refusing a time the clocks skip and asking which of
// two instants a repeated time means.

// LocalTimeError explains a local time that names no instant or two.
type LocalTimeError struct {
	// Kind is gap (the clocks skip it) or ambiguous (they repeat it).
	Kind    string
	Earlier time.Time
	Later   time.Time
}

func (e *LocalTimeError) Error() string {
	if e.Kind == "gap" {
		return "That time does not exist in this time zone: the clocks skip it. Pick another time."
	}
	return "That time happens twice in this time zone: the clocks repeat it. Choose the earlier or the later one."
}

func (e *LocalTimeError) Unwrap() error { return ErrInvalidInput }

// resolveLocalTime turns a local time (YYYY-MM-DDTHH:MM) in a zone into the
// instant it names. Offsets around the time are tried; each that maps back
// to the same wall time is an instant it names. Disambiguation picks one of
// two: earlier or later; anything else refuses.
func resolveLocalTime(local, zoneName, disambiguation string) (time.Time, error) {
	zone, err := time.LoadLocation(zoneName)
	if zoneName == "" || err != nil {
		return time.Time{}, invalid("Schedule in an IANA time zone, such as Europe/Paris.")
	}
	naive, err := time.Parse("2006-01-02T15:04", local)
	if err != nil {
		return time.Time{}, invalid("Give the local time as YYYY-MM-DDTHH:MM.")
	}
	offsets := map[int]bool{}
	for _, hours := range []int{-36, -24, -12, 0, 12, 24, 36} {
		_, offset := naive.Add(time.Duration(hours) * time.Hour).In(zone).Zone()
		offsets[offset] = true
	}
	var instants []time.Time
	for offset := range offsets {
		at := naive.Add(-time.Duration(offset) * time.Second).UTC()
		if at.In(zone).Format("2006-01-02T15:04") == local && !containsTime(instants, at) {
			instants = append(instants, at)
		}
	}
	sort.Slice(instants, func(i, j int) bool { return instants[i].Before(instants[j]) })
	switch {
	case len(instants) == 0:
		return time.Time{}, &LocalTimeError{Kind: "gap"}
	case len(instants) == 1:
		return instants[0], nil
	case disambiguation == "earlier":
		return instants[0], nil
	case disambiguation == "later":
		return instants[len(instants)-1], nil
	}
	return time.Time{}, &LocalTimeError{Kind: "ambiguous", Earlier: instants[0], Later: instants[len(instants)-1]}
}

func containsTime(times []time.Time, at time.Time) bool {
	for _, t := range times {
		if t.Equal(at) {
			return true
		}
	}
	return false
}
