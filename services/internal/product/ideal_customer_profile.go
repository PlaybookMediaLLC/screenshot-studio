package product

import (
	"context"
	"maps"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/idealcustomerprofile"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/profile"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// The ideal customer profile (docs/rfcs/032-background-onboarding-agent.md):
// one per workspace, with the product profile's provenance rules. A person's
// edit locks a field; an automated update skips locked fields.

// idealCustomerProfileFields are the field names provenance is kept for.
var idealCustomerProfileFields = []string{"personas", "pains", "jobs", "buyingTriggers", "objections", "channels"}

// IdealCustomerProfileRecord is a workspace's ideal customer profile.
type IdealCustomerProfileRecord struct {
	BuyingTriggers []string                           `json:"buyingTriggers"`
	Channels       []string                           `json:"channels"`
	CreatedAt      time.Time                          `json:"createdAt"`
	ID             string                             `json:"id"`
	Jobs           []string                           `json:"jobs"`
	Objections     []string                           `json:"objections"`
	Pains          []string                           `json:"pains"`
	Personas       []profile.Persona                  `json:"personas"`
	Provenance     map[string]profile.FieldProvenance `json:"provenance"`
	UpdatedAt      time.Time                          `json:"updatedAt"`
}

func idealCustomerProfileRecord(row *ent.IdealCustomerProfile) *IdealCustomerProfileRecord {
	personas := row.Personas
	if personas == nil {
		personas = []profile.Persona{}
	}
	return &IdealCustomerProfileRecord{BuyingTriggers: nonNilStrings(row.BuyingTriggers), Channels: nonNilStrings(row.Channels),
		CreatedAt: row.CreatedAt, ID: row.ID, Jobs: nonNilStrings(row.Jobs), Objections: nonNilStrings(row.Objections),
		Pains: nonNilStrings(row.Pains), Personas: personas, Provenance: row.Provenance, UpdatedAt: row.UpdatedAt}
}

// UpsertIdealCustomerProfileInput changes the fields it names; a nil field is
// left as it is. Source is manual (the default) or automated. SourceURLs and
// Confidence record, per field, where an automated value came from and how
// sure its source was. UnlockFields lets automated updates change those
// fields again (manual only).
type UpsertIdealCustomerProfileInput struct {
	BuyingTriggers *[]string          `json:"buyingTriggers"`
	Channels       *[]string          `json:"channels"`
	Confidence     map[string]float64 `json:"confidence"`
	Jobs           *[]string          `json:"jobs"`
	Objections     *[]string          `json:"objections"`
	Pains          *[]string          `json:"pains"`
	Personas       *[]profile.Persona `json:"personas"`
	Source         string             `json:"source"`
	SourceURLs     map[string]string  `json:"sourceUrls"`
	UnlockFields   []string           `json:"unlockFields"`
}

func validPersonas(personas *[]profile.Persona) bool {
	if personas == nil {
		return true
	}
	if len(*personas) > 8 {
		return false
	}
	for _, persona := range *personas {
		if strings.TrimSpace(persona.Role) == "" || utf8.RuneCountInString(persona.Role) > 120 ||
			utf8.RuneCountInString(persona.Seniority) > 60 || utf8.RuneCountInString(persona.TeamSize) > 60 {
			return false
		}
	}
	return true
}

func normalizeIdealCustomerProfileInput(input *UpsertIdealCustomerProfileInput) error {
	if input.Source == "" {
		input.Source = ProfileSourceManual
	}
	if input.Personas != nil {
		for i := range *input.Personas {
			persona := &(*input.Personas)[i]
			persona.Role, persona.Seniority, persona.TeamSize = strings.TrimSpace(persona.Role), strings.TrimSpace(persona.Seniority), strings.TrimSpace(persona.TeamSize)
		}
	}
	lists := []*[]string{input.Pains, input.Jobs, input.BuyingTriggers, input.Objections, input.Channels}
	valid := (input.Source == ProfileSourceManual || input.Source == ProfileSourceAutomated) && validPersonas(input.Personas) &&
		(input.Source == ProfileSourceManual || len(input.UnlockFields) == 0)
	for _, list := range lists {
		if list != nil {
			for i, value := range *list {
				(*list)[i] = strings.TrimSpace(value)
			}
		}
		valid = valid && validProfileList(list, 12, 300)
	}
	for field, source := range input.SourceURLs {
		valid = valid && slices.Contains(idealCustomerProfileFields, field) && validProfileURL(source)
	}
	for field, confidence := range input.Confidence {
		valid = valid && slices.Contains(idealCustomerProfileFields, field) && confidence >= 0 && confidence <= 1
	}
	for _, field := range input.UnlockFields {
		valid = valid && slices.Contains(idealCustomerProfileFields, field)
	}
	if !valid {
		return invalid("The ideal customer profile has a missing, unknown, or oversized field.")
	}
	return nil
}

// GetIdealCustomerProfile returns the workspace's ICP, or nil before one exists.
func (c *Configuration) GetIdealCustomerProfile(ctx context.Context, actor Actor) (*IdealCustomerProfileRecord, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	row, err := c.client.IdealCustomerProfile.Query().Where(idealcustomerprofile.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return idealCustomerProfileRecord(row), nil
}

// UpsertIdealCustomerProfile creates or changes the ICP. It needs brand:manage
// (owner or admin). A manual change locks each field it changes; an automated
// change skips locked fields and audits the skip.
func (c *Configuration) UpsertIdealCustomerProfile(ctx context.Context, actor Actor, input UpsertIdealCustomerProfileInput) (*IdealCustomerProfileRecord, error) {
	if err := c.authorizeRoles(ctx, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	if err := normalizeIdealCustomerProfileInput(&input); err != nil {
		return nil, err
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	current, err := tx.IdealCustomerProfile.Query().Where(idealcustomerprofile.OrganizationID(actor.OrganizationID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, err
	}
	if current == nil {
		current = &ent.IdealCustomerProfile{Personas: []profile.Persona{}, Pains: []string{}, Jobs: []string{},
			BuyingTriggers: []string{}, Objections: []string{}, Channels: []string{}, Provenance: map[string]profile.FieldProvenance{}}
	}
	provenance := maps.Clone(current.Provenance)
	if provenance == nil {
		provenance = map[string]profile.FieldProvenance{}
	}
	for _, field := range input.UnlockFields {
		if entry, ok := provenance[field]; ok {
			entry.EditedByUser = false
			provenance[field] = entry
		}
	}
	automated := input.Source == ProfileSourceAutomated
	now := time.Now().UTC()
	changed, skipped := []string{}, []string{}
	apply := func(field string, supplied, different bool) bool {
		if !supplied {
			return false
		}
		if automated && provenance[field].EditedByUser {
			skipped = append(skipped, field)
			return false
		}
		if !different && provenance[field].Source != "" {
			return false
		}
		provenance[field] = profile.FieldProvenance{Confidence: input.Confidence[field], EditedByUser: !automated,
			Source: input.Source, UpdatedAt: now, URL: input.SourceURLs[field]}
		changed = append(changed, field)
		return true
	}
	next := *current
	list := func(field string, value *[]string, target *[]string) {
		if apply(field, value != nil, value != nil && !slices.Equal(*value, *target)) {
			*target = *value
		}
	}
	if apply("personas", input.Personas != nil, input.Personas != nil && !slices.Equal(*input.Personas, current.Personas)) {
		next.Personas = *input.Personas
	}
	list("pains", input.Pains, &next.Pains)
	list("jobs", input.Jobs, &next.Jobs)
	list("buyingTriggers", input.BuyingTriggers, &next.BuyingTriggers)
	list("objections", input.Objections, &next.Objections)
	list("channels", input.Channels, &next.Channels)
	var saved *ent.IdealCustomerProfile
	if current.ID == "" {
		saved, err = tx.IdealCustomerProfile.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).
			SetPersonas(next.Personas).SetPains(next.Pains).SetJobs(next.Jobs).SetBuyingTriggers(next.BuyingTriggers).
			SetObjections(next.Objections).SetChannels(next.Channels).SetProvenance(provenance).Save(ctx)
		if ent.IsConstraintError(err) {
			return nil, publishing.ErrConflict
		}
	} else {
		// Conditional on the row read, so a concurrent update is a conflict, not a lost lock.
		saved, err = tx.IdealCustomerProfile.UpdateOneID(current.ID).Where(idealcustomerprofile.UpdatedAt(current.UpdatedAt)).
			SetPersonas(next.Personas).SetPains(next.Pains).SetJobs(next.Jobs).SetBuyingTriggers(next.BuyingTriggers).
			SetObjections(next.Objections).SetChannels(next.Channels).SetProvenance(provenance).Save(ctx)
		if ent.IsNotFound(err) {
			return nil, conflict("The ideal customer profile changed. Reload it and try again.")
		}
	}
	if err != nil {
		return nil, err
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.ideal_customer_profile_updated", "ideal_customer_profile", saved.ID,
		map[string]any{"changed": strings.Join(changed, ","), "skipped": strings.Join(skipped, ","), "source": input.Source,
			"unlocked": strings.Join(input.UnlockFields, ",")}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return idealCustomerProfileRecord(saved), nil
}
