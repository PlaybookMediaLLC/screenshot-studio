package product

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/brandprofile"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/member"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/onboardingrun"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/pageknowledge"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/brand"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

// Onboarding runs (docs/rfcs/034-background-onboarding-agent.md). The run row
// mirrors the Temporal workflow for the UI; PageKnowledge holds the pages it
// read. Both are written only for the workspace the run was started in.

// OnboardingFeature gates the whole agent; without it onboarding is manual.
const OnboardingFeature = "onboarding:agent"

// Onboarding run statuses.
const (
	OnboardingQueued    = "queued"
	OnboardingRunning   = "running"
	OnboardingCompleted = "completed"
	OnboardingPartial   = "partial"
	OnboardingFailed    = "failed"
	OnboardingCancelled = "cancelled"
)

const (
	// OnboardingDeadline is a run's hard wall clock.
	OnboardingDeadline = 15 * time.Minute
	// onboardingRunsPerHour caps how often a workspace starts a run.
	onboardingRunsPerHour = 3
	// OnboardingCacheAge is how long a stored page is served without a fetch.
	OnboardingCacheAge = time.Hour
	// onboardingAbandonAfter is past the deadline and the workflow's own
	// margin: an active run older than that has no process finishing it.
	onboardingAbandonAfter = 10 * time.Minute
)

// onboardingLimits are a plan's pages and tokens per run. There is no free plan.
func onboardingLimits(plan string) (pages, tokens int) {
	if plan == "business" || plan == "enterprise" {
		return 100, 400_000
	}
	return 25, 120_000
}

// OnboardingWorkflowID is the one workflow ID a workspace's runs share, so a
// second start while one runs finds the first.
func OnboardingWorkflowID(organizationID string) string { return "onboarding-" + organizationID }

// OnboardingRunRecord is one onboarding run, as the UI and workflow see it.
type OnboardingRunRecord struct {
	CompletedAt          *time.Time `json:"completedAt"`
	CompletedStages      []string   `json:"completedStages"`
	CreatedByUserID      *string    `json:"createdByUserId"`
	DeadlineAt           time.Time  `json:"deadlineAt"`
	DiscoveredURLs       []string   `json:"discoveredUrls"`
	EnrichmentCostMicros int64      `json:"enrichmentCostMicros"`
	ErrorCode            *string    `json:"errorCode"`
	ErrorMessage         *string    `json:"errorMessage"`
	FastPathMs           int        `json:"fastPathMs"`
	ID                   string     `json:"id"`
	ModelCostMicros      int64      `json:"modelCostMicros"`
	PageLimit            int        `json:"pageLimit"`
	PagesDiscovered      int        `json:"pagesDiscovered"`
	PagesProcessed       int        `json:"pagesProcessed"`
	PagesSkipped         int        `json:"pagesSkipped"`
	Progress             int        `json:"progress"`
	Stage                string     `json:"stage"`
	StartedAt            time.Time  `json:"startedAt"`
	Status               string     `json:"status"`
	TokenBudget          int        `json:"tokenBudget"`
	TokensUsed           int        `json:"tokensUsed"`
	UpdatedAt            time.Time  `json:"updatedAt"`
	URL                  string     `json:"url"`
	WorkflowID           string     `json:"workflowId"`
}

func onboardingRunRecord(row *ent.OnboardingRun) *OnboardingRunRecord {
	return &OnboardingRunRecord{CompletedAt: row.CompletedAt, CompletedStages: nonNilStrings(row.CompletedStages),
		CreatedByUserID: row.CreatedByUserID, DeadlineAt: row.DeadlineAt, DiscoveredURLs: nonNilStrings(row.DiscoveredUrls),
		EnrichmentCostMicros: row.EnrichmentCostMicros, ErrorCode: row.ErrorCode, ErrorMessage: row.ErrorMessage,
		FastPathMs: row.FastPathMs, ID: row.ID, ModelCostMicros: row.ModelCostMicros, PageLimit: row.PageLimit, PagesDiscovered: row.PagesDiscovered,
		PagesProcessed: row.PagesProcessed, PagesSkipped: row.PagesSkipped, Progress: row.Progress, Stage: row.Stage,
		StartedAt: row.StartedAt, Status: string(row.Status), TokenBudget: row.TokenBudget, TokensUsed: row.TokensUsed,
		UpdatedAt: row.UpdatedAt, URL: row.URL, WorkflowID: row.WorkflowID}
}

