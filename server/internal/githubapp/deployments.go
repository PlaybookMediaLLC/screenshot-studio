package githubapp

import (
	"context"
	"encoding/json"
	"fmt"
	fd "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/frontenddeploy"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"time"
)

// DeploymentChecks reads exact commit checks and statuses with installation
// credentials. A truncated result is an error, never an implicit pass.
func (a *App) DeploymentChecks(ctx context.Context, installation int64, repository, sha string) ([]fd.Check, error) {
	base := "/repositories/" + url.PathEscape(repository) + "/commits/" + url.PathEscape(sha)
	out := []fd.Check{}
	for page := 1; page <= 3; page++ {
		var response struct {
			TotalCount int `json:"total_count"`
			Checks     []struct {
				ID          int64     `json:"id"`
				Name        string    `json:"name"`
				SHA         string    `json:"head_sha"`
				Status      string    `json:"status"`
				Conclusion  string    `json:"conclusion"`
				CompletedAt time.Time `json:"completed_at"`
				StartedAt   time.Time `json:"started_at"`
				App         struct {
					ID int64 `json:"id"`
				} `json:"app"`
			} `json:"check_runs"`
		}
		if err := a.get(ctx, installation, base+"/check-runs?filter=latest&per_page=100&page="+strconv.Itoa(page), "", &response); err != nil {
			return nil, err
		}
		if response.TotalCount > 300 {
			return nil, fmt.Errorf("GitHub checks exceed bounded history")
		}
		for _, r := range response.Checks {
			at := r.CompletedAt
			if at.IsZero() {
				at = r.StartedAt
			}
			out = append(out, fd.Check{Source: "github_check", ID: strconv.FormatInt(r.ID, 10), Name: r.Name, AppID: strconv.FormatInt(r.App.ID, 10), RepositoryID: repository, Revision: r.SHA, Status: r.Status, Conclusion: r.Conclusion, OccurredAt: at})
		}
		if len(response.Checks) < 100 {
			break
		}
	}
	for page := 1; page <= 3; page++ {
		var statuses []struct {
			ID        int64     `json:"id"`
			Context   string    `json:"context"`
			State     string    `json:"state"`
			UpdatedAt time.Time `json:"updated_at"`
		}
		if err := a.get(ctx, installation, base+"/statuses?per_page=100&page="+strconv.Itoa(page), "", &statuses); err != nil {
			return nil, err
		}
		for _, r := range statuses {
			status := "completed"
			if r.State == "pending" {
				status = "pending"
			}
			out = append(out, fd.Check{Source: "github_status", ID: strconv.FormatInt(r.ID, 10), Name: r.Context, RepositoryID: repository, Revision: sha, Status: status, Conclusion: r.State, OccurredAt: r.UpdatedAt})
		}
		if len(statuses) < 100 {
			break
		}
		if page == 3 {
			return nil, fmt.Errorf("GitHub statuses exceed bounded history")
		}
	}
	return out, nil
}

// DeploymentDeliveries recovers signed webhook request bodies from GitHub's
// authenticated App delivery API. It never requests a provider mutation or
// claims GitHub will automatically retry. The last 100 deliveries are bounded;
// insufficient retained coverage explicitly leaves a gap for an operator.
func (a *App) DeploymentDeliveries(ctx context.Context, installation int64, repository string, since time.Time) ([]fd.GitHubRecoveredDelivery, bool, error) {
	token, err := a.appJWT()
	if err != nil {
		return nil, false, err
	}
	var items []struct {
		ID             int64     `json:"id"`
		GUID           string    `json:"guid"`
		DeliveredAt    time.Time `json:"delivered_at"`
		Event          string    `json:"event"`
		InstallationID int64     `json:"installation_id"`
		RepositoryID   int64     `json:"repository_id"`
	}
	if err := a.do(ctx, http.MethodGet, a.API+"/app/hook/deliveries?per_page=100", "Bearer "+token, nil, &items); err != nil {
		return nil, false, err
	}
	out := []fd.GitHubRecoveredDelivery{}
	complete := len(items) < 100
	for _, d := range items {
		if d.DeliveredAt.Before(since) {
			complete = true
			continue
		}
		if d.InstallationID != installation || strconv.FormatInt(d.RepositoryID, 10) != repository || !slices.Contains([]string{"deployment_status", "workflow_run", "workflow_job", "check_run", "status"}, d.Event) {
			continue
		}
		var detail struct {
			Request struct {
				Payload json.RawMessage `json:"payload"`
			} `json:"request"`
		}
		if err := a.do(ctx, http.MethodGet, a.API+"/app/hook/deliveries/"+strconv.FormatInt(d.ID, 10), "Bearer "+token, nil, &detail); err != nil {
			return nil, false, err
		}
		if len(detail.Request.Payload) > fd.MaxBody {
			return nil, false, fd.ErrPayload
		}
		out = append(out, fd.GitHubRecoveredDelivery{DeliveryID: d.GUID, EventName: d.Event, Body: detail.Request.Payload, OccurredAt: d.DeliveredAt})
	}
	return out, complete, nil
}
