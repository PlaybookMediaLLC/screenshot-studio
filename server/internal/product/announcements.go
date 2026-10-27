package product

import (
	"context"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/audiencesubscriber"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/communicationrecipient"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/customercommunication"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/release"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/releasedocument"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// Scheduling records intent only; server/internal/maintenance delivers
// SCHEDULED email communications and resolves recipients again at send time.

// announcementRoles hold publish:manage in the web role map.
var announcementRoles = []string{"owner", "admin", "publisher"}

// announcementError keeps a store error class while carrying the message the
// web surfaces to the user.
type announcementError struct {
	class   error
	message string
}

func (e announcementError) Error() string { return e.message }
func (e announcementError) Unwrap() error { return e.class }

type Announcement struct {
	Channel      string     `json:"channel"`
	CreatedAt    time.Time  `json:"createdAt"`
	CtaURL       *string    `json:"ctaUrl"`
	ID           string     `json:"id"`
	ScheduledFor *time.Time `json:"scheduledFor"`
	Status       string     `json:"status"`
}

type AnnouncementRecipientCount struct {
	Recipients int `json:"recipients"`
}

type AnnouncementRelease struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type AnnouncementDocument struct {
	Release  AnnouncementRelease `json:"release"`
	Revision int                 `json:"revision"`
}

type AnnouncementListItem struct {
	Announcement
	Count           AnnouncementRecipientCount `json:"_count"`
	ReleaseDocument *AnnouncementDocument      `json:"releaseDocument"`
}

type ScheduleAnnouncementInput struct {
	CtaURL            *string    `json:"ctaUrl"`
	IdempotencyKey    string     `json:"idempotencyKey"`
	ReleaseDocumentID string     `json:"releaseDocumentId"`
	ScheduledFor      *time.Time `json:"scheduledFor"`
}

type AnnouncementSchedule struct {
	Announcement Announcement `json:"announcement"`
	Created      bool         `json:"created"`
}

type AudienceSubscriberInput struct {
	Email string  `json:"email"`
	Name  *string `json:"name"`
}

type AudienceSubscriberRecord struct {
	CreatedAt      time.Time  `json:"createdAt"`
	Email          string     `json:"email"`
	ID             string     `json:"id"`
	Name           *string    `json:"name"`
	SuppressedAt   *time.Time `json:"suppressedAt"`
	UnsubscribedAt *time.Time `json:"unsubscribedAt"`
}

type AudienceAddition struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"`
}

func announcement(row *ent.CustomerCommunication) Announcement {
	return Announcement{Channel: string(row.Channel), CreatedAt: row.CreatedAt, CtaURL: row.CtaURL,
		ID: row.ID, ScheduledFor: row.ScheduledFor, Status: string(row.Status)}
}

