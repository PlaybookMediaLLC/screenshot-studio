package product

import (
	"context"
	"encoding/json"
	"reflect"
	"regexp"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/enrichmentrecord"
	"github.com/lucsky/cuid"
)

// Enrichment results (docs/rfcs/032, Enrichment), cached per workspace,
// domain, provider, and field. The cache is never shared across workspaces:
// a shared entry would reveal that another workspace looked at a company.

// EnrichmentRecordRecord is one cached enrichment result.
type EnrichmentRecordRecord struct {
	Confidence float64         `json:"confidence"`
	CostMicros int64           `json:"costMicros"`
	Domain     string          `json:"domain"`
	ExpiresAt  time.Time       `json:"expiresAt"`
	FetchedAt  time.Time       `json:"fetchedAt"`
	Field      string          `json:"field"`
	ID         string          `json:"id"`
	Provider   string          `json:"provider"`
	SourceURL  string          `json:"sourceUrl,omitempty"`
	Value      json.RawMessage `json:"value"`
}

func enrichmentRecord(row *ent.EnrichmentRecord) EnrichmentRecordRecord {
	record := EnrichmentRecordRecord{Confidence: row.Confidence, CostMicros: row.CostMicros, Domain: row.Domain, ExpiresAt: row.ExpiresAt,
		FetchedAt: row.FetchedAt, Field: row.Field, ID: row.ID, Provider: row.Provider, Value: row.Value}
	if row.SourceURL != nil {
		record.SourceURL = *row.SourceURL
	}
	return record
}

var enrichmentName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// ListEnrichmentRecords returns the workspace's results for a domain,
// expired ones included; callers check ExpiresAt.
func (c *Configuration) ListEnrichmentRecords(ctx context.Context, actor Actor, domain string) ([]EnrichmentRecordRecord, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	rows, err := c.client.EnrichmentRecord.Query().Where(enrichmentrecord.OrganizationID(actor.OrganizationID), enrichmentrecord.Domain(domain)).
		Order(ent.Asc(enrichmentrecord.FieldProvider), ent.Asc(enrichmentrecord.FieldField)).All(ctx)
	if err != nil {
		return nil, err
	}
	records := make([]EnrichmentRecordRecord, len(rows))
	for i, row := range rows {
		records[i] = enrichmentRecord(row)
	}
	return records, nil
}

// SaveEnrichmentInput is one provider result to cache until ExpiresAt.
type SaveEnrichmentInput struct {
	Confidence float64         `json:"confidence"`
	CostMicros int64           `json:"costMicros"`
	Domain     string          `json:"domain"`
	ExpiresAt  time.Time       `json:"expiresAt"`
	Field      string          `json:"field"`
	Provider   string          `json:"provider"`
	SourceURL  string          `json:"sourceUrl"`
	Value      json.RawMessage `json:"value"`
}

// SaveEnrichmentRecord upserts a result. Changed reports a new or different value.
func (c *Configuration) SaveEnrichmentRecord(ctx context.Context, actor Actor, input SaveEnrichmentInput) (bool, error) {
	if err := c.authorizeRoles(ctx, actor, "owner", "admin"); err != nil {
		return false, err
	}
	if !enrichmentName.MatchString(input.Provider) || !enrichmentName.MatchString(input.Field) || input.Domain == "" || len(input.Domain) > 253 ||
		input.Confidence < 0 || input.Confidence > 1 || input.CostMicros < 0 || len(input.Value) > 64<<10 || !json.Valid(input.Value) ||
		(input.SourceURL != "" && !validProfileURL(input.SourceURL)) {
		return false, ErrInvalidInput
	}
	var source *string
	if input.SourceURL != "" {
		source = &input.SourceURL
	}
	now := time.Now().UTC()
	current, err := c.client.EnrichmentRecord.Query().Where(enrichmentrecord.OrganizationID(actor.OrganizationID), enrichmentrecord.Domain(input.Domain),
		enrichmentrecord.Provider(input.Provider), enrichmentrecord.Field(input.Field)).Only(ctx)
	if ent.IsNotFound(err) {
		_, err = c.client.EnrichmentRecord.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).SetDomain(input.Domain).
			SetProvider(input.Provider).SetField(input.Field).SetValue(input.Value).SetConfidence(input.Confidence).SetNillableSourceURL(source).
			SetFetchedAt(now).SetExpiresAt(input.ExpiresAt).SetCostMicros(input.CostMicros).Save(ctx)
		if ent.IsConstraintError(err) {
			return c.SaveEnrichmentRecord(ctx, actor, input)
		}
		return err == nil, err
	}
	if err != nil {
		return false, err
	}
	changed := !jsonEqual(current.Value, input.Value)
	update := current.Update().SetValue(input.Value).SetConfidence(input.Confidence).SetFetchedAt(now).SetExpiresAt(input.ExpiresAt).
		SetCostMicros(input.CostMicros)
	if source != nil {
		update.SetSourceURL(*source)
	} else {
		update.ClearSourceURL()
	}
	_, err = update.Save(ctx)
	return changed, err
}

// jsonEqual compares values, not bytes: JSONB returns keys in its own order.
func jsonEqual(a, b json.RawMessage) bool {
	var left, right any
	if json.Unmarshal(a, &left) != nil || json.Unmarshal(b, &right) != nil {
		return false
	}
	return reflect.DeepEqual(left, right)
}
