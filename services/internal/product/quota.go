package product

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspaceentitlement"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/quota"
)

var ErrQuotaExceeded = errors.New("workspace plan quota exceeded")

// Workspace quotas. Monthly quotas reset at the start of each UTC calendar
// month; the others use rolling counter windows.
const (
	QuotaAPIWriteMinute = "api:write:minute"
	QuotaJobsConcurrent = "jobs:concurrent"
	// QuotaAICredits counts model spend: one credit is $0.01 at list price.
	QuotaAICredits = "ai:credits:monthly"
	QuotaPosts     = "posts:monthly"
	QuotaEmails    = "emails:monthly"
	// quotaLegacyGenerations is what web images older than the credit meter
	// send. It meters AI credits so a backend deployed first keeps working.
	quotaLegacyGenerations = "generation:monthly"
)

// planQuotas mirrors lib/billing/plans.ts. The allowances hold a 75% gross
// margin at half use (docs/rfcs/035-pricing-and-unit-economics.md).
var planQuotas = map[string]map[string]int{
	// "free" means no subscription: every allowance is zero.
	"free": {QuotaAPIWriteMinute: 0, QuotaJobsConcurrent: 0,
		QuotaAICredits: 0, QuotaPosts: 0, QuotaEmails: 0},
	"pro": {QuotaAPIWriteMinute: 300, QuotaJobsConcurrent: 5,
		QuotaAICredits: 3_600, QuotaPosts: 120, QuotaEmails: 5_000},
	"business": {QuotaAPIWriteMinute: 1_500, QuotaJobsConcurrent: 25,
		QuotaAICredits: 13_200, QuotaPosts: 480, QuotaEmails: 25_000},
	"enterprise": {QuotaAPIWriteMinute: 10_000, QuotaJobsConcurrent: 250,
		QuotaAICredits: 54_000, QuotaPosts: 2_400, QuotaEmails: 100_000},
}

var monthlyQuotas = map[string]bool{QuotaAICredits: true, QuotaPosts: true, QuotaEmails: true}

// maxQuotaAmount bounds one consumption. A release email can reach a whole
// audience and one model call can cost hundreds of credits.
func maxQuotaAmount(name string) int {
	if monthlyQuotas[name] {
		return 1_000_000
	}
	return 100
}

type QuotaCounter interface {
	Increment(context.Context, string, int, time.Duration) (int, error)
}

// MonthlyMeter records calendar-month usage; quota.MonthlyMeter implements it
// on Redis through github.com/ulule/limiter.
type MonthlyMeter interface {
	Meter(ctx context.Context, key string, amount, limit int64) (quota.MonthlyUsage, error)
}

func (c *Configuration) WithQuotaCounter(counter QuotaCounter) *Configuration {
	c.quota = counter
	return c
}

func (c *Configuration) WithMonthlyMeter(meter MonthlyMeter) *Configuration {
	c.meter = meter
	return c
}

// monthPeriod names the UTC calendar month a monthly meter key belongs to.
func monthPeriod(now time.Time) string { return now.UTC().Format("2006-01") }

// nextMonthStart is when a monthly quota resets.
func nextMonthStart(now time.Time) time.Time {
	now = now.UTC()
	return time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
}

func monthlyMeterKey(name, org string, now time.Time) string {
	return fmt.Sprintf("%s:%s:%s", name, org, monthPeriod(now))
}

// workspacePlan resolves the plan whose limits apply. An inactive workspace
// (lapsed billing, suspension) gets no quota at all.
func (c *Configuration) workspacePlan(ctx context.Context, org string) (string, bool, error) {
	entitlement, err := c.client.WorkspaceEntitlement.Query().Where(workspaceentitlement.ID(org)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return "", false, err
	}
	plan, _, features := evaluateBootstrapEntitlement(entitlement, time.Now().UTC())
	return plan, features["asset:read"], nil
}

// ConsumeWorkspaceQuota records amount against a quota and returns what is
// left. An amount of 0 reads the quota without consuming it.
func (c *Configuration) ConsumeWorkspaceQuota(ctx context.Context, actor Actor, name string, amount int) (int, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return 0, err
	}
	if name == quotaLegacyGenerations {
		name = QuotaAICredits
	}
	if _, known := planQuotas["free"][name]; !known || amount < 0 || amount > maxQuotaAmount(name) {
		return 0, ErrInvalidInput
	}
	plan, active, err := c.workspacePlan(ctx, actor.OrganizationID)
	if err != nil {
		return 0, err
	}
	limit := planQuotas[plan][name]
	now := time.Now().UTC()
	if !active {
		return 0, &QuotaExceededError{Limit: limit, Quota: name, ResetAt: nextMonthStart(now)}
	}
	if name == QuotaAICredits {
		return c.meterAICredits(ctx, actor.OrganizationID, plan, amount, now)
	}
	if monthlyQuotas[name] {
		return c.meterMonthly(ctx, actor.OrganizationID, plan, name, amount, now)
	}
	if c.quota == nil {
		return 0, ErrQuotaExceeded
	}
	window := 30 * 24 * time.Hour
	if name == QuotaAPIWriteMinute {
		window = time.Minute
	}
	key := fmt.Sprintf("screenshot-studio:quota:%s:%s:%d", name, actor.OrganizationID,
		now.UnixMilli()/window.Milliseconds())
	count, err := c.quota.Increment(ctx, key, amount, window)
	// An unavailable counter fails closed, like an exhausted one.
	if err != nil || count > limit {
		return 0, &QuotaExceededError{Limit: limit, Quota: name, ResetAt: now.Add(window)}
	}
	return limit - count, nil
}