func (c *Configuration) ListAnnouncements(ctx context.Context, actor Actor, limit int) ([]AnnouncementListItem, error) {
	if err := c.authorizeRoles(ctx, actor, announcementRoles...); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		return nil, ErrInvalidInput
	}
	org := actor.OrganizationID
	rows, err := c.client.CustomerCommunication.Query().Where(customercommunication.OrganizationID(org),
		customercommunication.ChannelEQ(customercommunication.ChannelEMAIL)).
		Order(ent.Desc(customercommunication.FieldCreatedAt), ent.Desc(customercommunication.FieldID)).
		Limit(limit).All(ctx)
	if err != nil || len(rows) == 0 {
		return []AnnouncementListItem{}, err
	}
	ids, documentIDs := make([]string, 0, len(rows)), make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
		documentIDs = append(documentIDs, row.ReleaseDocumentID)
	}
	documents, err := c.client.ReleaseDocument.Query().Where(releasedocument.OrganizationID(org),
		releasedocument.IDIn(documentIDs...)).All(ctx)
	if err != nil {
		return nil, err
	}
	releaseIDs := make([]string, 0, len(documents))
	for _, document := range documents {
		releaseIDs = append(releaseIDs, document.ReleaseID)
	}
	releases, err := c.client.Release.Query().Where(release.OrganizationID(org), release.IDIn(releaseIDs...)).All(ctx)
	if err != nil {
		return nil, err
	}
	var counts []struct {
		ID    string `json:"customerCommunicationId"`
		Count int    `json:"count"`
	}
	if err := c.client.CommunicationRecipient.Query().Where(communicationrecipient.OrganizationID(org),
		communicationrecipient.CustomerCommunicationIDIn(ids...)).
		GroupBy(communicationrecipient.FieldCustomerCommunicationID).Aggregate(ent.Count()).Scan(ctx, &counts); err != nil {
		return nil, err
	}
	titles := make(map[string]string, len(releases))
	for _, row := range releases {
		titles[row.ID] = row.Title
	}
	byDocument := make(map[string]*AnnouncementDocument, len(documents))
	for _, document := range documents {
		if title, ok := titles[document.ReleaseID]; ok {
			byDocument[document.ID] = &AnnouncementDocument{
				Release: AnnouncementRelease{ID: document.ReleaseID, Title: title}, Revision: document.Revision}
		}
	}
	recipients := make(map[string]int, len(counts))
	for _, count := range counts {
		recipients[count.ID] = count.Count
	}
	items := make([]AnnouncementListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, AnnouncementListItem{Announcement: announcement(row),
			Count:           AnnouncementRecipientCount{Recipients: recipients[row.ID]},
			ReleaseDocument: byDocument[row.ReleaseDocumentID]})
	}
	return items, nil
}

// audienceReach counts subscribers who would receive an announcement now.
// Advisory: delivery resolves recipients again at send time.
func (c *Configuration) audienceReach(ctx context.Context, org string) (int, error) {
	return c.client.AudienceSubscriber.Query().Where(audiencesubscriber.OrganizationID(org),
		audiencesubscriber.SuppressedAtIsNil(), audiencesubscriber.UnsubscribedAtIsNil()).Count(ctx)
}

func (c *Configuration) GetAudienceReach(ctx context.Context, actor Actor) (int, error) {
	if err := c.authorizeRoles(ctx, actor, announcementRoles...); err != nil {
		return 0, err
	}
	return c.audienceReach(ctx, actor.OrganizationID)
}

