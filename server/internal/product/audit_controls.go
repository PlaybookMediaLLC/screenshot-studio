package product

import (
	"context"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditdrain"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditlog"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/auditretentionpolicy"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

const defaultAuditRetentionDays = 90

// AuditRequest carries the caller fingerprint the web facade records with
// audit-control changes.
type AuditRequest struct {
	IPHash           string
	UserAgentSummary string
}

type AuditDrainRecord struct {
	CreatedAt time.Time `json:"createdAt"`
	Enabled   bool      `json:"enabled"`
	Endpoint  string    `json:"endpoint"`
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Provider  string    `json:"provider"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CreateAuditDrainInput takes the signing secret already sealed by the web
// facade, in the AES-256-GCM format the maintenance worker decrypts.
type CreateAuditDrainInput struct {
	EncryptedSigningSecret string `json:"encryptedSigningSecret"`
	Endpoint               string `json:"endpoint"`
	Name                   string `json:"name"`
	Provider               string `json:"provider"`
}

type AuditRetention struct {
	LegalHold     bool `json:"legalHold"`
	RetentionDays int  `json:"retentionDays"`
}

func auditDrainRecord(row *ent.AuditDrain) AuditDrainRecord {
	return AuditDrainRecord{CreatedAt: row.CreatedAt, Enabled: row.Enabled, Endpoint: row.Endpoint,
		ID: row.ID, Name: row.Name, Provider: string(row.Provider), UpdatedAt: row.UpdatedAt}
}

// authorizeAuditManage mirrors the web's sensitive audit:manage check: an
// owner or admin session, signed in within 15 minutes, with two-factor on.
func (c *Configuration) authorizeAuditManage(ctx context.Context, actor Actor) error {
	if !actor.IsSession() {
		return publishing.ErrForbidden
	}
	if err := c.authorizeRoles(ctx, actor, "owner", "admin"); err != nil {
		return err
	}
	current, err := c.auth.AuthorizeSession(ctx, actor.UserID, actor.SessionID)
	if err != nil {
		return err
	}
	if time.Since(current.CreatedAt) > 15*time.Minute {
		return publishing.ErrUnauthorized
	}
	person, err := c.client.User.Query().Where(user.ID(actor.UserID)).Only(ctx)
	if err != nil {
		return err
	}
	if person.TwoFactorEnabled == nil || !*person.TwoFactorEnabled {
		return publishing.ErrForbidden
	}
	return nil
}

func appendRequestAudit(ctx context.Context, tx *ent.Tx, actor Actor, request AuditRequest, action, entityType, entityID string, metadata map[string]any) error {
	return publishing.AppendAudit(ctx, tx, publishing.AuditInput{
		Action: action, Actor: actor.auditActor(), EntityID: entityID, EntityType: entityType,
		IPHash: request.IPHash, Metadata: metadata, Organization: actor.OrganizationID,
		Outcome: auditlog.OutcomeSUCCEEDED, UserAgentSummary: request.UserAgentSummary,
	})
}

func (c *Configuration) ListAuditDrains(ctx context.Context, actor Actor) ([]AuditDrainRecord, error) {
	if err := c.Authorize(ctx, actor); err != nil {
		return nil, err
	}
	rows, err := c.client.AuditDrain.Query().Where(auditdrain.OrganizationID(actor.OrganizationID)).
		Order(ent.Desc(auditdrain.FieldCreatedAt)).All(ctx)
	if err != nil {
		return nil, err
	}
	drains := make([]AuditDrainRecord, 0, len(rows))
	for _, row := range rows {
		drains = append(drains, auditDrainRecord(row))
	}
	return drains, nil
}

func validDrainInput(input CreateAuditDrainInput) bool {
	endpoint, err := url.Parse(input.Endpoint)
	name := strings.TrimSpace(input.Name)
	return err == nil && (endpoint.Scheme == "https" || endpoint.Scheme == "http") && endpoint.Host != "" &&
		len(input.Endpoint) <= 2000 && name != "" && utf8.RuneCountInString(name) <= 100 &&
		auditdrain.ProviderValidator(auditdrain.Provider(input.Provider)) == nil &&
		input.EncryptedSigningSecret != "" && len(input.EncryptedSigningSecret) <= 4096
}

func (c *Configuration) CreateAuditDrain(ctx context.Context, actor Actor, input CreateAuditDrainInput, request AuditRequest) (*AuditDrainRecord, error) {
	if err := c.authorizeAuditManage(ctx, actor); err != nil {
		return nil, err
	}
	if !validDrainInput(input) {
		return nil, ErrInvalidInput
	}
	name := strings.TrimSpace(input.Name)
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	taken, err := tx.AuditDrain.Query().Where(auditdrain.OrganizationID(actor.OrganizationID), auditdrain.Name(name)).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if taken {
		return nil, publishing.ErrConflict
	}
	created, err := tx.AuditDrain.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
		SetName(name).SetProvider(auditdrain.Provider(input.Provider)).SetEndpoint(input.Endpoint).
		SetEncryptedSigningSecret(input.EncryptedSigningSecret).Save(ctx)
	if ent.IsConstraintError(err) {
		return nil, publishing.ErrConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendRequestAudit(ctx, tx, actor, request, "audit.drain_created", "audit_drain", created.ID,
		map[string]any{"name": created.Name, "provider": string(created.Provider)}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	record := auditDrainRecord(created)
	return &record, nil
}

func (c *Configuration) DeleteAuditDrain(ctx context.Context, actor Actor, drainID string, request AuditRequest) error {
	if err := c.authorizeAuditManage(ctx, actor); err != nil {
		return err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	drain, err := tx.AuditDrain.Query().Where(auditdrain.ID(drainID), auditdrain.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return publishing.ErrNotFound
	}
	if err != nil {
		return err
	}
	// Pending deliveries cascade with the drain row.
	if err := tx.AuditDrain.DeleteOneID(drain.ID).Exec(ctx); err != nil {
		return err
	}
	if err := appendRequestAudit(ctx, tx, actor, request, "audit.drain_deleted", "audit_drain", drain.ID,
		map[string]any{"name": drain.Name, "provider": string(drain.Provider)}); err != nil {
		return err
	}
	return tx.Commit()
}

func (c *Configuration) GetAuditRetention(ctx context.Context, actor Actor) (*AuditRetention, error) {
	if err := c.Authorize(ctx, actor); err != nil {
		return nil, err
	}
	policy, err := c.client.AuditRetentionPolicy.Query().Where(auditretentionpolicy.ID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return &AuditRetention{LegalHold: false, RetentionDays: defaultAuditRetentionDays}, nil
	}
	if err != nil {
		return nil, err
	}
	return &AuditRetention{LegalHold: policy.LegalHold, RetentionDays: policy.RetentionDays}, nil
}

func (c *Configuration) UpdateAuditRetention(ctx context.Context, actor Actor, input AuditRetention, request AuditRequest) (*AuditRetention, error) {
	if err := c.authorizeAuditManage(ctx, actor); err != nil {
		return nil, err
	}
	if input.RetentionDays < 30 || input.RetentionDays > 3650 {
		return nil, ErrInvalidInput
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	exists, err := tx.AuditRetentionPolicy.Query().Where(auditretentionpolicy.ID(actor.OrganizationID)).Exist(ctx)
	if err != nil {
		return nil, err
	}
	if exists {
		err = tx.AuditRetentionPolicy.UpdateOneID(actor.OrganizationID).
			SetLegalHold(input.LegalHold).SetRetentionDays(input.RetentionDays).Exec(ctx)
	} else {
		err = tx.AuditRetentionPolicy.Create().SetID(actor.OrganizationID).
			SetLegalHold(input.LegalHold).SetRetentionDays(input.RetentionDays).Exec(ctx)
	}
	if ent.IsConstraintError(err) {
		return nil, publishing.ErrConflict
	}
	if err != nil {
		return nil, err
	}
	if err := appendRequestAudit(ctx, tx, actor, request, "audit.retention_changed", "audit_retention_policy", actor.OrganizationID,
		map[string]any{"legalHold": input.LegalHold, "retentionDays": input.RetentionDays}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &input, nil
}
