// Package account ports the Postiz account controllers of apps/backend
// (root, monitor, auth, users, settings, billing, payment, stripe,
// notifications, analytics, admin, announcements, enterprise).
package account

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/track"
)

// EmailService is the part of the email service the auth controller uses.
type EmailService interface {
	HasProvider() bool
}

// TrackService is the part of the track service the users controller uses.
type TrackService interface {
	Track(ctx context.Context, uniqueID, ip, agent string, tt track.Enum, additional map[string]any, fbclid string, user *ent.User) error
}

// PostsService is the part of the posts service the analytics and enterprise
// controllers use.
type PostsService interface {
	CheckPostAnalytics(ctx context.Context, orgID, postID string, date int64, forceRefresh bool) (any, error)
	DeletePost(ctx context.Context, orgID, group string) (map[string]bool, error)
}

const year = 365 * 24 * time.Hour

// setCookie is Postiz's
//
//	response.cookie(name, value, {
//	  domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
//	  ...(!process.env.NOT_SECURED ? { secure: true, httpOnly: true, sameSite: 'none' } : {}),
//	  expires,
//	})
func setCookie(c *httpx.Ctx, name, value string, expires time.Time) {
	c.SetCookie(cookie(name, value, expires))
}

// clearCookie is the same cookie with `maxAge: -1, expires: new Date(0)`.
func clearCookie(c *httpx.Ctx, name string) {
	ck := cookie(name, "", time.Unix(0, 0))
	ck.MaxAge = -1
	c.SetCookie(ck)
}

func cookie(name, value string, expires time.Time) *http.Cookie {
	ck := &http.Cookie{
		Name:    name,
		Value:   value,
		Path:    "/",
		Domain:  helpers.GetCookieURLFromDomain(os.Getenv("FRONTEND_URL")),
		Expires: expires,
	}
	if os.Getenv("NOT_SECURED") == "" {
		ck.Secure = true
		ck.HttpOnly = true
		ck.SameSite = http.SameSiteNoneMode
	}
	return ck
}

// setAuthCookie sets a one year cookie and, when NOT_SECURED, mirrors it in
// a response header (the frontend reads it from there).
func setAuthCookie(c *httpx.Ctx, name, value string) {
	setCookie(c, name, value, time.Now().Add(year))
	if os.Getenv("NOT_SECURED") != "" {
		c.SetHeader(name, value)
	}
}

// errorMessage is a thrown error's `e.message`.
func errorMessage(err error) string {
	var he *httpx.Error
	if errors.As(err, &he) {
		if s, ok := he.Body.(string); ok {
			return s
		}
		if m := he.Message(); m != "" {
			return m
		}
		return "Http Exception"
	}
	return err.Error()
}

// bodyFields decodes the JSON body for `@Body('name')` reads. Non-string
// values read as "" (they would fail every downstream string use anyway).
func bodyFields(c *httpx.Ctx) (map[string]any, error) {
	fields := map[string]any{}
	if err := c.Decode(&fields); err != nil {
		return nil, err
	}
	return fields, nil
}

func str(fields map[string]any, key string) string {
	s, _ := fields[key].(string)
	return s
}

// spreadJSON is `{ ...base, ...extra }` for objects without shared keys,
// keeping JavaScript's key order (base keys first).
func spreadJSON(base, extra any) (json.RawMessage, error) {
	a, err := json.Marshal(base)
	if err != nil {
		return nil, err
	}
	b, err := json.Marshal(extra)
	if err != nil {
		return nil, err
	}
	a = bytes.TrimSuffix(bytes.TrimSpace(a), []byte("}"))
	b = bytes.TrimPrefix(bytes.TrimSpace(b), []byte("{"))
	if len(bytes.TrimSpace(a)) > 1 && len(bytes.TrimSpace(b)) > 1 {
		a = append(a, ',')
	}
	return append(a, b...), nil
}

// searchParams is `new URLSearchParams()` + set(...) + toString(): pairs in
// insertion order, application/x-www-form-urlencoded escaping.
func searchParams(pairs ...string) string {
	var sb strings.Builder
	for i := 0; i+1 < len(pairs); i += 2 {
		if sb.Len() > 0 {
			sb.WriteByte('&')
		}
		sb.WriteString(formEscape(pairs[i]))
		sb.WriteByte('=')
		sb.WriteString(formEscape(pairs[i+1]))
	}
	return sb.String()
}

// formEscape keeps the URLSearchParams safe set (ALPHA DIGIT * - . _),
// encodes space as + and everything else as UTF-8 percent escapes.
func formEscape(s string) string {
	var sb strings.Builder
	for _, b := range []byte(s) {
		switch {
		case b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z', b >= '0' && b <= '9', b == '*', b == '-', b == '.', b == '_':
			sb.WriteByte(b)
		case b == ' ':
			sb.WriteByte('+')
		default:
			fmt.Fprintf(&sb, "%%%02X", b)
		}
	}
	return sb.String()
}

var errUnauthorized = errors.New("Unauthorized")

func unauthorized() error { return httpx.HTTPException("Unauthorized", http.StatusBadRequest) }
