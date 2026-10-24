package product

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/webhookdelivery"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/webhookdeliveryattempt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/webhooksubscription"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/webhooks"
	"github.com/lucsky/cuid"
)

// Outbound webhooks (RFC 043) are managed by a workspace's owners and admins.
// A signing secret is returned once, when it is made; afterwards the API
// only ever says that one exists.

const (
	webhookLimit          = 20
	webhookSecretOverlap  = 24 * time.Hour
	webhookDeliveryWindow = 100
)

// ErrWebhooksUnavailable means the server has no webhook encryption key.
var ErrWebhooksUnavailable = webhooks.ErrUnavailable

// WebhookRecord is a subscription as the API returns it, without its secret.
type WebhookRecord struct {
	CreatedAt     time.Time  `json:"createdAt"`
	Enabled       bool       `json:"enabled"`
	Events        []string   `json:"events"`
	ID            string     `json:"id"`
	LastFailureAt *time.Time `json:"lastFailureAt"`
	LastSuccessAt *time.Time `json:"lastSuccessAt"`
	Name          string     `json:"name"`
	// PreviousSecretExpiresAt is set while a rotated-out secret still signs.
	PreviousSecretExpiresAt *time.Time `json:"previousSecretExpiresAt"`
	UpdatedAt               time.Time  `json:"updatedAt"`
	URL                     string     `json:"url"`
}

// WebhookWithSecret is a subscription just made or rotated, with its secret.
type WebhookWithSecret struct {
	Secret  string        `json:"secret"`
	Webhook WebhookRecord `json:"webhook"`
}

// WebhookInput creates a subscription.
type WebhookInput struct {
	Events []string `json:"events"`
	Name   string   `json:"name"`
	URL    string   `json:"url"`
}

// WebhookUpdate changes the fields it sets.
type WebhookUpdate struct {
	Enabled *bool     `json:"enabled"`
	Events  *[]string `json:"events"`
	Name    *string   `json:"name"`
	URL     *string   `json:"url"`
}

// WebhookAttemptRecord is one try at a delivery.
type WebhookAttemptRecord struct {
	AttemptNumber  int       `json:"attemptNumber"`
	DurationMs     int       `json:"durationMs"`
	ErrorClass     *string   `json:"errorClass"`
	Outcome        string    `json:"outcome"`
	ResponseStatus *int      `json:"responseStatus"`
	StartedAt      time.Time `json:"startedAt"`
}

// WebhookDeliveryRecord is one event owed to a subscription and its history.
type WebhookDeliveryRecord struct {
	Attempts       int                    `json:"attempts"`
	CreatedAt      time.Time              `json:"createdAt"`
	ErrorClass     *string                `json:"errorClass"`
	EventID        string                 `json:"eventId"`
	EventType      string                 `json:"eventType"`
	History        []WebhookAttemptRecord `json:"history"`
	ID             string                 `json:"id"`
	LastAttemptAt  *time.Time             `json:"lastAttemptAt"`
	Manual         bool                   `json:"manual"`
	NextAttemptAt  *time.Time             `json:"nextAttemptAt"`
	ResponseStatus *int                   `json:"responseStatus"`
	Status         string                 `json:"status"`
}

// WithWebhooks sets the key that seals webhook secrets and the resolver that
// checks destinations. Without a key, outbound webhooks are unavailable.
func (c *Configuration) WithWebhooks(key []byte, resolver webhooks.Resolver) *Configuration {
	c.webhookKey = key
	c.webhookResolver = resolver
	return c
}

func (c *Configuration) authorizeWebhooks(ctx context.Context, actor Actor) error {
	if err := c.authorizeDecision(ctx, actor, "owner", "admin"); err != nil {
		return err
	}
	return c.requireWorkspaceFeature(ctx, actor.OrganizationID, "workspace:paid")
}

func webhookRecord(row *ent.WebhookSubscription) WebhookRecord {
	return WebhookRecord{CreatedAt: row.CreatedAt, Enabled: row.Enabled, Events: nonNilStrings(row.Events), ID: row.ID,
		LastFailureAt: row.LastFailureAt, LastSuccessAt: row.LastSuccessAt, Name: row.Name,
		PreviousSecretExpiresAt: row.PreviousSecretExpiresAt, UpdatedAt: row.UpdatedAt, URL: row.URL}
}

