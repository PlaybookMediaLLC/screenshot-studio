package auth

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

// Sections are the permission sections.
type Sections string

const (
	SectionChannel            Sections = "channel"
	SectionPostsPerMonth      Sections = "posts_per_month"
	SectionVideosPerMonth     Sections = "videos_per_month"
	SectionClippingMinutes    Sections = "clipping_minutes"
	SectionTeamMembers        Sections = "team_members"
	SectionCommunityFeatures  Sections = "community_features"
	SectionFeaturedByGitroom  Sections = "featured_by_gitroom"
	SectionAI                 Sections = "ai"
	SectionImportFromChannels Sections = "import_from_channels"
	SectionAdmin              Sections = "admin"
	SectionWebhooks           Sections = "webhooks"
)

// AuthorizationActions are the permission actions.
type AuthorizationActions string

const (
	ActionCreate AuthorizationActions = "create"
	ActionRead   AuthorizationActions = "read"
	ActionUpdate AuthorizationActions = "update"
	ActionDelete AuthorizationActions = "delete"
)

// AbilityPolicy is one [action, section] pair of @CheckPolicies.
type AbilityPolicy struct {
	Action  AuthorizationActions
	Section Sections
}

// Policy builds an AbilityPolicy.
func Policy(action AuthorizationActions, section Sections) AbilityPolicy {
	return AbilityPolicy{Action: action, Section: section}
}

// Ability is the CASL ability check builds: the granted [action, section] pairs.
type Ability map[AbilityPolicy]bool

// Can is ability.can(action, section).
func (a Ability) Can(action AuthorizationActions, section Sections) bool {
	return a[AbilityPolicy{action, section}]
}

// SubscriptionService is the part of subscriptions.Service permissions use.
type SubscriptionService interface {
	GetSubscriptionByOrganizationID(ctx context.Context, orgID string) (*ent.Subscription, error)
	GetSubscription(ctx context.Context, orgID string) (*ent.Subscription, error)
}

// PostsService is the part of posts.Service permissions use.
type PostsService interface {
	CountPostsFromDay(ctx context.Context, orgID string, date time.Time) (int, error)
}

// IntegrationService is the part of integration.Service permissions use.
type IntegrationService interface {
	GetIntegrationByInternalID(ctx context.Context, orgID, internalID string) (*ent.Integration, error)
	GetIntegrationsList(ctx context.Context, orgID string) ([]*ent.Integration, error)
}

// WebhooksService is the part of webhooks.Service permissions use.
type WebhooksService interface {
	GetTotal(ctx context.Context, orgID string) (int, error)
}

// PackageOptions are the plan pricing fields the permission checks read.
type PackageOptions struct {
	Channel            int
	PostsPerMonth      int
	TeamMembers        bool
	CommunityFeatures  bool
	FeaturedByGitroom  bool
	AI                 bool
	ImportFromChannels bool
	Webhooks           int
}

// packageOptions reads the permission fields of a plan's pricing.
func packageOptions(tier string) PackageOptions {
	p := subscriptions.Pricing[tier]
	return PackageOptions{Channel: p.Channel, PostsPerMonth: p.PostsPerMonth, TeamMembers: p.TeamMembers,
		CommunityFeatures: p.CommunityFeatures, FeaturedByGitroom: p.FeaturedByGitroom, AI: p.AI,
		ImportFromChannels: p.ImportFromChannels, Webhooks: p.Webhooks}
}

// PermissionsService is the permissions service.
type PermissionsService struct {
	subscriptions SubscriptionService
	posts         PostsService
	integrations  IntegrationService
	webhooks      WebhooksService
}

func NewPermissionsService(subscriptions SubscriptionService, posts PostsService, integrations IntegrationService, webhooks WebhooksService) *PermissionsService {
	return &PermissionsService{subscriptions: subscriptions, posts: posts, integrations: integrations, webhooks: webhooks}
}

// GetPackageOptions returns the org's subscription (nil when none) and its
// package limits; paid tiers report channel -10 so only totalChannels counts.
func (s *PermissionsService) GetPackageOptions(ctx context.Context, orgID string) (*ent.Subscription, PackageOptions, error) {
	subscription, err := s.subscriptions.GetSubscriptionByOrganizationID(ctx, orgID)
	if err != nil {
		return nil, PackageOptions{}, err
	}
	tier := "FREE"
	if os.Getenv("STRIPE_PUBLISHABLE_KEY") == "" {
		tier = "PRO"
	}
	if subscription != nil && subscription.SubscriptionTier != "" {
		tier = string(subscription.SubscriptionTier)
	}
	options := packageOptions(tier)
	if tier != "FREE" {
		options.Channel = -10
	}
	return subscription, options, nil
}

