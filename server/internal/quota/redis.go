package quota

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

var incrementScript = redis.NewScript(`
local count = redis.call('INCRBY', KEYS[1], ARGV[1])
if count == tonumber(ARGV[1]) then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return count
`)

type RedisCounter struct{ client *redis.Client }

func NewRedisCounter(rawURL string) (*RedisCounter, error) {
	options, err := redis.ParseURL(rawURL)
	if err != nil {
		return nil, err
	}
	return &RedisCounter{client: redis.NewClient(options)}, nil
}

func (r *RedisCounter) Increment(ctx context.Context, key string, amount int, window time.Duration) (int, error) {
	return incrementScript.Run(ctx, r.client, []string{key}, amount, window.Milliseconds()).Int()
}

func (r *RedisCounter) Close() error { return r.client.Close() }
