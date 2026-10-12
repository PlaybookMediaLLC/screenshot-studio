package activities

import (
	"encoding/json"
	"math"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/post"
)

func jsDate(t *time.Time) *JSDate {
	if t == nil {
		return nil
	}
	return &JSDate{*t}
}

func timePtr(d *JSDate) *time.Time {
	if d == nil {
		return nil
	}
	return &d.Time
}

// toIntegration is the full Prisma row, token included; nil stays null.
func toIntegration(i *ent.Integration) *Integration {
	if i == nil {
		return nil
	}
	return &Integration{
		ID: i.ID, InternalID: i.InternalID, OrganizationID: i.OrganizationID, Name: i.Name,
		CustomName: i.CustomName, Picture: i.Picture, ProviderIdentifier: i.ProviderIdentifier, Type: i.Type,
		Token: i.Token, Disabled: i.Disabled, TokenExpiration: jsDate(i.TokenExpiration),
		RefreshToken: i.RefreshToken, Profile: i.Profile, DeletedAt: jsDate(i.DeletedAt),
		CreatedAt: JSDate{i.CreatedAt}, UpdatedAt: jsDate(i.UpdatedAt), InBetweenSteps: i.InBetweenSteps,
		RefreshNeeded: i.RefreshNeeded, PostingTimes: i.PostingTimes, CustomInstanceDetails: i.CustomInstanceDetails,
		CustomerID: i.CustomerID, RootInternalID: i.RootInternalID, AdditionalSettings: i.AdditionalSettings,
	}
}

// entIntegration is the row the workflow sent back, as the services and
// providers take it.
func entIntegration(i *Integration) *ent.Integration {
	return &ent.Integration{
		ID: i.ID, InternalID: i.InternalID, OrganizationID: i.OrganizationID, Name: i.Name,
		CustomName: i.CustomName, Picture: i.Picture, ProviderIdentifier: i.ProviderIdentifier, Type: i.Type,
		Token: i.Token, Disabled: i.Disabled, TokenExpiration: timePtr(i.TokenExpiration),
		RefreshToken: i.RefreshToken, Profile: i.Profile, DeletedAt: timePtr(i.DeletedAt),
		CreatedAt: i.CreatedAt.Time, UpdatedAt: timePtr(i.UpdatedAt), InBetweenSteps: i.InBetweenSteps,
		RefreshNeeded: i.RefreshNeeded, PostingTimes: i.PostingTimes, CustomInstanceDetails: i.CustomInstanceDetails,
		CustomerID: i.CustomerID, RootInternalID: i.RootInternalID, AdditionalSettings: i.AdditionalSettings,
	}
}

// toPost converts a Post row; slim drops what slimPost drops.
func toPost(p *ent.Post, slim bool) Post {
	out := Post{
		ID: p.ID, State: string(p.State), PublishDate: JSDate{p.PublishDate}, OrganizationID: p.OrganizationID,
		IntegrationID: p.IntegrationID, Content: p.Content, Delay: p.Delay, Group: p.Group, BatchID: p.BatchID,
		ReleaseID: p.ReleaseID, ReleaseURL: p.ReleaseURL, Settings: p.Settings, Image: p.Image,
		CreationMethod: string(p.CreationMethod), IntervalInDays: p.IntervalInDays,
		Integration: toIntegration(p.Edges.Integration),
	}
	if slim {
		return out
	}
	out.Title, out.Description, out.ParentPostID = p.Title, p.Description, p.ParentPostID
	out.SubmittedForOrderID, out.SubmittedForOrganizationID = p.SubmittedForOrderID, p.SubmittedForOrganizationID
	out.ApprovedSubmitForOrder, out.LastMessageID, out.Error = string(p.ApprovedSubmitForOrder), p.LastMessageID, p.Error
	out.CreatedAt, out.UpdatedAt, out.DeletedAt = &JSDate{p.CreatedAt}, &JSDate{p.UpdatedAt}, jsDate(p.DeletedAt)
	return out
}

// entPost is the post the workflow sent back, as posts.Service takes it.
func entPost(p Post) *ent.Post {
	out := &ent.Post{
		ID: p.ID, State: post.State(p.State), PublishDate: p.PublishDate.Time, OrganizationID: p.OrganizationID,
		IntegrationID: p.IntegrationID, Content: p.Content, Delay: p.Delay, Group: p.Group, BatchID: p.BatchID,
		Title: p.Title, Description: p.Description, ParentPostID: p.ParentPostID, ReleaseID: p.ReleaseID,
		ReleaseURL: p.ReleaseURL, Settings: p.Settings, Image: p.Image,
		SubmittedForOrderID: p.SubmittedForOrderID, SubmittedForOrganizationID: p.SubmittedForOrganizationID,
		ApprovedSubmitForOrder: post.ApprovedSubmitForOrder(p.ApprovedSubmitForOrder),
		CreationMethod:         post.CreationMethod(p.CreationMethod), LastMessageID: p.LastMessageID,
		IntervalInDays: p.IntervalInDays, Error: p.Error, DeletedAt: timePtr(p.DeletedAt),
	}
	if p.CreatedAt != nil {
		out.CreatedAt = p.CreatedAt.Time
	}
	if p.UpdatedAt != nil {
		out.UpdatedAt = p.UpdatedAt.Time
	}
	if p.Integration != nil {
		out.Edges.Integration = entIntegration(p.Integration)
	}
	return out
}

// A genuinely missed occurrence (dead workflow) is only recovered by the
// missing-posts sweep, which runs every hour - so anything later than the
// sweep period plus retry margin is a stale anchor, not a missed publish.
const reanchorGrace = 2 * time.Hour

// reanchorInterval: a repeat post keeps its original anchor publishDate
// forever (updatePost only flips the state, the calendar expands occurrences
// virtually). If the workflow gets that raw past date, any (re)start - an
// accidental edit resetting the state to QUEUE, or a missing-posts sweep poke
// - sleeps 0 and publishes instantly, machine-gunning the channel. Roll the
// returned date forward to the next occurrence on the anchor grid instead, so
// fresh starts wait for the next real occurrence. Only for the initial QUEUE
// run: repeat chain children (postNow) run against a PUBLISHED post and must
// keep publishing immediately. Occurrences missed within the grace window
// still catch up and post.
func reanchorInterval(p Post, now time.Time) Post {
	if p.IntervalInDays == nil || *p.IntervalInDays == 0 || p.State != StateQueue {
		return p
	}

	interval := float64(*p.IntervalInDays) * 24 * 60 * 60 * 1000
	late := float64(now.Sub(p.PublishDate.Time).Milliseconds())
	if late <= float64(reanchorGrace.Milliseconds()) {
		return p
	}

	next := p.PublishDate.UnixMilli() + int64(math.Ceil(late/interval)*interval)
	p.PublishDate = JSDate{time.UnixMilli(next).UTC()}
	return p
}

// jsArg is an optional `any` argument as JavaScript sees it: missing or
// falsy JSON is nil, a JSON string is the string, anything else is its JSON
// text (what JSON.stringify gives back).
func jsArg(raw json.RawMessage) any {
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return nil
	}
	switch t := v.(type) {
	case nil:
		return nil
	case string:
		return t
	case bool:
		if !t {
			return nil
		}
	case float64:
		if t == 0 {
			return nil
		}
	}
	return string(raw)
}
