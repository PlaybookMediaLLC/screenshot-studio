package onboarding

import (
	"context"
	"encoding/xml"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// Page discovery (docs/rfcs/012-product-intelligence.md): same-origin pages
// scored by path, robots.txt honored, the homepage excluded (it is always
// read). A port of lib/onboarding/pages.ts.

// Page types, as PageKnowledge stores them.
const (
	PageHomepage  = "homepage"
	PagePricing   = "pricing"
	PageFeatures  = "features"
	PageDocs      = "docs"
	PageChangelog = "changelog"
	PageAbout     = "about"
	PageOther     = "other"
)

type pathScore struct {
	pattern  *regexp.Regexp
	pageType string
	score    int
}

var pathScores = []pathScore{
	{regexp.MustCompile(`^/(legal|privacy|terms|cookies?)(/|$)`), PageOther, 0},
	{regexp.MustCompile(`^/(pricing|plans)$`), PagePricing, 100},
	{regexp.MustCompile(`^/(features?|product|solutions)(/|$)`), PageFeatures, 90},
	{regexp.MustCompile(`^/(docs|documentation)$`), PageDocs, 70},
	{regexp.MustCompile(`^/(changelog|releases|whats-new)$`), PageChangelog, 70},
	{regexp.MustCompile(`^/(about|customers|case-studies)(/|$)`), PageAbout, 50},
	{regexp.MustCompile(`^/blog/`), PageOther, 20},
}

// otherPageScore is any other page: worth reading only when nothing better exists.
const otherPageScore = 5

func cleanPath(pathname string) string {
	path := strings.TrimRight(strings.ToLower(pathname), "/")
	if path == "" {
		return "/"
	}
	return path
}

// ScorePath is how useful a page is for describing the product, and its type.
// A score of 0 means never read it.
func ScorePath(pathname string) (int, string) {
	path := cleanPath(pathname)
	if path == "/" {
		return 0, PageHomepage
	}
	for _, candidate := range pathScores {
		if candidate.pattern.MatchString(path) {
			return candidate.score, candidate.pageType
		}
	}
	return otherPageScore, PageOther
}

// ClassifyPage is a page's type from its path, then its title.
func ClassifyPage(pageURL, title string) string {
	parsed, err := url.Parse(pageURL)
	if err != nil {
		return PageOther
	}
	if _, pageType := ScorePath(parsed.Path); pageType != PageOther {
		return pageType
	}
	title = strings.ToLower(title)
	for _, hint := range []struct{ word, pageType string }{{"pricing", PagePricing}, {"plans", PagePricing},
		{"features", PageFeatures}, {"changelog", PageChangelog}, {"release notes", PageChangelog},
		{"documentation", PageDocs}, {"docs", PageDocs}, {"about", PageAbout}} {
		if strings.Contains(title, hint.word) {
			return hint.pageType
		}
	}
	return PageOther
}

// NormalizeURL drops the fragment and query and the trailing slash, so
// /features and /features/ are one page.
func NormalizeURL(raw string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", false
	}
	parsed.Fragment, parsed.RawQuery, parsed.User = "", "", nil
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if parsed.Path == "" {
		parsed.Path = "/"
	}
	return parsed.String(), true
}

// PickPages returns the best limit pages: same origin as the homepage,
// allowed by robots, scored above 0, best first and shallower first on a tie.
func PickPages(homepage string, candidates []string, robots *Robots, limit int) []string {
	home, ok := NormalizeURL(homepage)
	if !ok {
		return nil
	}
	origin, _ := url.Parse(home)
	seen := map[string]bool{home: true}
	type scored struct {
		depth, score int
		url          string
	}
	var pages []scored
	for _, candidate := range candidates {
		normalized, ok := NormalizeURL(candidate)
		if !ok || seen[normalized] {
			continue
		}
		seen[normalized] = true
		parsed, _ := url.Parse(normalized)
		if parsed.Scheme != origin.Scheme || parsed.Host != origin.Host {
			continue
		}
		score, _ := ScorePath(parsed.Path)
		if score == 0 || !robots.Allows(parsed.Path) {
			continue
		}
		pages = append(pages, scored{depth: strings.Count(parsed.Path, "/"), score: score, url: normalized})
	}
	sort.SliceStable(pages, func(i, j int) bool {
		if pages[i].score != pages[j].score {
			return pages[i].score > pages[j].score
		}
		return pages[i].depth < pages[j].depth
	})
	out := make([]string, 0, min(limit, len(pages)))
	for _, page := range pages {
		if len(out) == limit {
			break
		}
		out = append(out, page.url)
	}
	return out
}

type sitemapDocument struct {
	XMLName xml.Name
	Entries []struct {
		Loc string `xml:"loc"`
	} `xml:",any"`
}

// parseSitemap returns a sitemap's locations and whether it is an index.
func parseSitemap(body []byte) ([]string, bool) {
	var document sitemapDocument
	if xml.Unmarshal(body, &document) != nil {
		return nil, false
	}
	var locs []string
	for _, entry := range document.Entries {
		if loc := strings.TrimSpace(entry.Loc); loc != "" {
			locs = append(locs, loc)
		}
	}
	return locs, document.XMLName.Local == "sitemapindex"
}

const (
	maxChildSitemaps = 3
	maxSitemapURLs   = 500
)

// Discovery is a site's robots.txt and the page URLs its sitemap lists.
type Discovery struct {
	Robots *Robots
	URLs   []string
}

// Discover reads robots.txt and the sitemap (/sitemap.xml, else the robots
// Sitemap line), following an index into its first few children. Failures
// return what was found; the caller falls back to homepage links.
func (f *Fetcher) Discover(ctx context.Context, homepage string) Discovery {
	parsed, err := url.Parse(homepage)
	if err != nil {
		return Discovery{Robots: ParseRobots("")}
	}
	origin := parsed.Scheme + "://" + parsed.Host
	discovery := Discovery{Robots: ParseRobots("")}
	if page, err := f.Get(ctx, origin+"/robots.txt", Conditional{}); err == nil {
		discovery.Robots = ParseRobots(string(page.Body))
	}
	candidates := append([]string{origin + "/sitemap.xml"}, discovery.Robots.Sitemaps...)
	for _, sitemap := range candidates {
		page, err := f.Get(ctx, sitemap, Conditional{})
		if err != nil {
			continue
		}
		locs, index := parseSitemap(page.Body)
		if index {
			var children []string
			for _, child := range locs[:min(len(locs), maxChildSitemaps)] {
				if childPage, err := f.Get(ctx, child, Conditional{}); err == nil {
					childLocs, _ := parseSitemap(childPage.Body)
					children = append(children, childLocs...)
				}
			}
			locs = children
		}
		if len(locs) > 0 {
			discovery.URLs = locs[:min(len(locs), maxSitemapURLs)]
			return discovery
		}
	}
	return discovery
}
