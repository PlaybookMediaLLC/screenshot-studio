package auth

import (
	"net/http"
	"os"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// RemoveAuth clears the auth cookie and tells the frontend to log out
// (auth.middleware.ts removeAuth).
func RemoveAuth(c *httpx.Ctx) {
	cookie := &http.Cookie{
		Name:    "auth",
		Value:   "",
		Path:    "/",
		Domain:  helpers.GetCookieURLFromDomain(os.Getenv("FRONTEND_URL")),
		Expires: time.Unix(0, 0),
		MaxAge:  -1,
	}
	if os.Getenv("NOT_SECURED") == "" {
		cookie.Secure = true
		cookie.HttpOnly = true
		cookie.SameSite = http.SameSiteNoneMode
	}
	c.SetCookie(cookie)
	c.SetHeader("logout", "true")
}

// HTTPForbiddenException is HttpForbiddenException together with its
// HttpExceptionFilter: the cookie is cleared and the answer is an empty 401.
func HTTPForbiddenException() *httpx.Error {
	return &httpx.Error{
		Status: http.StatusForbidden,
		Body:   "Forbidden",
		Write: func(c *httpx.Ctx) {
			RemoveAuth(c)
			c.Send(http.StatusUnauthorized, nil)
		},
	}
}

type subscriptionBody struct {
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message,omitempty"`
	URL        string `json:"url"`
}

// SubscriptionException is SubscriptionException rendered by
// SubscriptionExceptionFilter: 402 {statusCode, message, url}. Sections
// without a message leave it out, like the filter's undefined.
func SubscriptionException(section Sections, action AuthorizationActions) *httpx.Error {
	return httpx.NewError(http.StatusPaymentRequired, subscriptionBody{
		StatusCode: http.StatusPaymentRequired,
		Message:    subscriptionMessage(section),
		URL:        os.Getenv("FRONTEND_URL") + "/billing",
	})
}

func subscriptionMessage(section Sections) string {
	switch section {
	case SectionPostsPerMonth:
		return "You have reached the maximum number of posts for your subscription. Please upgrade your subscription to add more posts."
	case SectionChannel:
		return "You have reached the maximum number of channels for your subscription. Please upgrade your subscription to add more channels."
	case SectionWebhooks:
		return "You have reached the maximum number of webhooks for your subscription. Please upgrade your subscription to add more webhooks."
	case SectionVideosPerMonth:
		return "You have reached the maximum number of generated videos for your subscription. Please upgrade your subscription to generate more videos."
	case SectionClippingMinutes:
		return "You have used all the clipping minutes of your subscription for this month. Please upgrade your subscription to clip more videos."
	}
	return ""
}

// PostValidationError is the payload of PostValidationException.
type PostValidationError struct {
	// Provider identifier, e.g. "x", "linkedin-page".
	Provider string
	// Human readable provider name, e.g. "X", "LinkedIn Page".
	Name string
	// The readable validation error.
	Error string
}

type postValidationBody struct {
	StatusCode int    `json:"statusCode"`
	Provider   string `json:"provider"`
	Name       string `json:"name"`
	Message    string `json:"message"`
}

// PostValidationException is PostValidationException rendered by
// PostValidationExceptionFilter: 400 {statusCode, provider, name, message}.
func PostValidationException(e PostValidationError) *httpx.Error {
	return httpx.NewError(http.StatusBadRequest, postValidationBody{
		StatusCode: http.StatusBadRequest,
		Provider:   e.Provider,
		Name:       e.Name,
		Message:    e.Error,
	})
}
