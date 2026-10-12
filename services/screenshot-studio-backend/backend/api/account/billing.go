package account

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strconv"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/notifications"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/users"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/billing"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/payment"
)

// RegisterBillingController is billing.controller.ts (authenticated, /billing).
func RegisterBillingController(r *httpx.Router, authMiddleware httpx.Middleware, perms *auth.PermissionsService,
	subscriptionService *subscriptions.Service, notificationService *notifications.Service, usersService *users.Service,
	payments *payment.Service) {
	g := r.Group("/billing", authMiddleware)

	// Billing routes are the web platform; the org's own provider (or the web
	// default when it has none) handles the action.
	provider := func(c *httpx.Ctx) (payment.Provider, error) {
		return payments.GetProviderForOrganization(c.R.Context(), c.Org.ID, payment.PlatformWeb)
	}

	otherSubscribedAccount := func(ctx context.Context, u *ent.User) (bool, error) {
		other, err := usersService.GetUserWithActiveSubscriptionByEmail(ctx, u.Email, u.ID)
		return other != nil, err
	}

	// superAdmin runs fn for super admins only.
	superAdmin := func(fn func(c *httpx.Ctx, p payment.Provider) (any, error)) httpx.Handler {
		return func(c *httpx.Ctx) (any, error) {
			if !c.User.IsSuperAdmin {
				return nil, unauthorized()
			}
			p, err := provider(c)
			if err != nil {
				return nil, err
			}
			return fn(c, p)
		}
	}

	g.Get("/check/:id", func(c *httpx.Ctx) (any, error) {
		p, err := provider(c)
		if err != nil {
			return nil, err
		}
		status, err := p.CheckSubscription(c.R.Context(), c.Org.ID, c.Param("id"))
		if err != nil {
			return nil, err
		}
		return map[string]int{"status": status}, nil
	})

	g.Get("/check-discount", func(c *httpx.Ctx) (any, error) {
		p, err := provider(c)
		if err != nil {
			return nil, err
		}
		ok, err := p.CheckDiscount(c.R.Context(), c.Org)
		if err != nil {
			return nil, err
		}
		if !ok {
			return map[string]any{"offerCoupon": false}, nil
		}
		token, err := helpers.SignJWT(map[string]any{"discount": true})
		if err != nil {
			return nil, err
		}
		return map[string]any{"offerCoupon": token}, nil
	})

	g.Post("/apply-discount", func(c *httpx.Ctx) (any, error) {
		p, err := provider(c)
		if err != nil {
			return nil, err
		}
		_, err = p.ApplyDiscount(c.R.Context(), c.Org)
		return nil, err
	})

	g.Post("/finish-trial", func(c *httpx.Ctx) (any, error) {
		p, err := provider(c)
		if err != nil {
			return nil, err
		}
		_, _ = p.FinishTrial(c.R.Context(), c.Org)
		return map[string]bool{"finish": true}, nil
	})

	g.Get("/is-trial-finished", func(c *httpx.Ctx) (any, error) {
		return map[string]bool{"finished": !c.Org.IsTrailing}, nil
	})

	checkout := func(embedded bool) httpx.Handler {
		return func(c *httpx.Ctx) (any, error) {
			var body payment.BillingSubscribeDTO
			if err := c.Bind(&body); err != nil {
				return nil, err
			}
			blocked, err := otherSubscribedAccount(c.R.Context(), c.User)
			if err != nil {
				return nil, err
			}
			if blocked {
				return map[string]bool{"blocked": true}, nil
			}
			p, err := provider(c)
			if err != nil {
				return nil, err
			}
			uniqueID := c.Cookie("track")
			if embedded {
				return p.Embedded(c.R.Context(), uniqueID, c.Org.ID, c.User.ID, body, c.Org.AllowTrial)
			}
			return p.Subscribe(c.R.Context(), uniqueID, c.Org.ID, c.User.ID, body, c.Org.AllowTrial)
		}
	}
	g.Post("/embedded", checkout(true))
	g.Post("/subscribe", checkout(false))

	g.Post("/sync", func(c *httpx.Ctx) (any, error) {
		var body billing.BillingSyncDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		blocked, err := otherSubscribedAccount(c.R.Context(), c.User)
		if err != nil {
			return nil, err
		}
		if blocked {
			return map[string]bool{"blocked": true}, nil
		}
		if err := payments.AssertCanUseProvider(c.R.Context(), c.Org.ID, *body.Provider); err != nil {
			return nil, err
		}

		result, err := payments.SyncSubscription(c.R.Context(), *body.Provider, c.Org.ID)
		if err != nil {
			var he *httpx.Error
			if errors.As(err, &he) {
				return nil, err
			}
			message := err.Error()
			if message == "" {
				message = "Sync failed"
			}
			return nil, httpx.HTTPException(message, http.StatusBadRequest)
		}
		return result, nil
	})

	g.Get("/portal", func(c *httpx.Ctx) (any, error) {
		p, err := provider(c)
		if err != nil {
			return nil, err
		}
		link, err := p.PortalLink(c.R.Context(), c.Org.ID)
		if err != nil {
			return nil, err
		}
		return map[string]string{"portal": link.URL}, nil
	})

	g.Get("/invoices", func(c *httpx.Ctx) (any, error) {
		p, err := provider(c)
		if err != nil {
			return nil, err
		}
		return p.GetInvoices(c.R.Context(), c.Org.ID)
	}, perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionAdmin)))

	g.Get("/", func(c *httpx.Ctx) (any, error) {
		subscription, err := payments.GetSubscription(c.R.Context(), c.Org.ID)
		if err != nil || subscription == nil {
			// undefined: Nest sends an empty body
			return nil, err
		}
		return subscription, nil
	})

	g.Post("/cancel", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		p, err := provider(c)
		if err != nil {
			return nil, err
		}
		result, err := p.SetToCancel(c.R.Context(), c.Org.ID)
		if err != nil {
			return nil, err
		}
		if result.CancelAt != nil {
			feedback := "undefined"
			if v, ok := fields["feedback"].(string); ok {
				feedback = v
			}
			if err := notificationService.SendEmail(c.R.Context(), os.Getenv("EMAIL_FROM_ADDRESS"), "Subscription Cancelled",
				"Organization "+c.Org.Name+" has cancelled their subscription because: "+feedback, c.User.Email); err != nil {
				return nil, err
			}
		}
		return result, nil
	})

	g.Post("/prorate", func(c *httpx.Ctx) (any, error) {
		var body payment.BillingSubscribeDTO
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		p, err := provider(c)
		if err != nil {
			return nil, err
		}
		return p.Prorate(c.R.Context(), c.Org.ID, body)
	})

	g.Get("/charges", superAdmin(func(c *httpx.Ctx, p payment.Provider) (any, error) {
		return p.GetCharges(c.R.Context(), c.Org.ID)
	}))

	g.Post("/refund-charges", func(c *httpx.Ctx) (any, error) {
		var body struct {
			ChargeIDs []string `json:"chargeIds"`
		}
		if err := c.Decode(&body); err != nil {
			return nil, err
		}
		return superAdmin(func(c *httpx.Ctx, p payment.Provider) (any, error) {
			return p.RefundCharges(c.R.Context(), c.Org.ID, body.ChargeIDs)
		})(c)
	})

	g.Post("/cancel-subscription", superAdmin(func(c *httpx.Ctx, p payment.Provider) (any, error) {
		return p.CancelSubscription(c.R.Context(), c.Org.ID)
	}))

	g.Get("/coupon-info", superAdmin(func(c *httpx.Ctx, p payment.Provider) (any, error) {
		return p.GetCouponInfo(c.R.Context(), c.Org.ID)
	}))

	g.Post("/apply-coupon", func(c *httpx.Ctx) (any, error) {
		var body billing.AdminApplyCouponDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		months := int(*body.Months)
		return superAdmin(func(c *httpx.Ctx, p payment.Provider) (any, error) {
			return p.ApplyCoupon(c.R.Context(), c.Org.ID, payment.AdminApplyCouponDTO{Type: *body.Type, Value: body.Value, Months: &months})
		})(c)
	})

	g.Post("/cancel-coupon", superAdmin(func(c *httpx.Ctx, p payment.Provider) (any, error) {
		return p.CancelCoupon(c.R.Context(), c.Org.ID)
	}))

	g.Get("/chatbase-refund/preview", func(c *httpx.Ctx) (any, error) {
		p, err := provider(c)
		if err != nil {
			return nil, err
		}
		return p.ChatbaseRefundPreview(c.R.Context(), c.Org.ID)
	})

	g.Post("/chatbase-refund", func(c *httpx.Ctx) (any, error) {
		p, err := provider(c)
		if err != nil {
			return nil, err
		}
		refund, err := p.ChatbaseRefund(c.R.Context(), c.Org.ID)
		if err != nil {
			return nil, err
		}
		if refund.Refunded {
			amount, currency := "undefined", "undefined"
			if refund.Amount != nil {
				amount = strconv.FormatFloat(*refund.Amount, 'f', -1, 64)
			}
			if refund.Currency != nil {
				currency = *refund.Currency
			}
			if err := notificationService.SendEmail(c.R.Context(), os.Getenv("EMAIL_FROM_ADDRESS"), "Refund issued from Chatbase",
				"Organization "+c.Org.Name+" received a refund of "+amount+" "+currency+" and their subscription was cancelled", c.User.Email); err != nil {
				return nil, err
			}
		}
		return refund, nil
	})

	g.Post("/add-subscription", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		if !c.User.IsSuperAdmin {
			// a plain Error: Nest answers 500
			return nil, errUnauthorized
		}
		name, err := payments.GetDefaultProviderName(payment.PlatformWeb)
		if err != nil {
			return nil, err
		}
		return nil, subscriptionService.AddSubscription(c.R.Context(), c.Org.ID, c.User.ID, str(fields, "subscription"), name)
	})
}
