package channels

import (
	"bytes"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/autopost"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/sets"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/signatures"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/webhooks"
	autopostdto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/autopost"
	setsdto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/sets"
	signaturedto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/signature"
	webhooksdto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/webhooks"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ssrf"
)

// RegisterWebhooksController registers WebhookController under /webhooks.
func RegisterWebhooksController(r *httpx.Router, authn httpx.Middleware, perms *auth.PermissionsService, service *webhooks.Service) {
	g := r.Group("/webhooks", authn)
	g.Get("/", func(c *httpx.Ctx) (any, error) {
		return service.GetWebhooks(c.R.Context(), c.Org.ID)
	})
	g.Post("/", func(c *httpx.Ctx) (any, error) {
		var body webhooksdto.WebhooksDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		if err := body.Validate(c.R.Context()); err != nil {
			return nil, err
		}
		return service.CreateWebhook(c.R.Context(), c.Org.ID, body)
	}, perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionWebhooks)))
	g.Put("/", func(c *httpx.Ctx) (any, error) {
		var body webhooksdto.UpdateDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		if err := body.Validate(c.R.Context()); err != nil {
			return nil, err
		}
		return service.CreateWebhook(c.R.Context(), c.Org.ID, webhooksdto.WebhooksDto{
			ID: body.ID, Name: body.Name, URL: body.URL, Integrations: body.Integrations,
		})
	})
	g.Delete("/:id", func(c *httpx.Ctx) (any, error) {
		return service.DeleteWebhook(c.R.Context(), c.Org.ID, c.Param("id"))
	})
	g.Post("/send", func(c *httpx.Ctx) (any, error) {
		body, err := rawBody(c)
		if err != nil {
			return nil, err
		}
		var query webhooksdto.OnlyURL
		if err := c.BindQuery(&query); err != nil {
			return nil, err
		}
		if err := query.Validate(c.R.Context()); err != nil {
			return nil, err
		}
		if len(body) == 0 {
			body = []byte("{}")
		}
		// errors are swallowed: the test webhook is "sent" either way
		if req, err := http.NewRequestWithContext(c.R.Context(), http.MethodPost, query.URL, bytes.NewReader(body)); err == nil {
			req.Header.Set("Content-Type", "application/json")
			if res, err := ssrf.Client().Do(req); err == nil {
				_ = res.Body.Close()
			}
		}
		return map[string]bool{"send": true}, nil
	})
}

// RegisterAutopostController registers AutopostController under /autopost.
func RegisterAutopostController(r *httpx.Router, authn httpx.Middleware, perms *auth.PermissionsService, service *autopost.Service) {
	bind := func(c *httpx.Ctx) (autopostdto.AutopostDto, error) {
		var body autopostdto.AutopostDto
		if err := c.Bind(&body); err != nil {
			return body, err
		}
		return body, body.Validate(c.R.Context())
	}

	g := r.Group("/autopost", authn)
	g.Get("/", func(c *httpx.Ctx) (any, error) {
		return service.GetAutoposts(c.R.Context(), c.Org.ID)
	})
	g.Post("/", func(c *httpx.Ctx) (any, error) {
		body, err := bind(c)
		if err != nil {
			return nil, err
		}
		return service.CreateAutopost(c.R.Context(), c.Org.ID, body, "")
	}, perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionWebhooks)))
	g.Put("/:id", func(c *httpx.Ctx) (any, error) {
		body, err := bind(c)
		if err != nil {
			return nil, err
		}
		return service.CreateAutopost(c.R.Context(), c.Org.ID, body, c.Param("id"))
	})
	g.Delete("/:id", func(c *httpx.Ctx) (any, error) {
		return service.DeleteAutopost(c.R.Context(), c.Org.ID, c.Param("id"))
	})
	g.Post("/:id/active", func(c *httpx.Ctx) (any, error) {
		var body struct {
			Active bool `json:"active"`
		}
		if err := c.Decode(&body); err != nil {
			return nil, err
		}
		return service.ChangeActive(c.R.Context(), c.Org.ID, c.Param("id"), body.Active)
	})
	g.Post("/send", func(c *httpx.Ctx) (any, error) {
		var query webhooksdto.OnlyURL
		if err := c.BindQuery(&query); err != nil {
			return nil, err
		}
		if err := query.Validate(c.R.Context()); err != nil {
			return nil, err
		}
		return service.LoadXML(c.R.Context(), query.URL), nil
	})
}

// RegisterSetsController registers SetsController under /sets.
func RegisterSetsController(r *httpx.Router, authn httpx.Middleware, service *sets.Service) {
	g := r.Group("/sets", authn)
	g.Get("/", func(c *httpx.Ctx) (any, error) {
		return service.GetSets(c.R.Context(), c.Org.ID)
	})
	g.Post("/", func(c *httpx.Ctx) (any, error) {
		var body setsdto.SetsDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		return service.CreateSet(c.R.Context(), c.Org.ID, body)
	})
	g.Put("/", func(c *httpx.Ctx) (any, error) {
		var body setsdto.UpdateSetsDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		return service.CreateSet(c.R.Context(), c.Org.ID, setsdto.SetsDto{ID: body.ID, Name: body.Name, Content: body.Content})
	})
	g.Delete("/:id", func(c *httpx.Ctx) (any, error) {
		return service.DeleteSet(c.R.Context(), c.Org.ID, c.Param("id"))
	})
}

// RegisterSignatureController registers SignatureController under /signatures.
func RegisterSignatureController(r *httpx.Router, authn httpx.Middleware, service *signatures.Service) {
	g := r.Group("/signatures", authn)
	g.Get("/", func(c *httpx.Ctx) (any, error) {
		return service.GetSignaturesByOrgID(c.R.Context(), c.Org.ID)
	})
	g.Get("/default", func(c *httpx.Ctx) (any, error) {
		signature, err := service.GetDefaultSignature(c.R.Context(), c.Org.ID)
		if err != nil || signature == nil {
			return map[string]any{}, err
		}
		return signature, nil
	})
	g.Post("/", func(c *httpx.Ctx) (any, error) {
		var body signaturedto.SignatureDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		return service.CreateOrUpdateSignature(c.R.Context(), c.Org.ID, body, "")
	})
	g.Delete("/:id", func(c *httpx.Ctx) (any, error) {
		return service.DeleteSignature(c.R.Context(), c.Org.ID, c.Param("id"))
	})
	g.Put("/:id", func(c *httpx.Ctx) (any, error) {
		var body signaturedto.SignatureDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		return service.CreateOrUpdateSignature(c.R.Context(), c.Org.ID, body, c.Param("id"))
	})
}
