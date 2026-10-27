package x

import (
	"context"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/autodm"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/socialidentity"
)

// SendDirectMessage is the native transport for a previously claimed Auto-DM.
// It is not registered as a public action. An authorized event processor with a
// durable consent/opt-out ledger must own the claim before calling it. The
// deployment switch is off by default and requires approved messaging/event
// access; the live OAuth grant and identity are independently checked per send.
func (p *Provider) SendDirectMessage(ctx context.Context, in *ent.Integration, recipient, message string) (string, error) {
	if os.Getenv("PLATFORM_X_AUTO_DM_DELIVERY_ENABLED") != "true" {
		return "", autodm.ErrUnavailable
	}
	if in == nil || !socialidentity.XAccountID(recipient) || recipient == in.InternalID || strings.TrimSpace(message) == "" || !utf8.ValidString(message) || utf8.RuneCountInString(message) > 10000 {
		return "", publishRejected("Choose an eligible recipient and a message of at most 10,000 characters.")
	}
	caps, err := publishingLimits(ctx, in.Token, in)
	if err != nil {
		return "", err
	}
	if caps.OAuth1AccessLevel != "read-write-directmessages" {
		return "", publishRejected("Reconnect X with approved Direct Message access before sending.")
	}
	var receipt struct {
		Data struct {
			EventID        string `json:"dm_event_id"`
			ConversationID string `json:"dm_conversation_id"`
		} `json:"data"`
	}
	err = newClient(in.Token).mutationJSON(ctx, v2("dm_conversations/with/"+recipient+"/messages"), map[string]string{"text": message}, &receipt)
	if err != nil {
		if temporalx.FailureType(err) == temporalx.TypeUnknownDelivery {
			return "", temporalx.UnknownDelivery(identifier, "X may have accepted this Direct Message. Reconcile the durable claim before any resend.")
		}
		return "", err
	}
	if !socialidentity.XAccountID(receipt.Data.EventID) || receipt.Data.ConversationID == "" {
		return "", temporalx.UnknownDelivery(identifier, "X returned no valid Direct Message receipt. Automatic retry is disabled.")
	}
	return receipt.Data.EventID, nil
}
