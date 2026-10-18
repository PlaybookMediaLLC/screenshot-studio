package account

import (
	"errors"
	"net/http"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/payment"
)

// RegisterPaymentController registers the payment routes (public, /payment):
// provider webhooks verified against the raw body.
func RegisterPaymentController(r *httpx.Router, payments *payment.Service) {
	g := r.Group("/payment")

	g.Post("/:provider", func(c *httpx.Ctx) (any, error) {
		raw, err := c.RawBody()
		if err != nil {
			return nil, err
		}
		result, err := payments.Webhook(c.R.Context(), c.Param("provider"), raw, c.R.Header)
		if err != nil {
			var he *httpx.Error
			if errors.As(err, &he) {
				return nil, err
			}
			// new HttpException(e, 500): an Error object serializes to {}
			return nil, httpx.NewError(http.StatusInternalServerError, map[string]any{})
		}
		return result, nil
	})
}

// RegisterStripeController registers the stripe routes (public, /stripe).
func RegisterStripeController(r *httpx.Router, payments *payment.Service) {
	g := r.Group("/stripe")

	g.Post("/", func(c *httpx.Ctx) (any, error) {
		raw, err := c.RawBody()
		if err != nil {
			return nil, err
		}
		return payments.Webhook(c.R.Context(), payment.StripeProviderName, raw, c.R.Header)
	})
}
