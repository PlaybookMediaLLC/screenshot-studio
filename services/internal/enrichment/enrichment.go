// Package enrichment fills what a product's own pages rarely say: brand
// assets, firmographics, social reach, app store presence, competitors, and
// what other people write about it (docs/rfcs/032, Enrichment). Every source
// implements EnrichmentProvider, is enabled by its own environment variable,
// and is skipped cleanly without its key. Results are cached per workspace
// and domain with a TTL, and every call records its cost.
package enrichment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/onboarding"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/profile"
)

// Result fields.
const (
	FieldBrand         = "brand"
	FieldFirmographics = "firmographics"
	FieldSocials       = "socials"
	FieldReach         = "reach"
	FieldApps          = "apps"
	FieldReviews       = "reviews"
	FieldCompetitors   = "competitors"
	FieldMentions      = "mentions"
)

// Subject is the company a run enriches. The site provider adds the social
// and app store links later providers look up.
type Subject struct {
	AppStoreURLs []string
	Domain       string
	Homepage     string
	Name         string
	Socials      map[string]string
}

// Result is one provider finding for one field.
type Result struct {
	Confidence float64
	CostMicros int64
	Field      string
	SourceURL  string
	Value      any
}

// EnrichmentProvider is one enrichment source.
type EnrichmentProvider interface {
	// Name is the provider's stable name, stored on its records.
	Name() string
	// Enabled is false without the provider's key, or when it is switched off.
	Enabled() bool
	// TTL is how long its results are cached.
	TTL() time.Duration
	Enrich(ctx context.Context, subject Subject) ([]Result, error)
}

// ProviderError is a failed call. Retryable is a rate limit, server error,
// or network failure; anything else skips the provider at once.
type ProviderError struct {
	Retryable bool
	Status    int
}

func (e *ProviderError) Error() string {
	return fmt.Sprintf("enrichment provider answered %d", e.Status)
}

// Store is the product domain enrichment reads and writes.
type Store interface {
	CreateBrandKit(ctx context.Context, actor product.Actor, input product.CreateBrandKitInput) (*ent.BrandKit, error)
	GetProductProfile(ctx context.Context, actor product.Actor) (*product.ProductProfileRecord, error)
	ListBrandKits(ctx context.Context, organizationID string) ([]*ent.BrandKit, error)
	ListEnrichmentRecords(ctx context.Context, actor product.Actor, domain string) ([]product.EnrichmentRecordRecord, error)
	SaveEnrichmentRecord(ctx context.Context, actor product.Actor, input product.SaveEnrichmentInput) (bool, error)
	SeedBrandProfile(ctx context.Context, actor product.Actor, seed product.BrandProfileSeed) error
	UpsertProductProfile(ctx context.Context, actor product.Actor, input product.UpsertProductProfileInput) (*product.ProductProfileRecord, error)
}

// Enricher runs the enabled providers in order, from cache when fresh, and
// merges what they found below the site and the user (docs/rfcs/032).
type Enricher struct {
	Providers []EnrichmentProvider
	Store     Store
	// wait is between retries; tests shorten it.
	wait time.Duration
}

// FromEnvironment builds every provider; disabled ones are skipped at run time.
// PLATFORM_ENRICHMENT_DISABLED lists keyless providers to switch off.
func FromEnvironment(fetcher *onboarding.Fetcher) []EnrichmentProvider {
	disabled := map[string]bool{}
	for _, name := range strings.Split(os.Getenv("PLATFORM_ENRICHMENT_DISABLED"), ",") {
		disabled[strings.TrimSpace(name)] = true
	}
	country := strings.ToLower(strings.TrimSpace(os.Getenv("PLATFORM_ENRICHMENT_APPSTORE_COUNTRY")))
	if len(country) != 2 {
		country = "us"
	}
	return []EnrichmentProvider{
		&Site{Fetcher: fetcher, Off: disabled["site"]},
		&GitHub{Token: os.Getenv("PLATFORM_ENRICHMENT_GITHUB_TOKEN"), Off: disabled["github"]},
		&AppStore{Country: country, Off: disabled["appstore"]},
		&PeopleDataLabs{APIKey: os.Getenv("PLATFORM_ENRICHMENT_PDL_API_KEY")},
		&Brave{APIKey: os.Getenv("PLATFORM_ENRICHMENT_BRAVE_API_KEY")},
	}
}

// Domain is the registrable host enrichment keys its cache on.
func Domain(siteURL string) string {
	parsed, err := url.Parse(siteURL)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(parsed.Hostname()), "www.")
}

