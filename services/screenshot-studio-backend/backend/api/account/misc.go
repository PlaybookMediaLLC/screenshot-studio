package account

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/adminstats"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/announcements"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/errorsdb"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/notifications"
	dto "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/announcements"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// RegisterRootController is root.controller.ts.
func RegisterRootController(r *httpx.Router) {
	r.Group("/").Get("/", func(c *httpx.Ctx) (any, error) {
		return "App is running!", nil
	})
}

// RegisterMonitorController is monitor.controller.ts (public, /monitor).
func RegisterMonitorController(r *httpx.Router) {
	r.Group("/monitor").Get("/queue/:name", func(c *httpx.Ctx) (any, error) {
		return struct {
			Status  string `json:"status"`
			Message string `json:"message"`
		}{"success", "Queue " + c.Param("name") + " is healthy."}, nil
	})
}

// RegisterNotificationsController is notifications.controller.ts (authenticated, /notifications).
func RegisterNotificationsController(r *httpx.Router, authMiddleware httpx.Middleware, notificationService *notifications.Service) {
	g := r.Group("/notifications", authMiddleware)

	g.Get("/", func(c *httpx.Ctx) (any, error) {
		return notificationService.GetMainPageCount(c.R.Context(), c.Org.ID, c.User.ID)
	})

	g.Get("/list", func(c *httpx.Ctx) (any, error) {
		return notificationService.GetNotifications(c.R.Context(), c.Org.ID, c.User.ID)
	})
}

// RegisterAnalyticsController is analytics.controller.ts (authenticated, /analytics).
func RegisterAnalyticsController(r *httpx.Router, authMiddleware httpx.Middleware, integrationService *integration.Service, posts PostsService) {
	g := r.Group("/analytics", authMiddleware)

	g.Get("/:integration", func(c *httpx.Ctx) (any, error) {
		return integrationService.CheckAnalytics(c.R.Context(), c.Org, c.Param("integration"), c.Query("date"), false)
	})

	g.Get("/post/:postId", func(c *httpx.Ctx) (any, error) {
		return posts.CheckPostAnalytics(c.R.Context(), c.Org.ID, c.Param("postId"), jsNumber(c.Query("date")), false)
	})
}

// jsNumber is `+value` truncated to an integer; NaN reads as 0.
func jsNumber(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0
	}
	return int64(n)
}

// RegisterAdminController is admin.controller.ts (authenticated, /admin).
func RegisterAdminController(r *httpx.Router, authMiddleware httpx.Middleware, errorsService *errorsdb.Service, stats *adminstats.Service) {
	g := r.Group("/admin", authMiddleware)

	g.Get("/errors", func(c *httpx.Ctx) (any, error) {
		if c.User == nil || !c.User.IsSuperAdmin {
			return nil, unauthorized()
		}
		limit := 20
		if v := c.Query("limit"); v != "" {
			limit = parseInt(v)
		}
		unknownFirst := c.Query("unknownFirst")
		// page/limit 0 (also NaN) are the repository's defaults, like `|| 0` / `|| 20`
		return errorsService.ListErrors(c.R.Context(), errorsdb.ListErrorsParams{
			Page:         parseInt(c.Query("page")),
			Limit:        limit,
			Platform:     c.Query("platform"),
			Email:        c.Query("email"),
			UnknownFirst: unknownFirst == "true" || unknownFirst == "1",
		})
	})

	g.Get("/errors/platforms", func(c *httpx.Ctx) (any, error) {
		if c.User == nil || !c.User.IsSuperAdmin {
			return nil, unauthorized()
		}
		return errorsService.ListPlatforms(c.R.Context())
	})

	g.Get("/stats", func(c *httpx.Ctx) (any, error) {
		if c.User == nil || !c.User.IsSuperAdmin {
			return nil, unauthorized()
		}
		now := time.Now().UTC()
		from, to := now.AddDate(0, 0, -30), now
		var err error
		if v := c.Query("from"); v != "" {
			if from, err = parseDayjs(v); err != nil {
				return nil, err
			}
		}
		if v := c.Query("to"); v != "" {
			if to, err = parseDayjs(v); err != nil {
				return nil, err
			}
		}
		unknownOnly := c.Query("unknownOnly")
		return stats.GetStats(c.R.Context(), adminstats.StatsParams{
			From:        time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC),
			To:          time.Date(to.Year(), to.Month(), to.Day(), 23, 59, 59, int(999*time.Millisecond), time.UTC),
			UnknownOnly: unknownOnly == "true" || unknownOnly == "1",
		})
	})
}

var leadingInt = regexp.MustCompile(`^\s*[+-]?\d+`)

// parseInt is parseInt(value, 10); NaN reads as 0.
func parseInt(value string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(leadingInt.FindString(value)))
	return n
}

// dayjsFormat is dayjs's REGEX_PARSE for strings without a Z/offset (local
// time, which is UTC in Postiz).
var dayjsFormat = regexp.MustCompile(`^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$`)

// parseDayjs is dayjs(value) converted to UTC; an invalid date is an error
// (Prisma rejects Invalid Date).
func parseDayjs(value string) (time.Time, error) {
	if m := dayjsFormat.FindStringSubmatch(value); m != nil {
		n := func(i, def int) int {
			if m[i] == "" {
				return def
			}
			x, _ := strconv.Atoi(m[i])
			return x
		}
		ms := 0
		if m[7] != "" {
			ms, _ = strconv.Atoi((m[7] + "00")[:3])
		}
		return time.Date(n(1, 0), time.Month(n(2, 1)), n(3, 1), n(4, 0), n(5, 0), n(6, 0), ms*int(time.Millisecond), time.UTC), nil
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC1123, time.RFC1123Z} {
		if t, err := time.Parse(layout, value); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("Invalid Date: %q", value)
}

// RegisterAnnouncementsController is announcements.controller.ts (authenticated, /announcements).
func RegisterAnnouncementsController(r *httpx.Router, authMiddleware httpx.Middleware, announcementsService *announcements.Service) {
	g := r.Group("/announcements", authMiddleware)

	g.Get("/", func(c *httpx.Ctx) (any, error) {
		return announcementsService.GetAnnouncements(c.R.Context())
	})

	g.Post("/", func(c *httpx.Ctx) (any, error) {
		var body dto.AnnouncementDto
		if err := c.Bind(&body); err != nil {
			return nil, err
		}
		if !c.User.IsSuperAdmin {
			return nil, unauthorized()
		}
		return announcementsService.CreateAnnouncement(c.R.Context(), body)
	})

	g.Delete("/:id", func(c *httpx.Ctx) (any, error) {
		if !c.User.IsSuperAdmin {
			return nil, unauthorized()
		}
		return announcementsService.DeleteAnnouncement(c.R.Context(), c.Param("id"))
	})
}
