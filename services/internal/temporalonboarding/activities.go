package temporalonboarding

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"slices"
	"strings"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/enrichment"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/onboarding"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/platformai"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/profile"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// Store is the product domain the activities write through, the same
// methods the REST API uses. *product.Configuration implements it.
type Store interface {
	AIAgentEnabled(ctx context.Context, organizationID string) (bool, error)
	AuthorizeOnboardingApply(ctx context.Context, started product.Actor) error
	CreateProductSurface(ctx context.Context, actor product.Actor, input product.CreateProductSurfaceInput) (*ent.ProductSurface, error)
	FinishOnboardingRun(ctx context.Context, organizationID, id string, update product.OnboardingRunUpdate) (*product.OnboardingRunRecord, error)
	GetIdealCustomerProfile(ctx context.Context, actor product.Actor) (*product.IdealCustomerProfileRecord, error)
	GetPageKnowledge(ctx context.Context, actor product.Actor, url string) (*product.PageKnowledgeRecord, error)
	GetProductProfile(ctx context.Context, actor product.Actor) (*product.ProductProfileRecord, error)
	ListEnrichmentRecords(ctx context.Context, actor product.Actor, domain string) ([]product.EnrichmentRecordRecord, error)
	ListPageKnowledge(ctx context.Context, actor product.Actor) ([]product.PageKnowledgeRecord, error)
	ListProductSurfaces(ctx context.Context, organizationID string) ([]*ent.ProductSurface, error)
	SavePageKnowledge(ctx context.Context, actor product.Actor, input product.SavePageKnowledgeInput) (*product.PageKnowledgeRecord, bool, error)
	SeedBrandProfile(ctx context.Context, actor product.Actor, seed product.BrandProfileSeed) error
	UpdateOnboardingRun(ctx context.Context, actor product.Actor, id string, update product.OnboardingRunUpdate) (*product.OnboardingRunRecord, error)
	UpsertIdealCustomerProfile(ctx context.Context, actor product.Actor, input product.UpsertIdealCustomerProfileInput) (*product.IdealCustomerProfileRecord, error)
	UpsertProductProfile(ctx context.Context, actor product.Actor, input product.UpsertProductProfileInput) (*product.ProductProfileRecord, error)
}

// Enricher runs the enrichment providers for a site (docs/rfcs/032,
// Enrichment); *enrichment.Enricher is one.
type Enricher interface {
	Enrich(ctx context.Context, actor product.Actor, siteURL string) (changed bool, costMicros int64, err error)
}

// Activities are the onboarding workflow's I/O: page fetches, model calls,
// enrichment, and writes, each re-authorized for the workspace the run was
// started in. The workspace comes from the workflow input, never from content.
type Activities struct {
	Enricher Enricher
	Fetcher  *onboarding.Fetcher
	// Model may be nil: extraction stages then do nothing.
	Model onboarding.Model
	Store Store
}

// started is the principal that started the run; service is how activities
// act for it once its access is re-checked.
func started(run Input) product.Actor {
	return product.Actor{OrganizationID: run.OrganizationID, Kind: run.StartedBy.Kind, UserID: run.StartedBy.UserID,
		KeyID: run.StartedBy.KeyID, RequestID: run.StartedBy.RequestID}
}

func service(run Input) product.Actor {
	return product.Actor{OrganizationID: run.OrganizationID, Kind: "service", UserID: run.StartedBy.UserID,
		RequestID: run.StartedBy.RequestID, Display: "Onboarding agent"}
}

// authorize re-checks the starter before a write. A starter who lost access
// gets the run's results discarded, so the error is not retried.
func (a *Activities) authorize(ctx context.Context, run Input) (product.Actor, error) {
	err := a.Store.AuthorizeOnboardingApply(ctx, started(run))
	if errors.Is(err, publishing.ErrForbidden) || errors.Is(err, publishing.ErrUnauthorized) {
		return product.Actor{}, temporal.NewNonRetryableApplicationError("the run's starter can no longer change this workspace", ErrRevoked, nil)
	}
	return service(run), err
}

