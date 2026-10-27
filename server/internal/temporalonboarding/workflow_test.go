package temporalonboarding

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	commonpb "go.temporal.io/api/common/v1"
	enumspb "go.temporal.io/api/enums/v1"
	workflowpb "go.temporal.io/api/workflow/v1"
	"go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/mocks"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/onboarding"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// fakes stands in for the activities and records what the workflow asked for.
type fakes struct {
	mu       sync.Mutex
	calls    []string
	attempts map[string]int
	reports  []int
	finish   *Finish

	crawl         func(page string) (PageOutcome, error)
	enrichProfile func(BatchInput) (ModelOutcome, error)
	enrich        func() (EnrichOutcome, error)
	deriveICP     func() (ModelOutcome, error)
}

func (f *fakes) record(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, name)
}

func (f *fakes) count(name string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, call := range f.calls {
		if call == name {
			n++
		}
	}
	return n
}

func newEnvironment(t *testing.T, f *fakes) *testsuite.TestWorkflowEnvironment {
	t.Helper()
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(Workflow, workflow.RegisterOptions{Name: WorkflowName})
	env.RegisterWorkflowWithOptions(Pipeline, workflow.RegisterOptions{Name: PipelineWorkflowName})
	f.attempts = map[string]int{}
	if f.crawl == nil {
		f.crawl = func(page string) (PageOutcome, error) {
			return PageOutcome{Changed: true, Fetched: true, URL: page}, nil
		}
	}
	if f.enrichProfile == nil {
		f.enrichProfile = func(BatchInput) (ModelOutcome, error) { return ModelOutcome{Applied: true, Tokens: 1_000}, nil }
	}
	if f.enrich == nil {
		f.enrich = func() (EnrichOutcome, error) { return EnrichOutcome{}, nil }
	}
	if f.deriveICP == nil {
		f.deriveICP = func() (ModelOutcome, error) { return ModelOutcome{Applied: true, Tokens: 1_000}, nil }
	}
	env.RegisterActivityWithOptions(func(_ context.Context, _ Input, page string) (PageOutcome, error) {
		f.record(CrawlPageActivity)
		f.mu.Lock()
		f.attempts[page]++
		f.mu.Unlock()
		return f.crawl(page)
	}, activity.RegisterOptions{Name: CrawlPageActivity})
	env.RegisterActivityWithOptions(func(_ context.Context, batch BatchInput) (ModelOutcome, error) {
		f.record(EnrichProfileActivity)
		return f.enrichProfile(batch)
	}, activity.RegisterOptions{Name: EnrichProfileActivity})
	env.RegisterActivityWithOptions(func(context.Context, Input) (EnrichOutcome, error) {
		f.record(EnrichActivity)
		return f.enrich()
	}, activity.RegisterOptions{Name: EnrichActivity})
	env.RegisterActivityWithOptions(func(context.Context, Input) (ModelOutcome, error) {
		f.record(DeriveICPActivity)
		return f.deriveICP()
	}, activity.RegisterOptions{Name: DeriveICPActivity})
	for _, name := range []string{SeedBrandActivity, SeedSurfacesActivity} {
		env.RegisterActivityWithOptions(func(context.Context, Input) error { f.record(name); return nil }, activity.RegisterOptions{Name: name})
	}
	env.RegisterActivityWithOptions(func(_ context.Context, _ Input, progress Progress) error {
		f.mu.Lock()
		f.reports = append(f.reports, progress.Percent)
		f.mu.Unlock()
		return nil
	}, activity.RegisterOptions{Name: ReportProgressActivity})
	env.RegisterActivityWithOptions(func(_ context.Context, _ Input, finish Finish) error {
		f.record(FinishRunActivity)
		f.finish = &finish
		return nil
	}, activity.RegisterOptions{Name: FinishRunActivity})
	return env
}

func runInput(pages, limit int) Input {
	input := Input{OrganizationID: "org-1", PageLimit: limit, RunID: "run-1", StartedBy: StartedBy{Kind: "session", UserID: "user-1"},
		TokenBudget: 120_000, TokensUsed: 1_000, URL: "https://acme.test/"}
	for i := range pages {
		input.Pages = append(input.Pages, fmt.Sprintf("https://acme.test/page-%d", i))
	}
	return input
}

func run(t *testing.T, env *testsuite.TestWorkflowEnvironment, input Input) Progress {
	t.Helper()
	env.ExecuteWorkflow(WorkflowName, input)
	if !env.IsWorkflowCompleted() || env.GetWorkflowError() != nil {
		t.Fatalf("workflow completed=%v err=%v", env.IsWorkflowCompleted(), env.GetWorkflowError())
	}
	var progress Progress
	if err := env.GetWorkflowResult(&progress); err != nil {
		t.Fatal(err)
	}
	return progress
}