func webhookName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return "", invalid("Name the webhook with 1 to 80 characters.")
	}
	return name, nil
}

func webhookEvents(events []string) ([]string, error) {
	seen := map[string]bool{}
	out := []string{}
	for _, event := range events {
		if !webhooks.KnownEvent(event) {
			return nil, invalid("There is no webhook event called " + event + ".")
		}
		if !seen[event] {
			seen[event] = true
			out = append(out, event)
		}
	}
	if len(out) == 0 {
		return nil, invalid("Pick at least one event.")
	}
	return out, nil
}

func (c *Configuration) webhookURL(ctx context.Context, raw string) (string, error) {
	resolver := c.webhookResolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	checked, err := webhooks.ValidateEndpoint(ctx, resolver, raw)
	if err != nil {
		return "", invalid(err.Error())
	}
	return checked, nil
}

// ListWebhooks lists the workspace's subscriptions, newest first.
func (c *Configuration) ListWebhooks(ctx context.Context, actor Actor) ([]WebhookRecord, error) {
	if err := c.authorizeWebhooks(ctx, actor); err != nil {
		return nil, err
	}
	rows, err := c.client.WebhookSubscription.Query().Where(webhooksubscription.OrganizationID(actor.OrganizationID)).
		Order(ent.Desc(webhooksubscription.FieldCreatedAt)).All(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]WebhookRecord, 0, len(rows))
	for _, row := range rows {
		items = append(items, webhookRecord(row))
	}
	return items, nil
}

// CreateWebhook subscribes an endpoint and returns its secret, this once.
func (c *Configuration) CreateWebhook(ctx context.Context, actor Actor, input WebhookInput) (*WebhookWithSecret, error) {
	if err := c.authorizeWebhooks(ctx, actor); err != nil {
		return nil, err
	}
	if len(c.webhookKey) != 32 {
		return nil, ErrWebhooksUnavailable
	}
	name, err := webhookName(input.Name)
	if err != nil {
		return nil, err
	}
	events, err := webhookEvents(input.Events)
	if err != nil {
		return nil, err
	}
	endpoint, err := c.webhookURL(ctx, input.URL)
	if err != nil {
		return nil, err
	}
	count, err := c.client.WebhookSubscription.Query().Where(webhooksubscription.OrganizationID(actor.OrganizationID)).Count(ctx)
	if err != nil {
		return nil, err
	}
	if count >= webhookLimit {
		return nil, conflict("A workspace can have at most 20 webhooks. Delete one first.")
	}
	secret, err := webhooks.NewSecret()
	if err != nil {
		return nil, err
	}
	sealed, err := webhooks.Seal(c.webhookKey, secret)
	if err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := tx.WebhookSubscription.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).SetName(name).
		SetURL(endpoint).SetEvents(events).SetEncryptedSecret(sealed).SetCreatedByUserID(actor.UserID).Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.webhook_created", "webhook_subscription", row.ID,
		map[string]any{"events": events}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &WebhookWithSecret{Secret: secret, Webhook: webhookRecord(row.Unwrap())}, nil
}

func (c *Configuration) ownedWebhook(ctx context.Context, client *ent.Client, actor Actor, id string) (*ent.WebhookSubscription, error) {
	row, err := client.WebhookSubscription.Query().Where(webhooksubscription.ID(id), webhooksubscription.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, notFound("Webhook not found.")
	}
	return row, err
}

