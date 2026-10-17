package onboarding

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/platformai"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// Store is the product domain the onboarding agent reads and writes; the
// REST API uses the same methods. *product.Configuration implements it.
type Store interface {
	AIAgentEnabled(ctx context.Context, organizationID string) (bool, error)
	ConsumeWorkspaceQuota(ctx context.Context, actor product.Actor, name string, amount int) (int, error)
	CreateOnboardingRun(ctx context.Context, actor product.Actor, input product.CreateOnboardingRunInput) (*product.OnboardingRunRecord, bool, error)
	GetIdealCustomerProfile(ctx context.Context, actor product.Actor) (*product.IdealCustomerProfileRecord, error)
	GetPageKnowledge(ctx context.Context, actor product.Actor, url string) (*product.PageKnowledgeRecord, error)
	GetProductProfile(ctx context.Context, actor product.Actor) (*product.ProductProfileRecord, error)
	RecentOnboardingDiscovery(ctx context.Context, actor product.Actor, url string) ([]string, bool, error)
	SavePageKnowledge(ctx context.Context, actor product.Actor, input product.SavePageKnowledgeInput) (*product.PageKnowledgeRecord, bool, error)
	SeedBrandProfile(ctx context.Context, actor product.Actor, seed product.BrandProfileSeed) error
	UpdateOnboardingRun(ctx context.Context, actor product.Actor, id string, update product.OnboardingRunUpdate) (*product.OnboardingRunRecord, error)
	UpsertIdealCustomerProfile(ctx context.Context, actor product.Actor, input product.UpsertIdealCustomerProfileInput) (*product.IdealCustomerProfileRecord, error)
	UpsertProductProfile(ctx context.Context, actor product.Actor, input product.UpsertProductProfileInput) (*product.ProductProfileRecord, error)
}

// Starter starts the background workflow for a run. Without one, a run ends
// after its fast path.
type Starter interface {
	Start(ctx context.Context, run *product.OnboardingRunRecord, started product.Actor) error
}

// Service runs onboarding: the fast path in the request, then the workflow.
type Service struct {
	FastPath *FastPath
	Starter  Starter
	Store    Store
}

// StartInput is a pasted URL and, optionally, the founder's one sentence.
type StartInput struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Sentence       string `json:"sentence"`
	URL            string `json:"url"`
}

// StartResult is the drafts on screen and the run deepening them.
type StartResult struct {
	Created              bool                                `json:"created"`
	Extracted            bool                                `json:"extracted"`
	IdealCustomerProfile *product.IdealCustomerProfileRecord `json:"idealCustomerProfile"`
	Pages                []string                            `json:"pages"`
	ProductProfile       *product.ProductProfileRecord       `json:"productProfile"`
	// Reason says why the site could not be read; the manual form remains.
	Reason string                       `json:"reason,omitempty"`
	Run    *product.OnboardingRunRecord `json:"run"`
}

// Progress after each stage (docs/rfcs/032, progress model).
const (
	ProgressFastPath = 20
	ProgressDone     = 100
)

// Run stages, as the run row and the progress query name them.
const (
	StageFastPath = "fast_path"
	StageCrawl    = "crawl"
	StageClassify = "classify"
	StageEnrich   = "enrich"
	StageICP      = "icp"
	StageBrand    = "brand"
	StageSurfaces = "surfaces"
	StageDone     = "done"
)

// Start runs the fast path for a new run and starts its workflow. A replay
// or a second submit while a run is active returns the existing run.
func (s *Service) Start(ctx context.Context, actor product.Actor, input StartInput) (*StartResult, error) {
	started := time.Now()
	if utf8.RuneCountInString(strings.TrimSpace(input.Sentence)) > 300 {
		return nil, product.ErrInvalidInput
	}
	run, created, err := s.Store.CreateOnboardingRun(ctx, actor, product.CreateOnboardingRunInput{IdempotencyKey: input.IdempotencyKey, URL: input.URL})
	if err != nil {
		return nil, err
	}
	if !created {
		return s.current(ctx, actor, run, false)
	}
	fast := s.read(ctx, actor, run, input.Sentence)
	// The drafts are saved even if the caller has gone; the run must not be left open.
	persist, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	s.save(persist, actor, run, fast)
	elapsed := int(time.Since(started).Milliseconds())
	update := product.OnboardingRunUpdate{CompletedStage: StageFastPath, DiscoveredURLs: &fast.Discovered, FastPathMs: &elapsed,
		PagesDiscovered: intPtr(len(fast.Discovered)), Progress: ProgressFastPath, Stage: strPtr(StageCrawl),
		TokensUsed: intPtr(fast.Usage.Tokens())}
	if fast.Reason != "" {
		update.ErrorCode, update.ErrorMessage = strPtr("site_unreadable"), strPtr(fast.Reason)
	}
	if run, err = s.Store.UpdateOnboardingRun(persist, actor, run.ID, update); err != nil {
		return nil, err
	}
	slog.Info("onboarding fast path", "metric", "onboarding.fast_path", "organizationId", actor.OrganizationID, "requestId", actor.RequestID,
		"runId", run.ID, "durationMs", elapsed, "extracted", fast.Extracted, "reused", fast.Reused, "timedOut", strings.Join(fast.TimedOut, ","),
		"pagesDiscovered", len(fast.Discovered), "tokens", fast.Usage.Tokens())
	run = s.startBackground(persist, actor, run)
	result, err := s.current(persist, actor, run, true)
	if err != nil {
		return nil, err
	}
	result.Extracted, result.Reason = fast.Extracted, fast.Reason
	return result, nil
}

