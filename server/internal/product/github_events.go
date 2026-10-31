package product

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/activity"
	"image"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/deploymentevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/githubinstallation"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/outboxevent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/productsurface"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/release"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/sourceapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/sourcechange"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent/surfacecapture"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/githubapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releasenotes"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/telemetry"
)

// Product events the worker hands back to the product, because doing them
// takes GitHub, storage, or capture rather than SQL alone.
const (
	EventSourceChangeCollected = "source_change.collected"
	EventReleaseIngested       = "release.ingested"
	EventSourceAppConnected    = "source_app.connected"
	EventDeploymentSucceeded   = "deployment.succeeded"
)

// GitHubReader is what the worker reads from GitHub as the App.
type GitHubReader interface {
	Repository(ctx context.Context, installationID int64, repositoryID string) (githubapp.Repository, error)
	Releases(ctx context.Context, installationID int64, repositoryID string, limit int) ([]githubapp.Release, error)
	MergedPullRequests(ctx context.Context, installationID int64, repositoryID, base string, limit int) ([]githubapp.PullRequest, error)
	PullRequest(ctx context.Context, installationID int64, repositoryID string, number int) (githubapp.PullRequest, error)
	PullRequestFiles(ctx context.Context, installationID int64, repositoryID string, number int) ([]string, error)
	MilestonePullRequests(ctx context.Context, installationID int64, repositoryID string, milestone int) ([]int, error)
	ReleaseHTML(ctx context.Context, installationID int64, repositoryID string, releaseID int64) (string, error)
	InstallationToken(ctx context.Context, installationID int64) (string, error)
}

// Capturer takes a screenshot of a public page.
type Capturer interface {
	Capture(ctx context.Context, pageURL string) ([]byte, error)
}

// WithCapturer enables capturing the product after production deployments.
func (c *Configuration) WithCapturer(capturer Capturer) *Configuration {
	c.capture = capturer
	return c
}

// ErrNotEligible means the event's record is gone or cancelled; the worker
// retries, then dead-letters it, as it does for every release event.
var ErrNotEligible = errors.New("tenant resource is no longer eligible for dispatch")

// HandleOutboxEvent does a product event's side effect. It reports false for
// an event it does not own. Each handler is safe to run again after a crash.
func (c *Configuration) HandleOutboxEvent(ctx context.Context, eventID, organizationID, eventType, aggregateID string) (bool, error) {
	switch eventType {
	case EventGitHubObservation:
		return true, c.processGitHubObservation(ctx, organizationID, aggregateID)
	case EventReleaseAutomationDispatch:
		return true, c.dispatchReleaseAutomation(ctx, organizationID, aggregateID, false)
	case EventReleaseAutomationCancel:
		return true, c.dispatchReleaseAutomation(ctx, organizationID, aggregateID, true)
	case EventSourceChangeCollected:
		return true, c.enrichChange(ctx, organizationID, aggregateID)
	case EventReleaseIngested:
		return true, c.releaseScreenshots(ctx, eventID, organizationID, aggregateID)
	case EventSourceAppConnected:
		return true, c.backfillSource(ctx, organizationID, aggregateID)
	case EventDeploymentSucceeded:
		return true, c.captureDeployment(ctx, organizationID, aggregateID)
	case EventCampaignPostsSubmitted, EventCampaignPostsDecided:
		// Personal deliveries are claimed independently by the notification dispatcher.
		return true, nil
	}
	return false, nil
}

