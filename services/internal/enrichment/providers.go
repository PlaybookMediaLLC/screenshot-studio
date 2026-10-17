package enrichment

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/onboarding"
)

// BrandAssets is the site provider's brand result.
type BrandAssets struct {
	Colors     []string `json:"colors,omitempty"`
	Favicon    string   `json:"favicon,omitempty"`
	Fonts      []string `json:"fonts,omitempty"`
	Logo       string   `json:"logo,omitempty"`
	ThemeColor string   `json:"themeColor,omitempty"`
}

// AppListing is an app store listing and its rating.
type AppListing struct {
	Genre       string  `json:"genre,omitempty"`
	Name        string  `json:"name"`
	Rating      float64 `json:"rating"`
	RatingCount int     `json:"ratingCount"`
	Seller      string  `json:"seller,omitempty"`
	URL         string  `json:"url"`
}

// Snippet is a search result or review excerpt, quoted at snippet length.
type Snippet struct {
	Text  string `json:"text"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

// Firmographics is what is known about the company itself.
type Firmographics struct {
	Employees    int    `json:"employees,omitempty"`
	Founded      string `json:"founded,omitempty"`
	FundingStage string `json:"fundingStage,omitempty"`
	FundingTotal int64  `json:"fundingTotal,omitempty"`
	Headquarters string `json:"headquarters,omitempty"`
	Industry     string `json:"industry,omitempty"`
	Size         string `json:"size,omitempty"`
}

var vendor = &http.Client{Timeout: 15 * time.Second}

// getJSON calls a fixed vendor host and decodes its JSON answer.
func getJSON(ctx context.Context, client *http.Client, target string, headers map[string]string, out any) (int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return 0, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", onboarding.UserAgent)
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, &ProviderError{Retryable: true}
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return response.StatusCode, nil
	}
	if response.StatusCode != http.StatusOK {
		return response.StatusCode, &ProviderError{Retryable: response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500, Status: response.StatusCode}
	}
	return response.StatusCode, json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(out)
}

func clampSnippet(value string) string {
	return onboarding.ClampText(strings.TrimSpace(onboarding.StripInvisible(value)), 300)
}

// Site reads brand assets, social and app store links, and JSON-LD company
// facts from the product's own homepage: first-party, keyless, through the
// SSRF-guarded fetcher. Its results are cached for a week, so a re-run reads nothing.
type Site struct {
	Fetcher *onboarding.Fetcher
	Off     bool
}

func (*Site) Name() string       { return "site" }
func (s *Site) Enabled() bool    { return !s.Off && s.Fetcher != nil }
func (*Site) TTL() time.Duration { return 7 * 24 * time.Hour }

var (
	hexColor     = regexp.MustCompile(`^#(?:[0-9a-f]{3}|[0-9a-f]{6})$`)
	cssColor     = regexp.MustCompile(`(?i)--[\w-]*(?:color|primary|brand|accent|background|bg|text|foreground)[\w-]*\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b`)
	googleFont   = regexp.MustCompile(`fonts\.googleapis\.com/css2?\?[^"'>]*?family=([^"'&:>]+)`)
	fontFamily   = regexp.MustCompile(`(?i)font-family\s*:\s*["']?([A-Za-z][\w \-]{1,40}?)["']?\s*[,;}]`)
	genericFonts = map[string]bool{"inherit": true, "initial": true, "sans-serif": true, "serif": true, "monospace": true, "system-ui": true, "var": true}
)

