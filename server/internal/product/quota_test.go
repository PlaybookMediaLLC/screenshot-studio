package product

import (
	"testing"
	"time"
)

func TestMonthlyQuotaPeriods(t *testing.T) {
	december := time.Date(2026, time.December, 31, 23, 59, 0, 0, time.UTC)
	if got := monthPeriod(december); got != "2026-12" {
		t.Fatalf("period=%s", got)
	}
	if got := nextMonthStart(december); !got.Equal(time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("reset=%s", got)
	}
	// A non-UTC clock still meters against the UTC month.
	tokyo := time.Date(2026, time.November, 1, 5, 0, 0, 0, time.FixedZone("JST", 9*60*60))
	if got := monthlyMeterKey(QuotaAICredits, "org-1", tokyo); got != "ai:credits:monthly:org-1:2026-10" {
		t.Fatalf("key=%s", got)
	}
}

func TestPlanQuotasCoverEveryPlan(t *testing.T) {
	for name, limit := range planQuotas["free"] {
		want := map[string]int{QuotaPosts: 10, QuotaAPIWriteMinute: 60}[name]
		if limit != want {
			t.Fatalf("free %s=%d want %d", name, limit, want)
		}
	}
	for _, plan := range []string{"pro", "business", "enterprise"} {
		for name := range planQuotas["free"] {
			if planQuotas[plan][name] <= 0 {
				t.Fatalf("%s has no %s allowance", plan, name)
			}
		}
	}
	// docs/rfcs/023: AI credits sized for a 50% gross margin at 30% use.
	want := map[string]int{"free": 0, "pro": 1_500, "business": 4_000, "enterprise": 20_000}
	for plan, credits := range want {
		if planQuotas[plan][QuotaAICredits] != credits {
			t.Fatalf("%s AI credits=%d want %d", plan, planQuotas[plan][QuotaAICredits], credits)
		}
	}
	if maxQuotaAmount(QuotaEmails) < planQuotas["enterprise"][QuotaEmails] || maxQuotaAmount(QuotaAPIWriteMinute) != 100 {
		t.Fatal("quota amount bounds changed")
	}
}
