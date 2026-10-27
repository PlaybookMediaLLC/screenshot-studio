package httpapi

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

// The collaboration server's routes (RFC 013). It authenticates with its own
// credential, COLLAB_SERVICE_TOKEN, which opens nothing but these routes, and
// every call also carries the user's draft-scoped token, so the credential
// alone cannot read or write any draft.

const collabStateBodyLimit = 8 << 20

func (s *Server) registerCollab(mux *http.ServeMux) {
	token := os.Getenv("COLLAB_SERVICE_TOKEN")
	guard := func(next http.HandlerFunc) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token == "" {
				writeError(w, http.StatusServiceUnavailable, "collaboration is not configured")
				return
			}
			provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			next(w, r)
		})
	}
	mux.Handle("POST /v1/collab/authorize", guard(s.authorizeCollab))
	mux.Handle("GET /v1/collab/documents/{draftId}", guard(s.loadCollabDocument))
	mux.Handle("PUT /v1/collab/documents/{draftId}", guard(s.storeCollabDocument))
}

// writeCollabError keeps the reason a connection was refused visible in logs
// and responses without revealing whether another workspace's draft exists.
func writeCollabError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, product.ErrCollabUnavailable):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, publishing.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "the collaboration token is invalid or expired")
	case errors.Is(err, publishing.ErrForbidden):
		writeError(w, http.StatusForbidden, "the collaboration token does not grant this document")
	default:
		writeStoreError(w, err)
	}
}

func (s *Server) authorizeCollab(w http.ResponseWriter, r *http.Request) {
	var input struct {
		DocumentName string `json:"documentName"`
		Token        string `json:"token"`
	}
	if err := decodeJSON(r, &input); err != nil || input.Token == "" || input.DocumentName == "" {
		writeError(w, http.StatusBadRequest, "token and documentName are required")
		return
	}
	grant, err := s.configuration.AuthorizeCollab(r.Context(), input.Token, input.DocumentName)
	if err != nil {
		writeCollabError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, grant)
}

func collabDocumentID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("draftId")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid content draft ID")
		return "", false
	}
	return id, true
}

func (s *Server) loadCollabDocument(w http.ResponseWriter, r *http.Request) {
	id, ok := collabDocumentID(w, r)
	if !ok {
		return
	}
	state, err := s.configuration.LoadCollabState(r.Context(), r.Header.Get("X-Collab-Token"), id)
	if err != nil {
		writeCollabError(w, err)
		return
	}
	var encoded *string
	if state != nil {
		value := base64.StdEncoding.EncodeToString(state)
		encoded = &value
	}
	writeJSON(w, http.StatusOK, map[string]*string{"state": encoded})
}

func (s *Server) storeCollabDocument(w http.ResponseWriter, r *http.Request) {
	id, ok := collabDocumentID(w, r)
	if !ok {
		return
	}
	var input struct {
		State string `json:"state"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, collabStateBodyLimit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid collaboration state")
		return
	}
	state, err := base64.StdEncoding.DecodeString(input.State)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid collaboration state")
		return
	}
	if err := s.configuration.StoreCollabState(r.Context(), r.Header.Get("X-Collab-Token"), id, state); err != nil {
		writeCollabError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"stored": true})
}
