package medialimits

import "testing"

func TestPlanAndTypeLimits(t *testing.T) {
	for _, plan := range []string{"pro", "business", "enterprise"} {
		if UploadBytes("image/png", plan) != 20000000 {
			t.Fatal(plan)
		}
	}
	if UploadBytes("image/jpeg", "free") != 5000000 || UploadBytes("image/gif", "unknown") != 5000000 {
		t.Fatal("free image limit")
	}
	if UploadBytes("application/pdf", "pro") != 100_000_000 || UploadBytes("video/mp4", "pro") != 512<<20 {
		t.Fatal("document/video limit")
	}
}