func (s *Site) Enrich(ctx context.Context, subject Subject) ([]Result, error) {
	page, err := s.Fetcher.Get(ctx, subject.Homepage, onboarding.Conditional{})
	if err != nil {
		return nil, &ProviderError{Retryable: false}
	}
	doc := onboarding.ParseHTML(page.Body, page.URL)
	brand := onboarding.ExtractBrand(doc, page.URL)
	html := string(page.Body)
	assets := BrandAssets{Favicon: brand.Favicon, Logo: brand.Logo, ThemeColor: brand.ThemeColor, Colors: ranked(cssColor, html, 6, strings.ToLower),
		Fonts: append(ranked(googleFont, html, 2, func(value string) string { return strings.ReplaceAll(value, "+", " ") }),
			ranked(fontFamily, html, 4, strings.TrimSpace)...)}
	assets.Fonts = dedupe(assets.Fonts, 4)
	results := []Result{{Confidence: 0.8, Field: FieldBrand, SourceURL: page.URL, Value: assets}}
	if len(brand.Socials) > 0 {
		results = append(results, Result{Confidence: 0.9, Field: FieldSocials, SourceURL: page.URL, Value: brand.Socials})
	}
	if len(brand.AppStoreURLs)+len(brand.PlayStoreURLs) > 0 {
		results = append(results, Result{Confidence: 0.9, Field: FieldApps, SourceURL: page.URL,
			Value: map[string][]string{"appStore": brand.AppStoreURLs, "googlePlay": brand.PlayStoreURLs}})
	}
	if facts := jsonLDFirmographics(doc.JSONLD); facts != (Firmographics{}) {
		results = append(results, Result{Confidence: 0.7, Field: FieldFirmographics, SourceURL: page.URL, Value: facts})
	}
	return results, nil
}

// ranked is a pattern's distinct first groups, most frequent first.
func ranked(pattern *regexp.Regexp, text string, limit int, normalize func(string) string) []string {
	counts := map[string]int{}
	order := []string{}
	for _, match := range pattern.FindAllStringSubmatch(text, 200) {
		value := normalize(match[1])
		if value == "" || genericFonts[strings.ToLower(value)] {
			continue
		}
		if counts[value] == 0 {
			order = append(order, value)
		}
		counts[value]++
	}
	sort.SliceStable(order, func(i, j int) bool { return counts[order[i]] > counts[order[j]] })
	return order[:min(limit, len(order))]
}

func dedupe(values []string, limit int) []string {
	seen := map[string]bool{}
	var out []string
	for _, value := range values {
		if key := strings.ToLower(value); !seen[key] && len(out) < limit {
			seen[key] = true
			out = append(out, value)
		}
	}
	return out
}

func jsonLDFirmographics(nodes []map[string]any) Firmographics {
	var facts Firmographics
	for _, node := range nodes {
		kind := fmt.Sprint(node["@type"])
		if !strings.Contains(kind, "Organization") && !strings.Contains(kind, "Corporation") {
			continue
		}
		if founded, ok := node["foundingDate"].(string); ok {
			facts.Founded = clampSnippet(founded)
		}
		if address, ok := node["address"].(map[string]any); ok {
			facts.Headquarters = clampSnippet(strings.Trim(fmt.Sprintf("%v, %v", value(address["addressLocality"]), value(address["addressCountry"])), ", "))
		}
		switch employees := node["numberOfEmployees"].(type) {
		case float64:
			facts.Employees = int(employees)
		case map[string]any:
			if count, ok := employees["value"].(float64); ok {
				facts.Employees = int(count)
			}
		}
	}
	return facts
}

func value(field any) string {
	if field == nil {
		return ""
	}
	if text, ok := field.(string); ok {
		return text
	}
	if object, ok := field.(map[string]any); ok {
		return value(object["name"])
	}
	return ""
}

// GitHub reads stars and followers for the GitHub profile the site links,
// from the public API. Keyless; PLATFORM_ENRICHMENT_GITHUB_TOKEN raises the limit.
type GitHub struct {
	BaseURL string
	Client  *http.Client
	Off     bool
	Token   string
}

func (*GitHub) Name() string       { return "github" }
func (g *GitHub) Enabled() bool    { return !g.Off }
func (*GitHub) TTL() time.Duration { return 7 * 24 * time.Hour }

