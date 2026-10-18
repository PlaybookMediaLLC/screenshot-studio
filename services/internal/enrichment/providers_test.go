package enrichment

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/onboarding"
)

const homepage = `<!doctype html><html><head><title>Acme | Invoicing</title>
<meta name="theme-color" content="#3355FF"><link rel="apple-touch-icon" href="/touch.png">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap" rel="stylesheet">
<style>:root{--brand-primary:#3355ff;--text-color:#101010;--bg:#fafafa} h1{font-family:"Space Grotesk", sans-serif;} p{font-family: Inter, sans-serif;}</style>
<script type="application/ld+json">{"@type":"Organization","foundingDate":"2019","numberOfEmployees":42,"address":{"addressLocality":"Lisbon","addressCountry":"PT"}}</script>
</head><body><a href="https://github.com/acme/acme-app">GitHub</a><a href="https://x.com/acme">X</a>
<a href="https://apps.apple.com/us/app/acme/id1234567">iPhone</a><a href="https://play.google.com/store/apps/details?id=com.acme">Android</a></body></html>`

func vendorServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}

func TestSiteReadsBrandAssetsLinksAndCompanyFacts(t *testing.T) {
	t.Setenv("NODE_ENV", "test")
	t.Setenv("SCREENSHOT_E2E_ALLOWED_DOWNLOAD_HOSTS", "127.0.0.1")
	site := vendorServer(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(homepage)) })
	results, err := (&Site{Fetcher: onboarding.NewFetcher()}).Enrich(context.Background(), Subject{Homepage: site.URL + "/"})
	if err != nil {
		t.Fatal(err)
	}
	byField := map[string]any{}
	for _, result := range results {
		byField[result.Field] = result.Value
	}
	brand := byField[FieldBrand].(BrandAssets)
	if brand.ThemeColor != "#3355ff" || brand.Colors[0] != "#3355ff" || brand.Fonts[0] != "Space Grotesk" || !strings.HasSuffix(brand.Logo, "/touch.png") {
		t.Fatalf("brand %+v", brand)
	}
	if socials := byField[FieldSocials].(map[string]string); socials["github"] != "https://github.com/acme/acme-app" || socials["x"] != "https://x.com/acme" {
		t.Fatalf("socials %v", socials)
	}
	if apps := byField[FieldApps].(map[string][]string); len(apps["appStore"]) != 1 || len(apps["googlePlay"]) != 1 {
		t.Fatalf("apps %v", apps)
	}
	if facts := byField[FieldFirmographics].(Firmographics); facts.Founded != "2019" || facts.Employees != 42 || facts.Headquarters != "Lisbon, PT" {
		t.Fatalf("facts %+v", facts)
	}
	if kit := sixDigit("#35F"); kit != "#3355ff" || sixDigit("blue") != "" {
		t.Fatalf("hex %s", kit)
	}
}

func TestGitHubAndAppStoreReadPublicCounts(t *testing.T) {
	github := vendorServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/users/acme":
			_, _ = w.Write([]byte(`{"followers":321,"public_repos":12}`))
		case "/repos/acme/acme-app":
			_, _ = w.Write([]byte(`{"stargazers_count":4567}`))
		default:
			http.NotFound(w, r)
		}
	})
	results, err := (&GitHub{BaseURL: github.URL}).Enrich(context.Background(), Subject{Socials: map[string]string{"github": "https://github.com/acme/acme-app"}})
	reach := results[0].Value.(map[string]any)["github"].(map[string]any)
	if err != nil || reach["followers"] != 321 || reach["stars"] != 4567 {
		t.Fatalf("reach %v err=%v", reach, err)
	}
	if none, err := (&GitHub{BaseURL: github.URL}).Enrich(context.Background(), Subject{}); none != nil || err != nil {
		t.Fatalf("no link: %v %v", none, err)
	}
	store := vendorServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/lookup" && r.URL.Query().Get("id") == "1234567" {
			_, _ = w.Write([]byte(`{"results":[{"trackName":"Acme","averageUserRating":4.7,"userRatingCount":1200,"trackViewUrl":"https://apps.apple.com/app/id1234567"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"feed":{"entry":[{"title":{"label":"Saves hours"},"content":{"label":"Invoices go out on time."}}]}}`))
	})
	results, err = (&AppStore{BaseURL: store.URL}).Enrich(context.Background(), Subject{AppStoreURLs: []string{"https://apps.apple.com/us/app/acme/id1234567"}})
	if err != nil || len(results) != 2 || results[0].Value.([]AppListing)[0].RatingCount != 1200 || results[1].Value.([]Snippet)[0].Title != "Saves hours" {
		t.Fatalf("app store %+v err=%v", results, err)
	}
}

