package product

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/contentdraft"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/platformcreativeset"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/collab"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// Real-time co-editing of content drafts (RFC 037). The backend issues a
// short-lived token per draft, user and access level; the collaboration
// server presents it to authorize a connection and on every load and store
// of the Yjs state. The collaboration server never reads the database.

// collabStateLimit bounds one stored Yjs document state.
const collabStateLimit = 5 << 20

// WithCollabKey sets the key that signs collaboration tokens. Without one,
// collaboration is unavailable.
func (c *Configuration) WithCollabKey(key []byte) *Configuration {
	c.collabKey = key
	return c
}

// CollabToken admits the browser to one draft's document.
type CollabToken struct {
	Access       collab.Access `json:"access"`
	DocumentName string        `json:"documentName"`
	ExpiresAt    time.Time     `json:"expiresAt"`
	Token        string        `json:"token"`
}

// CollabGrant is who a connection is and what it may do, for the
// collaboration server.
type CollabGrant struct {
	Kind           string        `json:"kind,omitempty"`
	Access         collab.Access `json:"access"`
	DraftID        string        `json:"draftId"`
	OrganizationID string        `json:"organizationId"`
	User           struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"user"`
}

// ErrCollabUnavailable means the backend has no collaboration signing key.
var ErrCollabUnavailable = errors.New("collaboration is not configured")

// memberAccess is what a workspace member's current role allows, or an error
// when they are no longer a member.
func memberAccess(ctx context.Context, client *ent.Client, organizationID, userID string) (collab.Access, error) {
	row, err := client.Member.Query().Where(member.OrganizationID(organizationID), member.UserID(userID)).Only(ctx)
	if ent.IsNotFound(err) || ent.IsNotSingular(err) {
		return "", publishing.ErrForbidden
	}
	if err != nil {
		return "", err
	}
	if slices.Contains(contentDraftEditRoles, row.Role) {
		return collab.AccessWrite, nil
	}
	return collab.AccessRead, nil
}

// IssueContentDraftCollabToken gives the signed-in member a token for one
// draft: read-write with artifact:edit, read-only otherwise.
func (c *Configuration) IssueContentDraftCollabToken(ctx context.Context, actor Actor, draftID string) (*CollabToken, error) {
	if len(c.collabKey) == 0 {
		return nil, ErrCollabUnavailable
	}
	if !actor.IsSession() {
		return nil, publishing.ErrForbidden
	}
	if err := c.authorizeContentDrafts(ctx, actor, false); err != nil {
		return nil, err
	}
	if _, err := visibleContentDraft(ctx, c.client, actor, draftID); err != nil {
		return nil, err
	}
	access, err := memberAccess(ctx, c.client, actor.OrganizationID, actor.UserID)
	if err != nil {
		return nil, err
	}
	expires := time.Now().Add(collab.TokenTTL)
	token, err := collab.Sign(c.collabKey, collab.Claims{Access: access, DraftID: draftID, ExpiresAt: expires.Unix(),
		OrganizationID: actor.OrganizationID, UserID: actor.UserID})
	if err != nil {
		return nil, err
	}
	return &CollabToken{Access: access, DocumentName: collab.DocumentName(draftID), ExpiresAt: expires, Token: token}, nil
}

// collabClaims verifies a token for draftID (or for documentName when
// draftID is empty), and that the draft is still the workspace's.
func (c *Configuration) collabClaims(ctx context.Context, token, documentName, draftID string, grace time.Duration) (collab.Claims, error) {
	if len(c.collabKey) == 0 {
		return collab.Claims{}, ErrCollabUnavailable
	}
	claims, err := collab.Verify(c.collabKey, token, time.Now(), grace)
	if err != nil {
		return collab.Claims{}, publishing.ErrUnauthorized
	}
	if (documentName != "" && documentName != collab.DocumentNameFor(claims.Kind, claims.DraftID)) || (draftID != "" && draftID != claims.DraftID) {
		return collab.Claims{}, publishing.ErrForbidden
	}
	var owned bool
	if claims.Kind == "creative-set" {
		owned, err = c.client.PlatformCreativeSet.Query().Where(platformcreativeset.ID(claims.DraftID), platformcreativeset.OrganizationID(claims.OrganizationID)).Exist(ctx)
	} else {
		// The draft must still be one the token's person may see: a private
		// set's draft closes to everyone else even mid-session.
		_, err = visibleContentDraft(ctx, c.client, Actor{OrganizationID: claims.OrganizationID, UserID: claims.UserID, Kind: "session"}, claims.DraftID)
		owned = err == nil
		if errors.Is(err, publishing.ErrNotFound) {
			err = nil
		}
	}
	if err != nil {
		return collab.Claims{}, err
	}
	if !owned {
		return collab.Claims{}, publishing.ErrNotFound
	}
	current, err := memberAccess(ctx, c.client, claims.OrganizationID, claims.UserID)
	if err != nil {
		return collab.Claims{}, err
	}
	if current != collab.AccessWrite {
		claims.Access = collab.AccessRead
	}
	return claims, nil
}

// AuthorizeCollab admits a connection to documentName: the token must be
// current, for that document, and its user still a member. A demoted member
// is admitted read-only.
func (c *Configuration) AuthorizeCollab(ctx context.Context, token, documentName string) (*CollabGrant, error) {
	claims, err := c.collabClaims(ctx, token, documentName, "", 0)
	if err != nil {
		return nil, err
	}
	access, err := memberAccess(ctx, c.client, claims.OrganizationID, claims.UserID)
	if err != nil {
		return nil, err
	}
	if claims.Access == collab.AccessRead {
		access = collab.AccessRead
	}
	person, err := c.client.User.Query().Where(user.ID(claims.UserID)).Only(ctx)
	if err != nil {
		return nil, err
	}
	grant := &CollabGrant{Kind: claims.Kind, Access: access, DraftID: claims.DraftID, OrganizationID: claims.OrganizationID}
	grant.User.ID, grant.User.Name = person.ID, person.Name
	return grant, nil
}

// LoadCollabState returns the draft's stored Yjs state, or nil before the
// first store.
func (c *Configuration) LoadCollabState(ctx context.Context, token, draftID string) ([]byte, error) {
	claims, err := c.collabClaims(ctx, token, "", draftID, collab.StoreGrace)
	if err != nil {
		return nil, err
	}
	if claims.Kind == "creative-set" {
		return nil, publishing.ErrForbidden
	}
	row, err := c.client.ContentDraft.Query().Where(contentdraft.ID(draftID),
		contentdraft.OrganizationID(claims.OrganizationID)).Only(ctx)
	if err != nil {
		return nil, err
	}
	if row.CollabState == nil {
		return nil, nil
	}
	return *row.CollabState, nil
}

// StoreCollabState saves the draft's Yjs state on behalf of a read-write
// connection. The Plate body is saved separately by the editor's autosave.
func (c *Configuration) StoreCollabState(ctx context.Context, token, draftID string, state []byte) error {
	claims, err := c.collabClaims(ctx, token, "", draftID, collab.StoreGrace)
	if err != nil {
		return err
	}
	if claims.Access != collab.AccessWrite || claims.Kind == "creative-set" {
		return publishing.ErrForbidden
	}
	if len(state) == 0 || len(state) > collabStateLimit {
		return invalid("The collaboration state is empty or too large.")
	}
	return c.client.ContentDraft.Update().Where(contentdraft.ID(draftID),
		contentdraft.OrganizationID(claims.OrganizationID)).SetCollabState(state).Exec(ctx)
}