// A clean run completes every stage, reaches 100, and reports progress that
// never goes down (AC 2, 8).
func TestRunCompletesWithMonotonicProgress(t *testing.T) {
	f := &fakes{}
	env := newEnvironment(t, f)
	var queried []int
	for i := 1; i <= 20; i++ {
		env.RegisterDelayedCallback(func() {
			if value, err := env.QueryWorkflow(ProgressQuery); err == nil {
				var progress Progress
				_ = value.Get(&progress)
				queried = append(queried, progress.Percent)
			}
		}, time.Duration(i)*700*time.Millisecond)
	}
	input := runInput(10, 25)
	input.SeedSurfaces = true
	progress := run(t, env, input)
	if f.finish.Status != product.OnboardingCompleted || progress.Percent != 100 || progress.PagesProcessed != 10 ||
		!slices.Equal(progress.CompletedStages, []string{"fast_path", "crawl", "classify", "enrich", "icp", "brand", "surfaces"}) {
		t.Fatalf("finish %+v progress %+v", f.finish, progress)
	}
	for _, series := range [][]int{f.reports, queried} {
		if len(series) < 2 || !slices.IsSorted(series) || series[0] < onboarding.ProgressFastPath {
			t.Fatalf("progress went down or was never reported: %v", series)
		}
	}
	if progress.TokensUsed != 1_000+2*1_000+1_000 || f.count(SeedSurfacesActivity) != 1 {
		t.Fatalf("tokens %d surfaces %d", progress.TokensUsed, f.count(SeedSurfacesActivity))
	}
}

// A workspace over its page limit crawls exactly its limit (AC 9).
func TestRunCrawlsExactlyThePageLimit(t *testing.T) {
	f := &fakes{}
	env := newEnvironment(t, f)
	progress := run(t, env, runInput(30, 25))
	if f.count(CrawlPageActivity) != 25 || progress.PagesDiscovered != 25 || progress.PagesProcessed != 25 {
		t.Fatalf("crawled %d progress %+v", f.count(CrawlPageActivity), progress)
	}
}

// A page that keeps failing is tried three times (two retries), then
// skipped, and the run continues and completes (AC 10).
func TestFailingPageIsRetriedTwiceThenSkipped(t *testing.T) {
	f := &fakes{crawl: func(page string) (PageOutcome, error) {
		if page == "https://acme.test/page-1" {
			return PageOutcome{}, errors.New("the page answered 500")
		}
		return PageOutcome{Changed: true, Fetched: true, URL: page}, nil
	}}
	env := newEnvironment(t, f)
	progress := run(t, env, runInput(4, 25))
	if f.attempts["https://acme.test/page-1"] != 3 || f.attempts["https://acme.test/page-2"] != 1 ||
		f.finish.Status != product.OnboardingCompleted || progress.PagesSkipped != 1 || progress.PagesProcessed != 4 {
		t.Fatalf("attempts %v finish %+v progress %+v", f.attempts, f.finish, progress)
	}
}

// A run whose next model call would exceed the token budget stops and
// reports partial; what it already applied stands (AC 11).
func TestTokenBudgetStopsTheRunPartial(t *testing.T) {
	f := &fakes{enrichProfile: func(BatchInput) (ModelOutcome, error) { return ModelOutcome{Applied: true, Tokens: 20_000}, nil }}
	env := newEnvironment(t, f)
	input := runInput(12, 25)
	input.TokenBudget = 30_000
	run(t, env, input)
	if f.count(EnrichProfileActivity) != 1 || f.count(DeriveICPActivity) != 0 || f.finish.Status != product.OnboardingPartial ||
		f.finish.ErrorCode != "token_budget" || f.finish.Progress.TokensUsed != 21_000 {
		t.Fatalf("calls %v finish %+v", f.calls, f.finish)
	}
}

// Reaching the 15-minute deadline ends the run partial, not failed, and
// reports exactly which stages completed (AC 7).
func TestDeadlineEndsThePipelinePartialWithAccurateStages(t *testing.T) {
	f := &fakes{}
	env := newEnvironment(t, f)
	run(t, env, runInput(2_000, 2_000))
	if f.finish.Status != product.OnboardingPartial || f.finish.ErrorCode != "deadline" ||
		!slices.Equal(f.finish.Progress.CompletedStages, []string{"fast_path"}) || f.finish.Progress.PagesProcessed < 800 ||
		f.finish.Progress.PagesProcessed >= 2_000 || f.count(EnrichProfileActivity) != 0 {
		t.Fatalf("finish %+v", f.finish)
	}
}