// heartbeat records progress every few seconds until stop is called, so a
// long fetch is still seen alive and a cancel reaches it within seconds.
func heartbeat(ctx context.Context, detail string) (stop func()) {
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				activity.RecordHeartbeat(ctx, detail)
			}
		}
	}()
	activity.RecordHeartbeat(ctx, detail)
	return func() { close(done) }
}

// CrawlPage reads one page and stores it. A page read within the cache age is
// skipped without a request; a 304 or an unchanged hash is not Changed, so it
// costs no model call. A refused or 4xx page is skipped; a 5xx or timeout is
// returned for Temporal to retry.
func (a *Activities) CrawlPage(ctx context.Context, run Input, pageURL string) (PageOutcome, error) {
	actor, err := a.authorize(ctx, run)
	if err != nil {
		return PageOutcome{}, err
	}
	stop := heartbeat(ctx, pageURL)
	defer stop()
	stored, err := a.Store.GetPageKnowledge(ctx, actor, pageURL)
	if err != nil {
		return PageOutcome{}, err
	}
	if stored != nil && time.Since(stored.FetchedAt) < product.OnboardingCacheAge {
		return PageOutcome{Skipped: true, URL: pageURL}, nil
	}
	conditional := onboarding.Conditional{}
	if stored != nil {
		conditional = onboarding.Conditional{ETag: stored.ETag, LastModified: stored.LastModified}
	}
	fetchCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	page, err := a.Fetcher.Get(fetchCtx, pageURL, conditional)
	cancel()
	var refusal *onboarding.FetchError
	if errors.As(err, &refusal) && !refusal.Retryable {
		activity.GetLogger(ctx).Info("onboarding page skipped", "url", pageURL, "status", refusal.Status, "reason", refusal.Reason)
		return PageOutcome{Fetched: refusal.Status > 0, Skipped: true, URL: pageURL}, nil
	}
	if err != nil {
		return PageOutcome{}, err
	}
	input := product.SavePageKnowledgeInput{ETag: page.ETag, FetchedAt: time.Now().UTC(), HTTPStatus: page.Status, LastModified: page.LastModified,
		NotModified: page.NotModified, PageType: onboarding.PageOther, RunID: run.RunID, URL: pageURL}
	flagged := false
	if stored != nil && page.NotModified {
		input.PageType, input.Text, input.Title = stored.PageType, stored.Text, stored.Title
	} else {
		doc := onboarding.ParseHTML(page.Body, page.URL)
		input.Text, input.Title = doc.Text, doc.Title
		input.PageType = onboarding.ClassifyPage(pageURL, doc.Title)
		flagged = len(onboarding.DetectInjection(doc.Text)) > 0 || len(onboarding.DetectInjection(doc.Hidden)) > 0
	}
	_, changed, err := a.Store.SavePageKnowledge(ctx, actor, input)
	if err != nil {
		return PageOutcome{}, err
	}
	return PageOutcome{Changed: changed, Fetched: true, Flagged: flagged, URL: pageURL}, nil
}

// modelAllowed is a model configured and the workspace's AI switch on.
// Onboarding spends no AI credits: the platform pays, within the token budget.
func (a *Activities) modelAllowed(ctx context.Context, actor product.Actor) bool {
	if a.Model == nil {
		return false
	}
	enabled, err := a.Store.AIAgentEnabled(ctx, actor.OrganizationID)
	return err == nil && enabled
}