// Enrich runs the providers for a site and merges the results. A provider
// that fails or has no key is skipped; only a database error is returned.
func (e *Enricher) Enrich(ctx context.Context, actor product.Actor, siteURL string) (bool, int64, error) {
	subject := Subject{Domain: Domain(siteURL), Homepage: siteURL, Socials: map[string]string{}}
	if current, err := e.Store.GetProductProfile(ctx, actor); err == nil && current != nil {
		subject.Name = current.Name
	}
	stored, err := e.Store.ListEnrichmentRecords(ctx, actor, subject.Domain)
	if err != nil {
		return false, 0, err
	}
	changed, cost := false, int64(0)
	found := map[string]product.EnrichmentRecordRecord{}
	for _, provider := range e.Providers {
		if !provider.Enabled() {
			slog.Info("enrichment provider skipped", "provider", provider.Name(), "organizationId", actor.OrganizationID)
			continue
		}
		records := fresh(stored, provider.Name())
		if len(records) == 0 {
			results, err := e.call(ctx, provider, subject)
			if err != nil {
				slog.Warn("enrichment provider failed", "provider", provider.Name(), "organizationId", actor.OrganizationID, "error", err.Error())
				continue
			}
			for _, result := range results {
				value, err := json.Marshal(result.Value)
				if err != nil {
					continue
				}
				input := product.SaveEnrichmentInput{Confidence: result.Confidence, CostMicros: result.CostMicros, Domain: subject.Domain,
					ExpiresAt: time.Now().UTC().Add(provider.TTL()), Field: result.Field, Provider: provider.Name(), SourceURL: result.SourceURL, Value: value}
				different, err := e.Store.SaveEnrichmentRecord(ctx, actor, input)
				if err != nil {
					return changed, cost, err
				}
				changed = changed || different
				cost += result.CostMicros
				records = append(records, product.EnrichmentRecordRecord{Confidence: input.Confidence, Field: input.Field, Provider: input.Provider,
					SourceURL: input.SourceURL, Value: value})
			}
		}
		for _, record := range records {
			found[record.Provider+"/"+record.Field] = record
		}
		absorb(&subject, records)
	}
	return changed, cost, e.merge(ctx, actor, found)
}

// fresh is a provider's unexpired records.
func fresh(records []product.EnrichmentRecordRecord, provider string) []product.EnrichmentRecordRecord {
	var out []product.EnrichmentRecordRecord
	now := time.Now()
	for _, record := range records {
		if record.Provider == provider && record.ExpiresAt.After(now) {
			out = append(out, record)
		}
	}
	return out
}

// call tries a provider three times on retryable failures, with backoff.
func (e *Enricher) call(ctx context.Context, provider EnrichmentProvider, subject Subject) ([]Result, error) {
	wait := e.wait
	if wait == 0 {
		wait = time.Second
	}
	for attempt := 1; ; attempt++ {
		callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		results, err := provider.Enrich(callCtx, subject)
		cancel()
		var failure *ProviderError
		if err == nil || attempt == 3 || (errors.As(err, &failure) && !failure.Retryable) {
			return results, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait * time.Duration(attempt)):
		}
	}
}

// absorb gives later providers the links the site provider found.
func absorb(subject *Subject, records []product.EnrichmentRecordRecord) {
	for _, record := range records {
		switch record.Field {
		case FieldSocials:
			var socials map[string]string
			if json.Unmarshal(record.Value, &socials) == nil {
				for platform, link := range socials {
					subject.Socials[platform] = link
				}
			}
		case FieldApps:
			var apps struct {
				AppStore []string `json:"appStore"`
			}
			if json.Unmarshal(record.Value, &apps) == nil {
				subject.AppStoreURLs = append(subject.AppStoreURLs, apps.AppStore...)
			}
		}
	}
}