// A cancel signal mid-crawl stops the run within seconds, schedules nothing
// more, and keeps the pages already stored (AC 6).
func TestCancelStopsMidCrawlAndKeepsWhatWasRead(t *testing.T) {
	f := &fakes{}
	env := newEnvironment(t, f)
	env.RegisterDelayedCallback(func() { env.SignalWorkflow(CancelSignal, nil) }, 5500*time.Millisecond)
	run(t, env, runInput(50, 50))
	if f.finish.Status != product.OnboardingCancelled || f.count(CrawlPageActivity) > 8 || f.count(CrawlPageActivity) < 4 ||
		f.count(EnrichProfileActivity) != 0 || f.finish.Progress.PagesProcessed < 4 {
		t.Fatalf("crawled %d finish %+v", f.count(CrawlPageActivity), f.finish)
	}
}

// An unchanged site, every page cached or not modified, makes no model call (AC 3).
func TestUnchangedSiteMakesNoModelCall(t *testing.T) {
	f := &fakes{crawl: func(page string) (PageOutcome, error) { return PageOutcome{Skipped: true, URL: page}, nil }}
	env := newEnvironment(t, f)
	progress := run(t, env, runInput(10, 25))
	if f.count(EnrichProfileActivity) != 0 || f.count(DeriveICPActivity) != 0 || progress.PagesSkipped != 10 || f.finish.Status != product.OnboardingCompleted {
		t.Fatalf("calls %v progress %+v", f.calls, progress)
	}
}

// A page full of injected instructions changes nothing about what the
// workflow runs: the same activities in the same order (AC 12).
func TestInjectedPageChangesNoControlFlow(t *testing.T) {
	sequence := func(flagged bool) []string {
		f := &fakes{crawl: func(page string) (PageOutcome, error) {
			return PageOutcome{Changed: true, Fetched: true, Flagged: flagged && page == "https://acme.test/page-2", URL: page}, nil
		}}
		run(t, newEnvironment(t, f), runInput(5, 25))
		return f.calls
	}
	if clean, injected := sequence(false), sequence(true); !slices.Equal(clean, injected) {
		t.Fatalf("clean %v\ninjected %v", clean, injected)
	}
}

// A starter who lost access ends the run failed and discards the rest.
func TestRevokedStarterFailsTheRun(t *testing.T) {
	f := &fakes{crawl: func(string) (PageOutcome, error) {
		return PageOutcome{}, temporal.NewNonRetryableApplicationError("revoked", ErrRevoked, nil)
	}}
	env := newEnvironment(t, f)
	run(t, env, runInput(5, 25))
	if f.finish.Status != product.OnboardingFailed || f.finish.ErrorCode != "access_revoked" || f.count(CrawlPageActivity) != 1 {
		t.Fatalf("calls %v finish %+v", f.calls, f.finish)
	}
}

// One workflow ID per workspace: a second start while a run is active gets
// that run (USE_EXISTING), a later run may reuse the ID, and a start that
// lands on another run's workflow reports busy (AC 5).
func TestStartUsesOneWorkflowPerWorkspace(t *testing.T) {
	run := &product.OnboardingRunRecord{ID: "run-2", WorkflowID: product.OnboardingWorkflowID("org-1"), PageLimit: 25, TokenBudget: 120_000}
	options := StartOptions(run)
	if options.ID != "onboarding-org-1" || options.TaskQueue != TaskQueue || options.WorkflowExecutionTimeout != ParentTimeout ||
		options.WorkflowIDConflictPolicy != enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING ||
		options.WorkflowIDReusePolicy != enumspb.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE {
		t.Fatalf("options %+v", options)
	}
	for owner, want := range map[string]error{"run-2": nil, "run-1": ErrBusy} {
		temporalClient := &mocks.Client{}
		handle := &mocks.WorkflowRun{}
		handle.On("GetRunID").Return("temporal-run")
		temporalClient.On("ExecuteWorkflow", mock.Anything, mock.Anything, WorkflowName, mock.Anything).Return(handle, nil)
		memo, _ := converter.GetDefaultDataConverter().ToPayload(owner)
		temporalClient.On("DescribeWorkflowExecution", mock.Anything, "onboarding-org-1", "temporal-run").Return(
			&workflowservice.DescribeWorkflowExecutionResponse{WorkflowExecutionInfo: &workflowpb.WorkflowExecutionInfo{
				Memo: &commonpb.Memo{Fields: map[string]*commonpb.Payload{"runId": memo}}}}, nil)
		err := (&Client{Temporal: temporalClient}).Start(context.Background(), run, product.Actor{OrganizationID: "org-1", UserID: "user-1"})
		if !errors.Is(err, want) && !(want == nil && err == nil) {
			t.Fatalf("memo %s: %v", owner, err)
		}
		input := temporalClient.Calls[0].Arguments.Get(3).(Input)
		if input.OrganizationID != "org-1" || input.RunID != "run-2" || input.StartedBy.UserID != "user-1" {
			t.Fatalf("input %+v", input)
		}
	}
}
