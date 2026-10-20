package publishing

import (
	"context"
	"errors"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/channelconnection"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/socialset"
)

// ErrSocialSetSlotTaken refuses a second active account of one platform in a
// social set (RFC 043).
var ErrSocialSetSlotTaken = errors.New("this social set already has an account on that platform; remove it first")

// ErrAccountInAnotherSet refuses connecting an account that is already
// active in a different social set of the workspace.
var ErrAccountInAnotherSet = errors.New("this account is already in another social set of the workspace")

// targetSocialSet picks the set a new or reconnected account joins: the one
// the connection started from, or else the workspace's default set when it
// has no account on that platform yet. An account that fits nowhere stays in
// no set until someone adds it to one.
func targetSocialSet(ctx context.Context, tx *ent.Tx, organizationID, platform string, requested *string) (*string, error) {
	if requested != nil {
		set, err := tx.SocialSet.Query().Where(socialset.ID(*requested), socialset.OrganizationID(organizationID),
			socialset.DeletedAtIsNil()).Only(ctx)
		if ent.IsNotFound(err) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		taken, err := platformTaken(ctx, tx, set.ID, platform)
		if err != nil {
			return nil, err
		}
		if taken {
			return nil, ErrSocialSetSlotTaken
		}
		return &set.ID, nil
	}
	set, err := tx.SocialSet.Query().Where(socialset.OrganizationID(organizationID), socialset.DeletedAtIsNil(),
		socialset.VisibilityEQ(socialset.VisibilityWORKSPACE)).
		Order(ent.Asc(socialset.FieldCreatedAt), ent.Asc(socialset.FieldID)).First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	taken, err := platformTaken(ctx, tx, set.ID, platform)
	if err != nil || taken {
		return nil, err
	}
	return &set.ID, nil
}

func platformTaken(ctx context.Context, tx *ent.Tx, setID, platform string) (bool, error) {
	return tx.ChannelConnection.Query().Where(channelconnection.SocialSetID(setID), channelconnection.Platform(platform),
		channelconnection.StatusEQ(channelconnection.StatusACTIVE)).Exist(ctx)
}

// enableDefaultPlatform makes a newly connected platform one of the set's
// new-draft defaults, and its primary when it has none.
func enableDefaultPlatform(ctx context.Context, tx *ent.Tx, setID *string, platform string) error {
	if setID == nil {
		return nil
	}
	set, err := tx.SocialSet.Get(ctx, *setID)
	if err != nil {
		return err
	}
	for _, existing := range set.DefaultPlatforms {
		if existing == platform {
			return nil
		}
	}
	update := tx.SocialSet.UpdateOneID(set.ID).SetDefaultPlatforms(append(append([]string{}, set.DefaultPlatforms...), platform)).AddVersion(1)
	if set.PrimaryPlatform == nil {
		update.SetPrimaryPlatform(platform)
	}
	_, err = update.Save(ctx)
	return err
}