// read gathers what the fast path needs from the store, then runs it.
func (s *Service) read(ctx context.Context, actor product.Actor, run *product.OnboardingRunRecord, sentence string) *FastPathResult {
	input := FastPathInput{Brief: sentence, PageLimit: run.PageLimit, URL: run.URL}
	input.Cached, _ = s.Store.GetPageKnowledge(ctx, actor, run.URL)
	input.CachedPages, input.HavePages, _ = s.Store.RecentOnboardingDiscovery(ctx, actor, run.URL)
	if profile, err := s.Store.GetProductProfile(ctx, actor); err == nil && profile != nil {
		input.HaveProfile = true
	}
	input.ModelAllowed = s.modelAllowed(ctx, actor)
	return s.FastPath.Run(ctx, input)
}

// modelAllowed is the workspace's AI switch on and AI credits left.
func (s *Service) modelAllowed(ctx context.Context, actor product.Actor) bool {
	enabled, err := s.Store.AIAgentEnabled(ctx, actor.OrganizationID)
	if err != nil || !enabled {
		return false
	}
	left, err := s.Store.ConsumeWorkspaceQuota(ctx, actor, product.QuotaAICredits, 0)
	return err == nil && left > 0
}

// save stores the homepage and applies the drafts as automated changes,
// which skip every field a person edited. A failed write is logged, never
// fatal: the review screen shows whatever was saved.
func (s *Service) save(ctx context.Context, actor product.Actor, run *product.OnboardingRunRecord, fast *FastPathResult) {
	logFailure := func(step string, err error) {
		if err != nil {
			slog.Error("onboarding fast path write failed", "step", step, "organizationId", actor.OrganizationID, "runId", run.ID, "error", err)
		}
	}
	if fast.Homepage != nil {
		fast.Homepage.RunID = run.ID
		_, _, err := s.Store.SavePageKnowledge(ctx, actor, *fast.Homepage)
		logFailure("page", err)
	}
	if credits := platformai.Credits(fast.Usage.CostUSD); credits > 0 {
		_, err := s.Store.ConsumeWorkspaceQuota(ctx, actor, product.QuotaAICredits, credits)
		var exceeded *product.QuotaExceededError
		if !errors.As(err, &exceeded) {
			logFailure("credits", err)
		}
	}
	if fast.Reused || fast.Draft == nil {
		return
	}
	logFailure("product profile", retryConflict(func() error {
		_, err := s.Store.UpsertProductProfile(ctx, actor, fast.Draft.Profile)
		return err
	}))
	if hasICP(fast.Draft.ICP) {
		logFailure("ideal customer profile", retryConflict(func() error {
			_, err := s.Store.UpsertIdealCustomerProfile(ctx, actor, fast.Draft.ICP)
			return err
		}))
	}
	seed := product.BrandProfileSeed{ProductDescription: deref(fast.Draft.Profile.Summary), Audience: deref(fast.Draft.Profile.Audience)}
	if fast.Brand != nil {
		seed.SocialHandles = fast.Brand.Socials
	}
	logFailure("brand profile", s.Store.SeedBrandProfile(ctx, actor, seed))
}

// startBackground starts the workflow, or ends the run after its fast path
// when there is no workflow to start. Temporal being down fails the run;
// the drafts are saved and the founder can run it again.
func (s *Service) startBackground(ctx context.Context, actor product.Actor, run *product.OnboardingRunRecord) *product.OnboardingRunRecord {
	update := product.OnboardingRunUpdate{Progress: ProgressDone, Stage: strPtr(StageDone), Status: strPtr(product.OnboardingCompleted)}
	if s.Starter != nil {
		err := s.Starter.Start(ctx, run, actor)
		if err == nil {
			return run
		}
		slog.Error("onboarding workflow did not start", "organizationId", actor.OrganizationID, "runId", run.ID, "error", err)
		update = product.OnboardingRunUpdate{ErrorCode: strPtr("background_unavailable"),
			ErrorMessage: strPtr("The background read could not start. Your draft is saved; run it again later."), Status: strPtr(product.OnboardingFailed)}
	}
	if saved, err := s.Store.UpdateOnboardingRun(ctx, actor, run.ID, update); err == nil {
		return saved
	}
	return run
}

// current is the run with the workspace's saved drafts.
func (s *Service) current(ctx context.Context, actor product.Actor, run *product.OnboardingRunRecord, created bool) (*StartResult, error) {
	productProfile, err := s.Store.GetProductProfile(ctx, actor)
	if err != nil {
		return nil, err
	}
	icp, err := s.Store.GetIdealCustomerProfile(ctx, actor)
	if err != nil {
		return nil, err
	}
	return &StartResult{Created: created, IdealCustomerProfile: icp, Pages: run.DiscoveredURLs, ProductProfile: productProfile, Run: run}, nil
}

func hasICP(icp product.UpsertIdealCustomerProfileInput) bool {
	return icp.Personas != nil || icp.Pains != nil || icp.Jobs != nil || icp.BuyingTriggers != nil || icp.Objections != nil || icp.Channels != nil
}

// retryConflict retries a write that lost an optimistic-concurrency race once.
func retryConflict(write func() error) error {
	err := write()
	if errors.Is(err, publishing.ErrConflict) {
		err = write()
	}
	return err
}

func intPtr(value int) *int       { return &value }
func strPtr(value string) *string { return &value }
func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