// sources fences stored pages as untrusted sources S1..Sn, within the batch's characters.
func (a *Activities) sources(ctx context.Context, actor product.Actor, urls []string) ([]onboarding.Source, error) {
	var sources []onboarding.Source
	share := batchChars / max(len(urls), 1)
	for _, pageURL := range urls {
		page, err := a.Store.GetPageKnowledge(ctx, actor, pageURL)
		if err != nil {
			return nil, err
		}
		if page == nil || page.Text == "" {
			continue
		}
		sources = append(sources, onboarding.Source{Flagged: len(onboarding.DetectInjection(page.Text)) > 0, ID: fmt.Sprintf("S%d", len(sources)+1),
			Kind: page.PageType, Text: onboarding.ClampText(page.Text, share), Title: page.Title, URL: page.URL})
	}
	return sources, nil
}

// draft makes one extraction call over sources and reports what it used.
func (a *Activities) draft(ctx context.Context, run Input, sources []onboarding.Source) (*onboarding.Draft, ModelOutcome, error) {
	draft, usage, err := onboarding.RunDraft(ctx, a.Model, onboarding.DraftInput{Brief: run.Brief, Homepage: run.URL, Sources: sources}, platformai.RoleDrafting)
	spent := ModelOutcome{CostMicros: usage.CostMicros(), Tokens: usage.Tokens()}
	var providerErr *platformai.Error
	if errors.As(err, &providerErr) && !providerErr.Retryable {
		return nil, spent, temporal.NewNonRetryableApplicationError("the model provider refused the request", ErrRefused, nil)
	}
	return draft, spent, err
}

// EnrichProfile reads a batch of changed pages and applies the product
// profile they support, as an automated change that skips locked fields.
func (a *Activities) EnrichProfile(ctx context.Context, batch BatchInput) (ModelOutcome, error) {
	actor, err := a.authorize(ctx, batch.Run)
	if err != nil || !a.modelAllowed(ctx, actor) {
		return ModelOutcome{}, err
	}
	sources, err := a.sources(ctx, actor, batch.URLs)
	if err != nil || len(sources) == 0 {
		return ModelOutcome{}, err
	}
	draft, spent, err := a.draft(ctx, batch.Run, sources)
	if err != nil {
		return spent, err
	}
	if draft.Profile.Name == nil && draft.Profile.Summary == nil && draft.Profile.Capabilities == nil && draft.Profile.PricingNote == nil {
		return spent, nil
	}
	draft.Profile.URL = nil // the run's URL is the founder's; a page never changes it
	current, err := a.Store.GetProductProfile(ctx, actor)
	if err != nil {
		return spent, err
	}
	unionLists(&draft.Profile, current)
	_, err = a.Store.UpsertProductProfile(ctx, actor, draft.Profile)
	spent.Applied = err == nil
	return spent, err
}

// unionLists merges list fields with what other pages already supplied, so
// capabilities from /features and from the homepage add up instead of the
// last page winning (docs/rfcs/012, conflict resolution). A field a person
// edited is left to the upsert, which skips it.
func unionLists(draft *product.UpsertProductProfileInput, current *product.ProductProfileRecord) {
	if current == nil {
		return
	}
	union := func(field string, existing []string, next *[]string, limit int) *[]string {
		if next == nil || current.Provenance[field].EditedByUser {
			return next
		}
		seen := map[string]bool{}
		var merged []string
		for _, value := range append(slices.Clone(existing), *next...) {
			if key := strings.ToLower(strings.TrimSpace(value)); key != "" && !seen[key] && len(merged) < limit {
				seen[key] = true
				merged = append(merged, value)
			}
		}
		return &merged
	}
	draft.Capabilities = union("capabilities", current.Capabilities, draft.Capabilities, 12)
	draft.Competitors = union("competitors", current.Competitors, draft.Competitors, 20)
	if draft.ProofPoints != nil && !current.Provenance["proofPoints"].EditedByUser {
		seen := map[string]bool{}
		var merged []profile.ProofPoint
		for _, point := range append(slices.Clone(current.ProofPoints), *draft.ProofPoints...) {
			if key := strings.ToLower(strings.TrimSpace(point.Claim)); key != "" && !seen[key] && len(merged) < 10 {
				seen[key] = true
				merged = append(merged, point)
			}
		}
		draft.ProofPoints = &merged
	}
}

