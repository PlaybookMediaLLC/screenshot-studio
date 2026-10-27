package quota

import (
	"context"
	"time"

	"github.com/ulule/limiter/v3"
	redisstore "github.com/ulule/limiter/v3/drivers/store/redis"
)

// monthlyKeyTTL outlives the longest calendar month. Callers put the month in
// the key, so a key only has to survive until its month ends.
const monthlyKeyTTL = 32 * 24 * time.Hour

// MonthlyUsage is one meter reading after an increment or a peek.
type MonthlyUsage struct {
	// Used is capped at the limit; the store reports remaining, not overage.
	Used      int64
	Remaining int64
	// Reached is true once usage is over the limit. A call that crosses the
	// limit is still recorded: the work it paid for has already happened.
	Reached bool
}

// MonthlyMeter meters calendar-month allowances such as AI credits,
// scheduled posts, and release emails. It uses github.com/ulule/limiter's
// Redis store, whose Lua script adds and sets expiry atomically, so
// concurrent web and worker processes never lose an increment.
type MonthlyMeter struct{ store limiter.Store }

// MonthlyMeter shares the counter's Redis connection.
func (r *RedisCounter) MonthlyMeter() (*MonthlyMeter, error) {
	store, err := redisstore.NewStoreWithOptions(r.client, limiter.StoreOptions{
		Prefix:   "screenshot-studio:meter",
		MaxRetry: limiter.DefaultMaxRetry,
	})
	if err != nil {
		return nil, err
	}
	return &MonthlyMeter{store: store}, nil
}

// Meter adds amount to key and reads it against limit. An amount of 0 peeks
// without recording; a negative amount refunds work that did not happen.
func (m *MonthlyMeter) Meter(ctx context.Context, key string, amount, limit int64) (MonthlyUsage, error) {
	rate := limiter.Rate{Period: monthlyKeyTTL, Limit: limit}
	var reading limiter.Context
	var err error
	if amount == 0 {
		reading, err = m.store.Peek(ctx, key, rate)
	} else {
		reading, err = m.store.Increment(ctx, key, amount, rate)
	}
	if err != nil {
		return MonthlyUsage{}, err
	}
	return MonthlyUsage{Used: limit - reading.Remaining, Remaining: reading.Remaining, Reached: reading.Reached}, nil
}
