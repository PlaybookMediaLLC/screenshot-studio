package content

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/clipping"
	clippingdto "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/clipping"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
)

type clippingController struct {
	clipping *clipping.Service
}

// RegisterClippingController registers ClippingController (/clipping) behind
// the auth middleware.
func RegisterClippingController(r *httpx.Router, authMiddleware httpx.Middleware, clippingService *clipping.Service) {
	h := &clippingController{clipping: clippingService}
	g := r.Group("/clipping", authMiddleware)
	g.Post("/", h.startClipping)
	g.Get("/", h.getClippings)
	g.Get("/:id", h.getClipping)
}

func (h *clippingController) startClipping(c *httpx.Ctx) (any, error) {
	var body clippingdto.ClippingDto
	if err := c.Bind(&body); err != nil {
		return nil, err
	}
	started, err := h.clipping.StartClipping(c.R.Context(), c.Org, body)
	return nullable(started, subscriptionError(err))
}

func (h *clippingController) getClippings(c *httpx.Ctx) (any, error) {
	return nullable(h.clipping.GetClippings(c.R.Context(), c.Org.ID, queryPage(c)))
}

func (h *clippingController) getClipping(c *httpx.Ctx) (any, error) {
	return nullable(h.clipping.GetClipping(c.R.Context(), c.Org.ID, c.Param("id")))
}

// clippingTickets adapts clipping.Service to the auth package's ticket lookup.
type clippingTickets struct{ clipping *clipping.Service }

func (t clippingTickets) GetWidgetTicket(ctx context.Context, ticket string) (*auth.ClippingTicket, error) {
	found, err := t.clipping.GetWidgetTicket(ctx, ticket)
	if err != nil || found == nil {
		return nil, err
	}
	return &auth.ClippingTicket{Org: found.Org, ID: found.ID}, nil
}

// RegisterClippingWidgetController registers ClippingWidgetController
// (/clipping-widget) behind ClippingWidgetAuthMiddleware.
func RegisterClippingWidgetController(r *httpx.Router, clippingService *clipping.Service) {
	g := r.Group("/clipping-widget", auth.ClippingWidgetAuthMiddleware(clippingTickets{clippingService}))
	g.Get("/status", func(c *httpx.Ctx) (any, error) {
		progress, err := clippingService.GetWidgetProgress(c.R.Context(), c.Org.ID, auth.ClippingID(c), c.Query("seen") != "")
		if err != nil {
			return nil, err
		}
		c.SetHeader("Cache-Control", "no-store")
		return nullable(progress, nil)
	})
}
