package account

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/database/users"
	dtousers "github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/users"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/payment"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/track"
)

// selfExtra are the keys /user/self adds after `...user`.
type selfExtra struct {
	OrgID         string                `json:"orgId"`
	TotalChannels int                   `json:"totalChannels"`
	Tier          string                `json:"tier"`
	Role          *string               `json:"role,omitempty"`
	IsLifetime    bool                  `json:"isLifetime"`
	Admin         bool                  `json:"admin"`
	Impersonate   bool                  `json:"impersonate"`
	IsTrailing    bool                  `json:"isTrailing"`
	AllowTrial    bool                  `json:"allowTrial"`
	StreakSince   *organizations.JSTime `json:"streakSince"`
	PublicAPI     any                   `json:"publicApi"`
}

// orgMembership / orgSubscription are getOrgsByUserId's selected columns.
type orgMembership struct {
	Disabled bool                  `json:"disabled"`
	Role     userorganization.Role `json:"role"`
}

type orgSubscription struct {
	SubscriptionTier string               `json:"subscriptionTier"`
	TotalChannels    int                  `json:"totalChannels"`
	IsLifetime       bool                 `json:"isLifetime"`
	CreatedAt        organizations.JSTime `json:"createdAt"`
}

type orgSummary struct {
	ID           string           `json:"id"`
	Name         string           `json:"name"`
	Users        []orgMembership  `json:"users"`
	Subscription *orgSubscription `json:"subscription"`
}

