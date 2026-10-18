package httpapi

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/githubapp"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

var (
	numericIDPattern = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)
	installStatus    = map[string]product.GitHubInstallationStatus{
		"ACTIVE": product.GitHubInstallationActive, "SUSPENDED": product.GitHubInstallationSuspended,
		"DELETED": product.GitHubInstallationDeleted,
	}
)

func (s *Server) registerGitHub(mux *http.ServeMux) {
	mux.Handle("POST /v1/source-changes", s.authenticateProduct(http.HandlerFunc(s.collectSourceChange)))
	mux.Handle("POST /v1/source-deployments", s.authenticateProduct(http.HandlerFunc(s.ingestDeployment)))
	mux.Handle("POST /v1/github/connections/start", s.authenticateProduct(http.HandlerFunc(s.startGitHubConnection)))
	mux.Handle("POST /v1/github/connections/complete", s.authenticateProduct(http.HandlerFunc(s.completeGitHubConnection)))
	mux.Handle("GET /v1/github/connections", s.authenticateProduct(http.HandlerFunc(s.listGitHubConnections)))
	mux.Handle("DELETE /v1/github/connections/{id}", s.authenticateProduct(http.HandlerFunc(s.deleteGitHubConnection)))
	mux.Handle("GET /v1/github/connections/{id}/repositories", s.authenticateProduct(http.HandlerFunc(s.listGitHubRepositories)))
	// The App webhook runs before any tenant is known; these are facade-only.
	mux.Handle("GET /v1/internal/github/installations/{installation}/repositories/{repository}/sources",
		s.authenticateService(http.HandlerFunc(s.githubSources)))
	mux.Handle("PUT /v1/internal/github/installations/{installation}", s.authenticateService(http.HandlerFunc(s.recordGitHubInstallation)))
	mux.Handle("POST /v1/internal/github/installations/{installation}/status", s.authenticateService(http.HandlerFunc(s.setGitHubInstallationStatus)))
	mux.Handle("POST /v1/internal/github/installations/{installation}/removed-repositories",
		s.authenticateService(http.HandlerFunc(s.removeGitHubRepositories)))
}

func (s *Server) collectSourceChange(w http.ResponseWriter, r *http.Request) {
	var input product.CollectSourceChangeInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	result, err := s.configuration.CollectSourceChange(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, createdStatus(result.Created), result)
}

func (s *Server) ingestDeployment(w http.ResponseWriter, r *http.Request) {
	var input product.IngestDeploymentInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	result, err := s.configuration.IngestDeployment(r.Context(), workspaceActor(r), input)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, createdStatus(result.Created), result)
}

func createdStatus(created bool) int {
	if created {
		return http.StatusCreated
	}
	return http.StatusOK
}

func (s *Server) startGitHubConnection(w http.ResponseWriter, r *http.Request) {
	state, err := s.configuration.StartGitHubInstall(r.Context(), requestActor(r))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"state": state})
}

func (s *Server) completeGitHubConnection(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Code           string `json:"code"`
		InstallationID int64  `json:"installationId"`
		State          string `json:"state"`
	}
	if err := decodeJSON(r, &input); err != nil || len(input.Code) > 200 || len(input.State) > 200 {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	link, err := s.configuration.CompleteGitHubInstall(r.Context(), requestActor(r), input.State, input.Code, input.InstallationID)
	var choice *product.GitHubChoiceRequiredError
	if errors.As(err, &choice) {
		writeJSON(w, http.StatusConflict, map[string]any{"choices": choice.Choices,
			"code": "github_installation_choice_required", "error": err.Error()})
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, link)
}

func (s *Server) listGitHubConnections(w http.ResponseWriter, r *http.Request) {
	actor, ok := s.productReadActor(w, r)
	if !ok {
		return
	}
	links, err := s.configuration.ListGitHubInstallations(r.Context(), actor.OrganizationID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"connections": links})
}

func (s *Server) deleteGitHubConnection(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}
	if err := s.configuration.UnlinkGitHubInstallation(r.Context(), requestActor(r), id); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

func (s *Server) listGitHubRepositories(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusNotFound, "connection not found")
		return
	}
	repositories, err := s.configuration.GitHubRepositories(r.Context(), requestActor(r), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"repositories": repositories})
}

func installationParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	value := r.PathValue("installation")
	id, err := strconv.ParseInt(value, 10, 64)
	if !numericIDPattern.MatchString(value) || err != nil {
		writeError(w, http.StatusNotFound, "installation not found")
		return 0, false
	}
	return id, true
}

func (s *Server) githubSources(w http.ResponseWriter, r *http.Request) {
	installation, ok := installationParam(w, r)
	if !ok {
		return
	}
	repository := r.PathValue("repository")
	if !numericIDPattern.MatchString(repository) {
		writeError(w, http.StatusNotFound, "repository not found")
		return
	}
	sources, err := s.configuration.GitHubSources(r.Context(), installation, repository)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": sources})
}

func (s *Server) recordGitHubInstallation(w http.ResponseWriter, r *http.Request) {
	installation, ok := installationParam(w, r)
	if !ok {
		return
	}
	var input githubapp.Installation
	if err := decodeJSON(r, &input); err != nil || input.AccountLogin == "" || len(input.AccountLogin) > 100 ||
		input.AccountType == "" || len(input.AccountType) > 40 || len(input.RepositorySelection) > 20 {
		writeError(w, http.StatusBadRequest, "invalid installation")
		return
	}
	input.ID = installation
	if err := s.configuration.RecordGitHubInstallation(r.Context(), input); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"recorded": true})
}

func (s *Server) setGitHubInstallationStatus(w http.ResponseWriter, r *http.Request) {
	installation, ok := installationParam(w, r)
	if !ok {
		return
	}
	var input struct {
		Status string `json:"status"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	status, known := installStatus[input.Status]
	if !known {
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}
	archived, err := s.configuration.SetGitHubInstallationStatus(r.Context(), installation, status)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"archived": archived})
}

func (s *Server) removeGitHubRepositories(w http.ResponseWriter, r *http.Request) {
	installation, ok := installationParam(w, r)
	if !ok {
		return
	}
	var input struct {
		RepositoryIDs []string `json:"repositoryIds"`
	}
	if err := decodeJSON(r, &input); err != nil || len(input.RepositoryIDs) > 1000 {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	for _, id := range input.RepositoryIDs {
		if !numericIDPattern.MatchString(id) {
			writeError(w, http.StatusBadRequest, "invalid repository ID")
			return
		}
	}
	archived, err := s.configuration.RemoveGitHubRepositories(r.Context(), installation, input.RepositoryIDs)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"archived": archived})
}