// UpdateWebhook changes a subscription's name, URL, events or switch.
func (c *Configuration) UpdateWebhook(ctx context.Context, actor Actor, id string, input WebhookUpdate) (*WebhookRecord, error) {
	if err := c.authorizeWebhooks(ctx, actor); err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := c.ownedWebhook(ctx, tx.Client(), actor, id)
	if err != nil {
		return nil, err
	}
	update := tx.WebhookSubscription.UpdateOneID(row.ID)
	changed := []string{}
	if input.Name != nil {
		name, err := webhookName(*input.Name)
		if err != nil {
			return nil, err
		}
		update.SetName(name)
		changed = append(changed, "name")
	}
	if input.URL != nil {
		endpoint, err := c.webhookURL(ctx, *input.URL)
		if err != nil {
			return nil, err
		}
		update.SetURL(endpoint)
		changed = append(changed, "url")
	}
	if input.Events != nil {
		events, err := webhookEvents(*input.Events)
		if err != nil {
			return nil, err
		}
		update.SetEvents(events)
		changed = append(changed, "events")
	}
	if input.Enabled != nil {
		update.SetEnabled(*input.Enabled)
		changed = append(changed, "enabled")
	}
	saved, err := update.Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.webhook_updated", "webhook_subscription", row.ID,
		map[string]any{"fields": changed}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	record := webhookRecord(saved)
	return &record, nil
}

