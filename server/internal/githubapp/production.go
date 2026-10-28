package githubapp

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"

	automation "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/releaseautomation"
)

var ErrIncompleteEvidence = errors.New("GitHub returned incomplete evidence")

type ProductionCapabilities struct {
	Actions            bool     `json:"actions"`
	Deployments        bool     `json:"deployments"`
	Events             []string `json:"events"`
	SubscriptionsKnown bool     `json:"subscriptionsKnown"`
}

func (a *App) ProductionCapabilities(ctx context.Context, installation int64, repository string) (ProductionCapabilities, error) {
	if _, err := a.Repository(ctx, installation, repository); err != nil {
		return ProductionCapabilities{}, err
	}
	token, err := a.appJWT()
	if err != nil {
		return ProductionCapabilities{}, err
	}
	var install struct {
		Permissions map[string]string `json:"permissions"`
		SuspendedAt *string           `json:"suspended_at"`
	}
	if err := a.do(ctx, "GET", fmt.Sprintf("%s/app/installations/%d", a.API, installation), "Bearer "+token, nil, &install); err != nil {
		return ProductionCapabilities{}, err
	}
	if install.SuspendedAt != nil {
		return ProductionCapabilities{}, StatusError{Status: 403}
	}
	out := ProductionCapabilities{Actions: install.Permissions["actions"] == "read" || install.Permissions["actions"] == "write", Deployments: install.Permissions["deployments"] == "read" || install.Permissions["deployments"] == "write", Events: []string{}}
	var app struct {
		Events *[]string `json:"events"`
	}
	if err := a.do(ctx, "GET", a.API+"/app", "Bearer "+token, nil, &app); err != nil {
		return out, err
	}
	if app.Events != nil {
		out.Events = *app.Events
		out.SubscriptionsKnown = true
	}
	return out, nil
}

func (a *App) Workflows(ctx context.Context, installation int64, repository string) ([]automation.GitHubWorkflow, error) {
	result := []automation.GitHubWorkflow{}
	seen := map[int64]bool{}
	for page := 1; page <= 10; page++ {
		var out struct {
			Total     *int                        `json:"total_count"`
			Workflows []automation.GitHubWorkflow `json:"workflows"`
		}
		if err := a.get(ctx, installation, fmt.Sprintf("/repositories/%s/actions/workflows?per_page=100&page=%d", repository, page), "", &out); err != nil {
			return nil, err
		}
		if out.Total == nil || *out.Total < 0 || *out.Total > 1000 {
			return nil, ErrIncompleteEvidence
		}
		for _, w := range out.Workflows {
			if w.ID <= 0 || w.Path == "" || seen[w.ID] {
				return nil, ErrIncompleteEvidence
			}
			seen[w.ID] = true
			result = append(result, w)
		}
		if len(result) == *out.Total {
			return result, nil
		}
		if len(out.Workflows) < 100 {
			return nil, ErrIncompleteEvidence
		}
	}
	return nil, ErrIncompleteEvidence
}

type WorkflowJob struct {
	ID         int64  `json:"id"`
	RunID      int64  `json:"runId"`
	RunAttempt int    `json:"runAttempt"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
}

func (a *App) WorkflowJobs(ctx context.Context, installation int64, repository string, runID int64, attempt int) ([]WorkflowJob, error) {
	if runID <= 0 || attempt <= 0 {
		return nil, ErrIncompleteEvidence
	}
	jobs := []WorkflowJob{}
	seen := map[int64]bool{}
	for page := 1; page <= 10; page++ {
		var out struct {
			Total *int `json:"total_count"`
			Jobs  []struct {
				ID         int64  `json:"id"`
				RunID      int64  `json:"run_id"`
				Attempt    int    `json:"run_attempt"`
				Name       string `json:"name"`
				Status     string `json:"status"`
				Conclusion string `json:"conclusion"`
			} `json:"jobs"`
		}
		if err := a.get(ctx, installation, fmt.Sprintf("/repositories/%s/actions/runs/%d/attempts/%d/jobs?per_page=100&page=%d", repository, runID, attempt, page), "", &out); err != nil {
			return nil, err
		}
		if out.Total == nil || *out.Total < 0 || *out.Total > 1000 {
			return nil, ErrIncompleteEvidence
		}
		for _, j := range out.Jobs {
			if j.ID <= 0 || j.RunID != runID || j.Attempt != 0 && j.Attempt != attempt || seen[j.ID] {
				return nil, ErrIncompleteEvidence
			}
			seen[j.ID] = true
			jobs = append(jobs, WorkflowJob{j.ID, j.RunID, attempt, j.Name, j.Status, j.Conclusion})
		}
		if len(jobs) == *out.Total {
			return jobs, nil
		}
		if len(out.Jobs) < 100 {
			return nil, ErrIncompleteEvidence
		}
	}
	return nil, ErrIncompleteEvidence
}

func (a *App) EnrichProductionEvidence(ctx context.Context, e automation.GitHubEvidence) (automation.GitHubEvidence, error) {
	if e.RunID <= 0 || e.RunAttempt <= 0 {
		return e, ErrIncompleteEvidence
	}
	var run struct {
		ID         int64  `json:"id"`
		Attempt    int    `json:"run_attempt"`
		WorkflowID int64  `json:"workflow_id"`
		Name       string `json:"name"`
		Path       string `json:"path"`
		Repository struct {
			ID int64 `json:"id"`
		} `json:"repository"`
	}
	if err := a.get(ctx, e.InstallationID, fmt.Sprintf("/repositories/%s/actions/runs/%d/attempts/%d", e.RepositoryID, e.RunID, e.RunAttempt), "", &run); err != nil {
		return e, err
	}
	if run.ID != e.RunID || run.Attempt != e.RunAttempt || strconv.FormatInt(run.Repository.ID, 10) != e.RepositoryID || run.WorkflowID <= 0 {
		return e, ErrIncompleteEvidence
	}
	jobs, err := a.WorkflowJobs(ctx, e.InstallationID, e.RepositoryID, e.RunID, e.RunAttempt)
	if err != nil {
		return e, err
	}
	i := slices.IndexFunc(jobs, func(j WorkflowJob) bool { return j.ID == e.JobID })
	if i < 0 || jobs[i].Name != e.JobName {
		return e, ErrIncompleteEvidence
	}
	e.Workflow = automation.GitHubWorkflow{ID: run.WorkflowID, Name: run.Name, Path: run.Path}
	e.Association = "run_attempt_api"
	return e, nil
}