// Enrich runs the enrichment providers; without any it changes nothing.
// A provider without its key or failing is skipped inside the enricher.
func (a *Activities) Enrich(ctx context.Context, run Input) (EnrichOutcome, error) {
	actor, err := a.authorize(ctx, run)
	if err != nil || a.Enricher == nil {
		return EnrichOutcome{}, err
	}
	stop := heartbeat(ctx, "enrichment")
	defer stop()
	changed, cost, err := a.Enricher.Enrich(ctx, actor, run.URL)
	return EnrichOutcome{Changed: changed, CostMicros: cost}, err
}

// DeriveICP reads the run's best pages and derives the ideal customer profile.
func (a *Activities) DeriveICP(ctx context.Context, run Input) (ModelOutcome, error) {
	actor, err := a.authorize(ctx, run)
	if err != nil || !a.modelAllowed(ctx, actor) {
		return ModelOutcome{}, err
	}
	pages, err := a.Store.ListPageKnowledge(ctx, actor)
	if err != nil {
		return ModelOutcome{}, err
	}
	var urls []string
	for _, kind := range []string{onboarding.PageHomepage, onboarding.PagePricing, onboarding.PageFeatures, onboarding.PageAbout, onboarding.PageDocs, onboarding.PageOther} {
		for _, page := range pages {
			if page.PageType == kind && len(urls) < batchPages && sameSite(page.URL, run.URL) {
				urls = append(urls, page.URL)
			}
		}
	}
	sources, err := a.sources(ctx, actor, urls)
	if err != nil {
		return ModelOutcome{}, err
	}
	// Competitor results, mentions, and reviews are third-party: fenced like
	// pages, and values citing them rank below the site's.
	records, err := a.Store.ListEnrichmentRecords(ctx, actor, enrichment.Domain(run.URL))
	if err != nil {
		return ModelOutcome{}, err
	}
	sources = append(sources, enrichment.Sources(records, len(sources)+1)...)
	if len(sources) == 0 {
		return ModelOutcome{}, nil
	}
	draft, spent, err := a.draft(ctx, run, sources)
	if err != nil {
		return spent, err
	}
	site, thirdParty := draft.SplitICP()
	for _, icp := range []product.UpsertIdealCustomerProfileInput{site, thirdParty} {
		if icp.Personas == nil && icp.Pains == nil && icp.Jobs == nil && icp.BuyingTriggers == nil && icp.Objections == nil && icp.Channels == nil {
			continue
		}
		if _, err := a.Store.UpsertIdealCustomerProfile(ctx, actor, icp); err != nil {
			return spent, err
		}
		spent.Applied = true
	}
	if competitors := draft.Profile.Competitors; competitors != nil {
		source := product.ProfileSourceAutomated
		if draft.ThirdParty["competitors"] {
			source = product.ProfileSourceEnrichment
		}
		if _, err := a.Store.UpsertProductProfile(ctx, actor, product.UpsertProductProfileInput{Competitors: competitors, Source: source,
			Confidence: map[string]float64{"competitors": draft.Profile.Confidence["competitors"]},
			SourceURLs: map[string]string{"competitors": draft.Profile.SourceURLs["competitors"]}}); err != nil {
			return spent, err
		}
		spent.Applied = true
	}
	return spent, nil
}

func sameSite(pageURL, siteURL string) bool {
	page, err1 := url.Parse(pageURL)
	site, err2 := url.Parse(siteURL)
	return err1 == nil && err2 == nil && strings.EqualFold(page.Host, site.Host)
}

// SeedBrand fills the brand profile's empty fields from the product profile.
func (a *Activities) SeedBrand(ctx context.Context, run Input) error {
	actor, err := a.authorize(ctx, run)
	if err != nil {
		return err
	}
	profile, err := a.Store.GetProductProfile(ctx, actor)
	if err != nil || profile == nil {
		return err
	}
	return a.Store.SeedBrandProfile(ctx, actor, product.BrandProfileSeed{Audience: profile.Audience, ProductDescription: profile.Summary})
}

