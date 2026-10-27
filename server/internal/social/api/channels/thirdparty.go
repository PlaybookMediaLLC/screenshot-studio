package channels

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/media"
	thirdpartydto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/thirdparty"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/thirdparties"
)

// Storage is the part of the upload storage (UploadFactory.createStorage())
// the third-party controller uses.
type Storage interface {
	UploadSimple(ctx context.Context, path string) (string, error)
}

type thirdPartyController struct {
	manager *thirdparties.Manager
	media   *media.Service
	storage Storage
}

// RegisterThirdPartyController registers ThirdPartyController under /third-party.
func RegisterThirdPartyController(r *httpx.Router, authn httpx.Middleware, manager *thirdparties.Manager,
	mediaService *media.Service, storage Storage) {
	h := &thirdPartyController{manager: manager, media: mediaService, storage: storage}
	g := r.Group("/third-party", authn)
	g.Get("/list", h.getThirdPartyList)
	g.Get("/", h.getSavedThirdParty)
	g.Delete("/:id", h.deleteByID)
	g.Post("/:id/submit", h.generate)
	g.Post("/function/:id/:functionName", h.callFunction)
	g.Post("/:id/import", h.importMedia)
	g.Post("/:identifier", h.addAPIKey)
}

func (h *thirdPartyController) getThirdPartyList(*httpx.Ctx) (any, error) {
	return h.manager.GetAllThirdParties(), nil
}

type savedThirdParty struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	Identifier  string               `json:"identifier"`
	Title       string               `json:"title"`
	Position    string               `json:"position"`
	Fields      []thirdparties.Field `json:"fields"`
	Description string               `json:"description"`
}

func (h *thirdPartyController) getSavedThirdParty(c *httpx.Ctx) (any, error) {
	list, err := h.manager.GetAllThirdPartiesByOrganization(c.R.Context(), c.Org.ID)
	if err != nil {
		return nil, err
	}
	out := make([]savedThirdParty, 0, len(list))
	for _, item := range list {
		registered := h.manager.GetThirdPartyByName(item.Identifier)
		if registered == nil {
			return nil, errors.New("unknown third party " + item.Identifier)
		}
		out = append(out, savedThirdParty{ID: item.ID, Name: item.Name, Identifier: item.Identifier, Title: registered.Title,
			Position: registered.Position, Fields: registered.Fields, Description: registered.Description})
	}
	return out, nil
}

func (h *thirdPartyController) deleteByID(c *httpx.Ctx) (any, error) {
	return h.manager.DeleteIntegration(c.R.Context(), c.Org.ID, c.Param("id"))
}

// load finds the organization's third party and its provider, answering like
// the controller's guards; apiKey is the decrypted key.
func (h *thirdPartyController) load(c *httpx.Ctx) (provider thirdparties.Provider, apiKey string, err error) {
	thirdParty, err := h.manager.GetIntegrationByID(c.R.Context(), c.Org.ID, c.Param("id"))
	if err != nil {
		return nil, "", err
	}
	if thirdParty == nil {
		return nil, "", httpx.HTTPException("Integration not found", http.StatusNotFound)
	}
	registered := h.manager.GetThirdPartyByName(thirdParty.Identifier)
	if registered == nil {
		return nil, "", httpx.HTTPException("Invalid identifier", http.StatusBadRequest)
	}
	apiKey, err = helpers.FixedDecryption(thirdParty.APIKey)
	return registered.Instance, apiKey, err
}

func lastSegment(path string) string { return path[strings.LastIndex(path, "/")+1:] }

func (h *thirdPartyController) generate(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	data, err := rawBody(c)
	if err != nil {
		return nil, err
	}
	provider, apiKey, err := h.load(c)
	if err != nil {
		return nil, err
	}
	loaded, err := provider.SendData(ctx, apiKey, data)
	if err != nil {
		return nil, err
	}
	file, err := h.storage.UploadSimple(ctx, loaded)
	if err != nil {
		return nil, err
	}
	return h.media.SaveFile(ctx, c.Org.ID, lastSegment(file), file, "")
}

func (h *thirdPartyController) callFunction(c *httpx.Ctx) (any, error) {
	data, err := rawBody(c)
	if err != nil {
		return nil, err
	}
	provider, apiKey, err := h.load(c)
	if err != nil {
		return nil, err
	}
	fn := provider.Functions()[c.Param("functionName")]
	if fn == nil {
		return nil, errors.New("thirdPartyInstance.instance[functionName] is not a function")
	}
	return fn(c.R.Context(), apiKey, data)
}

func (h *thirdPartyController) importMedia(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	var body thirdpartydto.ImportMediaDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	if err := body.Validate(ctx); err != nil {
		return nil, err
	}
	provider, apiKey, err := h.load(c)
	if err != nil {
		return nil, err
	}

	unsupported := httpx.HTTPException("Import not supported", http.StatusBadRequest)
	fn := provider.Functions()["importMedia"]
	if fn == nil {
		return nil, unsupported
	}
	items, err := json.Marshal(body.Items)
	if err != nil {
		return nil, err
	}
	result, err := fn(ctx, apiKey, items)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var downloadURLs []struct {
		URL  string `json:"url"`
		Name string `json:"name"`
	}
	if json.Unmarshal(encoded, &downloadURLs) != nil || downloadURLs == nil {
		return nil, unsupported
	}

	results := []*media.SavedMedia{}
	for _, item := range downloadURLs {
		file, err := h.storage.UploadSimple(ctx, item.URL)
		if err != nil {
			return nil, err
		}
		name := item.Name
		if name == "" {
			name = lastSegment(file)
		}
		saved, err := h.media.SaveFile(ctx, c.Org.ID, name, file, "")
		if err != nil {
			return nil, err
		}
		results = append(results, saved)
	}
	return results, nil
}

func (h *thirdPartyController) addAPIKey(c *httpx.Ctx) (any, error) {
	ctx := c.R.Context()
	var body struct {
		API string `json:"api"`
	}
	if err := c.Decode(&body); err != nil {
		return nil, err
	}
	identifier := c.Param("identifier")
	registered := h.manager.GetThirdPartyByName(identifier)
	if registered == nil {
		return nil, httpx.HTTPException("Invalid identifier", http.StatusBadRequest)
	}

	connect, err := registered.Instance.CheckConnection(ctx, body.API)
	if err != nil {
		return nil, err
	}
	if connect == nil {
		return nil, httpx.HTTPException("Invalid API key", http.StatusBadRequest)
	}

	saved, err := h.manager.SaveIntegration(ctx, c.Org.ID, identifier, body.API, *connect)
	if err != nil {
		slog.Error("save third party failed", "error", err)
		return nil, httpx.HTTPException("Integration Already Exists", http.StatusBadRequest)
	}
	return map[string]string{"id": saved.ID}, nil
}
