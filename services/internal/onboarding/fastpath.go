package onboarding

import (
	"context"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/platformai"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// The fast path's budgets (docs/rfcs/032-background-onboarding-agent.md).
// The scrape and the site map run in parallel, so the budgets overlap; the
// whole path stops at Total, before the request's 10 seconds are up.
var FastPathBudget = struct{ Total, Scrape, Sitemap, Brand, Draft time.Duration }{
	Total: 9500 * time.Millisecond, Scrape: 4 * time.Second, Sitemap: 4 * time.Second, Brand: 2 * time.Second, Draft: 6 * time.Second,
}

// homepageTextLimit bounds the homepage text the draft reads.
const homepageTextLimit = 12_000

// FastPath reads a homepage and its site map, extracts the brand, and makes
// one model call. Every stage degrades instead of failing.
type FastPath struct {
	Fetcher *Fetcher
	// Model may be nil: the draft then comes from the page's metadata.
	Model Model
}

// FastPathInput is one read. Cached is the stored homepage; within the
// cache age it is used without a fetch, as is CachedPages.
type FastPathInput struct {
	Brief        string
	Cached       *product.PageKnowledgeRecord
	CachedPages  []string
	HavePages    bool
	HaveProfile  bool
	ModelAllowed bool
	PageLimit    int
	URL          string
}

// FastPathResult is what the read produced.
type FastPathResult struct {
	Brand *Brand
	// Discovered are the pages the background crawl reads, best first.
	Discovered []string
	Draft      *Draft
	// Extracted is a draft from the model, not only page metadata.
	Extracted bool
	// Homepage is the page to store, when it was fetched.
	Homepage *product.SavePageKnowledgeInput
	// Reason says why the site could not be read, when it could not.
	Reason string
	// Reused is an unchanged homepage with a saved profile: no model call.
	Reused   bool
	TimedOut []string
	Usage    platformai.Usage
}

type scrapeResult struct {
	brand    *Brand
	doc      *Document
	err      error
	page     *Page
	timedOut []string
}

// Run reads the site within the budget. It never returns an error: a site it
// cannot read yields a Reason and an empty draft, and the manual form.
func (f *FastPath) Run(ctx context.Context, input FastPathInput) *FastPathResult {
	ctx, cancel := context.WithTimeout(ctx, FastPathBudget.Total)
	defer cancel()
	result := &FastPathResult{}
	cached := input.Cached != nil && time.Since(input.Cached.FetchedAt) < product.OnboardingCacheAge
	var (
		doc       *Document
		text      string
		title     string
		discovery Discovery
	)
	if cached && input.HavePages {
		text, title = input.Cached.Text, input.Cached.Title
		discovery = Discovery{Robots: ParseRobots(""), URLs: input.CachedPages}
	} else {
		var wait sync.WaitGroup
		var scraped scrapeResult
		wait.Add(2)
		go func() {
			defer wait.Done()
			scraped = f.scrape(ctx, input.URL)
		}()
		go func() {
			defer wait.Done()
			sitemapCtx, cancel := context.WithTimeout(ctx, FastPathBudget.Sitemap)
			defer cancel()
			discovery = f.Fetcher.Discover(sitemapCtx, input.URL)
			if sitemapCtx.Err() != nil {
				result.TimedOut = append(result.TimedOut, "sitemap")
			}
		}()
		wait.Wait()
		result.TimedOut = append(result.TimedOut, scraped.timedOut...)
		if scraped.err != nil {
			result.Reason = scraped.err.Error()
			return result
		}
		doc, result.Brand = scraped.doc, scraped.brand
		text, title = doc.Text, doc.Title
		if parsed, err := url.Parse(scraped.page.URL); err == nil && !discovery.Robots.Allows(parsed.EscapedPath()) {
			result.Reason = "The site's robots.txt asks crawlers not to read it."
			return result
		}
		result.Homepage = &product.SavePageKnowledgeInput{ETag: scraped.page.ETag, FetchedAt: time.Now().UTC(), HTTPStatus: scraped.page.Status,
			LastModified: scraped.page.LastModified, PageType: PageHomepage, Text: text, Title: title, URL: input.URL}
		if len(discovery.URLs) == 0 {
			discovery.URLs = doc.Links
		}
	}
	result.Discovered = PickPages(input.URL, discovery.URLs, discovery.Robots, input.PageLimit)
	if input.Cached != nil && input.HaveProfile && input.Cached.ContentHash == product.ContentHash(text) {
		result.Reused = true
		return result
	}
	flagged := len(DetectInjection(text)) > 0 || (doc != nil && len(DetectInjection(doc.Hidden)) > 0)
	draftInput := DraftInput{Brief: strings.TrimSpace(input.Brief), Homepage: input.URL, Sources: []Source{
		{Flagged: flagged, ID: "S1", Kind: PageHomepage, Text: ClampText(text, homepageTextLimit), Title: title, URL: input.URL}}}
	if f.Model != nil && input.ModelAllowed {
		remaining := time.Until(deadline(ctx)) - 300*time.Millisecond
		draftCtx, cancel := context.WithTimeout(ctx, min(FastPathBudget.Draft, remaining))
		draft, usage, err := RunDraft(draftCtx, f.Model, draftInput, platformai.RoleFast)
		if draftCtx.Err() != nil {
			result.TimedOut = append(result.TimedOut, "draft")
		}
		cancel()
		result.Usage = usage
		if err == nil && !draft.Empty() {
			result.Draft, result.Extracted = draft, true
		}
	}
	if result.Draft == nil {
		result.Draft = metadataDraft(result.Brand, doc, title, input.URL)
	}
	return result
}

func deadline(ctx context.Context) time.Time {
	if at, ok := ctx.Deadline(); ok {
		return at
	}
	return time.Now().Add(FastPathBudget.Total)
}

// scrape reads the homepage within its budget, then the brand within its own.
func (f *FastPath) scrape(ctx context.Context, target string) scrapeResult {
	scrapeCtx, cancel := context.WithTimeout(ctx, FastPathBudget.Scrape)
	defer cancel()
	page, err := f.Fetcher.Get(scrapeCtx, target, Conditional{})
	result := scrapeResult{err: err, page: page}
	if page != nil && page.Truncated && scrapeCtx.Err() != nil {
		// What arrived is the head: a metadata-only read.
		result.timedOut = append(result.timedOut, "scrape")
	} else if err != nil && scrapeCtx.Err() != nil {
		result.timedOut = append(result.timedOut, "scrape")
	}
	if err != nil {
		return result
	}
	result.doc = ParseHTML(page.Body, page.URL)
	done := make(chan Brand, 1)
	go func() { done <- ExtractBrand(result.doc, page.URL) }()
	select {
	case brand := <-done:
		result.brand = &brand
	case <-time.After(FastPathBudget.Brand):
		result.timedOut = append(result.timedOut, "brand")
	}
	return result
}

// metadataDraft is the profile a page's own title and description give,
// for when the model could not help.
func metadataDraft(brand *Brand, doc *Document, title, target string) *Draft {
	name, summary := "", ""
	if brand != nil {
		name, summary = brand.Name, brand.Description
	} else if doc != nil {
		name, summary = titleSeparator.Split(doc.Title, 2)[0], doc.Description
	} else {
		name = titleSeparator.Split(title, 2)[0]
	}
	if strings.TrimSpace(name) == "" {
		if parsed, err := url.Parse(target); err == nil {
			name = strings.TrimPrefix(parsed.Hostname(), "www.")
		}
	}
	name = ClampText(strings.TrimSpace(name), 160)
	draft := &Draft{Profile: product.UpsertProductProfileInput{Name: &name, Source: product.ProfileSourceAutomated, URL: &target,
		SourceURLs: map[string]string{"name": target}, Confidence: map[string]float64{"name": 0.5}}}
	if summary = ClampText(strings.TrimSpace(summary), 2_000); summary != "" && len(DetectInjection(summary)) == 0 {
		draft.Profile.Summary = &summary
		draft.Profile.SourceURLs["summary"], draft.Profile.Confidence["summary"] = target, 0.5
	}
	return draft
}