// Exa is off without its key; every call asks for structured output and
// reads output.content; results on the product's own domain are dropped;
// grounding sets the source and confidence; each call records its own cost;
// a reply without structured output is a failure, not free text.
func TestExaAsksForStructuredOutputOnEveryCall(t *testing.T) {
	if (&Exa{}).Enabled() {
		t.Fatal("Exa is enabled without a key")
	}
	var calls atomic.Int32
	var unstructured atomic.Bool
	var mu sync.Mutex
	var queries []map[string]any
	exa := vendorServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("X-Api-Key") != "key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		queries = append(queries, body)
		mu.Unlock()
		if r.URL.Path != "/search" || body["outputSchema"] == nil || unstructured.Load() {
			_, _ = w.Write([]byte(`{"results":[],"costDollars":{"total":0.005}}`))
			return
		}
		query := body["query"].(string)
		switch {
		case strings.HasPrefix(query, "Alternatives"):
			_, _ = w.Write([]byte(`{"output":{"content":{"competitors":[{"name":"Ledgerly","url":"https://ledgerly.test/","reason":"Invoicing for freelancers."},
{"name":"Acme","url":"https://www.acme.test/","reason":"The product itself."}]},
"grounding":[{"field":"competitors[0].name","citations":[{"url":"https://compare.test/acme","title":"Acme alternatives"}],"confidence":"high"}]},
"costDollars":{"total":0.012}}`))
		case strings.HasPrefix(query, "What customers say"):
			_, _ = w.Write([]byte(`{"output":{"content":{"praise":["Late payments stopped."],"complaints":["No multi-currency."],"channels":["r/agency"]},
"grounding":[{"field":"complaints[0]","citations":[{"url":"https://reviews.test/acme","title":"Review"}],"confidence":"medium"}]},
"costDollars":{"total":0.013}}`))
		default:
			_, _ = w.Write([]byte(`{"output":{"content":{"employees":40,"industry":"Software","headquarters":"Lisbon, Portugal","fundingStage":"Seed","fundingTotal":2500000,"founded":"2019"},
"grounding":[{"field":"fundingTotal","citations":[{"url":"https://news.test/acme-seed","title":"Seed round"}],"confidence":"low"}]},
"costDollars":{"total":0.014}}`))
		}
	})
	provider := &Exa{APIKey: "key", BaseURL: exa.URL}
	subject := Subject{Domain: "acme.test", Homepage: "https://acme.test/", Name: "Acme"}
	results, err := provider.Enrich(context.Background(), subject)
	if err != nil || len(results) != 3 || calls.Load() != 3 {
		t.Fatalf("results %+v err=%v calls=%d", results, err, calls.Load())
	}
	competitors, mentions := results[0].Value.([]Snippet), results[1].Value.([]Snippet)
	facts := results[2].Value.(Firmographics)
	if len(competitors) != 1 || competitors[0].Title != "Ledgerly" || competitors[0].Text != "Invoicing for freelancers." ||
		results[0].SourceURL != "https://compare.test/acme" || results[0].Confidence != 0.7 || results[0].CostMicros != 12_000 {
		t.Fatalf("competitors %+v", results[0])
	}
	if len(mentions) != 3 || mentions[1].Title != "Customers complain" || mentions[1].URL != "https://reviews.test/acme" ||
		results[1].Confidence != 0.5 || results[1].CostMicros != 13_000 {
		t.Fatalf("mentions %+v", results[1])
	}
	if facts.Headquarters != "Lisbon, Portugal" || facts.FundingTotal != 2_500_000 || results[2].Confidence != 0.3 ||
		results[2].SourceURL != "https://news.test/acme-seed" || results[2].CostMicros != 14_000 {
		t.Fatalf("firmographics %+v", results[2])
	}
	for _, query := range queries {
		if query["outputSchema"] == nil || query["type"] != "auto" {
			t.Fatalf("a call did not ask for structured output: %+v", query)
		}
	}
	if excluded := queries[0]["excludeDomains"].([]any); excluded[0] != "acme.test" {
		t.Fatalf("own domain not excluded: %+v", queries[0])
	}
	unstructured.Store(true)
	var failure *ProviderError
	if _, err := provider.Enrich(context.Background(), subject); !errors.As(err, &failure) || failure.Retryable {
		t.Fatalf("an unstructured reply was accepted: %v", err)
	}
	_, err = (&Exa{APIKey: "wrong", BaseURL: exa.URL}).Enrich(context.Background(), subject)
	if !errors.As(err, &failure) || failure.Retryable || failure.Status != http.StatusUnauthorized {
		t.Fatalf("unauthorized: %v", err)
	}
}
