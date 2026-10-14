package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/postiz"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type oauthRequest struct {
	Provider      string `json:"provider"`
	State         string `json:"state"`
	IntegrationID string `json:"integrationId"`
}

func oauthIdentity(w http.ResponseWriter, r *http.Request) (publishing.Actor, string, bool) {
	actor, ok := actorFromRequest(w, r, true)
	if !ok {
		return publishing.Actor{}, "", false
	}
	sessionID := r.Header.Get("X-Session-ID")
	if sessionID == "" {
		writeError(w, http.StatusBadRequest, "X-Session-ID is required")
		return publishing.Actor{}, "", false
	}
	return actor, sessionID, true
}

func validOAuthProvider(provider string) bool {
	return provider == "x" || provider == "instagram" || provider == "instagram-standalone"
}

func decodeOAuthRequest(w http.ResponseWriter, r *http.Request, requireState, requireIntegration bool) (oauthRequest, bool) {
	var input oauthRequest
	if err := decodeJSON(r, &input); err != nil || !validOAuthProvider(input.Provider) ||
		(requireState && (input.State == "" || len(input.State) > 512)) ||
		(requireIntegration && (input.IntegrationID == "" || len(input.IntegrationID) > 160)) {
		writeError(w, http.StatusBadRequest, "invalid social OAuth request")
		return oauthRequest{}, false
	}
	return input, true
}

func validatedAuthorizationURL(raw, provider string) (string, string, error) {
	u, err := url.Parse(raw)
	if err != nil || u == nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" {
		return "", "", errors.New("invalid authorization URL")
	}
	host := map[string]string{
		"x": "api.x.com", "instagram": "www.facebook.com", "instagram-standalone": "www.instagram.com",
	}[provider]
	if u.Host != host {
		return "", "", errors.New("unexpected authorization host")
	}
	key := "state"
	if provider == "x" {
		key = "oauth_token"
	}
	state := strings.TrimSpace(u.Query().Get(key))
	if state == "" || len(state) > 512 {
		return "", "", errors.New("missing authorization state")
	}
	return u.String(), state, nil
}

func (s *Server) beginSocialOAuth(w http.ResponseWriter, r *http.Request) {
	actor, sessionID, ok := oauthIdentity(w, r)
	if !ok {
		return
	}
	input, ok := decodeOAuthRequest(w, r, false, false)
	if !ok {
		return
	}
	binding, err := s.store.Binding(r.Context(), actor.Organization)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	if s.verifier == nil {
		writeError(w, http.StatusServiceUnavailable, "social OAuth is unavailable")
		return
	}
	raw, err := s.verifier.BeginOAuth(r.Context(), postiz.BeginOAuthInput{
		ExpectedGoOrganizationID: binding.GoOrganizationID,
		Provider:                 input.Provider, SecretReference: binding.SecretReference,
	})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "social OAuth is unavailable")
		return
	}
	authorizationURL, state, err := validatedAuthorizationURL(raw, input.Provider)
	if err != nil {
		writeError(w, http.StatusBadGateway, "social provider returned an invalid authorization URL")
		return
	}
	if err := s.store.StartOAuth(r.Context(), actor, sessionID, state, input.Provider, binding.SecretReference); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"url": authorizationURL})
}

func (s *Server) verifySocialOAuth(w http.ResponseWriter, r *http.Request) {
	actor, sessionID, ok := oauthIdentity(w, r)
	if !ok {
		return
	}
	input, ok := decodeOAuthRequest(w, r, true, false)
	if !ok {
		return
	}
	var expected *string
	if input.IntegrationID != "" {
		expected = &input.IntegrationID
	}
	if _, err := s.store.OAuthStart(r.Context(), actor, sessionID, input.State, input.Provider, expected); err != nil {
		writeOAuthStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"valid": true})
}

func (s *Server) rememberSocialOAuth(w http.ResponseWriter, r *http.Request) {
	actor, sessionID, ok := oauthIdentity(w, r)
	if !ok {
		return
	}
	input, ok := decodeOAuthRequest(w, r, true, true)
	if !ok {
		return
	}
	if input.Provider != "instagram" {
		writeError(w, http.StatusBadRequest, "provider must be instagram")
		return
	}
	if err := s.store.RememberInstagramIntegration(r.Context(), actor, sessionID, input.State, input.IntegrationID); err != nil {
		writeOAuthStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"saved": true})
}

func (s *Server) completeSocialOAuth(w http.ResponseWriter, r *http.Request) {
	actor, sessionID, ok := oauthIdentity(w, r)
	if !ok {
		return
	}
	input, ok := decodeOAuthRequest(w, r, true, true)
	if !ok {
		return
	}
	var expected *string
	if input.Provider == "instagram" {
		expected = &input.IntegrationID
	}
	start, err := s.store.OAuthStart(r.Context(), actor, sessionID, input.State, input.Provider, expected)
	if err != nil {
		writeOAuthStoreError(w, err)
		return
	}
	binding, err := s.store.Binding(r.Context(), actor.Organization)
	if err != nil || binding.SecretReference != start.SecretReference || s.verifier == nil {
		writeError(w, http.StatusConflict, "social connection is unavailable for this workspace")
		return
	}
	if err := s.verifier.VerifyDestination(r.Context(), postiz.VerifyDestinationInput{
		DestinationID: input.IntegrationID, ExpectedGoOrganizationID: binding.GoOrganizationID,
		Platform: input.Provider, SecretReference: start.SecretReference,
	}); err != nil {
		writeError(w, http.StatusConflict, "social destination could not be verified")
		return
	}
	connection, err := s.store.FinishOAuth(r.Context(), actor, sessionID, input.State, input.Provider, input.IntegrationID)
	if err != nil {
		writeOAuthStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, connectionResponse(connection))
}

func writeOAuthStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, publishing.ErrNotFound) {
		writeError(w, http.StatusForbidden, "social connection expired; please start again")
		return
	}
	writeStoreError(w, err)
}
