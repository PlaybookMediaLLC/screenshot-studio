package product

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/invitation"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
)

// Plan limits cap what a workspace holds, unlike quotas, which cap what it
// uses each month (docs/rfcs/035-pricing-and-unit-economics.md, Packaging).
// Products need no limit here: a workspace has one product profile.
const (
	LimitSeats    = "seats"
	LimitChannels = "channels"
)

const unlimited = math.MaxInt32

// planLimits mirrors the Packaging table in RFC 035. A workspace without a
// subscription keeps its owner's seat and nothing else.
var planLimits = map[string]map[string]int{
	"free":       {LimitSeats: 1, LimitChannels: 0},
	"pro":        {LimitSeats: 5, LimitChannels: 3},
	"business":   {LimitSeats: 20, LimitChannels: 15},
	"enterprise": {LimitSeats: unlimited, LimitChannels: unlimited},
}

var limitNouns = map[string]string{LimitSeats: "seats", LimitChannels: "social channels"}

// PlanLimitError reports that a workspace already holds all of something its
// plan includes.
type PlanLimitError struct {
	Limit      int
	Name, Plan string
}

func (e *PlanLimitError) Error() string {
	if e.Plan == "free" {
		return fmt.Sprintf("Choose a plan to add %s.", limitNouns[e.Name])
	}
	return fmt.Sprintf("The %s plan includes %d %s. Upgrade the plan to add more.",
		strings.ToUpper(e.Plan[:1])+e.Plan[1:], e.Limit, limitNouns[e.Name])
}

// requirePlanCapacity refuses one more of name when the workspace already
// holds held of them.
// ponytail: counts are read outside the writing transaction, so two
// concurrent adds at the limit can both pass; lock the organization row if
// that overshoot ever matters.
func (c *Configuration) requirePlanCapacity(ctx context.Context, org, name string, held int) error {
	plan, _, err := c.workspacePlan(ctx, org)
	if err != nil {
		return err
	}
	if limit := planLimits[plan][name]; held >= limit {
		return &PlanLimitError{Limit: limit, Name: name, Plan: plan}
	}
	return nil
}

// RequireSeat refuses adding a member when the workspace's members already
// fill its plan's seats. With invitations set, a pending invitation holds a
// seat too: it is checked before inviting, and not again on acceptance.
func (c *Configuration) RequireSeat(ctx context.Context, org string, invitations bool) error {
	held, err := c.client.Member.Query().Where(member.OrganizationID(org)).Count(ctx)
	if err != nil {
		return err
	}
	if invitations {
		pending, err := c.client.Invitation.Query().Where(invitation.OrganizationID(org),
			invitation.Status("pending"), invitation.ExpiresAtGT(time.Now().UTC())).Count(ctx)
		if err != nil {
			return err
		}
		held += pending
	}
	return c.requirePlanCapacity(ctx, org, LimitSeats, held)
}

// RequireChannel refuses connecting a new social account when the workspace
// already has all the active channels its plan includes. Reconnecting an
// account the workspace already holds is always allowed.
func (c *Configuration) RequireChannel(ctx context.Context, org, externalAccountID string) error {
	known, err := c.client.ChannelConnection.Query().Where(channelconnection.OrganizationID(org),
		channelconnection.ExternalAccountID(externalAccountID)).Exist(ctx)
	if err != nil || known {
		return err
	}
	active, err := c.client.ChannelConnection.Query().Where(channelconnection.OrganizationID(org),
		channelconnection.StatusEQ(channelconnection.StatusACTIVE)).Count(ctx)
	if err != nil {
		return err
	}
	return c.requirePlanCapacity(ctx, org, LimitChannels, active)
}