// Terminal reports a run that will not change again.
func (r *OnboardingRunRecord) Terminal() bool {
	return r.Status != OnboardingQueued && r.Status != OnboardingRunning
}

// NormalizeOnboardingURL is the product URL a run reads: http(s) only, no
// credentials, fragment, or query, lower-case host, no trailing slash.
func NormalizeOnboardingURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil || len(raw) > 2000 {
		return "", invalid("Use the http or https address of your product's site.")
	}
	parsed.Fragment, parsed.RawQuery = "", ""
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if parsed.Path == "" {
		parsed.Path = "/"
	}
	return parsed.String(), nil
}

// CreateOnboardingRunInput starts a run. IdempotencyKey, when given, makes a
// replay return the original run; without one a repeat for the same URL in
// the same hour does.
type CreateOnboardingRunInput struct {
	IdempotencyKey string `json:"idempotencyKey"`
	URL            string `json:"url"`
}

// CreateOnboardingRun records a new run, or returns the run a replay or an
// active run already holds (created is false then). It needs owner or admin,
// the onboarding feature, and fewer than three runs this hour.
func (c *Configuration) CreateOnboardingRun(ctx context.Context, actor Actor, input CreateOnboardingRunInput) (*OnboardingRunRecord, bool, error) {
	if err := c.authorizeRoles(ctx, actor, "owner", "admin"); err != nil {
		return nil, false, err
	}
	if err := c.requireWorkspaceFeature(ctx, actor.OrganizationID, OnboardingFeature); err != nil {
		return nil, false, err
	}
	target, err := NormalizeOnboardingURL(input.URL)
	if err != nil {
		return nil, false, err
	}
	key := strings.TrimSpace(input.IdempotencyKey)
	if utf8.RuneCountInString(key) > 128 {
		return nil, false, invalid("The idempotency key is longer than 128 characters.")
	}
	now := time.Now().UTC()
	if key == "" {
		sum := sha256.Sum256([]byte(target + "|" + now.Format("2006-01-02T15")))
		key = "auto:" + hex.EncodeToString(sum[:16])
	} else {
		key = "client:" + key
	}
	existing, err := c.findOnboardingRun(ctx, actor.OrganizationID, key)
	if err != nil {
		return nil, false, err
	}
	if existing != nil && !existing.Terminal() && now.After(existing.DeadlineAt.Add(onboardingAbandonAfter)) {
		// Nothing finished this run: the process running it died. Free the workspace.
		failed, code, message := OnboardingFailed, "abandoned", "The run stopped without finishing. Run it again."
		if _, err := c.FinishOnboardingRun(ctx, actor.OrganizationID, existing.ID, OnboardingRunUpdate{Status: &failed, ErrorCode: &code, ErrorMessage: &message}); err != nil {
			return nil, false, err
		}
		if existing, err = c.findOnboardingRun(ctx, actor.OrganizationID, key); err != nil {
			return nil, false, err
		}
	}
	if existing != nil {
		return existing, false, nil
	}
	recent, err := c.client.OnboardingRun.Query().Where(onboardingrun.OrganizationID(actor.OrganizationID),
		onboardingrun.CreatedAtGT(now.Add(-time.Hour))).Order(ent.Asc(onboardingrun.FieldCreatedAt)).All(ctx)
	if err != nil {
		return nil, false, err
	}
	if len(recent) >= onboardingRunsPerHour {
		return nil, false, &QuotaExceededError{Limit: onboardingRunsPerHour, Quota: "onboarding:runs:hourly", ResetAt: recent[0].CreatedAt.Add(time.Hour)}
	}
	plan, _, err := c.workspacePlan(ctx, actor.OrganizationID)
	if err != nil {
		return nil, false, err
	}
	pages, tokens := onboardingLimits(plan)
	create := c.client.OnboardingRun.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).SetURL(target).
		SetStatus(onboardingrun.StatusRunning).SetIdempotencyKey(key).SetWorkflowID(OnboardingWorkflowID(actor.OrganizationID)).
		SetPageLimit(pages).SetTokenBudget(tokens).SetDeadlineAt(now.Add(OnboardingDeadline)).SetStartedAt(now)
	if actor.UserID != "" {
		create.SetCreatedByUserID(actor.UserID)
	}
	row, err := create.Save(ctx)
	if ent.IsConstraintError(err) {
		// A concurrent start won the active-run index or the key; return its run.
		existing, findErr := c.findOnboardingRun(ctx, actor.OrganizationID, key)
		if existing == nil && findErr == nil {
			return nil, false, conflict("Another onboarding run is starting. Try again in a moment.")
		}
		return existing, false, findErr
	}
	if err != nil {
		return nil, false, err
	}
	if err := c.appendAudit(ctx, actor, "product.onboarding_run_started", "onboarding_run", row.ID, map[string]any{"url": target}); err != nil {
		return nil, false, err
	}
	return onboardingRunRecord(row), true, nil
}