// ScheduleAnnouncement schedules email delivery of an approved release
// document. Announcing is the irreversible customer-facing step, so drafts
// and empty audiences are refused; a repeated idempotency key returns the
// original announcement.
func (c *Configuration) ScheduleAnnouncement(ctx context.Context, actor Actor, input ScheduleAnnouncementInput) (*AnnouncementSchedule, error) {
	if err := c.authorizeDecision(ctx, actor, announcementRoles...); err != nil {
		return nil, err
	}
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.ReleaseDocumentID == "" || input.IdempotencyKey == "" || len(input.IdempotencyKey) > 128 ||
		(input.CtaURL != nil && !validReleaseURLs([]string{*input.CtaURL})) ||
		(input.ScheduledFor != nil && !input.ScheduledFor.After(time.Now())) {
		return nil, ErrInvalidInput
	}
	org := actor.OrganizationID
	document, err := c.client.ReleaseDocument.Query().Where(releasedocument.ID(input.ReleaseDocumentID),
		releasedocument.OrganizationID(org)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, announcementError{publishing.ErrNotFound, "Release document not found."}
	}
	if err != nil {
		return nil, err
	}
	if document.Status != releasedocument.StatusAPPROVED {
		return nil, announcementError{publishing.ErrConflict,
			"Only an approved release document can be announced to customers."}
	}
	// An empty audience is almost always a setup mistake, so it fails here
	// rather than succeeding silently at dispatch time.
	reach, err := c.audienceReach(ctx, org)
	if err != nil {
		return nil, err
	}
	if reach == 0 {
		return nil, announcementError{publishing.ErrConflict,
			"This organization has no subscribed customers to announce to."}
	}
	existing := func() (*AnnouncementSchedule, error) {
		row, err := c.client.CustomerCommunication.Query().Where(customercommunication.OrganizationID(org),
			customercommunication.IdempotencyKey(input.IdempotencyKey)).Only(ctx)
		if err != nil {
			return nil, err
		}
		return &AnnouncementSchedule{Announcement: announcement(row)}, nil
	}
	if found, err := existing(); err == nil || !ent.IsNotFound(err) {
		return found, err
	}
	// Each subscriber reached is one email against the plan's monthly
	// allowance; a failed or raced insert gives the emails back.
	refund, err := c.ChargeMonthlyQuota(ctx, org, QuotaEmails, reach)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			refund()
		}
	}()
	scheduledFor := time.Now()
	if input.ScheduledFor != nil {
		scheduledFor = *input.ScheduledFor
	}
	// The column holds milliseconds; round first so the response and the
	// audit metadata match the stored value.
	scheduledFor = scheduledFor.UTC().Round(time.Millisecond)
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := tx.CustomerCommunication.Create().SetID(cuid.New()).SetOrganizationID(org).
		SetReleaseDocumentID(document.ID).SetChannel(customercommunication.ChannelEMAIL).
		SetNillableCtaURL(input.CtaURL).SetIdempotencyKey(input.IdempotencyKey).
		SetScheduledFor(scheduledFor).SetStatus(customercommunication.StatusSCHEDULED).Save(ctx)
	if ent.IsConstraintError(err) {
		// A concurrent request with the same key won the insert.
		_ = tx.Rollback()
		return existing()
	}
	if err != nil {
		return nil, err
	}
	actor.RequestID = input.IdempotencyKey
	if err := appendConfigurationAudit(ctx, tx, actor, "communication.scheduled", "customer_communication", row.ID,
		map[string]any{"releaseId": document.ReleaseID, "scheduledFor": scheduledFor.Format("2006-01-02T15:04:05.000Z07:00")}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	return &AnnouncementSchedule{Announcement: announcement(row), Created: true}, nil
}

