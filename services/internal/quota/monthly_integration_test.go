package quota

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestMonthlyMeterRecordsPeeksAndRefunds(t *testing.T) {
	url := os.Getenv("QUOTA_TEST_REDIS_URL")
	if url == "" {
		t.Skip("QUOTA_TEST_REDIS_URL is not set")
	}
	counter, err := NewRedisCounter(url)
	if err != nil {
		t.Fatal(err)
	}
	defer counter.Close()
	meter, err := counter.MonthlyMeter()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	key := "meter-test:" + uuid.NewString()
	defer counter.client.Del(context.Background(), "screenshot-studio:meter:"+key)

	if usage, err := meter.Meter(ctx, key, 0, 100); err != nil || usage.Remaining != 100 || usage.Reached {
		t.Fatalf("empty peek=%+v err=%v", usage, err)
	}
	if usage, err := meter.Meter(ctx, key, 60, 100); err != nil || usage.Remaining != 40 || usage.Used != 60 {
		t.Fatalf("first charge=%+v err=%v", usage, err)
	}
	// Crossing the limit is recorded and reported, never silently dropped.
	if usage, err := meter.Meter(ctx, key, 50, 100); err != nil || !usage.Reached || usage.Remaining != 0 {
		t.Fatalf("overrun=%+v err=%v", usage, err)
	}
	if usage, err := meter.Meter(ctx, key, -50, 100); err != nil || usage.Reached || usage.Remaining != 40 {
		t.Fatalf("refund=%+v err=%v", usage, err)
	}
	if ttl, err := counter.client.PTTL(ctx, "screenshot-studio:meter:"+key).Result(); err != nil || ttl <= 31*24*time.Hour {
		t.Fatalf("meter ttl=%s err=%v", ttl, err)
	}
}