// SeedSurfaces adds a product surface for each stored pricing, features,
// docs, or changelog page no surface covers yet (behind a flag until RFC 013).
func (a *Activities) SeedSurfaces(ctx context.Context, run Input) error {
	actor, err := a.authorize(ctx, run)
	if err != nil {
		return err
	}
	pages, err := a.Store.ListPageKnowledge(ctx, actor)
	if err != nil {
		return err
	}
	surfaces, err := a.Store.ListProductSurfaces(ctx, run.OrganizationID)
	if err != nil {
		return err
	}
	covered := map[string]bool{}
	for _, surface := range surfaces {
		covered[strings.TrimRight(surface.URL, "/")] = true
	}
	for _, page := range pages {
		if covered[strings.TrimRight(page.URL, "/")] || !sameSite(page.URL, run.URL) ||
			(page.PageType != onboarding.PagePricing && page.PageType != onboarding.PageFeatures && page.PageType != onboarding.PageDocs && page.PageType != onboarding.PageChangelog) {
			continue
		}
		name := onboarding.ClampText(strings.TrimSpace(page.Title), 100)
		if name == "" {
			name = page.PageType
		}
		_, err := a.Store.CreateProductSurface(ctx, actor, product.CreateProductSurfaceInput{Environment: "production", FeatureTags: []string{page.PageType},
			Name: name, ScreenshotAssetIDs: []string{}, URL: page.URL})
		if err != nil && !errors.Is(err, publishing.ErrConflict) {
			return err
		}
		covered[strings.TrimRight(page.URL, "/")] = true
	}
	return nil
}

func progressUpdate(progress Progress) product.OnboardingRunUpdate {
	stages := progress.CompletedStages
	update := product.OnboardingRunUpdate{EnrichmentCostMicros: &progress.EnrichmentCostMicros, ModelCostMicros: &progress.ModelCostMicros,
		PagesDiscovered: &progress.PagesDiscovered,
		PagesProcessed:  &progress.PagesProcessed, PagesSkipped: &progress.PagesSkipped, Progress: progress.Percent, Stage: &progress.Stage,
		TokensUsed: &progress.TokensUsed}
	if len(stages) > 0 {
		update.CompletedStage = stages[len(stages)-1]
	}
	return update
}

// ReportProgress mirrors the workflow's progress onto the run row for the UI.
func (a *Activities) ReportProgress(ctx context.Context, run Input, progress Progress) error {
	_, err := a.Store.FinishOnboardingRun(ctx, run.OrganizationID, run.RunID, progressUpdate(progress))
	return err
}

// FinishRun records the run's outcome and the per-run metrics.
func (a *Activities) FinishRun(ctx context.Context, run Input, finish Finish) error {
	update := progressUpdate(finish.Progress)
	update.Status = &finish.Status
	if finish.ErrorCode != "" {
		update.ErrorCode, update.ErrorMessage = &finish.ErrorCode, &finish.Message
	}
	saved, err := a.Store.FinishOnboardingRun(ctx, run.OrganizationID, run.RunID, update)
	if err != nil {
		return err
	}
	slog.Info("onboarding run finished", "metric", "onboarding.run", "organizationId", run.OrganizationID, "runId", run.RunID,
		"workflowId", activity.GetInfo(ctx).WorkflowExecution.ID, "requestId", run.StartedBy.RequestID, "status", saved.Status,
		"errorCode", finish.ErrorCode, "pagesProcessed", saved.PagesProcessed, "pagesSkipped", saved.PagesSkipped, "tokens", saved.TokensUsed,
		"enrichmentCostMicros", saved.EnrichmentCostMicros, "modelCostMicros", saved.ModelCostMicros, "durationMs", time.Since(saved.StartedAt).Milliseconds())
	return nil
}
