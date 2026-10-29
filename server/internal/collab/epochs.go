package collab

import (
	"context"
	"strconv"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Epochs count the changes that can alter who may use a live collaboration
// session: per workspace, and one count for every workspace (sessions and
// memberships written through the auth store name no single workspace). The
// collaboration server authorizes a connection when it opens, then again only
// when its workspace's count or the global one has moved, so revocation is
// pushed instead of being re-checked on every message.
type Epochs interface {
	// Bump records a change in organizationID, or in every workspace when it is "".
	Bump(ctx context.Context, organizationID string) error
	// Read returns the global count and the count of each workspace asked for.
	Read(ctx context.Context, organizationIDs []string) (int64, map[string]int64, error)
}

// MemoryEpochs keeps the counts in this process: one backend replica only.
type MemoryEpochs struct {
	mu            sync.Mutex
	global        int64
	organizations map[string]int64
}

// NewMemoryEpochs returns empty in-process counts.
func NewMemoryEpochs() *MemoryEpochs {
	return &MemoryEpochs{organizations: map[string]int64{}}
}

// Bump implements Epochs.
func (m *MemoryEpochs) Bump(_ context.Context, organizationID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if organizationID == "" {
		m.global++
	} else {
		m.organizations[organizationID]++
	}
	return nil
}

// Read implements Epochs.
func (m *MemoryEpochs) Read(_ context.Context, organizationIDs []string) (int64, map[string]int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	counts := make(map[string]int64, len(organizationIDs))
	for _, id := range organizationIDs {
		counts[id] = m.organizations[id]
	}
	return m.global, counts, nil
}

const epochPrefix = "shots-collab:epoch:"

// RedisEpochs shares the counts between backend replicas.
type RedisEpochs struct{ client *redis.Client }

// NewRedisEpochs connects to rawURL.
func NewRedisEpochs(rawURL string) (*RedisEpochs, error) {
	options, err := redis.ParseURL(rawURL)
	if err != nil {
		return nil, err
	}
	return &RedisEpochs{client: redis.NewClient(options)}, nil
}

func epochKey(organizationID string) string {
	if organizationID == "" {
		return epochPrefix + "*"
	}
	return epochPrefix + organizationID
}

// Bump implements Epochs.
func (r *RedisEpochs) Bump(ctx context.Context, organizationID string) error {
	return r.client.Incr(ctx, epochKey(organizationID)).Err()
}

// Read implements Epochs.
func (r *RedisEpochs) Read(ctx context.Context, organizationIDs []string) (int64, map[string]int64, error) {
	keys := []string{epochKey("")}
	for _, id := range organizationIDs {
		keys = append(keys, epochKey(id))
	}
	values, err := r.client.MGet(ctx, keys...).Result()
	if err != nil {
		return 0, nil, err
	}
	counts := make(map[string]int64, len(organizationIDs))
	for i, id := range organizationIDs {
		counts[id] = redisCount(values[i+1])
	}
	return redisCount(values[0]), counts, nil
}

// Close releases the connection.
func (r *RedisEpochs) Close() error { return r.client.Close() }

// redisCount reads a counter MGET returned; a missing key is zero.
func redisCount(value any) int64 {
	text, _ := value.(string)
	count, _ := strconv.ParseInt(text, 10, 64)
	return count
}
