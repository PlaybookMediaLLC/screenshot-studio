package httpapi

import (
	"context"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
)

// LibraryStore renames and archives a workspace's presets and brand kits.
// Each acts on every version of the name the given version belongs to.
type LibraryStore interface {
	RenameCreativeTemplate(context.Context, product.Actor, string, string) (*product.CreativeTemplateRecord, error)
	ArchiveCreativeTemplate(context.Context, product.Actor, string) error
	RenameBrandKit(context.Context, product.Actor, string, string) (*ent.BrandKit, error)
	ArchiveBrandKit(context.Context, product.Actor, string) error
}

func (s *Server) registerLibrary(mux *http.ServeMux) {
	mux.Handle("PATCH /v1/creative-templates/{id}", s.authenticateProduct(http.HandlerFunc(s.renameCreativeTemplate)))
	mux.Handle("DELETE /v1/creative-templates/{id}", s.authenticateProduct(http.HandlerFunc(s.archiveCreativeTemplate)))
	mux.Handle("PATCH /v1/brand-kits/{id}", s.authenticateProduct(http.HandlerFunc(s.renameBrandKit)))
	mux.Handle("DELETE /v1/brand-kits/{id}", s.authenticateProduct(http.HandlerFunc(s.archiveBrandKit)))
}

// libraryRename reads the path ID and the new name, answering 400 when either is malformed.
func libraryRename(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid ID")
		return "", "", false
	}
	var input struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return "", "", false
	}
	return id, input.Name, true
}

func (s *Server) renameCreativeTemplate(w http.ResponseWriter, r *http.Request) {
	id, name, ok := libraryRename(w, r)
	if !ok {
		return
	}
	item, err := s.configuration.RenameCreativeTemplate(r.Context(), workspaceActor(r), id, name)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) archiveCreativeTemplate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid ID")
		return
	}
	if err := s.configuration.ArchiveCreativeTemplate(r.Context(), workspaceActor(r), id); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"archived": true})
}

func (s *Server) renameBrandKit(w http.ResponseWriter, r *http.Request) {
	id, name, ok := libraryRename(w, r)
	if !ok {
		return
	}
	kit, err := s.configuration.RenameBrandKit(r.Context(), workspaceActor(r), id, name)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, brandKitResponse(kit))
}

func (s *Server) archiveBrandKit(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !resourceIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid ID")
		return
	}
	if err := s.configuration.ArchiveBrandKit(r.Context(), workspaceActor(r), id); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"archived": true})
}
