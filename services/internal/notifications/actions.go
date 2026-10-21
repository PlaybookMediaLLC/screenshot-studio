package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

type ChannelDecision struct {
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason"`
}

func effectiveSettings(p Policy, pref Preferences, emailAvailable bool, connections []SlackConnection) map[string]map[string]ChannelDecision {
	result := map[string]map[string]ChannelDecision{}
	connected := false
	for _, c := range connections {
		if c.ID == p.SlackConnectionID && c.Health == "CONNECTED" {
			connected = true
		}
	}
	for _, d := range activity.Catalogue {
		decisions := map[string]ChannelDecision{}
		for _, ch := range []string{"in_app", "email", "slack"} {
			reason := ""
			pol, personal := p.Events[d.ID], pref.Events[d.ID]
			switch {
			case !availableChannel(p, ch):
				reason = "This channel is unavailable in this workspace."
			case ch == "slack" && d.Restricted:
				reason = "This activity is private to its recipients."
			case ch == "in_app" && !pol.InApp || ch == "email" && !pol.Email || ch == "slack" && !pol.Slack:
				reason = "Disabled by workspace policy."
			case ch == "in_app" && !personal.InApp || ch == "email" && !personal.Email:
				reason = "Disabled in your preferences."
			case ch == "email" && !emailAvailable:
				reason = "Email delivery is not configured."
			case ch == "slack" && (!connected || p.SlackChannelID == ""):
				reason = "Connect Slack and select an available channel."
			}
			decisions[ch] = ChannelDecision{Enabled: reason == "", Reason: reason}
		}
		result[d.ID] = decisions
	}
	return result
}

// Resolve authorizes a retained notification destination without changing seen state.
func (s *Service) Resolve(ctx context.Context, p Principal, id string) (string, error) {
	if err := s.Authorize(ctx, p, false); err != nil {
		return "", err
	}
	var kind, resourceID string
	err := s.DB.QueryRowContext(ctx, `SELECT resource_type,resource_id FROM platform_notification_inbox WHERE id=$1 AND "organizationId"=$2 AND "userId"=$3`, id, p.OrganizationID, p.UserID).Scan(&kind, &resourceID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", publishing.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	allowed, row, err := s.resource(ctx, p.OrganizationID, p.UserID, kind, resourceID)
	if err != nil {
		return "", err
	}
	if !allowed {
		return "", nil
	}
	return href(kind, resourceID, row), nil
}

// Test queues exactly one explicit test, scoped to the selected channel or current user's email.
func (s *Service) Test(ctx context.Context, p Principal, channel, key string) (string, error) {
	if err := s.Authorize(ctx, p, channel == "slack"); err != nil {
		return "", err
	}
	if (channel != "email" && channel != "slack") || len(key) < 16 || len(key) > 128 {
		return "", ErrInvalid
	}
	pol, err := policy(ctx, s.DB, p.OrganizationID)
	if err != nil {
		return "", err
	}
	if !availableChannel(pol, channel) {
		return "", invalid("this channel is disabled by workspace policy")
	}
	pref, err := preferences(ctx, s.DB, p.OrganizationID, p.UserID)
	if err != nil {
		return "", err
	}
	destination, connection := p.UserID, ""
	if channel == "slack" {
		destination, connection = pol.SlackChannelID, pol.SlackConnectionID
		if _, err = s.ValidateChannel(ctx, p.OrganizationID, connection, destination); err != nil {
			return "", err
		}
	} else if !emailConfigured() {
		return "", ErrUnavailable
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if err = lockSessionMember(ctx, tx, p, channel == "slack"); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "notification-test:"+p.OrganizationID+":"+channel+":"+destination); err != nil {
		return "", err
	}
	idempotency := "notification-test:" + p.UserID + ":" + key
	var existing string
	err = tx.QueryRowContext(ctx, `SELECT d.id FROM platform_notification_delivery d JOIN outbox_event e ON e.id=d.event_id WHERE e."organizationId"=$1 AND e."idempotencyKey"=$2`, p.OrganizationID, idempotency).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	var throttled bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM platform_notification_delivery WHERE "organizationId"=$1 AND channel=$2 AND destination=$3 AND kind='notification.test' AND created_at>now()-interval '1 minute')`, p.OrganizationID, channel, destination).Scan(&throttled)
	if err != nil {
		return "", err
	}
	if throttled {
		return "", ErrRateLimit
	}
	eventID, id := cuid.New(), cuid.New()
	raw, _ := json.Marshal(map[string]any{"actorUserId": p.UserID, "ownerUserId": p.UserID})
	_, err = tx.ExecContext(ctx, `INSERT INTO outbox_event(id,"organizationId",type,"aggregateType","aggregateId",payload,"idempotencyKey",notification_version,notification_fanned) VALUES($1,$2,'activity.notification.test','workspace',$2,$3,$4,1,true)`, eventID, p.OrganizationID, raw, idempotency)
	if err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO platform_notification_delivery(id,"organizationId",event_id,kind,channel,destination,policy_generation,preference_generation,connection_id) VALUES($1,$2,$3,'notification.test',$4,$5,$6,$7,$8)`, id, p.OrganizationID, eventID, channel, destination, pol.Generation, pref.Generation, connection)
	if err != nil {
		return "", err
	}
	if err = audit(ctx, tx, p, "notification.test_requested", id); err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return id, nil
}

// DeliveryStatus permits a member to inspect their own personal delivery, or administrators to inspect workspace delivery.
func (s *Service) DeliveryStatus(ctx context.Context, p Principal, id string) (*Delivery, error) {
	if err := s.Authorize(ctx, p, false); err != nil {
		return nil, err
	}
	admin := s.Authorize(ctx, p, true) == nil
	var d Delivery
	err := s.DB.QueryRowContext(ctx, `SELECT id,"organizationId",event_id,kind,channel,destination,status,failure_code,provider_receipt,attempts,created_at,updated_at FROM platform_notification_delivery WHERE id=$1 AND "organizationId"=$2 AND ($3 OR channel='email' AND destination=$4)`, id, p.OrganizationID, admin, p.UserID).Scan(&d.ID, &d.OrganizationID, &d.EventID, &d.Kind, &d.Channel, &d.Destination, &d.Status, &d.FailureCode, &d.ProviderReceipt, &d.Attempts, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, publishing.ErrNotFound
	}
	return &d, err
}
