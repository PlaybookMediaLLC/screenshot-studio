package linkedinpage

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations/social/linkedin"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

var (
	_ integrations.Provider               = (*Provider)(nil)
	_ integrations.PendingPoster          = (*Provider)(nil)
	_ integrations.Commenter              = (*Provider)(nil)
	_ integrations.Reconnector            = (*Provider)(nil)
	_ integrations.Analytics              = (*Provider)(nil)
	_ integrations.PostAnalytics          = (*Provider)(nil)
	_ integrations.PageInformationFetcher = (*Provider)(nil)
	_ integrations.MentionFormatter       = (*Provider)(nil)
)

type call struct {
	method, uri string
	header      http.Header
	body        []byte
}

func serve(t *testing.T, routes map[string]http.HandlerFunc) *[]call {
	var mu sync.Mutex
	calls := &[]call{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		*calls = append(*calls, call{r.Method, r.URL.RequestURI(), r.Header.Clone(), body})
		mu.Unlock()
		if h, ok := routes[r.Method+" "+r.URL.Path]; ok {
			h(w, r)
			return
		}
		t.Errorf("unexpected call %s %s", r.Method, r.URL.String())
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	apiURL, wwwURL := linkedin.APIURL, linkedin.WWWURL
	linkedin.APIURL, linkedin.WWWURL = srv.URL, srv.URL
	t.Cleanup(func() { linkedin.APIURL, linkedin.WWWURL = apiURL, wwwURL })
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	return calls
}

func jsonReply(v any) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) { _ = json.NewEncoder(w).Encode(v) }
}

func TestInfo(t *testing.T) {
	info := New().Info()
	if info.Identifier != "linkedin-page" || info.Name != "LinkedIn Page" || !info.IsBetweenSteps || info.MaxConcurrentJob != 2 || !info.OneTimeToken || !info.RefreshWait {
		t.Fatalf("got %+v", info)
	}
	if len(New().Plugs()) != 2 || len(New().InternalPlugs()) != 2 {
		t.Fatal("plugs")
	}
	for _, name := range []string{"company", "companies", "fetchPageInformation"} {
		if New().Functions()[name] == nil {
			t.Fatalf("missing function %s", name)
		}
	}
}

