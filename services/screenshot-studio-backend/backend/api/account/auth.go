package account

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/user"
	authdto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/integrations/social/farcaster"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
)

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// RegisterAuthController registers the auth routes (public, /auth).
func RegisterAuthController(r *httpx.Router, authService *auth.AuthService, email EmailService, store redis.Store) {
	g := r.Group("/auth")

	g.Get("/can-register", func(c *httpx.Ctx) (any, error) {
		register, err := authService.CanRegister(c.R.Context(), string(user.ProviderNameLOCAL))
		if err != nil {
			return nil, err
		}
		return map[string]bool{"register": register}, nil
	})

	g.Post("/register", func(c *httpx.Ctx) (any, error) {
		var body authdto.CreateOrgUserDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		provider := user.ProviderName(deref(body.Provider))
		result, err := authService.RouteAuth(c.R.Context(), provider, auth.AuthBody{
			Email:             deref(body.Email),
			Password:          deref(body.Password),
			Provider:          provider,
			ProviderToken:     deref(body.ProviderToken),
			Company:           deref(body.Company),
			DatafastVisitorID: body.DatafastVisitorID,
		}, true, c.RealIP(), c.Header("User-Agent"), authService.GetOrgFromCookie(c.Cookie("org")))
		if err != nil {
			c.Send(http.StatusBadRequest, errorMessage(err))
			return nil, nil
		}

		activationRequired := provider == user.ProviderNameLOCAL && email.HasProvider()
		if activationRequired {
			c.SetHeader("activate", "true")
			c.JSON(http.StatusOK, map[string]bool{"activate": true})
			return nil, nil
		}

		setAuthCookie(c, "auth", result.JWT)
		if result.AddedOrg != nil && result.AddedOrg.OrganizationID != "" {
			setAuthCookie(c, "showorg", result.AddedOrg.OrganizationID)
		}

		sentry.NewMeter(c.R.Context()).Count("new_user", 1)
		c.SetHeader("onboarding", "true")
		c.JSON(http.StatusOK, map[string]bool{"register": true})
		return nil, nil
	}, httpx.Raw())

	g.Post("/login", func(c *httpx.Ctx) (any, error) {
		var body authdto.LoginUserDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		provider := user.ProviderName(deref(body.Provider))
		result, err := authService.RouteAuth(c.R.Context(), provider, auth.AuthBody{
			Email:             deref(body.Email),
			Password:          deref(body.Password),
			Provider:          provider,
			ProviderToken:     deref(body.ProviderToken),
			DatafastVisitorID: body.DatafastVisitorID,
		}, false, c.RealIP(), c.Header("User-Agent"), authService.GetOrgFromCookie(c.Cookie("org")))
		if err != nil {
			c.Send(http.StatusBadRequest, errorMessage(err))
			return nil, nil
		}

		setAuthCookie(c, "auth", result.JWT)
		if result.AddedOrg != nil && result.AddedOrg.OrganizationID != "" {
			setAuthCookie(c, "showorg", result.AddedOrg.OrganizationID)
		}

		c.SetHeader("reload", "true")
		c.JSON(http.StatusOK, map[string]bool{"login": true})
		return nil, nil
	}, httpx.Raw())

	g.Post("/forgot", func(c *httpx.Ctx) (any, error) {
		var body authdto.ForgotPasswordDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		if err := authService.Forgot(c.R.Context(), deref(body.Email)); err != nil {
			return map[string]bool{"forgot": false}, nil
		}
		return map[string]bool{"forgot": true}, nil
	})

	g.Post("/forgot-return", func(c *httpx.Ctx) (any, error) {
		var body authdto.ForgotReturnPasswordDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		reset, err := authService.ForgotReturn(c.R.Context(), deref(body.Token), deref(body.Password))
		if err != nil {
			return nil, err
		}
		return map[string]bool{"reset": reset}, nil
	})

	g.Get("/oauth-mobile-callback", func(c *httpx.Ctx) (any, error) {
		scheme := os.Getenv("MOBILE_APP_SCHEME")
		if scheme == "" {
			scheme = "postiz://auth/callback"
		}
		var pairs []string
		if code := c.Query("code"); code != "" {
			pairs = append(pairs, "code", code)
		}
		if state := c.Query("state"); state != "" {
			pairs = append(pairs, "state", state)
		}
		c.Redirect(http.StatusFound, scheme+"?"+searchParams(pairs...))
		return nil, nil
	}, httpx.Raw())

	g.Get("/oauth/:provider", func(c *httpx.Ctx) (any, error) {
		state := "login-" + ids.Secure(16)
		setCookie(c, "oauth_state", state, time.Now().Add(10*time.Minute))

		query := map[string]string{}
		for key, values := range c.R.URL.Query() {
			query[key] = values[0]
		}
		query["state"] = state
		return authService.OAuthLink(c.R.Context(), c.Param("provider"), query)
	})

	g.Post("/activate", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		activate, err := authService.Activate(c.R.Context(), str(fields, "code"), str(fields, "datafast_visitor_id"))
		if err != nil {
			return nil, err
		}
		if activate == "" {
			c.JSON(http.StatusOK, map[string]bool{"can": false})
			return nil, nil
		}

		setAuthCookie(c, "auth", activate)
		c.SetHeader("onboarding", "true")
		c.JSON(http.StatusOK, map[string]bool{"can": true})
		return nil, nil
	}, httpx.Raw())

	g.Post("/resend-activation", func(c *httpx.Ctx) (any, error) {
		var body authdto.ResendActivationDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		if _, err := authService.ResendActivationEmail(c.R.Context(), deref(body.Email)); err != nil {
			return struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
			}{false, errorMessage(err)}, nil
		}
		return map[string]bool{"success": true}, nil
	})

	// public and creates a signer at Neynar per call, so cap it per client
	g.Post("/farcaster/signer", func(c *httpx.Ctx) (any, error) {
		signer, err := farcaster.New().CreateSigner(c.R.Context())
		if err != nil {
			return signerError(err, "Failed to create signer"), nil
		}
		return signer, nil
	}, httpx.With(auth.ThrottlerRealIpGuard(store, "AuthController-farcasterSigner", 30, auth.ThrottleTTL)))

	// the modal polls every 2s for up to 10 minutes, so leave room for that
	g.Get("/farcaster/signer", func(c *httpx.Ctx) (any, error) {
		status, err := farcaster.New().SignerStatus(c.R.Context(), c.Query("signerUuid"))
		if err != nil {
			return signerError(err, "Failed to check signer"), nil
		}
		return status, nil
	}, httpx.With(auth.ThrottlerRealIpGuard(store, "AuthController-farcasterSignerStatus", 1000, auth.ThrottleTTL)))

	g.Post("/oauth/:provider/redirect", func(c *httpx.Ctx) (any, error) {
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}
		code, state := str(fields, "code"), str(fields, "state")
		if code == "" {
			c.Redirect(http.StatusSeeOther, os.Getenv("FRONTEND_URL")+"/auth/login")
			return nil, nil
		}

		pairs := []string{"code", code}
		if state != "" {
			pairs = append(pairs, "state", state)
		}
		pairs = append(pairs, "provider", strings.ToUpper(c.Param("provider")))
		c.Redirect(http.StatusSeeOther, os.Getenv("FRONTEND_URL")+"/auth?"+searchParams(pairs...))
		return nil, nil
	}, httpx.Raw())

	g.Post("/oauth/:provider/exists", func(c *httpx.Ctx) (any, error) {
		// a cross-site form post can spoof any body field, a json body cannot
		if !strings.Contains(c.Header("Content-Type"), "application/json") {
			c.Send(http.StatusBadRequest, "Invalid request")
			return nil, nil
		}
		fields, err := bodyFields(c)
		if err != nil {
			return nil, err
		}

		result, err := authService.CheckExists(c.R.Context(), c.Param("provider"), str(fields, "code"),
			str(fields, "redirect_uri"), str(fields, "state"), c.Cookie("oauth_state"))
		if err != nil {
			return nil, err
		}
		if result.Token != "" {
			c.JSON(http.StatusOK, map[string]string{"token": result.Token})
			return nil, nil
		}

		setAuthCookie(c, "auth", result.JWT)
		c.SetHeader("reload", "true")
		c.JSON(http.StatusOK, map[string]bool{"login": true})
		return nil, nil
	}, httpx.Raw())
}

// signerError is `{ error: err.message || fallback }`.
func signerError(err error, fallback string) map[string]string {
	message := err.Error()
	if message == "" {
		message = fallback
	}
	return map[string]string{"error": message}
}
