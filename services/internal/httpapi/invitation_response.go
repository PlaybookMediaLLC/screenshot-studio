package httpapi

import "net/http"

func (s *Server) getRecipientInvitation(w http.ResponseWriter, r *http.Request) {
	result, err := s.configuration.GetRecipientInvitation(r.Context(), workspaceActor(r), r.PathValue("id"))
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) respondInvitation(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Action string `json:"action"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid invitation action")
		return
	}
	result, err := s.configuration.RespondInvitation(r.Context(), workspaceActor(r), r.PathValue("id"), input.Action)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