// Check builds the ability for the requested policies.
func (s *PermissionsService) Check(ctx context.Context, orgID string, createdAt time.Time, permission string, requested []AbilityPolicy, refreshChannelID string) (Ability, error) {
	ability := Ability{}
	if len(requested) == 0 || os.Getenv("STRIPE_PUBLISHABLE_KEY") == "" {
		for _, p := range requested {
			ability[p] = true
		}
		return ability, nil
	}

	subscription, options, err := s.GetPackageOptions(ctx, orgID)
	if err != nil {
		return nil, err
	}
	for _, p := range requested {
		section := p.Section
		// check for the amount of channels
		if section == SectionChannel {
			// Refreshing an existing channel doesn't add a new one, so skip the limit check
			// but only if the channel actually belongs to this org
			if refreshChannelID != "" {
				existing, err := s.integrations.GetIntegrationByInternalID(ctx, orgID, refreshChannelID)
				if err != nil {
					return nil, err
				}
				if existing != nil {
					ability[p] = true
					continue
				}
			}

			list, err := s.integrations.GetIntegrationsList(ctx, orgID)
			if err != nil {
				return nil, err
			}
			totalChannels := 0
			for _, i := range list {
				if !i.RefreshNeeded {
					totalChannels++
				}
			}
			subscriptionChannels := 0
			if subscription != nil {
				subscriptionChannels = subscription.TotalChannels
			}
			if (options.Channel != 0 && options.Channel > totalChannels) || subscriptionChannels > totalChannels {
				ability[p] = true
				continue
			}
		}

		if section == SectionWebhooks {
			total, err := s.webhooks.GetTotal(ctx, orgID)
			if err != nil {
				return nil, err
			}
			if total < options.Webhooks {
				// The original app grants create only, whatever action was asked.
				ability[AbilityPolicy{ActionCreate, section}] = true
				continue
			}
		}

		// check for posts per month
		if section == SectionPostsPerMonth {
			from := createdAt
			sub, err := s.subscriptions.GetSubscription(ctx, orgID)
			if err != nil {
				return nil, err
			}
			if sub != nil && !sub.CreatedAt.IsZero() {
				from = sub.CreatedAt
			}
			from = from.UTC()
			now := time.Now().UTC()
			totalMonthPast := absFloor(monthDiff(from, now))
			if totalMonthPast < 0 {
				totalMonthPast = -totalMonthPast
			}
			checkFrom := addMonths(from, totalMonthPast)
			count, err := s.posts.CountPostsFromDay(ctx, orgID, checkFrom)
			if err != nil {
				return nil, err
			}
			if count < options.PostsPerMonth {
				ability[p] = true
				continue
			}
		}

		if section == SectionTeamMembers && options.TeamMembers {
			ability[p] = true
			continue
		}
		if section == SectionAdmin && (permission == "ADMIN" || permission == "SUPERADMIN") {
			ability[p] = true
			continue
		}
		if section == SectionCommunityFeatures && options.CommunityFeatures {
			ability[p] = true
			continue
		}
		if section == SectionFeaturedByGitroom && options.FeaturedByGitroom {
			ability[p] = true
			continue
		}
		if section == SectionAI && options.AI {
			ability[p] = true
			continue
		}
		if section == SectionImportFromChannels && options.ImportFromChannels {
			ability[p] = true
		}
	}
	return ability, nil
}

// CheckPolicies is @CheckPolicies(...) enforced by the global PoliciesGuard.
// Attach it to a route after its auth middleware.
func (s *PermissionsService) CheckPolicies(policies ...AbilityPolicy) httpx.RouteOption {
	return httpx.With(s.policiesGuard(policies))
}

func (s *PermissionsService) policiesGuard(policies []AbilityPolicy) httpx.Middleware {
	return func(c *httpx.Ctx) error {
		path := c.R.URL.Path
		if strings.Contains(path, "/auth") ||
			strings.Contains(path, "/integrations/social-connect") ||
			strings.Contains(path, "/integrations/provider") {
			return nil
		}
		if len(policies) == 0 {
			return nil
		}
		if c.Org == nil {
			return errors.New("PoliciesGuard: request has no organization")
		}
		refresh := ""
		if values := c.R.URL.Query()["refresh"]; len(values) == 1 {
			refresh = values[0]
		}
		ability, err := s.Check(c.R.Context(), c.Org.ID, c.Org.CreatedAt, c.Role(), policies, refresh)
		if err != nil {
			return err
		}
		for _, p := range policies {
			if !ability.Can(p.Action, p.Section) {
				return SubscriptionException(p.Section, p.Action)
			}
		}
		return nil
	}
}

// addMonths is dayjs add(n, 'month'): the day is clamped to the target
// month's length (Jan 31 + 1 month = Feb 28).
func addMonths(t time.Time, n int) time.Time {
	first := time.Date(t.Year(), t.Month()+time.Month(n), 1, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
	last := time.Date(first.Year(), first.Month()+1, 0, 0, 0, 0, 0, t.Location()).Day()
	return time.Date(first.Year(), first.Month(), min(t.Day(), last), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), t.Location())
}

// monthDiff is dayjs Utils.m (moment's monthDiff): dayjs(a).diff(b, 'month')
// before truncation.
func monthDiff(a, b time.Time) float64 {
	if a.Day() < b.Day() {
		return -monthDiff(b, a)
	}
	whole := (b.Year()-a.Year())*12 + int(b.Month()-a.Month())
	anchor := addMonths(a, whole)
	behind := b.Sub(anchor) < 0
	var anchor2 time.Time
	if behind {
		anchor2 = addMonths(a, whole-1)
	} else {
		anchor2 = addMonths(a, whole+1)
	}
	var span time.Duration
	if behind {
		span = anchor.Sub(anchor2)
	} else {
		span = anchor2.Sub(anchor)
	}
	return -(float64(whole) + float64(b.Sub(anchor))/float64(span))
}

// absFloor is dayjs Utils.a: truncation toward zero.
func absFloor(n float64) int {
	return int(n)
}