func TestAuthenticate(t *testing.T) {
	t.Setenv("FRONTEND_URL", "https://app.example")
	calls := serve(t, map[string]http.HandlerFunc{
		"POST /oauth/v2/accessToken": jsonReply(map[string]any{"access_token": "at", "expires_in": 60, "scope": strings.Join(linkedin.PageScopes, " ")}),
		"GET /v2/userinfo":           jsonReply(map[string]any{"name": "Jane", "sub": "abc"}),
		"GET /v2/me":                 jsonReply(map[string]any{"vanityName": "jane"}),
	})
	got, err := New().Authenticate(context.Background(), integrations.AuthenticateParams{Code: "c", Refresh: "ignored"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != "linkedin-page_abc" || got.Username != "jane" {
		t.Fatalf("got %+v", got)
	}
	if !strings.Contains(string((*calls)[0].body), "redirect_uri=https%3A%2F%2Fapp.example%2Fintegrations%2Fsocial%2Flinkedin-page&") &&
		!strings.HasSuffix(string((*calls)[0].body), "redirect_uri=https%3A%2F%2Fapp.example%2Fintegrations%2Fsocial%2Flinkedin-page") {
		t.Fatalf("form %s", (*calls)[0].body)
	}
}

func TestCompaniesAndReConnect(t *testing.T) {
	logo := map[string]any{"original~": map[string]any{"elements": []any{map[string]any{"identifiers": []any{map[string]any{"identifier": "https://logo"}}}}}}
	serve(t, map[string]http.HandlerFunc{
		"GET /v2/organizationalEntityAcls": jsonReply(map[string]any{"elements": []any{
			map[string]any{"role": "ADMINISTRATOR", "organizationalTarget": "urn:li:organization:7", "organizationalTarget~": map[string]any{"localizedName": "Acme", "vanityName": "acme", "logoV2": logo}},
			map[string]any{"role": "ANALYST", "organizationalTarget": "urn:li:organization:8", "organizationalTarget~": map[string]any{"localizedName": "No"}},
			map[string]any{"role": "ADMINISTRATOR", "organizationalTarget": "urn:li:organization:9"},
		}}),
		"GET /v2/organizations/7": jsonReply(map[string]any{"id": 7, "localizedName": "Acme", "vanityName": "acme", "logoV2": logo}),
	})
	p := New()
	companies, err := p.Companies(context.Background(), "tok")
	if err != nil || len(companies) != 1 || companies[0] != (Company{ID: "7", Page: "7", Username: "acme", Name: "Acme", Picture: "https://logo"}) {
		t.Fatalf("got %+v %v", companies, err)
	}
	got, err := p.ReConnect(context.Background(), "x", "7", "tok")
	if err != nil || !reflect.DeepEqual(*got, integrations.AuthTokenDetails{ID: "7", Name: "Acme", AccessToken: "tok", Picture: "https://logo", Username: "acme"}) {
		t.Fatalf("got %+v %v", got, err)
	}
}

func TestAnalytics(t *testing.T) {
	const day = 1735732800000 // 2025-01-01T12:00Z
	tr := map[string]any{"start": day, "end": day}
	calls := serve(t, map[string]http.HandlerFunc{
		"GET /v2/organizationPageStatistics": jsonReply(map[string]any{"elements": []any{
			map[string]any{"timeRange": tr, "totalPageStatistics": map[string]any{"views": map[string]any{"allPageViews": map[string]any{"pageViews": 12}}}},
		}}),
		"GET /v2/organizationalEntityFollowerStatistics": jsonReply(map[string]any{"elements": []any{
			map[string]any{"timeRange": tr, "followerGains": map[string]any{"organicFollowerGain": 3, "paidFollowerGain": 0}},
		}}),
		"GET /v2/organizationalEntityShareStatistics": jsonReply(map[string]any{"elements": []any{
			map[string]any{"timeRange": tr, "totalShareStatistics": map[string]any{"clickCount": 4, "shareCount": 1, "engagement": 0.25, "commentCount": 2}},
		}}),
	})
	got, err := New().Analytics(context.Background(), "42", "tok", 7)
	if err != nil {
		t.Fatal(err)
	}
	labels := []string{"Page Views", "Clicks", "Shares", "Engagement", "Comments", "Organic Followers", "Paid Followers"}
	totals := []string{"12", "4", "1", "0.25", "2", "3", "0"}
	for i, a := range got {
		if a.Label != labels[i] || len(a.Data) != 1 || a.Data[0].Total != totals[i] || a.PercentageChange != 0 {
			t.Fatalf("%d: %+v", i, a)
		}
	}
	if !strings.Contains((*calls)[0].uri, "organization=urn%3Ali%3Aorganization%3A42&timeIntervals=(timeRange:(start:") ||
		(*calls)[0].header.Get("Linkedin-Version") != "202601" {
		t.Fatalf("call %+v", (*calls)[0])
	}
}

func TestPostAnalyticsFallsBackToSocialActions(t *testing.T) {
	calls := serve(t, map[string]http.HandlerFunc{
		"GET /v2/organizationalEntityShareStatistics": jsonReply(map[string]any{"elements": []any{}}),
		"GET /v2/socialActions/urn:li:share:9":        jsonReply(map[string]any{"likesSummary": map[string]any{"totalLikes": 5}}),
	})
	got, err := New().PostAnalytics(context.Background(), "42", "tok", "urn:li:share:9", 0)
	if err != nil {
		t.Fatal(err)
	}
	// An omitted comments count is unknown, never an invented zero.
	if len(got) != 1 || got[0].Label != "Likes" || got[0].Data[0].Total != "5" {
		t.Fatalf("got %+v", got)
	}
	if !strings.HasSuffix((*calls)[0].uri, "&shares=List(urn%3Ali%3Ashare%3A9)") {
		t.Fatalf("uri %s", (*calls)[0].uri)
	}
}

func TestAutoRepostPost(t *testing.T) {
	plugDelay = 0
	calls := serve(t, map[string]http.HandlerFunc{
		"GET /v2/socialActions/urn:li:share:9": jsonReply(map[string]any{"likesSummary": map[string]any{"totalLikes": 10}}),
		"POST /rest/posts": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("x-restli-id", "urn:li:share:10")
			w.WriteHeader(http.StatusCreated)
		},
	})
	integration := &ent.Integration{InternalID: "42", Token: "tok"}
	if fired, err := New().AutoRepostPost(context.Background(), integration, "urn:li:share:9", map[string]string{"likesAmount": "11"}); err != nil || fired {
		t.Fatalf("below threshold fired=%v err=%v", fired, err)
	}
	fired, err := New().AutoRepostPost(context.Background(), integration, "urn:li:share:9", map[string]string{"likesAmount": "10"})
	if err != nil || !fired {
		t.Fatalf("fired=%v err=%v", fired, err)
	}
	var payload map[string]any
	_ = json.Unmarshal((*calls)[len(*calls)-1].body, &payload)
	if payload["author"] != "urn:li:organization:42" || payload["reshareContext"].(map[string]any)["parent"] != "urn:li:share:9" {
		t.Fatalf("payload %v", payload)
	}
}

func TestPostCreatesAsOrganization(t *testing.T) {
	calls := serve(t, map[string]http.HandlerFunc{
		"POST /rest/posts": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("x-restli-id", "urn:li:share:1")
			w.WriteHeader(http.StatusCreated)
		},
	})
	got, err := New().Post(context.Background(), "42", "tok", []integrations.PostDetails{{ID: "p1", Message: "hi"}}, &ent.Integration{})
	if err != nil || got[0].PostID != "urn:li:share:1" {
		t.Fatalf("got %+v %v", got, err)
	}
	if !strings.Contains(string((*calls)[0].body), `"author":"urn:li:organization:42"`) {
		t.Fatalf("body %s", (*calls)[0].body)
	}
}

func TestRetryThenBadBody(t *testing.T) {
	serve(t, map[string]http.HandlerFunc{
		"GET /v2/socialActions/x": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"message":"Not enough permissions"}`))
		},
	})
	_, err := New().AutoPlugPost(context.Background(), &ent.Integration{Token: "tok"}, "x", map[string]string{"likesAmount": "1"})
	if temporalx.FailureType(err) != temporalx.TypeBadBody {
		t.Fatalf("got %v", err)
	}
}

func TestPostAnalyticsPreservesZeroAndOmitsMissingCounters(t *testing.T) {
	serve(t, map[string]http.HandlerFunc{
		"GET /v2/organizationalEntityShareStatistics": jsonReply(map[string]any{"elements": []any{map[string]any{"totalShareStatistics": map[string]any{"impressionCount": 0, "likeCount": 4}}}}),
		"GET /v2/socialActions/urn:li:share:9":        func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) },
	})
	got, err := New().PostAnalytics(context.Background(), "42", "tok", "urn:li:share:9", 0)
	if err != nil || len(got) != 2 || got[0].Label != "Impressions" || got[0].Data[0].Total != "0" || got[1].Label != "Likes" || got[1].Data[0].Total != "4" {
		t.Fatalf("counters=%+v error=%v", got, err)
	}
}