// merge applies results below the site and the user: social links and brand
// colors only fill what is empty, and an app rating becomes a proof point
// only where the profile has none. Competitors and mentions reach the ICP
// through the extraction prompt, as untrusted sources.
func (e *Enricher) merge(ctx context.Context, actor product.Actor, found map[string]product.EnrichmentRecordRecord) error {
	if socials, ok := found["site/"+FieldSocials]; ok {
		var handles map[string]string
		if json.Unmarshal(socials.Value, &handles) == nil && len(handles) > 0 {
			if err := e.Store.SeedBrandProfile(ctx, actor, product.BrandProfileSeed{SocialHandles: handles}); err != nil {
				slog.Warn("brand profile not seeded from enrichment", "organizationId", actor.OrganizationID, "error", err.Error())
			}
		}
	}
	if brand, ok := found["site/"+FieldBrand]; ok {
		if err := e.seedBrandKit(ctx, actor, brand); err != nil {
			slog.Warn("brand kit not seeded from enrichment", "organizationId", actor.OrganizationID, "error", err.Error())
		}
	}
	if listing, ok := found["appstore/"+FieldApps]; ok {
		var apps []AppListing
		if json.Unmarshal(listing.Value, &apps) == nil && len(apps) > 0 && apps[0].RatingCount > 0 {
			app := apps[0]
			points := []profile.ProofPoint{{Claim: fmt.Sprintf("Rated %.1f from %d App Store ratings", app.Rating, app.RatingCount), SourceURL: app.URL}}
			_, err := e.Store.UpsertProductProfile(ctx, actor, product.UpsertProductProfileInput{ProofPoints: &points, Source: product.ProfileSourceEnrichment,
				SourceURLs: map[string]string{"proofPoints": app.URL}, Confidence: map[string]float64{"proofPoints": listing.Confidence}})
			if err != nil {
				slog.Warn("proof point not applied from enrichment", "organizationId", actor.OrganizationID, "error", err.Error())
			}
		}
	}
	return nil
}

// seedBrandKit drafts a brand kit from the site's colors and fonts when the
// workspace has none. The logo stays a URL: a kit needs an uploaded asset.
func (e *Enricher) seedBrandKit(ctx context.Context, actor product.Actor, record product.EnrichmentRecordRecord) error {
	var brand BrandAssets
	if err := json.Unmarshal(record.Value, &brand); err != nil {
		return err
	}
	accent := sixDigit(firstNonEmpty(brand.ThemeColor, first(brand.Colors)))
	if accent == "" {
		return nil
	}
	kits, err := e.Store.ListBrandKits(ctx, actor.OrganizationID)
	if err != nil || len(kits) > 0 {
		return err
	}
	heading := firstNonEmpty(first(brand.Fonts), "Inter")
	_, err = e.Store.CreateBrandKit(ctx, actor, product.CreateBrandKitInput{Name: "From your site", Definition: map[string]any{
		"colors":     map[string]any{"text": "#111111", "background": "#ffffff", "accent": accent},
		"typography": map[string]any{"headingFamily": heading},
	}})
	return err
}

func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func firstNonEmpty(values ...string) string {
	if i := slices.IndexFunc(values, func(value string) bool { return value != "" }); i >= 0 {
		return values[i]
	}
	return ""
}

// sixDigit expands #abc to #aabbcc; anything not a hex color is "".
func sixDigit(color string) string {
	color = strings.ToLower(strings.TrimSpace(color))
	switch {
	case hexColor.MatchString(color) && len(color) == 7:
		return color
	case hexColor.MatchString(color) && len(color) == 4:
		return "#" + strings.Repeat(color[1:2], 2) + strings.Repeat(color[2:3], 2) + strings.Repeat(color[3:4], 2)
	}
	return ""
}

// Sources fences cached competitor, mention, and review results as untrusted
// third-party sources for the ICP extraction, numbered after the site's.
func Sources(records []product.EnrichmentRecordRecord, firstID int) []onboarding.Source {
	var sources []onboarding.Source
	for _, record := range records {
		if record.Field != FieldCompetitors && record.Field != FieldMentions && record.Field != FieldReviews {
			continue
		}
		var snippets []Snippet
		if json.Unmarshal(record.Value, &snippets) != nil || len(snippets) == 0 {
			continue
		}
		var lines []string
		flagged := false
		for _, snippet := range snippets {
			line := strings.TrimSpace(snippet.Title + ": " + snippet.Text)
			flagged = flagged || len(onboarding.DetectInjection(line)) > 0
			lines = append(lines, "- "+onboarding.ClampText(line, 400))
		}
		sources = append(sources, onboarding.Source{Flagged: flagged, ID: fmt.Sprintf("S%d", firstID+len(sources)), Kind: record.Provider + "-" + record.Field,
			Text: onboarding.ClampText(strings.Join(lines, "\n"), 6_000), ThirdParty: true, Title: record.Provider + " " + record.Field,
			URL: firstNonEmpty(record.SourceURL, snippets[0].URL)})
	}
	return sources
}