// readerFor returns the App and installation that deliver a source, or nil
// when the source is a hand-made webhook or its installation is not active.
func (c *Configuration) readerFor(ctx context.Context, source *ent.SourceApp) (GitHubReader, int64, error) {
	reader, ok := c.github.(GitHubReader)
	if !ok || source.GithubInstallationID == nil {
		return nil, 0, nil
	}
	row, err := c.client.GitHubInstallation.Get(ctx, *source.GithubInstallationID)
	if ent.IsNotFound(err) {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	if row.Status != githubinstallation.StatusACTIVE {
		return nil, 0, nil
	}
	return reader, row.InstallationID, nil
}

// enrichChange records the paths a collected PR changed, never their contents.
func (c *Configuration) enrichChange(ctx context.Context, organizationID, changeID string) error {
	change, err := c.client.SourceChange.Query().Where(sourcechange.ID(changeID), sourcechange.OrganizationID(organizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return ErrNotEligible
	}
	if err != nil {
		return err
	}
	source, err := c.client.SourceApp.Get(ctx, change.SourceAppID)
	if err != nil {
		return err
	}
	reader, installation, err := c.readerFor(ctx, source)
	if err != nil || reader == nil || len(change.Files) > 0 {
		return err
	}
	files, err := reader.PullRequestFiles(ctx, installation, change.RepositoryID, change.Number)
	if err != nil {
		return err
	}
	if len(files) > 300 {
		files = files[:300]
	}
	return change.Update().SetFiles(files).Exec(ctx)
}

// releaseScreenshots stores the images a release and its merged changes show
// as workspace assets. GitHub signs images in private repositories with
// short-lived URLs, so they are read through the App at download time.
func (c *Configuration) releaseScreenshots(ctx context.Context, eventID, organizationID, releaseID string) error {
	row, err := c.client.Release.Query().Where(release.ID(releaseID), release.OrganizationID(organizationID),
		release.StatusNEQ(release.StatusCANCELLED)).Only(ctx)
	if ent.IsNotFound(err) {
		return ErrNotEligible
	}
	if err != nil || len(row.ScreenshotAssetIds) > 0 || c.objects == nil {
		return err
	}
	event, err := c.client.OutboxEvent.Query().Where(outboxevent.ID(eventID), outboxevent.OrganizationID(organizationID)).Only(ctx)
	if err != nil {
		return err
	}
	sourceID, _ := event.Payload["sourceAppId"].(string)
	source, err := c.client.SourceApp.Query().Where(sourceapp.ID(sourceID), sourceapp.OrganizationID(organizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	changes, err := c.client.SourceChange.Query().Where(sourcechange.OrganizationID(organizationID),
		sourcechange.ReleaseID(releaseID)).Order(ent.Asc(sourcechange.FieldMergedAt)).Limit(releasenotes.MaxImages).All(ctx)
	if err != nil {
		return err
	}
	var images []string
	reader, installation, err := c.readerFor(ctx, source)
	if err != nil {
		return err
	}
	if reader != nil {
		if githubReleaseID, ok := payloadInt(event.Payload["githubReleaseId"]); ok && source.ExternalID != nil {
			html, err := reader.ReleaseHTML(ctx, installation, *source.ExternalID, githubReleaseID)
			if err != nil {
				return err
			}
			images = append(images, releasenotes.Images(html)...)
		}
		for _, change := range changes {
			pr, err := reader.PullRequest(ctx, installation, change.RepositoryID, change.Number)
			if err != nil {
				return err
			}
			images = append(images, releasenotes.Images(pr.BodyHTML)...)
		}
	} else {
		if row.Notes != nil {
			images = append(images, releasenotes.Images(*row.Notes)...)
		}
		for _, change := range changes {
			images = append(images, change.ImageUrls...)
		}
	}
	// An image stored in a private repository is private too: it is read from
	// GitHub's raw host with the installation token, which goes nowhere else.
	private, token := map[string]bool{}, ""
	if reader != nil && source.ExternalID != nil && len(images) > 0 {
		repository, err := reader.Repository(ctx, installation, *source.ExternalID)
		if err != nil {
			return err
		}
		for i, imageURL := range images {
			if raw, ok := repositoryFile(imageURL, repository.FullName); ok {
				images[i], private[raw] = raw, true
			}
		}
		if len(private) > 0 {
			if token, err = reader.InstallationToken(ctx, installation); err != nil {
				return err
			}
		}
	}
	actor := Actor{OrganizationID: organizationID, Kind: "service", Display: "github", RequestID: eventID}
	if source.PlatformOwnerUserID != nil {
		actor.UserID = *source.PlatformOwnerUserID
	}
	assets := []string{}
	for i, imageURL := range dedupe(images, releasenotes.MaxImages) {
		authorization := ""
		if private[imageURL] {
			authorization = "Bearer " + token
		}
		body, contentType, err := c.fetchImage(ctx, imageURL, authorization)
		if err != nil {
			slog.Info("release screenshot skipped", "release", releaseID, "reason", err.Error())
			continue
		}
		stored, err := c.storeImage(ctx, actor, body, contentType, fmt.Sprintf("release-%d", i+1))
		if err != nil {
			slog.Info("release screenshot not stored", "release", releaseID, "reason", err.Error())
			continue
		}
		assets = append(assets, stored)
	}
	if len(assets) == 0 {
		return nil
	}
	return row.Update().SetScreenshotAssetIds(assets).Exec(ctx)
}

func payloadInt(value any) (int64, bool) {
	switch number := value.(type) {
	case float64:
		return int64(number), number > 0
	case string:
		parsed, err := strconv.ParseInt(number, 10, 64)
		return parsed, err == nil && parsed > 0
	}
	return 0, false
}

func dedupe(values []string, max int) []string {
	result := []string{}
	for _, value := range values {
		if !slices.Contains(result, value) && len(result) < max {
			result = append(result, value)
		}
	}
	return result
}

// maxImageBytes bounds one downloaded screenshot.
const maxImageBytes = 10 << 20

// githubImageHost admits GitHub's own image hosts only: a URL in third-party
// text must never make the worker fetch an internal address.
func githubImageHost(host string) bool {
	host = strings.ToLower(host)
	return host == "github.com" || strings.HasSuffix(host, ".githubusercontent.com")
}

func (c *Configuration) imageHTTP() *http.Client {
	allowed := c.imageHost
	if allowed == nil {
		allowed = githubImageHost
	}
	client := &http.Client{Timeout: 20 * time.Second}
	if c.web != nil {
		client.Transport = c.web.Transport
	}
	// Every redirect hop is checked again: a hop to an internal address is refused.
	client.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if len(via) >= 5 || request.URL.Scheme != "https" || !allowed(request.URL.Hostname()) {
			return errors.New("image redirect refused")
		}
		return nil
	}
	return client
}

// repositoryFile maps an image stored in the repository (a blob, raw, or
// raw.githubusercontent.com URL) to its address on GitHub's raw host.
func repositoryFile(imageURL, repositoryName string) (string, bool) {
	parsed, err := url.Parse(imageURL)
	if err != nil || parsed.Scheme != "https" || repositoryName == "" {
		return "", false
	}
	parts := strings.Split(strings.TrimPrefix(parsed.EscapedPath(), "/"), "/")
	switch strings.ToLower(parsed.Host) {
	case "github.com":
		if len(parts) < 5 || (parts[2] != "blob" && parts[2] != "raw") {
			return "", false
		}
		parts = append(parts[:2:2], parts[3:]...)
	case "raw.githubusercontent.com":
		if len(parts) < 4 {
			return "", false
		}
	default:
		return "", false
	}
	for _, part := range parts {
		// A dot segment could walk to another repository the token can read.
		if segment, err := url.PathUnescape(part); err != nil || segment == "" || segment == "." || segment == ".." {
			return "", false
		}
	}
	if !strings.EqualFold(parts[0]+"/"+parts[1], repositoryName) {
		return "", false
	}
	return "https://raw.githubusercontent.com/" + strings.Join(parts, "/"), true
}

// fetchImage downloads a PNG, JPEG, or WebP image from an allowed host. A
// request carrying credentials never follows a redirect.
func (c *Configuration) fetchImage(ctx context.Context, imageURL, authorization string) ([]byte, string, error) {
	allowed := c.imageHost
	if allowed == nil {
		allowed = githubImageHost
	}
	parsed, err := url.Parse(imageURL)
	if err != nil || parsed.Scheme != "https" || !allowed(parsed.Hostname()) {
		return nil, "", errors.New("image host refused")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, "", err
	}
	client := c.imageHTTP()
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("image redirect refused") }
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("image returned %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxImageBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(body) > maxImageBytes {
		return nil, "", errors.New("image too large")
	}
	contentType := http.DetectContentType(body)
	if contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/webp" {
		return nil, "", errors.New("not a PNG, JPEG, or WebP image")
	}
	return body, contentType, nil
}

func (c *Configuration) storeImage(ctx context.Context, actor Actor, body []byte, contentType, name string) (string, error) {
	config, _, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	extension := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[contentType]
	stored, err := c.StoreGeneratedAsset(ctx, actor, GeneratedAssetInput{Body: body, Classification: "capture",
		ContentType: contentType, FileName: name + "." + extension, Height: config.Height, Width: config.Width})
	if err != nil {
		return "", err
	}
	return stored.ID, nil
}

// backfillLimits bound what connecting a repository imports. GitHub lists
// releases by their commit's date, not when they were published, so a page is
// scanned for the most recently published ones.
const (
	backfillReleases = 5
	backfillScan     = 30
	backfillMerges   = 30
)

// backfillSource imports a newly connected repository's recent releases, then
// holds the merges since the latest one for the next release. It goes through
// the same idempotent ingestion as live webhooks, so a delivery that races it
// is a no-op.
func (c *Configuration) backfillSource(ctx context.Context, organizationID, sourceAppID string) error {
	source, err := c.client.SourceApp.Query().Where(sourceapp.ID(sourceAppID), sourceapp.OrganizationID(organizationID),
		sourceapp.StatusEQ(sourceapp.StatusACTIVE)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil
	}
	if err != nil || source.ExternalID == nil {
		return err
	}
	reader, installation, err := c.readerFor(ctx, source)
	if err != nil || reader == nil {
		return err
	}
	repositoryID := *source.ExternalID
	repository, err := reader.Repository(ctx, installation, repositoryID)
	if err != nil {
		return err
	}
	releases, err := reader.Releases(ctx, installation, repositoryID, backfillScan)
	if err != nil {
		return err
	}
	releases = slices.DeleteFunc(releases, func(item githubapp.Release) bool {
		return source.SkipPrereleases && item.Prerelease
	})
	slices.SortStableFunc(releases, func(a, b githubapp.Release) int { return b.PublishedAt.Compare(a.PublishedAt) })
	releases = releases[:min(len(releases), backfillReleases)]
	actor := Actor{OrganizationID: organizationID, Kind: "webhook", Display: source.ID, RequestID: "backfill:" + source.ID}
	var latest time.Time
	for i := len(releases) - 1; i >= 0; i-- {
		item := releases[i]
		if err := c.recordHistoricalRelease(ctx, source, repository, item); err != nil {
			return err
		}
		notes := releasenotes.Clean(item.Body, MaxReleaseNotesRunes)
		title := releasenotes.Clean(firstNonEmpty(item.Name, item.TagName), 160)
		repositoryName := repository.FullName
		input := IngestSourceReleaseInput{BenefitStatement: releasenotes.Clean(firstNonEmpty(notes, item.TagName), 500),
			EventID: "release:" + repositoryID + ":" + strconv.FormatInt(item.ID, 10), Notes: &notes, RepositoryID: &repositoryID,
			RepositoryName: &repositoryName, SourceAppID: source.ID, SourceURLs: []string{}, Title: title}
		if item.HTMLURL != "" {
			input.SourceURLs = []string{item.HTMLURL}
		}
		owner, repo, _ := strings.Cut(repository.FullName, "/")
		numbers := releasenotes.PullRequests(notes, owner, repo)
		for _, feature := range releasenotes.Features(notes) {
			if feature.Number > 0 && !slices.Contains(numbers, feature.Number) {
				numbers = append(numbers, feature.Number)
			}
		}
		input.automationAssociation = &sourceReleaseAssociation{Numbers: numbers, Cutoff: item.PublishedAt}
		imported, err := c.IngestSourceRelease(ctx, actor, input)
		if err != nil && !errors.Is(err, ErrInvalidInput) {
			return err
		}
		if err == nil {
			if err := c.recordHistoricalReleaseOutput(ctx, organizationID, source.ID, input.EventID, imported.ReleaseID); err != nil {
				return err
			}
		}
		if item.PublishedAt.After(latest) {
			latest = item.PublishedAt
		}
	}
	branch := repository.DefaultBranch
	if source.Branch != nil {
		branch = *source.Branch
	}
	merged, err := reader.MergedPullRequests(ctx, installation, repositoryID, branch, backfillMerges)
	if err != nil {
		return err
	}
	for _, pr := range merged {
		if pr.MergedAt == nil || !pr.MergedAt.After(latest) || ignoresPullRequestAuthor(source, pr.User.Login, pr.User.Type) {
			continue
		}
		if err := c.recordHistoricalPR(ctx, source, repository, pr); err != nil {
			return err
		}
		labels := []string{}
		for _, label := range pr.Labels {
			if label.Name != "" && len(labels) < 50 {
				labels = append(labels, label.Name)
			}
		}
		author := pr.User.Login
		input := CollectSourceChangeInput{AuthorLogin: &author, Body: pr.Body, EventID: "backfill", Labels: labels,
			MergedAt: *pr.MergedAt, Number: pr.Number, RepositoryID: repositoryID, SourceAppID: source.ID,
			Title: pr.Title, URL: pr.HTMLURL}
		if author == "" {
			input.AuthorLogin = nil
		}
		if _, err := c.CollectSourceChange(ctx, actor, input); err != nil && !errors.Is(err, ErrInvalidInput) {
			return err
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// ignoresPullRequestAuthor applies a source's author rules with GitHub's
// account type, which only the API (not release notes) reports.
func ignoresPullRequestAuthor(source *ent.SourceApp, login, accountType string) bool {
	if source.IgnoreBotPullRequests && accountType == "Bot" {
		return true
	}
	return ignoresAuthor(source, login)
}

// maxCapturedSurfaces bounds the pages one deployment captures.
const maxCapturedSurfaces = 10

// captureDeployment captures the workspace's registered production pages on
// the deployed host once the deployment answers. Only registered product
// surfaces are captured, never a URL taken from the payload.
func (c *Configuration) captureDeployment(ctx context.Context, organizationID, deploymentID string) error {
	row, err := c.client.DeploymentEvent.Query().Where(deploymentevent.ID(deploymentID), deploymentevent.OrganizationID(organizationID)).Only(ctx)
	if ent.IsNotFound(err) {
		return ErrNotEligible
	}
	if err != nil || row.Status != deploymentevent.StatusRECEIVED {
		return err
	}
	skip := func(code string) error {
		return row.Update().SetStatus(deploymentevent.StatusSKIPPED).SetFailureCode(code).Exec(ctx)
	}
	if row.URL == nil {
		return skip("deployment_url_missing")
	}
	deployed, err := url.Parse(*row.URL)
	if err != nil {
		return skip("deployment_url_invalid")
	}
	candidates, err := c.client.ProductSurface.Query().Where(productsurface.OrganizationID(organizationID),
		productsurface.Environment("production")).Order(ent.Asc(productsurface.FieldName)).All(ctx)
	if err != nil {
		return err
	}
	var surfaces []*ent.ProductSurface
	for _, surface := range candidates {
		parsed, err := url.Parse(surface.URL)
		if err == nil && strings.EqualFold(parsed.Hostname(), deployed.Hostname()) && len(surfaces) < maxCapturedSurfaces {
			surfaces = append(surfaces, surface)
		}
	}
	if len(surfaces) == 0 {
		return skip("deployment_host_rejected")
	}
	if c.capture == nil || c.objects == nil {
		return skip("capture_unavailable")
	}
	// Not live yet: fail so the worker retries on its next run, the readiness window.
	if err := c.ready(ctx, surfaces[0].URL); err != nil {
		return err
	}
	actor := Actor{OrganizationID: organizationID, Kind: "service", Display: "deployment", RequestID: deploymentID}
	assets := []string{}
	failed := func(surface *ent.ProductSurface, code string, err error) error {
		slog.Info("deployment capture failed", "surface", surface.ID, "code", code, "reason", err.Error())
		tx, txErr := c.client.Tx(ctx)
		if txErr != nil {
			return txErr
		}
		defer tx.Rollback()
		if txErr = tx.ProductSurface.UpdateOneID(surface.ID).SetLastCaptureFailureCode(code).Exec(ctx); txErr != nil {
			return txErr
		}
		if txErr = activity.Emit(ctx, tx, organizationID, "capture.failed", "product_surface", surface.ID, "", deploymentID+":"+surface.ID, map[string]any{"background": true}); txErr != nil {
			return txErr
		}
		return tx.Commit()
	}
	for i, surface := range surfaces {
		actor.UserID = ""
		if surface.PlatformOwnerUserID != nil {
			actor.UserID = *surface.PlatformOwnerUserID
		}
		shot, err := c.capture.Capture(ctx, surface.URL)
		if err != nil {
			if err := failed(surface, "capture_failed", err); err != nil {
				return err
			}
			continue
		}
		stored, err := c.storeImage(ctx, actor, shot, http.DetectContentType(shot), fmt.Sprintf("deployment-%d", i+1))
		if err != nil {
			if err := failed(surface, "asset_unavailable", err); err != nil {
				return err
			}
			continue
		}
		assets = append(assets, stored)
		tx, err := c.client.Tx(ctx)
		if err != nil {
			return err
		}
		if _, err := recordCapture(ctx, tx, actor, surface, stored, surfacecapture.SourceDeployment, &row.ID); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	update := row.Update().SetAssetIds(assets).SetStatus(deploymentevent.StatusCAPTURED)
	if len(assets) == 0 {
		update.SetStatus(deploymentevent.StatusFAILED).SetFailureCode("capture_failed")
	}
	return update.Exec(ctx)
}

// ready reports whether the deployed page answers successfully.
func (c *Configuration) ready(ctx context.Context, pageURL string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return err
	}
	// The customer's page is not a dependency: it gets no trace headers.
	client := &http.Client{Timeout: 15 * time.Second, Transport: telemetry.UntracedTransport}
	if c.web != nil {
		client.Transport = c.web.Transport
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("deployment not ready: %w", err)
	}
	_ = response.Body.Close()
	if response.StatusCode >= 400 {
		return fmt.Errorf("deployment not ready: %d", response.StatusCode)
	}
	return nil
}