func (c *Configuration) meterMonthly(ctx context.Context, org, plan, name string, amount int, now time.Time) (int, error) {
	limit := planQuotas[plan][name]
	exceeded := &QuotaExceededError{Limit: limit, Quota: name, ResetAt: nextMonthStart(now)}
	if c.meter == nil {
		return 0, exceeded
	}
	usage, err := c.meter.Meter(ctx, monthlyMeterKey(name, org, now), int64(amount), int64(limit))
	// An unavailable meter fails closed, like an exhausted one.
	if err != nil || usage.Reached || (amount == 0 && usage.Remaining == 0) {
		if err != nil {
			slog.Error("monthly meter unavailable", "quota", name, "error", err)
		}
		return 0, exceeded
	}
	return int(usage.Remaining), nil
}

// exactMeterLimit is far above any allowance, so the meter's remaining count
// gives exact usage rather than usage capped at the plan limit.
const exactMeterLimit = 1 << 40

// meterAICredits spends the monthly allowance first, then purchased packs.
// The call that crosses both is still recorded, so overrun is at most one
// call; the next one is refused.
func (c *Configuration) meterAICredits(ctx context.Context, org, plan string, amount int, now time.Time) (int, error) {
	limit := planQuotas[plan][QuotaAICredits]
	exceeded := &QuotaExceededError{Limit: limit, Quota: QuotaAICredits, ResetAt: nextMonthStart(now)}
	if c.meter == nil {
		return 0, exceeded
	}
	usage, err := c.meter.Meter(ctx, monthlyMeterKey(QuotaAICredits, org, now), int64(amount), exactMeterLimit)
	if err != nil {
		// An unavailable meter fails closed, like an exhausted one.
		slog.Error("monthly meter unavailable", "quota", QuotaAICredits, "error", err)
		return 0, exceeded
	}
	used := int(usage.Used)
	allowance := max(limit-used, 0)
	overflow := min(amount, max(used-limit, 0))
	var taken, balance int
	if overflow > 0 {
		taken, balance, err = c.drawCredits(ctx, org, overflow)
	} else {
		balance, err = c.creditBalance(ctx, org)
	}
	if err != nil {
		slog.Error("credit balance unavailable", "error", err)
		return 0, exceeded
	}
	if taken < overflow || (amount == 0 && allowance+balance == 0) {
		return 0, exceeded
	}
	return allowance + balance, nil
}

// ChargeMonthlyQuota takes amount from an authorized workspace's monthly quota
// before work that costs money. The returned refund gives it back if that
// work then fails, so a rolled-back schedule does not use the allowance.
func (c *Configuration) ChargeMonthlyQuota(ctx context.Context, org, name string, amount int) (func(), error) {
	plan, active, err := c.workspacePlan(ctx, org)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	exceeded := &QuotaExceededError{Limit: planQuotas[plan][name], Quota: name, ResetAt: nextMonthStart(now)}
	if !active || c.meter == nil {
		return nil, exceeded
	}
	usage, err := c.meter.Meter(ctx, monthlyMeterKey(name, org, now), int64(amount), int64(planQuotas[plan][name]))
	if err != nil {
		slog.Error("monthly meter unavailable", "quota", name, "error", err)
		return nil, exceeded
	}
	refund := func() { c.refundMonthly(org, name, amount, now) }
	if usage.Reached {
		// The meter recorded the overrun; give it back so a refused request
		// does not count against the month.
		refund()
		return nil, exceeded
	}
	return refund, nil
}

func (c *Configuration) refundMonthly(org, name string, amount int, at time.Time) {
	if c.meter == nil || amount <= 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := c.meter.Meter(ctx, monthlyMeterKey(name, org, at), -int64(amount), 1); err != nil {
		slog.Error("monthly meter refund failed", "quota", name, "amount", amount, "error", err)
	}
}

// QuotaExceededError carries what a client needs to back off.
type QuotaExceededError struct {
	Limit   int
	Quota   string
	ResetAt time.Time
}

func (e *QuotaExceededError) Error() string { return ErrQuotaExceeded.Error() }
func (e *QuotaExceededError) Unwrap() error { return ErrQuotaExceeded }