// findOnboardingRun is the run a key already started, else the active run.
func (c *Configuration) findOnboardingRun(ctx context.Context, organizationID, key string) (*OnboardingRunRecord, error) {
	row, err := c.client.OnboardingRun.Query().Where(onboardingrun.OrganizationID(organizationID), onboardingrun.Or(
		onboardingrun.IdempotencyKey(key), onboardingrun.StatusIn(onboardingrun.StatusQueued, onboardingrun.StatusRunning))).
		Order(ent.Desc(onboardingrun.FieldCreatedAt)).First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return onboardingRunRecord(row), nil
}

func (c *Configuration) appendAudit(ctx context.Context, actor Actor, action, entityType, entityID string, metadata map[string]any) error {
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := appendConfigurationAudit(ctx, tx, actor, action, entityType, entityID, metadata); err != nil {
		return err
	}
	return tx.Commit()
}

// GetOnboardingRun returns one of the workspace's runs; any member may read it.
func (c *Configuration) GetOnboardingRun(ctx context.Context, actor Actor, id string) (*OnboardingRunRecord, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	row, err := c.client.OnboardingRun.Query().Where(onboardingrun.ID(id), onboardingrun.OrganizationID(actor.OrganizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return onboardingRunRecord(row), nil
}

// LatestOnboardingRun is the workspace's newest run, or nil before its first.
func (c *Configuration) LatestOnboardingRun(ctx context.Context, actor Actor) (*OnboardingRunRecord, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	row, err := c.client.OnboardingRun.Query().Where(onboardingrun.OrganizationID(actor.OrganizationID)).
		Order(ent.Desc(onboardingrun.FieldCreatedAt)).First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return onboardingRunRecord(row), nil
}

// OnboardingRunUpdate is what a stage reports. Nil fields stay as they are;
// Progress only ever raises the stored value, and a finished run keeps its status.
type OnboardingRunUpdate struct {
	CompletedStage       string    `json:"completedStage"`
	DiscoveredURLs       *[]string `json:"discoveredUrls"`
	EnrichmentCostMicros *int64    `json:"enrichmentCostMicros"`
	ErrorCode            *string   `json:"errorCode"`
	ErrorMessage         *string   `json:"errorMessage"`
	FastPathMs           *int      `json:"fastPathMs"`
	ModelCostMicros      *int64    `json:"modelCostMicros"`
	PagesDiscovered      *int      `json:"pagesDiscovered"`
	PagesProcessed       *int      `json:"pagesProcessed"`
	PagesSkipped         *int      `json:"pagesSkipped"`
	Progress             int       `json:"progress"`
	Stage                *string   `json:"stage"`
	Status               *string   `json:"status"`
	TokensUsed           *int      `json:"tokensUsed"`
}

var onboardingStatuses = []string{OnboardingQueued, OnboardingRunning, OnboardingCompleted, OnboardingPartial, OnboardingFailed, OnboardingCancelled}

// UpdateOnboardingRun applies a stage's report to the run row. Concurrent
// reports retry against the row they read, so none is lost.
func (c *Configuration) UpdateOnboardingRun(ctx context.Context, actor Actor, id string, update OnboardingRunUpdate) (*OnboardingRunRecord, error) {
	if err := c.authorizeRoles(ctx, actor, "owner", "admin"); err != nil {
		return nil, err
	}
	if update.Status != nil && !slices.Contains(onboardingStatuses, *update.Status) || update.Progress < 0 || update.Progress > 100 {
		return nil, ErrInvalidInput
	}
	for attempt := 0; ; attempt++ {
		saved, err := c.updateOnboardingRunOnce(ctx, actor.OrganizationID, id, update)
		if !ent.IsNotFound(err) || attempt == 4 {
			return saved, err
		}
		if _, err := c.client.OnboardingRun.Query().Where(onboardingrun.ID(id), onboardingrun.OrganizationID(actor.OrganizationID)).Only(ctx); ent.IsNotFound(err) {
			return nil, publishing.ErrNotFound
		}
	}
}

// FinishOnboardingRun is the workflow's own bookkeeping: it records a run's
// outcome even when the workspace was scheduled for deletion meanwhile, so a
// cancelled run reads cancelled. It writes only that run's row, matched on
// its workspace, and is never exposed to a caller.
func (c *Configuration) FinishOnboardingRun(ctx context.Context, organizationID, id string, update OnboardingRunUpdate) (*OnboardingRunRecord, error) {
	if update.Status != nil && !slices.Contains(onboardingStatuses, *update.Status) || update.Progress < 0 || update.Progress > 100 {
		return nil, ErrInvalidInput
	}
	for attempt := 0; ; attempt++ {
		saved, err := c.updateOnboardingRunOnce(ctx, organizationID, id, update)
		if !ent.IsNotFound(err) || attempt == 4 {
			return saved, err
		}
	}
}

func (c *Configuration) updateOnboardingRunOnce(ctx context.Context, organizationID, id string, update OnboardingRunUpdate) (*OnboardingRunRecord, error) {
	current, err := c.client.OnboardingRun.Query().Where(onboardingrun.ID(id), onboardingrun.OrganizationID(organizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, publishing.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	record := onboardingRunRecord(current)
	// Conditional on the row read; a concurrent change makes this a not-found, and the caller retries.
	change := c.client.OnboardingRun.UpdateOneID(id).Where(onboardingrun.UpdatedAt(current.UpdatedAt)).
		SetProgress(max(current.Progress, update.Progress))
	if update.Stage != nil {
		change.SetStage(*update.Stage)
	}
	if update.CompletedStage != "" && !slices.Contains(current.CompletedStages, update.CompletedStage) {
		change.SetCompletedStages(append(slices.Clone(current.CompletedStages), update.CompletedStage))
	}
	if update.DiscoveredURLs != nil {
		change.SetDiscoveredUrls(*update.DiscoveredURLs)
	}
	setInt := func(value *int, set func(int) *ent.OnboardingRunUpdateOne) {
		if value != nil {
			set(max(0, *value))
		}
	}
	setInt(update.PagesDiscovered, change.SetPagesDiscovered)
	setInt(update.PagesProcessed, change.SetPagesProcessed)
	setInt(update.PagesSkipped, change.SetPagesSkipped)
	setInt(update.TokensUsed, change.SetTokensUsed)
	setInt(update.FastPathMs, change.SetFastPathMs)
	if update.EnrichmentCostMicros != nil {
		change.SetEnrichmentCostMicros(max(0, *update.EnrichmentCostMicros))
	}
	if update.ModelCostMicros != nil {
		change.SetModelCostMicros(max(0, *update.ModelCostMicros))
	}
	if update.ErrorCode != nil {
		change.SetErrorCode(clampRunes(*update.ErrorCode, 64))
	}
	if update.ErrorMessage != nil {
		change.SetErrorMessage(clampRunes(*update.ErrorMessage, 500))
	}
	if update.Status != nil && !record.Terminal() {
		change.SetStatus(onboardingrun.Status(*update.Status))
		if *update.Status != OnboardingQueued && *update.Status != OnboardingRunning {
			change.SetCompletedAt(time.Now().UTC())
		}
	}
	saved, err := change.Save(ctx)
	if err != nil {
		return nil, err
	}
	return onboardingRunRecord(saved), nil
}

func clampRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

// RecentOnboardingDiscovery is the page list the newest run for url found
// within the cache age, so a quick re-run reads no sitemap.
func (c *Configuration) RecentOnboardingDiscovery(ctx context.Context, actor Actor, target string) ([]string, bool, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, false, err
	}
	row, err := c.client.OnboardingRun.Query().Where(onboardingrun.OrganizationID(actor.OrganizationID), onboardingrun.URL(target),
		onboardingrun.CreatedAtGT(time.Now().UTC().Add(-OnboardingCacheAge)), onboardingrun.PagesDiscoveredGT(0)).
		Order(ent.Desc(onboardingrun.FieldCreatedAt)).First(ctx)
	if ent.IsNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return nonNilStrings(row.DiscoveredUrls), true, nil
}

// AuthorizeOnboardingApply re-checks, before a background run writes, that
// the workspace is operational and whoever started the run may still change
// it: a member still owner or admin, or an API key still enabled. The session
// that started the run may have ended; the member's access is what counts.
func (c *Configuration) AuthorizeOnboardingApply(ctx context.Context, started Actor) error {
	switch started.Kind {
	case "", "session":
		if err := c.auth.AuthorizeWorkspace(ctx, started.OrganizationID); err != nil {
			return err
		}
		allowed, err := c.client.Member.Query().Where(member.OrganizationID(started.OrganizationID), member.UserID(started.UserID),
			member.RoleIn("owner", "admin")).Exist(ctx)
		if err != nil {
			return err
		}
		if !allowed {
			return publishing.ErrForbidden
		}
		return nil
	case "api_key":
		return c.auth.AuthorizeAPIKey(ctx, started.OrganizationID, started.KeyID)
	}
	return c.auth.AuthorizeWorkspace(ctx, started.OrganizationID)
}

// PageKnowledgeRecord is one stored page of the workspace's product site.
type PageKnowledgeRecord struct {
	ContentHash  string    `json:"contentHash"`
	ETag         string    `json:"etag,omitempty"`
	FetchedAt    time.Time `json:"fetchedAt"`
	HTTPStatus   int       `json:"httpStatus"`
	ID           string    `json:"id"`
	LastModified string    `json:"lastModified,omitempty"`
	PageType     string    `json:"pageType"`
	RunID        string    `json:"runId"`
	Text         string    `json:"text"`
	Title        string    `json:"title"`
	URL          string    `json:"url"`
}

func pageKnowledgeRecord(row *ent.PageKnowledge) *PageKnowledgeRecord {
	record := &PageKnowledgeRecord{ContentHash: row.ContentHash, FetchedAt: row.FetchedAt, HTTPStatus: row.HTTPStatus, ID: row.ID,
		PageType: string(row.PageType), RunID: row.RunID, Text: row.Text, Title: row.Title, URL: row.URL}
	if row.Etag != nil {
		record.ETag = *row.Etag
	}
	if row.LastModified != nil {
		record.LastModified = *row.LastModified
	}
	return record
}

// ContentHash is the hash PageKnowledge compares to skip unchanged pages.
func ContentHash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

// GetPageKnowledge returns the stored page for url, or nil.
func (c *Configuration) GetPageKnowledge(ctx context.Context, actor Actor, pageURL string) (*PageKnowledgeRecord, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	row, err := c.client.PageKnowledge.Query().Where(pageknowledge.OrganizationID(actor.OrganizationID), pageknowledge.URL(pageURL)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return pageKnowledgeRecord(row), nil
}

// ListPageKnowledge returns the workspace's stored pages, newest read first.
func (c *Configuration) ListPageKnowledge(ctx context.Context, actor Actor) ([]PageKnowledgeRecord, error) {
	if err := c.AuthorizeRead(ctx, actor); err != nil {
		return nil, err
	}
	rows, err := c.client.PageKnowledge.Query().Where(pageknowledge.OrganizationID(actor.OrganizationID)).
		Order(ent.Desc(pageknowledge.FieldFetchedAt)).Limit(200).All(ctx)
	if err != nil {
		return nil, err
	}
	records := make([]PageKnowledgeRecord, len(rows))
	for i, row := range rows {
		records[i] = *pageKnowledgeRecord(row)
	}
	return records, nil
}

// SavePageKnowledgeInput is one read page. NotModified records a 304: the
// stored text stands and only the read time and run change.
type SavePageKnowledgeInput struct {
	ETag         string    `json:"etag"`
	FetchedAt    time.Time `json:"fetchedAt"`
	HTTPStatus   int       `json:"httpStatus"`
	LastModified string    `json:"lastModified"`
	NotModified  bool      `json:"notModified"`
	PageType     string    `json:"pageType"`
	RunID        string    `json:"runId"`
	Text         string    `json:"text"`
	Title        string    `json:"title"`
	URL          string    `json:"url"`
}

const maxPageKnowledgeText = 200_000

// SavePageKnowledge upserts a page on (workspace, url). Changed reports a new
// page or new content; an unchanged hash is what lets a re-run skip it.
func (c *Configuration) SavePageKnowledge(ctx context.Context, actor Actor, input SavePageKnowledgeInput) (*PageKnowledgeRecord, bool, error) {
	if err := c.authorizeRoles(ctx, actor, "owner", "admin"); err != nil {
		return nil, false, err
	}
	if !validProfileURL(input.URL) || pageknowledge.PageTypeValidator(pageknowledge.PageType(input.PageType)) != nil {
		return nil, false, ErrInvalidInput
	}
	if input.FetchedAt.IsZero() {
		input.FetchedAt = time.Now().UTC()
	}
	input.Text = clampRunes(input.Text, maxPageKnowledgeText)
	input.Title = clampRunes(strings.TrimSpace(input.Title), 300)
	current, err := c.client.PageKnowledge.Query().Where(pageknowledge.OrganizationID(actor.OrganizationID), pageknowledge.URL(input.URL)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return nil, false, err
	}
	if current != nil && input.NotModified {
		saved, err := current.Update().SetFetchedAt(input.FetchedAt).SetRunID(input.RunID).Save(ctx)
		if err != nil {
			return nil, false, err
		}
		return pageKnowledgeRecord(saved), false, nil
	}
	hash := ContentHash(input.Text)
	optional := func(value string) *string {
		if value == "" {
			return nil
		}
		value = clampRunes(value, 200)
		return &value
	}
	if current == nil {
		saved, err := c.client.PageKnowledge.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).SetRunID(input.RunID).
			SetURL(input.URL).SetTitle(input.Title).SetContentHash(hash).SetPageType(pageknowledge.PageType(input.PageType)).
			SetText(input.Text).SetHTTPStatus(input.HTTPStatus).SetNillableEtag(optional(input.ETag)).
			SetNillableLastModified(optional(input.LastModified)).SetFetchedAt(input.FetchedAt).Save(ctx)
		if ent.IsConstraintError(err) {
			return c.SavePageKnowledge(ctx, actor, input)
		}
		if err != nil {
			return nil, false, err
		}
		return pageKnowledgeRecord(saved), true, nil
	}
	saved, err := current.Update().SetRunID(input.RunID).SetTitle(input.Title).SetContentHash(hash).
		SetPageType(pageknowledge.PageType(input.PageType)).SetText(input.Text).SetHTTPStatus(input.HTTPStatus).
		SetNillableEtag(optional(input.ETag)).SetNillableLastModified(optional(input.LastModified)).SetFetchedAt(input.FetchedAt).Save(ctx)
	if err != nil {
		return nil, false, err
	}
	return pageKnowledgeRecord(saved), hash != current.ContentHash, nil
}

// BrandProfileSeed is what a site read suggests for the brand profile.
type BrandProfileSeed struct {
	Audience           string            `json:"audience"`
	ProductDescription string            `json:"productDescription"`
	SocialHandles      map[string]string `json:"socialHandles"`
	Tagline            string            `json:"tagline"`
}

// SeedBrandProfile fills only what the brand profile leaves empty, creating
// it when there is none. Unlike UpsertBrandProfile it never replaces a value,
// so nothing a person wrote is lost.
func (c *Configuration) SeedBrandProfile(ctx context.Context, actor Actor, seed BrandProfileSeed) error {
	if err := c.authorizeRoles(ctx, actor, "owner", "admin"); err != nil {
		return err
	}
	seed.Audience, seed.ProductDescription = clampRunes(strings.TrimSpace(seed.Audience), 1000), clampRunes(strings.TrimSpace(seed.ProductDescription), 2000)
	seed.Tagline = clampRunes(strings.TrimSpace(seed.Tagline), 200)
	handles := map[string]string{}
	for platform, handle := range seed.SocialHandles {
		if handle = strings.TrimSpace(handle); handle != "" && utf8.RuneCountInString(handle) <= 160 && len(handles) < 20 {
			handles[platform] = handle
		}
	}
	tx, err := c.client.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	current, err := tx.BrandProfile.Query().Where(brandprofile.OrganizationID(actor.OrganizationID)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	var id string
	if current == nil {
		create := tx.BrandProfile.Create().SetID(cuid.New()).SetOrganizationID(actor.OrganizationID).SetAudience(seed.Audience).
			SetProductDescription(seed.ProductDescription).SetTone("").SetPreferredStyles([]string{}).
			SetProhibitedTerms([]brand.ProhibitedTerm{}).SetSocialHandles(handles)
		if seed.Tagline != "" {
			create.SetTagline(seed.Tagline)
		}
		saved, err := create.Save(ctx)
		if ent.IsConstraintError(err) {
			return publishing.ErrConflict
		}
		if err != nil {
			return err
		}
		id = saved.ID
	} else {
		id = current.ID
		// Conditional on the row read, so a person's concurrent edit is never overwritten.
		update := tx.BrandProfile.UpdateOneID(current.ID).Where(brandprofile.UpdatedAt(current.UpdatedAt))
		filled := false
		if current.Audience == "" && seed.Audience != "" {
			update.SetAudience(seed.Audience)
			filled = true
		}
		if current.ProductDescription == "" && seed.ProductDescription != "" {
			update.SetProductDescription(seed.ProductDescription)
			filled = true
		}
		if (current.Tagline == nil || *current.Tagline == "") && seed.Tagline != "" {
			update.SetTagline(seed.Tagline)
			filled = true
		}
		merged := map[string]string{}
		for platform, handle := range current.SocialHandles {
			merged[platform] = handle
		}
		for platform, handle := range handles {
			if merged[platform] == "" {
				merged[platform] = handle
				filled = true
			}
		}
		if !filled {
			return nil
		}
		if _, err := update.SetSocialHandles(merged).Save(ctx); ent.IsNotFound(err) {
			return conflict("The brand profile changed while it was being seeded.")
		} else if err != nil {
			return err
		}
	}
	if err := appendConfigurationAudit(ctx, tx, actor, "product.brand_profile_seeded", "brand_profile", id); err != nil {
		return err
	}
	return tx.Commit()
}