func (g *GitHub) Enrich(ctx context.Context, subject Subject) ([]Result, error) {
	link := subject.Socials["github"]
	parsed, err := url.Parse(link)
	if link == "" || err != nil {
		return nil, nil
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	base := strings.TrimRight(firstNonEmpty(g.BaseURL, "https://api.github.com"), "/")
	client := g.Client
	if client == nil {
		client = vendor
	}
	headers := map[string]string{"X-GitHub-Api-Version": "2022-11-28"}
	if g.Token != "" {
		headers["Authorization"] = "Bearer " + g.Token
	}
	reach := map[string]any{"url": link}
	var account struct {
		Followers   int `json:"followers"`
		PublicRepos int `json:"public_repos"`
	}
	status, err := getJSON(ctx, client, base+"/users/"+url.PathEscape(parts[0]), headers, &account)
	if err != nil {
		return nil, err
	}
	if status == http.StatusOK {
		reach["followers"], reach["publicRepos"] = account.Followers, account.PublicRepos
	}
	if len(parts) > 1 && parts[1] != "" {
		var repository struct {
			Stars int `json:"stargazers_count"`
		}
		if status, err := getJSON(ctx, client, base+"/repos/"+url.PathEscape(parts[0])+"/"+url.PathEscape(parts[1]), headers, &repository); err != nil {
			return nil, err
		} else if status == http.StatusOK {
			reach["stars"] = repository.Stars
		}
	}
	if len(reach) == 1 {
		return nil, nil
	}
	return []Result{{Confidence: 0.9, Field: FieldReach, SourceURL: link, Value: map[string]any{"github": reach}}}, nil
}

// AppStore reads the App Store listing, rating, and recent reviews for each
// app the site links, from the public iTunes lookup and reviews feeds.
type AppStore struct {
	BaseURL string
	Client  *http.Client
	Country string
	Off     bool
}

func (*AppStore) Name() string       { return "appstore" }
func (a *AppStore) Enabled() bool    { return !a.Off }
func (*AppStore) TTL() time.Duration { return 7 * 24 * time.Hour }

var appID = regexp.MustCompile(`/id(\d{4,12})`)

func (a *AppStore) Enrich(ctx context.Context, subject Subject) ([]Result, error) {
	base := strings.TrimRight(firstNonEmpty(a.BaseURL, "https://itunes.apple.com"), "/")
	client := a.Client
	if client == nil {
		client = vendor
	}
	country := firstNonEmpty(a.Country, "us")
	var listings []AppListing
	var reviews []Snippet
	for _, link := range subject.AppStoreURLs[:min(len(subject.AppStoreURLs), 2)] {
		match := appID.FindStringSubmatch(link)
		if match == nil {
			continue
		}
		var lookup struct {
			Results []struct {
				Genre       string  `json:"primaryGenreName"`
				Name        string  `json:"trackName"`
				Rating      float64 `json:"averageUserRating"`
				RatingCount int     `json:"userRatingCount"`
				Seller      string  `json:"sellerName"`
				URL         string  `json:"trackViewUrl"`
			} `json:"results"`
		}
		if _, err := getJSON(ctx, client, base+"/lookup?id="+match[1]+"&country="+country, nil, &lookup); err != nil {
			return nil, err
		}
		for _, result := range lookup.Results {
			listings = append(listings, AppListing{Genre: result.Genre, Name: clampSnippet(result.Name), Rating: result.Rating,
				RatingCount: result.RatingCount, Seller: clampSnippet(result.Seller), URL: firstNonEmpty(result.URL, link)})
		}
		var feed struct {
			Feed struct {
				Entry []struct {
					Content struct {
						Label string `json:"label"`
					} `json:"content"`
					Title struct {
						Label string `json:"label"`
					} `json:"title"`
				} `json:"entry"`
			} `json:"feed"`
		}
		if _, err := getJSON(ctx, client, base+"/"+country+"/rss/customerreviews/id="+match[1]+"/sortby=mostrecent/json", nil, &feed); err == nil {
			for _, entry := range feed.Feed.Entry[:min(len(feed.Feed.Entry), 10)] {
				reviews = append(reviews, Snippet{Text: clampSnippet(entry.Content.Label), Title: clampSnippet(entry.Title.Label), URL: link})
			}
		}
	}
	var results []Result
	if len(listings) > 0 {
		results = append(results, Result{Confidence: 0.9, Field: FieldApps, SourceURL: listings[0].URL, Value: listings})
	}
	if len(reviews) > 0 {
		results = append(results, Result{Confidence: 0.6, Field: FieldReviews, SourceURL: subject.AppStoreURLs[0], Value: reviews})
	}
	return results, nil
}

// PeopleDataLabs reads company size, industry, funding, and headquarters from
// PDL's company enrichment, one call per domain. Needs PLATFORM_ENRICHMENT_PDL_API_KEY.
type PeopleDataLabs struct {
	APIKey  string
	BaseURL string
	Client  *http.Client
}

// pdlCostMicros is what one matched company lookup costs.
const pdlCostMicros = 100_000

func (*PeopleDataLabs) Name() string       { return "pdl" }
func (p *PeopleDataLabs) Enabled() bool    { return p.APIKey != "" }
func (*PeopleDataLabs) TTL() time.Duration { return 30 * 24 * time.Hour }

func (p *PeopleDataLabs) Enrich(ctx context.Context, subject Subject) ([]Result, error) {
	base := strings.TrimRight(firstNonEmpty(p.BaseURL, "https://api.peopledatalabs.com"), "/")
	client := p.Client
	if client == nil {
		client = vendor
	}
	var company struct {
		Employees    int     `json:"employee_count"`
		Founded      int     `json:"founded"`
		FundingStage string  `json:"latest_funding_stage"`
		FundingTotal int64   `json:"total_funding_raised"`
		Industry     string  `json:"industry"`
		Likelihood   float64 `json:"likelihood"`
		Location     struct {
			Name string `json:"name"`
		} `json:"location"`
		Size string `json:"size"`
	}
	status, err := getJSON(ctx, client, base+"/v5/company/enrich?website="+url.QueryEscape(subject.Domain), map[string]string{"X-Api-Key": p.APIKey}, &company)
	if err != nil || status != http.StatusOK {
		return nil, err
	}
	facts := Firmographics{Employees: company.Employees, FundingStage: clampSnippet(company.FundingStage), FundingTotal: company.FundingTotal,
		Headquarters: clampSnippet(company.Location.Name), Industry: clampSnippet(company.Industry), Size: clampSnippet(company.Size)}
	if company.Founded > 0 {
		facts.Founded = strconv.Itoa(company.Founded)
	}
	return []Result{{Confidence: min(1, max(0.3, company.Likelihood/10)), CostMicros: pdlCostMicros, Field: FieldFirmographics,
		SourceURL: "https://www.peopledatalabs.com", Value: facts}}, nil
}

// Brave finds competitors, alternatives, and what people write about the
// product through the Brave Search API, at most four queries a run. Needs
// PLATFORM_ENRICHMENT_BRAVE_API_KEY. Snippets only; no result page is fetched.
type Brave struct {
	APIKey  string
	BaseURL string
	Client  *http.Client
}

// braveCostMicros is what one search query costs.
const braveCostMicros = 5_000

func (*Brave) Name() string       { return "brave" }
func (b *Brave) Enabled() bool    { return b.APIKey != "" }
func (*Brave) TTL() time.Duration { return 24 * time.Hour }

func (b *Brave) Enrich(ctx context.Context, subject Subject) ([]Result, error) {
	if subject.Name == "" {
		return nil, nil
	}
	base := strings.TrimRight(firstNonEmpty(b.BaseURL, "https://api.search.brave.com"), "/")
	client := b.Client
	if client == nil {
		client = vendor
	}
	var results []Result
	for field, queries := range map[string][]string{FieldCompetitors: {"alternatives", "vs"}, FieldMentions: {"review", "reddit"}} {
		var snippets []Snippet
		cost := int64(0)
		for _, suffix := range queries {
			var answer struct {
				Web struct {
					Results []struct {
						Description string `json:"description"`
						Title       string `json:"title"`
						URL         string `json:"url"`
					} `json:"results"`
				} `json:"web"`
			}
			query := url.QueryEscape(`"` + subject.Name + `" ` + suffix)
			if _, err := getJSON(ctx, client, base+"/res/v1/web/search?count=5&q="+query, map[string]string{"X-Subscription-Token": b.APIKey}, &answer); err != nil {
				return nil, err
			}
			cost += braveCostMicros
			for _, result := range answer.Web.Results {
				if parsed, err := url.Parse(result.URL); err == nil && Domain(result.URL) != subject.Domain && (parsed.Scheme == "https" || parsed.Scheme == "http") {
					snippets = append(snippets, Snippet{Text: clampSnippet(result.Description), Title: clampSnippet(result.Title), URL: result.URL})
				}
			}
		}
		// Kept even when empty, so the queries' cost is recorded and cached.
		source := ""
		if len(snippets) > 0 {
			source = snippets[0].URL
		} else {
			snippets = []Snippet{}
		}
		results = append(results, Result{Confidence: 0.4, CostMicros: cost, Field: field, SourceURL: source, Value: snippets})
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Field < results[j].Field })
	return results, nil
}
