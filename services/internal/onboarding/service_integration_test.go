package onboarding

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/quota"
	"github.com/lucsky/cuid"
)

// memoryMeter is a monthly meter without Redis.
type memoryMeter struct {
	mu   sync.Mutex
	used map[string]int64
}

func (m *memoryMeter) Meter(_ context.Context, key string, amount, limit int64) (quota.MonthlyUsage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.used[key] += amount
	return quota.MonthlyUsage{Used: min(m.used[key], limit), Remaining: max(limit-m.used[key], 0), Reached: m.used[key] > limit}, nil
}

// testWorkspace is a paid workspace with an owner and a viewer.
type testWorkspace struct {
	db     *database.Database
	org    string
	owner  product.Actor
	viewer product.Actor
	store  *product.Configuration
}

func newTestWorkspace(t *testing.T, plan string) *testWorkspace {
	t.Helper()
	url := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	id := cuid.New()
	w := &testWorkspace{db: db, org: "org_" + id, store: product.NewConfiguration(db.Client).WithMonthlyMeter(&memoryMeter{used: map[string]int64{}})}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,'Workspace',$1,now())`, w.org)
	exec(`INSERT INTO workspace_entitlement ("organizationId",plan,status,"updatedAt") VALUES ($1,$2,'active',now())`, w.org, plan)
	for _, role := range []string{"owner", "viewer"} {
		user, session := "user_"+role+"_"+id, "session_"+role+"_"+id
		exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,now(),now())`, user, role, role+"-"+id+"@example.test")
		exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`, session, user, w.org)
		exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,$4,now())`, "member_"+role+"_"+id, w.org, user, role)
		actor := product.Actor{OrganizationID: w.org, UserID: user, SessionID: session, RequestID: "request_" + id}
		if role == "owner" {
			w.owner = actor
		} else {
			w.viewer = actor
		}
	}
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1`, w.org)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id LIKE $1`, "user_%_"+id)
	})
	return w
}

