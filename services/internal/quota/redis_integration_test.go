package quota

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRedisCounterAtomicIncrement(t *testing.T) {
	url := os.Getenv("QUOTA_TEST_REDIS_URL")
	if url == "" {
		t.Skip("QUOTA_TEST_REDIS_URL is not set")
	}
	counter, err := NewRedisCounter(url)
	if err != nil {
		t.Fatal(err)
	}
	defer counter.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	key := "codex-quota-test:" + uuid.NewString()
	defer counter.client.Del(context.Background(), key)
	if count, err := counter.Increment(ctx, key, 2, time.Minute); err != nil || count != 2 {
		t.Fatalf("first increment count=%d err=%v", count, err)
	}
	if count, err := counter.Increment(ctx, key, 3, time.Minute); err != nil || count != 5 {
		t.Fatalf("second increment count=%d err=%v", count, err)
	}
	if ttl, err := counter.client.PTTL(ctx, key).Result(); err != nil || ttl <= 0 {
		t.Fatalf("counter ttl=%s err=%v", ttl, err)
	}
}
