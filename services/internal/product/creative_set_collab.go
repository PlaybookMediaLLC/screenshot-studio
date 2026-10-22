package product

import (
	"context"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/platformcreativeset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/collab"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"time"
)

// IssueCreativeSetCollabToken admits a workspace member to presence; revision-checked document writes remain authoritative.
func (c *Configuration) IssueCreativeSetCollabToken(ctx context.Context, actor Actor, id string) (*CollabToken, error) {
	if len(c.collabKey) == 0 {
		return nil, ErrCollabUnavailable
	}
	if !actor.IsSession() {
		return nil, publishing.ErrForbidden
	}
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	owned, err := c.client.PlatformCreativeSet.Query().Where(platformcreativeset.ID(id), platformcreativeset.OrganizationID(actor.OrganizationID)).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if !owned {
		return nil, publishing.ErrNotFound
	}
	access, err := memberAccess(ctx, c.client, actor.OrganizationID, actor.UserID)
	if err != nil {
		return nil, err
	}
	expires := time.Now().Add(collab.TokenTTL)
	token, err := collab.Sign(c.collabKey, collab.Claims{Kind: "creative-set", Access: access, DraftID: id, ExpiresAt: expires.Unix(), OrganizationID: actor.OrganizationID, UserID: actor.UserID, SessionID: actor.SessionID})
	if err != nil {
		return nil, err
	}
	return &CollabToken{Access: access, DocumentName: collab.DocumentNameFor("creative-set", id), ExpiresAt: expires, Token: token}, nil
}
