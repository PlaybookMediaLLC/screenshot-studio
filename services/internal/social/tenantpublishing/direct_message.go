package tenantpublishing

import (
	"context"
	"errors"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/autodm"
	socialent "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
)

// DirectMessageSender binds the Auto-DM transport to a tenant's actual channel
// connection. AccountID is the stable native X ID used for global quotas;
// DestinationID is the workspace-bound integration, never a replacement for it.
// This adapter is deliberately not installed in production until the verified
// event source and opt-out receiver have been authorized and configured.
type DirectMessageSender struct {
	Publisher                                                 *Publisher
	OrganizationID, DestinationID, SecretReference, AccountID string
}

var _ autodm.Sender = DirectMessageSender{}

func (s DirectMessageSender) Send(ctx context.Context, accountID, recipient, message string) (string, error) {
	if s.Publisher == nil || accountID == "" || accountID != s.AccountID {
		return "", autodm.ErrUnavailable
	}
	account, provider, _, err := s.Publisher.account(ctx, s.OrganizationID, s.DestinationID, "x", s.SecretReference, nil)
	if err != nil {
		return "", err
	}
	if account.InternalID != accountID {
		return "", errors.New("Auto-DM account identity changed; reconnect and review the campaign")
	}
	sender, ok := provider.(interface {
		SendDirectMessage(context.Context, *socialent.Integration, string, string) (string, error)
	})
	if !ok {
		return "", autodm.ErrUnavailable
	}
	return sender.SendDirectMessage(ctx, account, recipient, message)
}
