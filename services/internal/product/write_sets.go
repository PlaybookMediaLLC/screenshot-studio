package product

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraft"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/predicate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// Write (RFC 025) on the settings platform's social sets (RFC 024): a draft
// belongs to a set the actor may see; drafts written before sets belong to
// the workspace's default set.

// memberRole is the user's role in the workspace, or ErrForbidden.
func memberRole(ctx context.Context, client *ent.Client, organizationID, userID string) (string, error) {
	row, err := client.Member.Query().Where(member.OrganizationID(organizationID), member.UserID(userID)).Only(ctx)
	if ent.IsNotFound(err) || ent.IsNotSingular(err) {
		return "", publishing.ErrForbidden
	}
	if err != nil {
		return "", err
	}
	return row.Role, nil
}

// writeSet is the set a Write operation names, or the workspace's default
// set when it names none; a set the actor may not see is not found.
func (c *Configuration) writeSet(ctx context.Context, actor Actor, setID string) (*ent.SocialSet, error) {
	if setID != "" {
		return visibleSocialSet(ctx, c.client, actor, setID)
	}
	set, err := c.defaultSocialSet(ctx, actor.OrganizationID)
	if err != nil {
		return nil, err
	}
	if !socialSetVisible(set, actor) {
		return nil, notFound("Social set not found.")
	}
	return set, nil
}

// draftWriteSet is the set a draft belongs to: its own, or the default set
// for a draft from before sets.
func (c *Configuration) draftWriteSet(ctx context.Context, client *ent.Client, draft *ent.ContentDraft) (*ent.SocialSet, error) {
	if draft.SocialSetID == nil {
		return c.defaultSocialSet(ctx, draft.OrganizationID)
	}
	return client.SocialSet.Get(ctx, *draft.SocialSetID)
}

// draftSetFilter keeps one visible set's drafts, with the drafts from
// before sets when it is the default set.
func (c *Configuration) draftSetFilter(ctx context.Context, actor Actor, setID string) (predicate.ContentDraft, error) {
	set, err := visibleSocialSet(ctx, c.client, actor, setID)
	if err != nil {
		return nil, err
	}
	fallback, err := c.defaultSocialSet(ctx, actor.OrganizationID)
	if err != nil {
		return nil, err
	}
	if fallback.ID == set.ID {
		return contentdraft.Or(contentdraft.SocialSetID(set.ID), contentdraft.SocialSetIDIsNil()), nil
	}
	return contentdraft.SocialSetID(set.ID), nil
}

// setAccount is a set's active account on a platform, if it has one.
func setAccount(ctx context.Context, client *ent.Client, set *ent.SocialSet, platform string) (*ent.ChannelConnection, error) {
	platforms := []string{platform}
	if platform == "linkedin" {
		platforms = append(platforms, "linkedin-page")
	}
	return client.ChannelConnection.Query().Where(channelconnection.OrganizationID(set.OrganizationID),
		channelconnection.SocialSetID(set.ID), channelconnection.PlatformIn(platforms...),
		channelconnection.StatusEQ(channelconnection.StatusACTIVE)).First(ctx)
}
