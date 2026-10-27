package redis

import (
	"context"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
)

func TestTakeHasExactlyOneConsumer(t *testing.T) {
	stores := map[string]Store{"memory": NewMemory()}
	if os.Getenv("REDIS_URL") != "" {
		remote, err := New()
		if err != nil {
			t.Fatal(err)
		}
		stores["redis"] = remote
	}
	for name, store := range stores {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			key := "disposable-take-test:" + ids.Secure(32)
			t.Cleanup(func() { _ = store.Del(ctx, key) })
			if err := store.Set(ctx, key, "once", time.Minute); err != nil {
				t.Fatal(err)
			}
			var winners atomic.Int32
			var wg sync.WaitGroup
			for range 30 {
				wg.Go(func() {
					value, found, err := store.Take(ctx, key)
					if err != nil {
						t.Error(err)
					}
					if found {
						if value != "once" {
							t.Error("wrong value")
						}
						winners.Add(1)
					}
				})
			}
			wg.Wait()
			if winners.Load() != 1 {
				t.Fatal("more than one consumer")
			}
		})
	}
}
