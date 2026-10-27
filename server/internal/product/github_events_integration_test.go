package product

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/deploymentevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/release"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/sourcechange"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/database"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/githubapp"
	"github.com/lucsky/cuid"
)

func testPNG(t *testing.T, width int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, 10))
	img.Set(1, 1, color.RGBA{R: 200, A: 255})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, img); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

type fakeReader struct {
	fakeGitHub
	base     string
	released time.Time
}

func (f fakeReader) Repository(context.Context, int64, string) (githubapp.Repository, error) {
	return githubapp.Repository{ID: 1001, FullName: "acme/app", DefaultBranch: "main"}, nil
}

// Releases lists like GitHub: by commit date, not publish date, so the newest
// stable release sits behind pre-releases and older releases.
func (f fakeReader) Releases(_ context.Context, _ int64, _ string, limit int) ([]githubapp.Release, error) {
	out := []githubapp.Release{}
	for i := 1; i <= 5; i++ {
		out = append(out, githubapp.Release{ID: int64(100 + i), Name: fmt.Sprintf("v2.0-rc%d", i), Body: "candidate",
			Prerelease: true, PublishedAt: f.released.Add(time.Duration(i-3) * time.Hour)})
	}
	for i := 0; i <= 5; i++ {
		out = append(out, githubapp.Release{ID: int64(10 + i), Name: fmt.Sprintf("v0.%d", i), Body: "older",
			PublishedAt: f.released.Add(time.Duration(i-10) * 24 * time.Hour)})
	}
	out = append(out, githubapp.Release{ID: 2, Name: "v2.0", TagName: "v2.0", Body: "## Features\n* Faster exports (#5)",
		HTMLURL: "https://github.com/acme/app/releases/tag/v2.0", PublishedAt: f.released})
	return out[:min(len(out), limit)], nil
}
func (f fakeReader) MergedPullRequests(context.Context, int64, string, string, int) ([]githubapp.PullRequest, error) {
	after, before := f.released.Add(time.Hour), f.released.Add(-2*time.Hour)
	pr := func(number int, title, login, kind string, merged time.Time) githubapp.PullRequest {
		p := githubapp.PullRequest{Number: number, Title: title, Body: "Body", HTMLURL: "https://github.com/acme/app/pull/x", MergedAt: &merged}
		p.User.Login, p.User.Type = login, kind
		return p
	}
	return []githubapp.PullRequest{
		pr(7, "feat: Recurring invoices", "octocat", "User", after),
		pr(8, "Bump deps", "dependabot[bot]", "Bot", after),
		pr(3, "Before the release", "octocat", "User", before),
	}, nil
}
func (f fakeReader) PullRequest(_ context.Context, _ int64, _ string, number int) (githubapp.PullRequest, error) {
	return githubapp.PullRequest{Number: number, BodyHTML: `<p><img src="` + f.base + `/img/pr.png"></p>`}, nil
}
func (f fakeReader) PullRequestFiles(context.Context, int64, string, int) ([]string, error) {
	return []string{"app/billing/page.tsx", "README.md"}, nil
}
func (f fakeReader) MilestonePullRequests(context.Context, int64, string, int) ([]int, error) {
	return []int{90, 91}, nil
}
func (f fakeReader) InstallationToken(context.Context, int64) (string, error) { return "token", nil }
func (f fakeReader) ReleaseHTML(context.Context, int64, string, int64) (string, error) {
	return `<img src="` + f.base + `/img/release.png"><img src="` + f.base + `/img/redirect"><img src="` + f.base + `/img/text">`, nil
}

type fakeCapturer struct{ shot []byte }

func (f fakeCapturer) Capture(context.Context, string) ([]byte, error) { return f.shot, nil }