// The fast path end to end against the product store: drafts in well under
// ten seconds, saved as automated changes that keep a person's edits, a
// replay that returns the same run, a re-run of an unchanged site that reads
// nothing and calls no model, and the gates around starting a run.
func TestStartRunsTheFastPathAndSavesItsDrafts(t *testing.T) {
	site := newTestSite(t)
	w := newTestWorkspace(t, "pro")
	ctx := context.Background()
	model := &fakeModel{}
	service := &Service{FastPath: &FastPath{Fetcher: testFetcher(t), Model: model}, Store: w.store}
	// The clean homepage: the site's root hides an injection, which flags it.
	home := site.URL + "/acme"

	started := time.Now()
	result, err := service.Start(ctx, w.owner, StartInput{URL: home})
	if err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > 10*time.Second {
		t.Fatalf("fast path took %s", elapsed)
	}
	run := result.Run
	if !result.Created || !result.Extracted || run.Status != product.OnboardingCompleted || run.Progress != 100 ||
		strings.Join(run.CompletedStages, ",") != StageFastPath || run.PagesDiscovered != 3 || run.TokensUsed != 1_000 || run.FastPathMs <= 0 {
		t.Fatalf("run %+v", run)
	}
	if result.ProductProfile == nil || result.ProductProfile.Name != "Acme" || result.ProductProfile.Provenance["summary"].Confidence != 0.7 {
		t.Fatalf("product profile %+v", result.ProductProfile)
	}
	if result.IdealCustomerProfile == nil || result.IdealCustomerProfile.Personas[0].Role != "Agency owner" ||
		result.IdealCustomerProfile.Provenance["pains"].URL != home {
		t.Fatalf("ICP %+v", result.IdealCustomerProfile)
	}
	brand, err := w.store.GetBrandProfile(ctx, w.org)
	if err != nil || brand == nil || brand.SocialHandles["x"] != "https://x.com/acme" || brand.Audience != "Small agencies" {
		t.Fatalf("brand profile %+v err=%v", brand, err)
	}
	page, err := w.store.GetPageKnowledge(ctx, w.owner, home)
	if err != nil || page == nil || page.PageType != PageHomepage || page.RunID != run.ID || strings.Contains(page.Text, "free forever") {
		t.Fatalf("homepage knowledge %+v err=%v", page, err)
	}

	// A replay in the same hour returns the run without reading anything.
	fetches, calls := site.total(), model.calls.Load()
	replay, err := service.Start(ctx, w.owner, StartInput{URL: home})
	if err != nil || replay.Created || replay.Run.ID != run.ID || site.total() != fetches || model.calls.Load() != calls {
		t.Fatalf("replay %+v err=%v", replay, err)
	}

	// The founder corrects the audience; a re-run of the unchanged site reuses
	// the stored homepage and page list: no fetch, no model call, edit intact.
	audience := "Design studios"
	if _, err := w.store.UpsertProductProfile(ctx, w.owner, product.UpsertProductProfileInput{Audience: &audience}); err != nil {
		t.Fatal(err)
	}
	rerun, err := service.Start(ctx, w.owner, StartInput{IdempotencyKey: "rerun-1", URL: home})
	if err != nil || !rerun.Created || rerun.Extracted || site.total() != fetches || model.calls.Load() != calls ||
		rerun.ProductProfile.Audience != audience || len(rerun.Pages) != 3 {
		t.Fatalf("re-run %+v err=%v fetches %d calls %d", rerun, err, site.total()-fetches, model.calls.Load()-calls)
	}

	// Three runs an hour; the fourth is refused before any fetch.
	if _, err := service.Start(ctx, w.owner, StartInput{IdempotencyKey: "rerun-2", URL: home}); err != nil {
		t.Fatal(err)
	}
	var exceeded *product.QuotaExceededError
	if _, err := service.Start(ctx, w.owner, StartInput{IdempotencyKey: "rerun-3", URL: home}); !errors.As(err, &exceeded) || exceeded.Limit != 3 {
		t.Fatalf("fourth run: %v", err)
	}
	if _, err := service.Start(ctx, w.viewer, StartInput{URL: home}); !errors.Is(err, publishing.ErrForbidden) {
		t.Fatalf("viewer started a run: %v", err)
	}
	if read, err := w.store.GetOnboardingRun(ctx, w.viewer, run.ID); err != nil || read.ID != run.ID {
		t.Fatalf("viewer read %+v err=%v", read, err)
	}
	other := newTestWorkspace(t, "pro")
	if _, err := other.store.GetOnboardingRun(ctx, other.owner, run.ID); !errors.Is(err, publishing.ErrNotFound) {
		t.Fatalf("another workspace read the run: %v", err)
	}
	if page, err := other.store.GetPageKnowledge(ctx, other.owner, home); err != nil || page != nil {
		t.Fatalf("another workspace read the page: %+v %v", page, err)
	}
	for _, bad := range []string{"ftp://acme.test", "not a url", "http://user:pass@acme.test"} {
		if _, err := service.Start(ctx, other.owner, StartInput{URL: bad}); !errors.Is(err, product.ErrInvalidInput) {
			t.Fatalf("%s: %v", bad, err)
		}
	}
}

// Without the onboarding feature a workspace onboards manually: no run starts.
func TestStartNeedsTheOnboardingFeature(t *testing.T) {
	w := newTestWorkspace(t, "pro")
	service := &Service{FastPath: &FastPath{Fetcher: testFetcher(t)}, Store: w.store}
	t.Setenv("PLATFORM_ONBOARDING_AGENT", "disabled")
	var notEntitled *product.FeatureNotEntitledError
	if _, err := service.Start(context.Background(), w.owner, StartInput{URL: "https://acme.test"}); !errors.As(err, &notEntitled) {
		t.Fatalf("disabled flag: %v", err)
	}
	free := newTestWorkspace(t, "free")
	t.Setenv("PLATFORM_ONBOARDING_AGENT", "")
	if _, err := service.Start(context.Background(), free.owner, StartInput{URL: "https://acme.test"}); !errors.As(err, &notEntitled) {
		t.Fatalf("free workspace: %v", err)
	}
}

// A site that cannot be read still completes onboarding: the run reports why,
// and the founder fills in the manual form.
func TestStartWithAnUnreadableSiteLeavesTheManualForm(t *testing.T) {
	w := newTestWorkspace(t, "pro")
	service := &Service{FastPath: &FastPath{Fetcher: testFetcher(t), Model: &fakeModel{}}, Store: w.store}
	result, err := service.Start(context.Background(), w.owner, StartInput{URL: "http://127.0.0.1:1/"})
	if err != nil || result.Reason == "" || result.ProductProfile != nil || result.Run.Status != product.OnboardingCompleted ||
		result.Run.ErrorCode == nil || *result.Run.ErrorCode != "site_unreadable" {
		t.Fatalf("result %+v err=%v", result, err)
	}
}