// signHS256 is jsonwebtoken's sign(payload, secret[, { expiresIn }]).
func signHS256(claims jwt.MapClaims, secret string, expiresIn time.Duration) (string, error) {
	now := time.Now()
	claims["iat"] = now.Unix()
	if expiresIn > 0 {
		claims["exp"] = now.Add(expiresIn).Unix()
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

// RegisterUsersController registers the users routes (authenticated, /user).
// authMiddleware is auth.AuthMiddleware(...).
func RegisterUsersController(r *httpx.Router, authMiddleware httpx.Middleware, perms *auth.PermissionsService,
	payments *payment.Service, authService *auth.AuthService, orgs *organizations.Service, usersService *users.Service,
	tracker TrackService) {
	g := r.Group("/user", authMiddleware)
	admin := perms.CheckPolicies(auth.Policy(auth.ActionCreate, auth.SectionAdmin))

	g.Get("/chatbase-token", func(c *httpx.Ctx) (any, error) {
		secret := os.Getenv("CHATBASE_TOKEN")
		if secret == "" {
			return nil, httpx.HTTPException("Chatbase SSO is not configured", http.StatusBadRequest)
		}
		claims := jwt.MapClaims{"user_id": c.Org.ID, "email": c.User.Email}
		if c.Org.PaymentID != nil && *c.Org.PaymentID != "" {
			claims["stripe_accounts"] = []map[string]string{{"label": c.Org.Name, "stripe_id": *c.Org.PaymentID}}
		}
		token, err := signHS256(claims, secret, time.Hour)
		if err != nil {
			return nil, err
		}
		return map[string]string{"token": token}, nil
	})

	g.Get("/agent-media-sso", func(c *httpx.Ctx) (any, error) {
		secret := os.Getenv("AGENT_MEDIA_SSO_KEY")
		if secret == "" {
			return nil, httpx.HTTPException("Agent Media SSO is not configured", http.StatusBadRequest)
		}
		token, err := signHS256(jwt.MapClaims{"id": c.Org.ID, "displayName": c.Org.Name}, secret, 0)
		if err != nil {
			return nil, err
		}
		return map[string]string{"url": "https://app.agent-media.ai/sso/" + token}, nil
	})

	g.Get("/self", func(c *httpx.Ctx) (any, error) {
		org := c.Org
		if org == nil {
			return nil, auth.HTTPForbiddenException()
		}
		noStripe := os.Getenv("STRIPE_PUBLISHABLE_KEY") == ""
		sub := org.Edges.Subscription

		extra := selfExtra{
			OrgID:       org.ID,
			Admin:       c.User.IsSuperAdmin,
			Impersonate: c.Cookie("impersonate") != "" || c.Header("impersonate") != "",
			IsTrailing:  !noStripe && org.IsTrailing,
			AllowTrial:  org.AllowTrial,
			StreakSince: organizations.NewJSTime(org.StreakSince),
			PublicAPI:   "",
		}
		switch {
		case noStripe:
			extra.TotalChannels = 10000
		case sub != nil && sub.TotalChannels != 0:
			extra.TotalChannels = sub.TotalChannels
		default:
			extra.TotalChannels = subscriptions.Pricing["FREE"].Channel
		}
		switch {
		case sub != nil && sub.SubscriptionTier != "":
			extra.Tier = string(sub.SubscriptionTier)
		case noStripe:
			extra.Tier = "ULTIMATE"
		default:
			extra.Tier = "FREE"
		}
		extra.IsLifetime = sub != nil && sub.IsLifetime
		if len(org.Edges.Users) > 0 {
			role := string(org.Edges.Users[0].Role)
			extra.Role = &role
			if role == "SUPERADMIN" || role == "ADMIN" {
				extra.PublicAPI = org.APIKey
			}
		}
		return spreadJSON(c.User, extra)
	})

	g.Get("/personal", func(c *httpx.Ctx) (any, error) {
		return usersService.GetPersonal(c.R.Context(), c.User.ID)
	})

	g.Get("/impersonate", func(c *httpx.Ctx) (any, error) {
		if !c.User.IsSuperAdmin {
			return nil, unauthorized()
		}
		return usersService.GetImpersonateUser(c.R.Context(), c.Query("name"))
	})

	g.Post("/impersonate", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		if !c.User.IsSuperAdmin {
			return nil, unauthorized()
		}
		setAuthCookie(c, "impersonate", str(fields, "id"))
		return nil, nil
	})

	g.Post("/switch", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		if !c.User.IsSuperAdmin {
			return nil, unauthorized()
		}

		// `user` is the impersonated account, so the admin id comes from the token.
		// Require an active impersonation session and never allow the admin's own
		// account in the swap — either would trade away the admin's login.
		id := str(fields, "id")
		adminID := requestUserID(c)
		if id == "" || adminID == "" || id == c.User.ID || adminID == c.User.ID || adminID == id {
			return nil, httpx.HTTPException("Invalid user to switch to", http.StatusBadRequest)
		}

		result, err := usersService.SwitchUser(c.R.Context(), c.User.ID, id, adminID)
		if err != nil {
			return nil, err
		}
		if err := payments.SyncCustomerEmailsAfterSwitch(c.R.Context(), []payment.Account{
			{ID: result.Kept.ID, Email: result.Kept.Email},
			{ID: result.Switched.ID, Email: result.Switched.Email},
		}); err != nil {
			return nil, err
		}
		return map[string]bool{"success": true}, nil
	})

	g.Post("/personal", func(c *httpx.Ctx) (any, error) {
		var body dtousers.UserDetailDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		return nil, usersService.ChangePersonal(c.R.Context(), c.User.ID, &body)
	})

	g.Get("/email-notifications", func(c *httpx.Ctx) (any, error) {
		return usersService.GetEmailNotifications(c.R.Context(), c.User.ID)
	})

	g.Post("/email-notifications", func(c *httpx.Ctx) (any, error) {
		var body dtousers.EmailNotificationsDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		return nil, usersService.UpdateEmailNotifications(c.R.Context(), c.User.ID, &body)
	})

	g.Post("/api-key/rotate", func(c *httpx.Ctx) (any, error) {
		return orgs.UpdateAPIKey(c.R.Context(), c.Org.ID)
	}, admin)

	g.Get("/subscription", func(c *httpx.Ctx) (any, error) {
		subscription, err := payments.GetSubscription(c.R.Context(), c.Org.ID)
		if err != nil {
			return nil, err
		}
		if subscription == nil {
			return map[string]any{}, nil
		}
		return map[string]any{"subscription": subscription}, nil
	}, admin)

	g.Get("/subscription/tiers", func(c *httpx.Ctx) (any, error) {
		provider, err := payments.GetDefaultProvider(payment.PlatformWeb)
		if err != nil {
			return nil, err
		}
		return provider.GetPackages(c.R.Context())
	}, admin)

	g.Post("/join-org", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		invite := authService.GetOrgFromCookie(str(fields, "org"))
		if invite == nil {
			c.JSON(http.StatusOK, map[string]any{"id": nil})
			return nil, nil
		}

		added, err := orgs.AddUserToOrg(c.R.Context(), c.User.ID, invite.ID, invite.OrgID, userorganization.Role(invite.Role))
		if err != nil {
			return nil, err
		}
		var id any
		if added != nil {
			id = added.OrganizationID
		}
		c.JSON(http.StatusOK, map[string]any{"id": id})
		return nil, nil
	})

	g.Get("/organizations", func(c *httpx.Ctx) (any, error) {
		list, err := orgs.GetOrgsByUserID(c.R.Context(), c.User.ID)
		if err != nil {
			return nil, err
		}
		out := []orgSummary{}
		for _, o := range list {
			if len(o.Edges.Users) == 0 || o.Edges.Users[0].Disabled {
				continue
			}
			summary := orgSummary{ID: o.ID, Name: o.Name, Users: []orgMembership{}}
			for _, m := range o.Edges.Users {
				summary.Users = append(summary.Users, orgMembership{Disabled: m.Disabled, Role: m.Role})
			}
			if s := o.Edges.Subscription; s != nil {
				summary.Subscription = &orgSubscription{
					SubscriptionTier: string(s.SubscriptionTier),
					TotalChannels:    s.TotalChannels,
					IsLifetime:       s.IsLifetime,
					CreatedAt:        organizations.JSTime{Time: s.CreatedAt},
				}
			}
			out = append(out, summary)
		}
		return out, nil
	})

	g.Post("/change-org", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		setAuthCookie(c, "showorg", str(fields, "id"))
		c.Send(http.StatusOK, nil)
		return nil, nil
	})

	g.Post("/delete-account", func(c *httpx.Ctx) (any, error) {
		if c.Cookie("impersonate") != "" || c.Header("impersonate") != "" {
			return nil, httpx.HTTPException("Account cannot be deleted while impersonating", http.StatusBadRequest)
		}

		// Cancel billing before scrubbing the account — once the account is
		// deleted there is no way to retry a failed cancellation
		owned, err := usersService.GetOrgsToDeleteForAccount(c.R.Context(), c.User.ID)
		if err != nil {
			return nil, err
		}
		for _, org := range owned {
			if err := payments.CancelAllSubscriptions(c.R.Context(), org.ID); err != nil {
				slog.Error("cancel subscriptions failed", "organizationId", org.ID, "error", err)
				return nil, httpx.HTTPException("Could not cancel your subscription, please try again or contact support", http.StatusBadRequest)
			}
		}

		if _, err := usersService.DeleteAccount(c.R.Context(), c.User.ID); err != nil {
			return nil, err
		}
		logout(c)
		return nil, nil
	})

	g.Post("/logout", func(c *httpx.Ctx) (any, error) {
		logout(c)
		return nil, nil
	})

	g.Post("/t", func(c *httpx.Ctx) (any, error) {
		var body struct {
			TT         track.Enum     `json:"tt"`
			Fbclid     string         `json:"fbclid"`
			Additional map[string]any `json:"additional"`
		}
		if err := c.Decode(&body); err != nil {
			return nil, err
		}
		uniqueID := c.Cookie("track")
		if uniqueID == "" {
			uniqueID = ids.Make(10)
		}
		fbclid := c.Cookie("fbclid")
		if fbclid == "" {
			fbclid = body.Fbclid
		}
		if err := tracker.Track(c.R.Context(), uniqueID, c.RealIP(), c.Header("User-Agent"), body.TT, body.Additional, fbclid, c.User); err != nil {
			return nil, err
		}
		if c.Cookie("track") == "" {
			setCookie(c, "track", uniqueID, time.Now().Add(year))
		}
		c.JSON(http.StatusOK, map[string]string{"track": uniqueID})
		return nil, nil
	})
}

// requestUserID is the id in the caller's own auth token (header first).
func requestUserID(c *httpx.Ctx) string {
	token := c.Header("auth")
	if token == "" {
		token = c.Cookie("auth")
	}
	payload, err := helpers.VerifyJWT(token)
	if err != nil {
		return ""
	}
	id, _ := payload["id"].(string)
	return id
}

// logout clears the session cookies and answers an empty 200.
func logout(c *httpx.Ctx) {
	c.SetHeader("logout", "true")
	clearCookie(c, "auth")
	clearCookie(c, "showorg")
	clearCookie(c, "impersonate")
	c.Send(http.StatusOK, nil)
}
