package product

import (
	"context"
	"maps"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/productprofile"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/profile"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// The product profile (docs/rfcs/017-product-intelligence.md): one per
// workspace. A person's edit locks a field; an automated update skips locked
// fields so a correction is never reverted.

// Profile update sources, in precedence order (docs/rfcs/032, Merge and
// precedence): a person, then the product's own site, then third-party
// enrichment. A source never overwrites a field a higher one set.
const (
	ProfileSourceManual     = "manual"
	ProfileSourceAutomated  = "automated"
	ProfileSourceEnrichment = "enrichment"
)

func validProfileSource(source string) bool {
	return source == ProfileSourceManual || source == ProfileSourceAutomated || source == ProfileSourceEnrichment
}

// outranks reports whether an update from source may replace a field current
// set. Manual and site values outrank enrichment; everything outranks nothing.
func outranks(source, current string) bool {
	return source != ProfileSourceEnrichment || current == "" || current == ProfileSourceEnrichment
}

// productProfileFields are the field names provenance is kept for.
var productProfileFields = []string{"name", "url", "summary", "problem", "audience", "capabilities", "proofPoints", "pricingNote", "competitors"}

// ProductProfileRecord is a workspace's product profile.
type ProductProfileRecord struct {
	Audience     string                             `json:"audience"`
	Capabilities []string                           `json:"capabilities"`
	Competitors  []string                           `json:"competitors"`
	CreatedAt    time.Time                          `json:"createdAt"`
	ID           string                             `json:"id"`
	Name         string                             `json:"name"`
	PricingNote  string                             `json:"pricingNote"`
	Problem      string                             `json:"problem"`
	ProofPoints  []profile.ProofPoint               `json:"proofPoints"`
	Provenance   map[string]profile.FieldProvenance `json:"provenance"`
	Summary      string                             `json:"summary"`
	UpdatedAt    time.Time                          `json:"updatedAt"`
	URL          string                             `json:"url"`
}

func productProfileRecord(row *ent.ProductProfile) *ProductProfileRecord {
	return &ProductProfileRecord{Audience: row.Audience, Capabilities: nonNilStrings(row.Capabilities),
		Competitors: nonNilStrings(row.Competitors), CreatedAt: row.CreatedAt, ID: row.ID, Name: row.Name,
		PricingNote: row.PricingNote, Problem: row.Problem, ProofPoints: nonNilProofPoints(row.ProofPoints),
		Provenance: row.Provenance, Summary: row.Summary, UpdatedAt: row.UpdatedAt, URL: row.URL}
}

func nonNilProofPoints(points []profile.ProofPoint) []profile.ProofPoint {
	if points == nil {
		return []profile.ProofPoint{}
	}
	return points
}

// UpsertProductProfileInput changes the fields it names; a nil field is left
// as it is. Source is manual (the default) or automated. SourceURLs records
// the page each automated value came from, and Confidence how sure its
// source was. UnlockFields lets automated updates change those fields again
// (manual only).
type UpsertProductProfileInput struct {
	Audience     *string               `json:"audience"`
	Capabilities *[]string             `json:"capabilities"`
	Competitors  *[]string             `json:"competitors"`
	Confidence   map[string]float64    `json:"confidence"`
	Name         *string               `json:"name"`
	PricingNote  *string               `json:"pricingNote"`
	Problem      *string               `json:"problem"`
	ProofPoints  *[]profile.ProofPoint `json:"proofPoints"`
	Source       string                `json:"source"`
	SourceURLs   map[string]string     `json:"sourceUrls"`
	Summary      *string               `json:"summary"`
	UnlockFields []string              `json:"unlockFields"`
	// AcceptFields locks fields as they are: a person confirmed them (manual only).
	AcceptFields []string `json:"acceptFields"`
	URL          *string  `json:"url"`
}

func validProfileURL(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && len(value) <= 2000 && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != ""
}

func validProfileText(value *string, max int) bool {
	return value == nil || utf8.RuneCountInString(*value) <= max
}

func validProfileList(values *[]string, items, max int) bool {
	if values == nil {
		return true
	}
	if len(*values) > items {
		return false
	}
	for _, value := range *values {
		if strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > max {
			return false
		}
	}
	return true
}

// normalizeProductProfileInput trims and bounds the input.
func normalizeProductProfileInput(input *UpsertProductProfileInput) error {
	if input.Source == "" {
		input.Source = ProfileSourceManual
	}
	for _, text := range []**string{&input.Name, &input.URL, &input.Summary, &input.Problem, &input.Audience, &input.PricingNote} {
		if *text != nil {
			trimmed := strings.TrimSpace(**text)
			*text = &trimmed
		}
	}
	valid := validProfileSource(input.Source) &&
		(input.Name == nil || (*input.Name != "" && utf8.RuneCountInString(*input.Name) <= 160)) &&
		(input.URL == nil || validProfileURL(*input.URL)) &&
		validProfileText(input.Summary, 2000) && validProfileText(input.Problem, 2000) &&
		validProfileText(input.Audience, 1000) && validProfileText(input.PricingNote, 500) &&
		validProfileList(input.Capabilities, 30, 300) && validProfileList(input.Competitors, 20, 100) &&
		(input.Source == ProfileSourceManual || len(input.UnlockFields)+len(input.AcceptFields) == 0) && len(input.SourceURLs) <= len(productProfileFields)
	if input.ProofPoints != nil {
		valid = valid && len(*input.ProofPoints) <= 30
		for _, point := range *input.ProofPoints {
			valid = valid && strings.TrimSpace(point.Claim) != "" && utf8.RuneCountInString(point.Claim) <= 500 &&
				(point.SourceURL == "" || validProfileURL(point.SourceURL))
		}
	}
	for field, source := range input.SourceURLs {
		valid = valid && slices.Contains(productProfileFields, field) && validProfileURL(source)
	}
	for field, confidence := range input.Confidence {
		valid = valid && slices.Contains(productProfileFields, field) && confidence >= 0 && confidence <= 1
	}
	for _, field := range append(slices.Clone(input.UnlockFields), input.AcceptFields...) {
		valid = valid && slices.Contains(productProfileFields, field)
	}
	if !valid {
		return invalid("The product profile has a missing, unknown, or oversized field.")
	}
	return nil
}

// GetProductProfile returns the workspace's profile, or nil before one exists.
func (c *Configuration) GetProductProfile(ctx context.Context, actor Actor) (*ProductProfileRecord, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	row, err := c.client.ProductProfile.Query().Where(productprofile.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return productProfileRecord(row), nil
}

// UpsertProductProfile creates or changes the profile. It needs brand:manage
// (owner or admin). A manual change locks each field it changes; an
// automated change skips locked fields and audits the skip.
func (c *Configuration) UpsertProductProfile(ctx context.Context, actor Actor, input UpsertProductProfileInput) (*ProductProfileRecord, error) {
	if err := c.authorizeRoles(ctx, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	if err := normalizeProductProfileInput(&input); err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	current, err := tx.ProductProfile.Query().Where(productprofile.OrganizationID(actor.OrganizationID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	if current == nil {
		if input.Name == nil || input.URL == nil {
			return nil, invalid("A new product profile needs a name and a URL.")
		}
		current = &ent.ProductProfile{Capabilities: []string{}, Competitors: []string{}, ProofPoints: []profile.ProofPoint{},
			Provenance: map[string]profile.FieldProvenance{}}
	}
	provenance := maps.Clone(current.Provenance)
	if provenance == nil {
		provenance = map[string]profile.FieldProvenance{}
	}
	automated := input.Source != ProfileSourceManual
	for _, field := range input.UnlockFields {
		if entry, ok := provenance[field]; ok {
			entry.EditedByUser = false
			provenance[field] = entry
		}
	}
	for _, field := range input.AcceptFields {
		if entry, ok := provenance[field]; ok {
			entry.EditedByUser, entry.UpdatedAt = true, time.Now().UTC()
			provenance[field] = entry
		}
	}
	now := time.Now().UTC()
	changed, skipped := []string{}, []string{}
	// apply reports whether a supplied field may be written, and records its provenance.
	apply := func(field string, supplied, different bool) bool {
		if !supplied {
			return false
		}
		if automated && provenance[field].EditedByUser || !outranks(input.Source, provenance[field].Source) {
			skipped = append(skipped, field)
			return false
		}
		if !different && provenance[field].Source != "" {
			return false
		}
		provenance[field] = profile.FieldProvenance{Confidence: input.Confidence[field], EditedByUser: !automated, Source: input.Source,
			UpdatedAt: now, URL: input.SourceURLs[field]}
		changed = append(changed, field)
		return true
	}
	next := *current
	if apply("name", input.Name != nil, input.Name != nil && *input.Name != current.Name) {
		next.Name = *input.Name
	}
	if apply("url", input.URL != nil, input.URL != nil && *input.URL != current.URL) {
		next.URL = *input.URL
	}
	if apply("summary", input.Summary != nil, input.Summary != nil && *input.Summary != current.Summary) {
		next.Summary = *input.Summary
	}
	if apply("problem", input.Problem != nil, input.Problem != nil && *input.Problem != current.Problem) {
		next.Problem = *input.Problem
	}
	if apply("audience", input.Audience != nil, input.Audience != nil && *input.Audience != current.Audience) {
		next.Audience = *input.Audience
	}
	if apply("pricingNote", input.PricingNote != nil, input.PricingNote != nil && *input.PricingNote != current.PricingNote) {
		next.PricingNote = *input.PricingNote
	}
	if apply("capabilities", input.Capabilities != nil, input.Capabilities != nil && !slices.Equal(*input.Capabilities, current.Capabilities)) {
		next.Capabilities = *input.Capabilities
	}
	if apply("competitors", input.Competitors != nil, input.Competitors != nil && !slices.Equal(*input.Competitors, current.Competitors)) {
		next.Competitors = *input.Competitors
	}
	if apply("proofPoints", input.ProofPoints != nil, input.ProofPoints != nil && !slices.Equal(*input.ProofPoints, current.ProofPoints)) {
		next.ProofPoints = *input.ProofPoints
	}
	var saved *ent.ProductProfile
	if current.ID == "" {
		saved, err = tx.ProductProfile.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).SetName(next.Name).
			SetURL(next.URL).SetSummary(next.Summary).SetProblem(next.Problem).SetAudience(next.Audience).
			SetPricingNote(next.PricingNote).SetCapabilities(next.Capabilities).SetCompetitors(next.Competitors).
			SetProofPoints(next.ProofPoints).SetProvenance(provenance).Save(ctx)
		if ent.IsConstraintError(err) {
			return nil, publishing.ErrConflict
		}
	} else {
		// Conditional on the row read, so a concurrent update is a conflict, not a lost lock.
		saved, err = tx.ProductProfile.UpdateOneID(current.ID).Where(productprofile.UpdatedAt(current.UpdatedAt)).SetName(next.Name).SetURL(next.URL).SetSummary(next.Summary).
			SetProblem(next.Problem).SetAudience(next.Audience).SetPricingNote(next.PricingNote).
			SetCapabilities(next.Capabilities).SetCompetitors(next.Competitors).SetProofPoints(next.ProofPoints).
			SetProvenance(provenance).Save(ctx)
		if ent.IsNotFound(err) {
			return nil, conflict("The product profile changed. Reload it and try again.")
		}
	}
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.product_profile_updated", "product_profile", saved.ID,
		map[string]any{"changed": strings.Join(changed, ","), "skipped": strings.Join(skipped, ","), "source": input.Source,
			"unlocked": strings.Join(input.UnlockFields, ","), "accepted": strings.Join(input.AcceptFields, ",")}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return productProfileRecord(saved), nil
}