// CancelAnnouncement cancels a SCHEDULED announcement and reports whether it
// did. Once delivery claims it the messages may already be with the provider,
// so a later cancel would report a stop that did not happen.
func (c *Configuration) CancelAnnouncement(ctx context.Context, actor Actor, id string) (bool, error) {
	if err := c.authorizeDecision(ctx, actor, announcementRoles...); err != nil {
		return false, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	cancelled, err := tx.CustomerCommunication.Update().Where(customercommunication.ID(id),
		customercommunication.OrganizationID(actor.OrganizationID),
		customercommunication.StatusEQ(customercommunication.StatusSCHEDULED)).
		SetStatus(customercommunication.StatusCANCELLED).Save(ctx)
	if err != nil || cancelled == 0 {
		return false, err
	}
	actor.RequestID = id
	if err := appendConfigurationAudit(ctx, tx, actor, "communication.cancelled", "customer_communication", id); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func (c *Configuration) ListAudienceSubscribers(ctx context.Context, actor Actor, includeUnsubscribed bool, limit int) ([]AudienceSubscriberRecord, error) {
	if err := c.authorizeRoles(ctx, actor, announcementRoles...); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 500 {
		return nil, ErrInvalidInput
	}
	query := c.client.AudienceSubscriber.Query().Where(audiencesubscriber.OrganizationID(actor.OrganizationID))
	if !includeUnsubscribed {
		query.Where(audiencesubscriber.SuppressedAtIsNil(), audiencesubscriber.UnsubscribedAtIsNil())
	}
	rows, err := query.Order(ent.Desc(audiencesubscriber.FieldCreatedAt), ent.Desc(audiencesubscriber.FieldID)).
		Limit(limit).All(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]AudienceSubscriberRecord, 0, len(rows))
	for _, row := range rows {
		items = append(items, AudienceSubscriberRecord{CreatedAt: row.CreatedAt, Email: row.Email, ID: row.ID,
			Name: row.Name, SuppressedAt: row.SuppressedAt, UnsubscribedAt: row.UnsubscribedAt})
	}
	return items, nil
}

// AddAudienceSubscribers adds new addresses and leaves existing rows alone:
// re-importing a list must not resurrect consent for someone who unsubscribed.
// Addresses are lowercased so case variants cannot bypass an unsubscribe.
func (c *Configuration) AddAudienceSubscribers(ctx context.Context, actor Actor, subscribers []AudienceSubscriberInput) (*AudienceAddition, error) {
	if err := c.authorizeRoles(ctx, actor, announcementRoles...); err != nil {
		return nil, err
	}
	if len(subscribers) < 1 || len(subscribers) > 1000 {
		return nil, ErrInvalidInput
	}
	names := make(map[string]*string, len(subscribers))
	emails := make([]string, 0, len(subscribers))
	for _, subscriber := range subscribers {
		email := strings.ToLower(strings.TrimSpace(subscriber.Email))
		address, err := mail.ParseAddress(email)
		if err != nil || address.Address != email || len(email) > 320 {
			return nil, ErrInvalidInput
		}
		name := subscriber.Name
		if name != nil {
			trimmed := strings.TrimSpace(*name)
			if utf8.RuneCountInString(trimmed) > 200 {
				return nil, ErrInvalidInput
			}
			name = &trimmed
		}
		if _, seen := names[email]; !seen {
			emails = append(emails, email)
		}
		// The last occurrence of an address wins, as in the web import.
		names[email] = name
	}
	org := actor.OrganizationID
	for attempt := 0; attempt < 3; attempt++ {
		tx, err := c.client.Tx(ctx)
		if err != nil {
			return nil, err
		}
		present, err := tx.AudienceSubscriber.Query().Where(audiencesubscriber.OrganizationID(org),
			audiencesubscriber.EmailIn(emails...)).Select(audiencesubscriber.FieldEmail).Strings(ctx)
		if err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		known := make(map[string]bool, len(present))
		for _, email := range present {
			known[email] = true
		}
		builders := make([]*ent.AudienceSubscriberCreate, 0, len(emails))
		for _, email := range emails {
			if !known[email] {
				builders = append(builders, tx.AudienceSubscriber.Create().SetID(cuid.New()).
					SetOrganizationID(org).SetEmail(email).SetNillableName(names[email]))
			}
		}
		if len(builders) > 0 {
			_, err = tx.AudienceSubscriber.CreateBulk(builders...).Save(ctx)
		}
		if ent.IsConstraintError(err) {
			// A concurrent import added one of these addresses; recount.
			_ = tx.Rollback()
			continue
		}
		if err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return &AudienceAddition{Added: len(builders), Skipped: len(emails) - len(builders)}, nil
	}
	return nil, publishing.ErrConflict
}

// UnsubscribeAudienceMember records an opt-out from a signed unsubscribe link
// the web verified. It skips the operational-workspace check so consent is
// recorded even while a deletion is pending (and could still be cancelled).
// Idempotent: a repeat keeps the original timestamp and writes no audit.
func (c *Configuration) UnsubscribeAudienceMember(ctx context.Context, actor Actor, email string) error {
	if actor.Kind != "service" || actor.OrganizationID == "" {
		return publishing.ErrForbidden
	}
	if email == "" || len(email) > 320 {
		return ErrInvalidInput
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	updated, err := tx.AudienceSubscriber.Update().Where(audiencesubscriber.OrganizationID(actor.OrganizationID),
		audiencesubscriber.Email(email), audiencesubscriber.UnsubscribedAtIsNil()).
		SetUnsubscribedAt(time.Now().UTC()).Save(ctx)
	if err != nil || updated == 0 {
		return err
	}
	actor.RequestID = email
	if err := appendConfigurationAudit(ctx, tx, actor, "audience.unsubscribed", "audience_subscriber", email); err != nil {
		return err
	}
	return tx.Commit()
}
