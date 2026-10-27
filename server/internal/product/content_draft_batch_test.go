package product

import (
	"reflect"
	"testing"
	"time"
)

func TestSpreadTimes(t *testing.T) {
	input := DraftBatchTimesInput{Count: 6, LocalTime: "2027-03-13T09:00", PostsPerDay: 2, SpacingMinutes: 240, ShiftMinutes: 15, Seed: "a-stable-batch-seed"}
	now := time.Date(2027, 3, 1, 0, 0, 0, 0, time.UTC)
	first, err := spreadTimes(input, "America/New_York", now)
	if err != nil {
		t.Fatal(err)
	}
	second, err := spreadTimes(input, "America/New_York", now)
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatal("a repeated preview moved times")
	}
	zone, _ := time.LoadLocation("America/New_York")
	for i, at := range first {
		local := at.In(zone)
		if local.Day() != 13+i/2 {
			t.Fatal("spread moved day across DST", first)
		}
		minutes := local.Hour()*60 + local.Minute()
		expected := 9*60 + (i%2)*240
		if minutes < expected-15 || minutes > expected+15 || minutes%5 != 0 {
			t.Fatal("shift outside configured bounds", first)
		}
	}
	input.LocalTime = "2027-03-14T02:30"
	input.ShiftMinutes = 0
	if _, err := spreadTimes(input, "America/New_York", now); err == nil {
		t.Fatal("DST gap accepted")
	}
	input.LocalTime = "2027-11-07T01:30"
	if _, err := spreadTimes(input, "America/New_York", now); err == nil {
		t.Fatal("ambiguous DST time accepted")
	}
	input.LocalTime = "2027-03-15T23:30"
	if _, err := spreadTimes(input, "UTC", now); err == nil {
		t.Fatal("spread crossed midnight")
	}
	input.LocalTime = "2027-03-15T09:00"
	input.ShiftMinutes = 4
	if _, err := spreadTimes(input, "UTC", now); err == nil {
		t.Fatal("non-five-minute shift accepted")
	}
}
