package threads

import (
	"context"
	"net/http"
	"testing"
)

func TestInsightsRetainOnlyMeasuredValues(t *testing.T) {
	setup(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"data":[{"name":"likes","total_value":{"value":0}},{"name":"views","values":[{"value":25,"end_time":"2026-10-24T00:00:00+0000"}]},{"name":"replies","values":[]}]}`))
	})
	rows, err := New().Analytics(context.Background(), "user", "token", 30)
	if err != nil || len(rows) != 3 || rows[0].Data[0].Total != "0" || rows[1].Data[0].Total != "25" || len(rows[2].Data) != 0 {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
	for _, row := range rows {
		if row.PercentageChange != 0 {
			t.Fatal("invented change", row)
		}
	}
	posts, err := New().PostAnalytics(context.Background(), "user", "token", "post", 0)
	if err != nil || len(posts) != 2 {
		t.Fatalf("posts=%+v err=%v", posts, err)
	}
}

func TestInsightsPreserveRetryableFailures(t *testing.T) {
	for _, status := range []int{200, 401, 429, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			setup(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
				w.Write([]byte(`{"error":{"message":"private provider detail"}}`))
			})
			if _, err := New().Analytics(context.Background(), "user", "token", 30); err == nil {
				t.Fatal("lost account failure")
			}
			if _, err := New().PostAnalytics(context.Background(), "user", "token", "post", 0); err == nil {
				t.Fatal("lost post failure")
			}
		})
	}
}