// RotateWebhookSecret issues a new secret, returned this once. The previous
// secret keeps signing for 24 hours beside it, so a receiver can switch over.
func (c *Configuration) RotateWebhookSecret(ctx context.Context, actor Actor, id string) (*WebhookWithSecret, error) {
	if err := c.authorizeWebhooks(ctx, actor); err != nil {
		return nil, err
	}
	if len(c.webhookKey) != 32 {
		return nil, ErrWebhooksUnavailable
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := c.ownedWebhook(ctx, tx.Client(), actor, id)
	if err != nil {
		return nil, err
	}
	secret, err := webhooks.NewSecret()
	if err != nil {
		return nil, err
	}
	sealed, err := webhooks.Seal(c.webhookKey, secret)
	if err != nil {
		return nil, err
	}
	saved, err := tx.WebhookSubscription.UpdateOneID(row.ID).SetEncryptedSecret(sealed).
		SetPreviousEncryptedSecret(row.EncryptedSecret).SetPreviousSecretExpiresAt(time.Now().UTC().Add(webhookSecretOverlap)).Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.webhook_secret_rotated", "webhook_subscription", row.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &WebhookWithSecret{Secret: secret, Webhook: webhookRecord(saved)}, nil
}

// DeleteWebhook removes a subscription and its delivery history.
func (c *Configuration) DeleteWebhook(ctx context.Context, actor Actor, id string) error {
	if err := c.authorizeWebhooks(ctx, actor); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	count, err := tx.WebhookSubscription.Delete().Where(webhooksubscription.ID(id), webhooksubscription.OrganizationID(actor.OrganizationID)).Exec(ctx)
	if err != nil {
		return err
	}
	if count == 0 {
		return notFound("Webhook not found.")
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.webhook_deleted", "webhook_subscription", id); err != nil {
		return err
	}
	return tx.Commit()
}

// TestWebhook queues a webhook.test delivery to one subscription; it goes out
// within seconds, signed like any other event.
func (c *Configuration) TestWebhook(ctx context.Context, actor Actor, id string) (*WebhookDeliveryRecord, error) {
	if err := c.authorizeWebhooks(ctx, actor); err != nil {
		return nil, err
	}
	row, err := c.ownedWebhook(ctx, c.client, actor, id)
	if err != nil {
		return nil, err
	}
	envelope := webhooks.NewEnvelope(actor.OrganizationID, webhooks.Test, nil,
		webhooks.Resource{ID: row.ID, Type: "webhook_subscription"}, map[string]any{"message": "A test delivery from Screenshot Studio."})
	body, err := json.Marshal(envelope)
	if err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	delivery, err := tx.WebhookDelivery.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
		SetSubscriptionID(row.ID).SetEventID(envelope.ID).SetEventType(webhooks.Test).SetBody(string(body)).
		SetManual(true).Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.webhook_tested", "webhook_subscription", row.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	record := webhookDeliveryRecord(delivery.Unwrap(), nil)
	return &record, nil
}

func webhookDeliveryRecord(row *ent.WebhookDelivery, attempts []*ent.WebhookDeliveryAttempt) WebhookDeliveryRecord {
	history := make([]WebhookAttemptRecord, 0, len(attempts))
	for _, attempt := range attempts {
		history = append(history, WebhookAttemptRecord{AttemptNumber: attempt.AttemptNumber, DurationMs: attempt.DurationMs,
			ErrorClass: attempt.ErrorClass, Outcome: string(attempt.Outcome), ResponseStatus: attempt.ResponseStatus,
			StartedAt: attempt.StartedAt})
	}
	var next *time.Time
	if row.Status == webhookdelivery.StatusPENDING {
		at := row.NextAttemptAt
		next = &at
	}
	return WebhookDeliveryRecord{Attempts: row.Attempts, CreatedAt: row.CreatedAt, ErrorClass: row.ErrorClass,
		EventID: row.EventID, EventType: row.EventType, History: history, ID: row.ID, LastAttemptAt: row.LastAttemptAt,
		Manual: row.Manual, NextAttemptAt: next, ResponseStatus: row.ResponseStatus, Status: string(row.Status)}
}

// ListWebhookDeliveries lists a subscription's latest deliveries with their
// attempts. It never returns the signing secret or response bodies.
func (c *Configuration) ListWebhookDeliveries(ctx context.Context, actor Actor, id string) ([]WebhookDeliveryRecord, error) {
	if err := c.authorizeWebhooks(ctx, actor); err != nil {
		return nil, err
	}
	row, err := c.ownedWebhook(ctx, c.client, actor, id)
	if err != nil {
		return nil, err
	}
	deliveries, err := c.client.WebhookDelivery.Query().Where(webhookdelivery.SubscriptionID(row.ID),
		webhookdelivery.OrganizationID(actor.OrganizationID)).
		Order(ent.Desc(webhookdelivery.FieldCreatedAt), ent.Desc(webhookdelivery.FieldID)).Limit(webhookDeliveryWindow).All(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(deliveries))
	for _, delivery := range deliveries {
		ids = append(ids, delivery.ID)
	}
	attempts, err := c.client.WebhookDeliveryAttempt.Query().Where(webhookdeliveryattempt.DeliveryIDIn(ids...)).
		Order(ent.Asc(webhookdeliveryattempt.FieldAttemptNumber)).All(ctx)
	if err != nil {
		return nil, err
	}
	byDelivery := map[string][]*ent.WebhookDeliveryAttempt{}
	for _, attempt := range attempts {
		byDelivery[attempt.DeliveryID] = append(byDelivery[attempt.DeliveryID], attempt)
	}
	items := make([]WebhookDeliveryRecord, 0, len(deliveries))
	for _, delivery := range deliveries {
		items = append(items, webhookDeliveryRecord(delivery, byDelivery[delivery.ID]))
	}
	return items, nil
}

// RetryWebhookDelivery replays a delivery that ran out of retries. The same
// event ID and body go out again, so a receiver that already has it can
// discard the repeat.
func (c *Configuration) RetryWebhookDelivery(ctx context.Context, actor Actor, deliveryID string) (*WebhookDeliveryRecord, error) {
	if err := c.authorizeWebhooks(ctx, actor); err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	count, err := tx.WebhookDelivery.Update().Where(webhookdelivery.ID(deliveryID), webhookdelivery.OrganizationID(actor.OrganizationID),
		webhookdelivery.StatusEQ(webhookdelivery.StatusDEAD)).SetStatus(webhookdelivery.StatusPENDING).SetManual(true).
		SetNextAttemptAt(time.Now().UTC()).Save(ctx)
	if err != nil {
		return nil, err
	}
	if count == 0 {
		exists, err := tx.WebhookDelivery.Query().Where(webhookdelivery.ID(deliveryID), webhookdelivery.OrganizationID(actor.OrganizationID)).Exist(ctx)
		if err != nil {
			return nil, err
		}
		if !exists {
			return nil, notFound("Delivery not found.")
		}
		return nil, conflict("Only a delivery that stopped retrying can be replayed.")
	}
	row, err := tx.WebhookDelivery.Get(ctx, deliveryID)
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.webhook_delivery_retried", "webhook_delivery", row.ID,
		map[string]any{"eventId": row.EventID}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	record := webhookDeliveryRecord(row, nil)
	return &record, nil
}
