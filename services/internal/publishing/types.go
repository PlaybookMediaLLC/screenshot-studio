package publishing

import (
	"errors"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
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

type PublishJob struct {
	AssetObjectKey  string
	AssetMediaType  string
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
