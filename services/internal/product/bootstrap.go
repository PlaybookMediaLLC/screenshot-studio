package product

import (
	"context"
	"os"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/campaignpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/scheduledpost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/workspaceentitlement"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

var bootstrapFeatures = []string{
	"asset:create", "asset:read", "asset:update", "asset:delete", "release:create", "source-app:create",
	"workspace:use", "enterprise:audit-drain", "enterprise:sso", "enterprise:scim", "campaign:workflow",
}

type BootstrapSnapshot struct {
	User struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Email string `json:"email"`
	} `json:"user"`
	Organization struct {
		ID   string  `json:"id"`
		Logo *string `json:"logo"`
		Name string  `json:"name"`
		Slug string  `json:"slug"`
	} `json:"organization"`
	Organizations []ListedWorkspace `json:"organizations"`
	Role          string            `json:"role"`
	Settings      *struct {
		Locale             string `json:"locale"`
		TimeZone           string `json:"timeZone"`
		DefaultPublishTime string `json:"defaultPublishTime"`
	} `json:"settings"`
	Entitlements struct {
		Features map[string]bool `json:"features"`
		Plan     string          `json:"plan"`
		Status   string          `json:"status"`
	} `json:"entitlements"`
	Capabilities struct {
		BrowserAutomation bool `json:"browserAutomation"`
		EngineeringAgent  bool `json:"engineeringAgent"`
		Publishing        bool `json:"publishing"`
		VoiceCapture      bool `json:"voiceCapture"`
		Workflows         bool `json:"workflows"`
	} `json:"capabilities"`
	Counters struct {
		Approvals int `json:"approvals"`
		Attention int `json:"attention"`
	} `json:"counters"`
}

type CurrentUser struct {
	ID    string  `json:"id"`
	Email string  `json:"email"`
	Image *string `json:"image"`
	Name  string  `json:"name"`
}

func (c *Configuration) GetCurrentUser(ctx context.Context, actor Actor) (*CurrentUser, error) {
	if err := c.AuthorizeSession(ctx, actor); err != nil {
		return nil, err
	}
	person, err := c.client.User.Get(ctx, actor.UserID)
	if err != nil {
		return nil, err
	}
	return &CurrentUser{ID: person.ID, Email: person.Email, Image: person.Image, Name: person.Name}, nil
}

func (c *Configuration) Bootstrap(ctx context.Context, actor Actor) (*BootstrapSnapshot, error) {
	person, err := c.client.User.Get(ctx, actor.UserID)
	if err != nil {
		return nil, err
	}
	org, err := c.GetWorkspace(ctx, actor.OrganizationID)
	if err != nil {
		return nil, err
	}
	if org == nil {
		return nil, publishing.ErrNotFound
	}
	membership, err := c.client.Member.Query().Where(member.OrganizationID(actor.OrganizationID), member.UserID(actor.UserID)).Only(ctx)
	if err != nil {
		return nil, err
	}
	organizations, err := c.ListWorkspaces(ctx, actor)
	if err != nil {
		return nil, err
	}
	channels, err := c.client.ChannelConnection.Query().Where(channelconnection.OrganizationID(actor.OrganizationID),
		channelconnection.StatusEQ(channelconnection.StatusACTIVE)).Count(ctx)
	if err != nil {
		return nil, err
	}
	approvals, err := c.client.CampaignPost.Query().Where(campaignpost.OrganizationID(actor.OrganizationID),
		campaignpost.StatusEQ(campaignpost.StatusREADY_FOR_REVIEW)).Count(ctx)
	if err != nil {
		return nil, err
	}
	attention, err := c.client.ScheduledPost.Query().Where(scheduledpost.OrganizationID(actor.OrganizationID),
		scheduledpost.StatusEQ(scheduledpost.StatusFAILED)).Count(ctx)
	if err != nil {
		return nil, err
	}
	entitlement, err := c.client.WorkspaceEntitlement.Query().Where(workspaceentitlement.ID(actor.OrganizationID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	result := &BootstrapSnapshot{Organizations: organizations}
	result.User.ID, result.User.Email, result.User.Name = person.ID, person.Email, person.Name
	result.Organization.ID, result.Organization.Logo = org.ID, org.Logo
	result.Organization.Name, result.Organization.Slug = org.Name, org.Slug
	result.Role = membership.Role
	if result.Role == "member" {
		result.Role = "viewer"
	}
	if org.WorkspaceSettings != nil {
		result.Settings = &struct {
			Locale             string `json:"locale"`
			TimeZone           string `json:"timeZone"`
			DefaultPublishTime string `json:"defaultPublishTime"`
		}{org.WorkspaceSettings.Locale, org.WorkspaceSettings.TimeZone, org.WorkspaceSettings.DefaultPublishTime}
	}
	result.Entitlements.Plan, result.Entitlements.Status, result.Entitlements.Features = evaluateBootstrapEntitlement(entitlement, time.Now().UTC())
	result.Capabilities.Publishing = channels > 0
	result.Counters.Approvals, result.Counters.Attention = approvals, attention
	return result, nil
}

func evaluateBootstrapEntitlement(entitlement *ent.WorkspaceEntitlement, now time.Time) (string, string, map[string]bool) {
	plan, status := "free", "active"
	active := true
	var overrides map[string]any
	if entitlement != nil {
		status = entitlement.Status
		switch entitlement.Plan {
		case "free", "pro", "business", "enterprise":
			plan = entitlement.Plan
		}
		overrides = entitlement.FeatureOverrides
		active = (status == "active" || status == "trialing" ||
			(status == "past_due" && entitlement.GraceUntil != nil && entitlement.GraceUntil.After(now))) &&
			(entitlement.ValidUntil == nil || entitlement.ValidUntil.After(now))
	}
	features := make(map[string]bool, len(bootstrapFeatures))
	for _, feature := range bootstrapFeatures {
		allowed := false
		switch feature {
		// There is no free plan: "free" is a workspace without a subscription,
		// and it gets nothing until it pays.
		case "asset:create", "asset:read", "asset:update", "asset:delete",
			"release:create", "source-app:create", "workspace:use", "campaign:workflow":
			allowed = plan != "free"
		case "enterprise:audit-drain", "enterprise:sso", "enterprise:scim":
			allowed = plan == "enterprise"
		}
		if override, ok := overrides[feature].(bool); ok {
			allowed = override
		}
		features[feature] = active && allowed
	}
	if os.Getenv("PLATFORM_CAMPAIGN_WORKFLOW") == "enabled" {
		features["campaign:workflow"] = true
	}
	return plan, status, features
}