func TestWorkerEnrichesReleasesBackfillsAndCaptures(t *testing.T) {
	dsn := os.Getenv("PUBLISHING_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("PUBLISHING_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var name string
	if err := db.SQL.QueryRowContext(ctx, `SELECT current_database()`).Scan(&name); err != nil || !strings.Contains(name, "test") {
		t.Fatalf("refusing database %q: %v", name, err)
	}
	id := cuid.New()
	org, user, session := "orgw_"+id, "userw_"+id, "sessw_"+id
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.SQL.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%v\n%s", err, query)
		}
	}
	installation := 800000 + time.Now().UnixNano()%99999
	t.Cleanup(func() {
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM organization WHERE id=$1`, org)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM "user" WHERE id=$1`, user)
		_, _ = db.SQL.ExecContext(ctx, `DELETE FROM github_installation WHERE "installationId"=$1`, installation)
	})
	exec(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,'U',$2,true,now(),now())`, user, user+"@example.test")
	exec(`INSERT INTO organization (id,name,slug,"createdAt") VALUES ($1,$1,$1,now())`, org)
	exec(`INSERT INTO member (id,"organizationId","userId",role,"createdAt") VALUES ($1,$2,$3,'owner',now())`, "mw"+id, org, user)
	exec(`INSERT INTO session (id,"expiresAt",token,"createdAt","updatedAt","userId","activeOrganizationId") VALUES ($1,now()+interval '1 hour',$1,now(),now(),$2,$3)`, session, user, org)
	exec(`INSERT INTO github_installation (id,"installationId","accountLogin","accountType") VALUES ($1,$2,'acme','Organization')`, "gi"+id, installation)
	exec(`INSERT INTO workspace_github_installation (id,"organizationId","githubInstallationId","connectedByUserId") VALUES ($1,$2,$3,$4)`, "wg"+id, org, "gi"+id, user)

	shot := testPNG(t, 40)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/img/release.png":
			_, _ = w.Write(testPNG(t, 30))
		case "/img/pr.png":
			_, _ = w.Write(testPNG(t, 20))
		case "/img/redirect":
			http.Redirect(w, r, "http://169.254.169.254/latest/meta-data", http.StatusFound)
		case "/img/text":
			_, _ = w.Write([]byte("not an image"))
		case "/product":
			_, _ = w.Write([]byte("<html>live</html>"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	local, _ := url.Parse(server.URL)
	released := time.Now().Add(-24 * time.Hour).UTC().Truncate(time.Second)
	reader := fakeReader{fakeGitHub: fakeGitHub{}, base: server.URL, released: released}
	objects := &recordingAssetObjects{}
	repo := NewConfiguration(db.Client).WithGitHubApp(reader).WithObjectStore(objects).WithCapturer(fakeCapturer{shot: shot})
	subscribe(t, ctx, repo, org, "pro")
	repo.imageHost = func(host string) bool { return host == local.Hostname() }
	repo.web = server.Client()
	owner := Actor{OrganizationID: org, UserID: user, SessionID: session}

	// The App-delivered source watches main and skips pre-releases.
	repository, skip := "1001", true
	connected, err := db.Client.SourceApp.Create().SetID(cuid.New()).SetOrganizationID(org).SetName("acme/app").
		SetProvider("github").SetExternalID(repository).SetAllowedHosts([]string{"https://api.github.com"}).
		SetGithubInstallationID("gi" + id).SetSkipPrereleases(skip).SetStatus("ACTIVE").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	webhook := Actor{OrganizationID: org, Kind: "webhook", Display: connected.ID, RequestID: "delivery"}

	// #2: a collected change gains the paths it touched.
	change, err := repo.CollectSourceChange(ctx, webhook, CollectSourceChangeInput{Body: "x", EventID: "d", MergedAt: time.Now(),
		Number: 41, RepositoryID: repository, SourceAppID: connected.ID, Title: "Billing page", URL: "https://github.com/acme/app/pull/41"})
	if err != nil {
		t.Fatal(err)
	}
	if handled, err := repo.HandleOutboxEvent(ctx, "unused", org, EventSourceChangeCollected, change.ChangeID); !handled || err != nil {
		t.Fatalf("enrich handled=%v err=%v", handled, err)
	}
	stored, _ := db.Client.SourceChange.Get(ctx, change.ChangeID)
	if len(stored.Files) != 2 || stored.Files[0] != "app/billing/page.tsx" {
		t.Fatalf("files=%v", stored.Files)
	}

	// #4: a release keeps the screenshots its notes and merged PRs show; a
	// redirect to an internal address and a non-image are skipped.
	ingested, err := repo.IngestSourceRelease(ctx, webhook, IngestSourceReleaseInput{BenefitStatement: "Billing.",
		EventID: "release:" + repository + ":99", RepositoryID: &repository, SourceAppID: connected.ID, Title: "v1.0"})
	if err != nil {
		t.Fatal(err)
	}
	event, err := db.Client.OutboxEvent.Query().Where(outboxevent.AggregateID(ingested.ReleaseID), outboxevent.Type(EventReleaseIngested)).Only(ctx)
	if err != nil || event.Payload["githubReleaseId"] != float64(99) && event.Payload["githubReleaseId"] != int64(99) {
		t.Fatalf("release event payload=%v err=%v", event.Payload, err)
	}
	for run := 0; run < 2; run++ {
		if _, err := repo.HandleOutboxEvent(ctx, event.ID, org, EventReleaseIngested, ingested.ReleaseID); err != nil {
			t.Fatal(err)
		}
	}
	withShots, _ := db.Client.Release.Get(ctx, ingested.ReleaseID)
	if len(withShots.ScreenshotAssetIds) != 2 {
		t.Fatalf("screenshots=%v", withShots.ScreenshotAssetIds)
	}
	var assets int
	_ = db.SQL.QueryRowContext(ctx, `SELECT count(*) FROM asset WHERE "organizationId"=$1 AND status='UPLOADED'`, org).Scan(&assets)
	if assets != 2 {
		t.Fatalf("a re-run stored screenshots twice: %d assets", assets)
	}
	if _, err := repo.HandleOutboxEvent(ctx, event.ID, org, EventReleaseIngested, "missing-release"); !errors.Is(err, ErrNotEligible) {
		t.Fatalf("a missing release was handled: %v", err)
	}

	// A hand-made webhook source reads screenshots from the notes, allowed hosts only.
	secret := "SOURCE_SECRET"
	manual, err := repo.CreateSourceApp(ctx, owner, CreateSourceAppInput{AllowedHosts: []string{"https://api.github.com"},
		Name: "manual " + id, Provider: "github", SecretReference: &secret})
	if err != nil {
		t.Fatal(err)
	}
	notes := "![a](" + server.URL + "/img/release.png)\n![b](https://169.254.169.254/x.png)"
	manualRelease, err := repo.IngestSourceRelease(ctx, Actor{OrganizationID: org, Kind: "webhook", Display: manual.ID},
		IngestSourceReleaseInput{BenefitStatement: "Notes.", EventID: "delivery-7", Notes: &notes, SourceAppID: manual.ID, Title: "v1.1"})
	if err != nil {
		t.Fatal(err)
	}
	manualEvent, _ := db.Client.OutboxEvent.Query().Where(outboxevent.AggregateID(manualRelease.ReleaseID), outboxevent.Type(EventReleaseIngested)).Only(ctx)
	if _, err := repo.HandleOutboxEvent(ctx, manualEvent.ID, org, EventReleaseIngested, manualRelease.ReleaseID); err != nil {
		t.Fatal(err)
	}
	if row, _ := db.Client.Release.Get(ctx, manualRelease.ReleaseID); len(row.ScreenshotAssetIds) != 1 {
		t.Fatalf("manual screenshots=%v", row.ScreenshotAssetIds)
	}

	// #7: connecting backfills recent releases (pre-releases skipped) and holds
	// only merges after the latest one, without bots. Running again adds nothing.
	for run := 0; run < 2; run++ {
		if _, err := repo.HandleOutboxEvent(ctx, "unused", org, EventSourceAppConnected, connected.ID); err != nil {
			t.Fatal(err)
		}
	}
	backfilled, err := db.Client.Release.Query().Where(release.OrganizationID(org), release.Title("v2.0")).All(ctx)
	if err != nil || len(backfilled) != 1 || len(backfilled[0].Features) != 1 || backfilled[0].Features[0].Title != "Faster exports" {
		t.Fatalf("backfilled=%+v err=%v", backfilled, err)
	}
	if n, _ := db.Client.Release.Query().Where(release.OrganizationID(org), release.TitleHasPrefix("v2.0-rc")).Count(ctx); n != 0 {
		t.Fatal("a pre-release was backfilled")
	}
	// The newest published stable releases, not the first listed: v0.2–v0.5 and v2.0.
	older, _ := db.Client.Release.Query().Where(release.OrganizationID(org), release.TitleHasPrefix("v0.")).All(ctx)
	titles := []string{}
	for _, row := range older {
		titles = append(titles, row.Title)
	}
	if slices.Sort(titles); strings.Join(titles, ",") != "v0.2,v0.3,v0.4,v0.5" {
		t.Fatalf("backfilled older releases=%v", titles)
	}
	held, _ := db.Client.SourceChange.Query().Where(sourcechange.SourceAppID(connected.ID), sourcechange.ReleaseIDIsNil()).All(ctx)
	numbers := []int{}
	for _, change := range held {
		numbers = append(numbers, change.Number)
	}
	if len(numbers) != 1 || numbers[0] != 7 {
		t.Fatalf("held merges=%v", numbers)
	}

	// #6: a production deployment captures registered pages on its host only.
	surface, err := repo.CreateProductSurface(ctx, owner, CreateProductSurfaceInput{Environment: "production", Name: "Product " + id,
		FeatureTags: []string{}, ScreenshotAssetIDs: []string{}, URL: server.URL + "/product"})
	if err != nil {
		t.Fatal(err)
	}
	deploy := func(externalID string, deployURL *string) string {
		t.Helper()
		result, err := repo.IngestDeployment(ctx, Actor{OrganizationID: org, Kind: "webhook", Display: manual.ID},
			IngestDeploymentInput{Environment: "production", EventID: "d", ExternalID: externalID, SourceAppID: manual.ID, URL: deployURL})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.HandleOutboxEvent(ctx, "unused", org, EventDeploymentSucceeded, result.DeploymentID); err != nil {
			t.Fatal(err)
		}
		return result.DeploymentID
	}
	live := server.URL
	captured, _ := db.Client.DeploymentEvent.Get(ctx, deploy("1", &live))
	if captured.Status != deploymentevent.StatusCAPTURED || len(captured.AssetIds) != 1 {
		t.Fatalf("deployment=%+v", captured)
	}
	if refreshed, _ := db.Client.ProductSurface.Get(ctx, surface.ID); len(refreshed.ScreenshotAssetIds) != 1 || refreshed.ScreenshotAssetIds[0] != captured.AssetIds[0] {
		t.Fatalf("surface screenshots=%v", refreshed.ScreenshotAssetIds)
	}
	var generatedOwner string
	if err := db.SQL.QueryRowContext(ctx, `SELECT payload->>'ownerUserId' FROM outbox_event WHERE "aggregateId"=$1 AND type='asset.uploaded'`, captured.AssetIds[0]).Scan(&generatedOwner); err != nil || generatedOwner != owner.UserID {
		t.Fatalf("background asset owner=%s err=%v", generatedOwner, err)
	}
	// The capture is a row; a second deployment supersedes it and keeps it.
	again, _ := db.Client.DeploymentEvent.Get(ctx, deploy("4", &live))
	captures, err := repo.ListSurfaceCaptures(ctx, owner, surface.ID)
	if err != nil || len(captures) != 2 || captures[0].AssetID != again.AssetIds[0] || captures[0].SupersededAt != nil ||
		captures[1].AssetID != captured.AssetIds[0] || captures[1].SupersededAt == nil || captures[0].Source != "deployment" ||
		*captures[0].SourceID != again.ID {
		t.Fatalf("captures=%+v err=%v", captures, err)
	}
	if refreshed, _ := db.Client.ProductSurface.Get(ctx, surface.ID); refreshed.LastCapturedAt == nil || refreshed.LastCaptureFailureCode != nil ||
		len(refreshed.ScreenshotAssetIds) != 2 {
		t.Fatalf("surface after captures=%+v", refreshed)
	}
	elsewhere := "https://elsewhere.example"
	if row, _ := db.Client.DeploymentEvent.Get(ctx, deploy("2", &elsewhere)); row.Status != deploymentevent.StatusSKIPPED || *row.FailureCode != "deployment_host_rejected" {
		t.Fatalf("an unregistered host was captured: %+v", row)
	}
	if row, _ := db.Client.DeploymentEvent.Get(ctx, deploy("3", nil)); row.Status != deploymentevent.StatusSKIPPED || *row.FailureCode != "deployment_url_missing" {
		t.Fatalf("a deployment without a URL: %+v", row)
	}
	if handled, _ := repo.HandleOutboxEvent(ctx, "unused", org, "asset.uploaded", "x"); handled {
		t.Fatal("the product claimed an event it does not own")
	}
}
