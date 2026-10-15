package product

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspaceentitlement"
)

var ErrQuotaExceeded = errors.New("workspace plan quota exceeded")

type QuotaCounter interface {
	Increment(context.Context, string, int, time.Duration) (int, error)
}

func (c *Configuration) WithQuotaCounter(counter QuotaCounter) *Configuration {
	c.quota = counter
	return c
}

func (c *Configuration) ConsumeWorkspaceQuota(ctx context.Context, actor Actor, quota string, amount int) (int, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return 0, err
	}
	if amount < 1 || amount > 100 {
		return 0, ErrInvalidInput
	}
	limits := map[string]map[string]int{
		"free":       {"api:write:minute": 30, "generation:monthly": 250, "jobs:concurrent": 1},
		"pro":        {"api:write:minute": 300, "generation:monthly": 5000, "jobs:concurrent": 5},
		"business":   {"api:write:minute": 1500, "generation:monthly": 25000, "jobs:concurrent": 25},
		"enterprise": {"api:write:minute": 10000, "generation:monthly": 250000, "jobs:concurrent": 250},
	}
	if quota != "api:write:minute" && quota != "generation:monthly" && quota != "jobs:concurrent" {
		return 0, ErrInvalidInput
	}
	entitlement, err := c.client.WorkspaceEntitlement.Query().Where(workspaceentitlement.ID(actor.OrganizationID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return 0, err
	}
	plan, _, features := evaluateBootstrapEntitlement(entitlement, time.Now().UTC())
	if !features["asset:read"] {
		return 0, ErrQuotaExceeded
	}
	limit := limits[plan][quota]
	if c.quota == nil {
		return 0, ErrQuotaExceeded
	}
	window := 30 * 24 * time.Hour
	if quota == "api:write:minute" {
		window = time.Minute
	}
	key := fmt.Sprintf("screenshot-studio:quota:%s:%s:%d", quota, actor.OrganizationID,
		time.Now().UnixMilli()/window.Milliseconds())
	count, err := c.quota.Increment(ctx, key, amount, window)
	// An unavailable counter fails closed, like an exhausted one.
	if err != nil || count > limit {
		return 0, &QuotaExceededError{Limit: limit, Quota: quota, ResetAt: time.Now().UTC().Add(window)}
	}
	return limit - count, nil
}

// QuotaExceededError carries what a client needs to back off.
type QuotaExceededError struct {
	Limit   int
	Quota   string
	ResetAt time.Time
}

func (e *QuotaExceededError) Error() string { return ErrQuotaExceeded.Error() }
func (e *QuotaExceededError) Unwrap() error { return ErrQuotaExceeded }
