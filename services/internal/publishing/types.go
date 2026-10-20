package publishing

import (
	"errors"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postoptions"
)

var (
	ErrUnauthorized = errors.New("publishing session is invalid or expired")
	ErrForbidden    = errors.New("publishing permission is denied")
	ErrConflict     = errors.New("publishing resource already exists")
	ErrInvalidState = errors.New("publishing resource is in an invalid state")
	ErrNotFound     = errors.New("publishing resource was not found")
	ErrNotEligible  = errors.New("creative variant is not approved for publishing")
)

type Actor struct {
	Display      string
	Organization string
	RequestID    string
	Type         string
	UserID       string
}

type CreateConnectionInput struct {
	ExternalAccountID string
	Platform          string
	ProviderSettings  map[string]any
	SecretReference   string
	// SocialSetID is the set the account joins; nil is the default set.
	SocialSetID *string
}

type CreateScheduledPostInput struct {
	Caption             string
	ChannelConnectionID string
	IdempotencyKey      string
	ScheduledFor        time.Time
	// Exactly one of VariantID and ContentDraftID is set.
	VariantID      string
	ContentDraftID string
}

type CreateScheduledPostResult struct {
	Created bool
	Post    *ent.ScheduledPost
}

// MediaAsset is one stored file a post publishes.
type MediaAsset struct {
	MediaType string
	ObjectKey string
	// Alt describes an image (RFC 042); jobs recorded before it have none.
	Alt string `json:",omitempty"`
}

// PublishReply is a thread reply to publish after the post: its text and files.
type PublishReply struct {
	Assets  []MediaAsset
	Caption string
	// Options are the reply's own settings (RFC 042); replies from before
	// them have none.
	Options *postoptions.PublishOptions `json:",omitempty"`
}

type PublishJob struct {
	// AssetObjectKey and AssetMediaType are Assets[0], for callers that take one.
	AssetObjectKey string
	AssetMediaType string
	Assets         []MediaAsset
	// Replies follow the post as a thread, each answering the one before.
	Replies []PublishReply
	// ReplyTo is the live post a resumed thread answers; empty for a new post.
	ReplyTo     string
	AutoActions postoptions.AutoActions
	Poll        postoptions.Poll
	// Options are the first post's settings beyond its text (RFC 042).
	Options postoptions.PublishOptions
	// Document is a LinkedIn PDF posted as a document carousel; Cover is an
	// X article's cover image.
	Document        *MediaAsset
	Cover           *MediaAsset
	Connection      *ent.ChannelConnection
	Post            *ent.ScheduledPost
	WorkspaceActive bool
}

type Attempt struct {
	ID     string
	Number int
}

type RecoverablePost struct {
	ID             string
	OrganizationID string
	ScheduledFor   time.Time
}

// AutomationReceipt is a live post's follow-up to record (RFC 042): its
// key, its kind and when it is first due.
type AutomationReceipt struct {
	DueAt time.Time
	Key   string
	Kind  string
}
