package instagram

import (
	"context"
	"net/http"
	"testing"
)

func TestInsightsRetainOnlyMeasuredValues(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("metric_type") == "total_value" {
			w.Write([]byte(`{"data":[{"name":"likes","total_value":{"value":0}}]}`))
			return
		}
		w.Write([]byte(`{"data":[{"name":"views","values":[{"value":25,"end_time":"2026-10-24T00:00:00+0000"}]},{"name":"replies","values":[]}]}`))
	})
	p := setup(t, mux)
	rows, err := p.Analytics(context.Background(), "user", "token", 30)
	if err != nil || len(rows) != 3 || rows[0].Data[0].Total != "25" || rows[2].Data[0].Total != "0" || len(rows[1].Data) != 0 {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
	for _, row := range rows {
		if row.PercentageChange != 0 {
			t.Fatal("invented change", row)
		}
	}
	posts, err := p.PostAnalytics(context.Background(), "user", "token", "post", 0)
	if err != nil || len(posts) != 1 || posts[0].Data[0].Total != "25" {
		t.Fatalf("posts=%+v err=%v", posts, err)
	}
}

func TestInsightsPreserveRetryableFailures(t *testing.T) {
	for _, status := range []int{200, 401, 429, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			mux := http.NewServeMux()
			mux.HandleFunc("GET /", func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
				w.Write([]byte(`{"error":{"message":"private provider detail"}}`))
			})
			p := setup(t, mux)
			if _, err := p.Analytics(context.Background(), "user", "token", 30); err == nil {
				t.Fatal("lost account failure")
			}
			if _, err := p.PostAnalytics(context.Background(), "user", "token", "post", 0); err == nil {
				t.Fatal("lost post failure")
			}
		})
	}
}
