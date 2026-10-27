package autodm

import (
	"context"
	"fmt"
	"time"
)

// Authorization comes from current provider/account access, not draft fields.
// Event access includes a working opt-out receiver. Expiration fails closed.
type Authorization struct {
	OrganizationID, AccountID         string
	Messaging, Events, OptOutReceiver bool
	ExpiresAt                         time.Time
	Limits                            Limits
}

func (a Authorization) permits(c Campaign, now time.Time) bool {
	return a.OrganizationID == c.OrganizationID && a.AccountID == c.AccountID && a.Messaging && a.Events && a.OptOutReceiver && now.Before(a.ExpiresAt) && validLimits(a.Limits)
}

// VerifiedEvent is an authenticated provider observation. The verifier must
// resolve actions and explicit consent for the specific immutable offer; a
// repost, follow, guessed user ID or keyword alone never establishes consent.
type VerifiedEvent struct {
	EvidenceID string
	AccountID  string
	CampaignID string
	Kind       string // consent, opt_out, or source_removed
	Recipient  Recipient
	ObservedAt time.Time
}

// EventVerifier validates source authentication and account ownership before
// resolving an event. It must reject forged, stale, unrelated or incomplete
// observations. No production implementation is installed without API approval.
type EventVerifier interface {
	Verify(context.Context, Campaign, []byte) (VerifiedEvent, error)
}
type Authorizer interface {
	Authorize(context.Context, Campaign) (Authorization, error)
}

// EventProcessor is the production integration boundary. All dependencies must
// be installed explicitly; there is no default event source or automatic enable.
// Stop events are recorded even when the current send grant is revoked.
type EventProcessor struct {
	Ledger     SQLLedger
	Verifier   EventVerifier
	Authorizer Authorizer
	Sender     Sender
	Now        func() time.Time
}

func (p EventProcessor) Handle(ctx context.Context, c Campaign, payload []byte) error {
	if p.Verifier == nil || p.Authorizer == nil || p.Sender == nil || p.Ledger.DB == nil {
		return ErrUnavailable
	}
	now := time.Now().UTC()
	if p.Now != nil {
		now = p.Now().UTC()
	}
	event, err := p.Verifier.Verify(ctx, c, payload)
	if err != nil {
		return err
	}
	if event.EvidenceID == "" || event.AccountID != c.AccountID || event.ObservedAt.IsZero() || event.ObservedAt.After(now) {
		return fmt.Errorf("unverified or unrelated Auto-DM event")
	}
	if event.Kind == "opt_out" {
		return p.Ledger.OptOut(ctx, c.AccountID, event.Recipient.ID, event.EvidenceID, event.ObservedAt)
	}
	if event.CampaignID != c.ID {
		return fmt.Errorf("event does not belong to this campaign")
	}
	if event.Kind == "source_removed" {
		return p.Ledger.Stop(ctx, c.OrganizationID, c.AccountID, c.ID, true)
	}
	if event.Kind != "consent" || event.Recipient.ConsentEvidenceID != event.EvidenceID || event.Recipient.ConsentPostID != c.PostID {
		return fmt.Errorf("explicit consent for this offer is required")
	}
	grant, err := p.Authorizer.Authorize(ctx, c)
	if err != nil {
		return err
	}
	if !grant.permits(c, now) {
		return ErrUnavailable
	}
	if err = p.Ledger.RecordRecipient(ctx, c, event.Recipient, event.ObservedAt); err != nil {
		return err
	}
	return Deliver(ctx, c, event.Recipient, now, true, grant.Limits, p.Ledger, p.Sender)
}
