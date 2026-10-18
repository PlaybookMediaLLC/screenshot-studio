package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
)

// ThrottleTTL is the app-wide throttler window (ThrottlerModule ttl 3600000).
const ThrottleTTL = time.Hour

var publicComment = regexp.MustCompile(`^/public/posts/[^/]+/comments`)

func isPublicComment(method, url string) bool {
	return method == http.MethodPost && publicComment.MatchString(url)
}

// apiLimit is the ThrottlerModule limit: API_LIMIT or 90. A non-numeric
// API_LIMIT is NaN in Postiz, which never blocks.
func apiLimit() int64 {
	raw := os.Getenv("API_LIMIT")
	if raw == "" {
		return 90
	}
	n, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return math.MaxInt64
	}
	return int64(n)
}

func forwardedFor(c *httpx.Ctx) string {
	return strings.TrimSpace(strings.Split(c.Header("X-Forwarded-For"), ",")[0])
}

// socketIP is Express's req.ip without "trust proxy".
func socketIP(c *httpx.Ctx) string {
	host, _, err := net.SplitHostPort(c.R.RemoteAddr)
	if err != nil {
		return c.R.RemoteAddr
	}
	return host
}

// ThrottlerBehindProxyGuard is the global throttler guard: it only limits
// POST /public/v1/posts (per organization) and public comments (per client).
// Register it after the auth middlewares so the organization is known.
func ThrottlerBehindProxyGuard(store redis.Store) httpx.Middleware {
	return func(c *httpx.Ctx) error {
		url, method := c.R.URL.RequestURI(), c.R.Method
		var handler string
		switch {
		case method == http.MethodPost && strings.Contains(url, "/public/v1/posts"):
			handler = "PublicIntegrationsController-createPost"
		case isPublicComment(method, url):
			handler = "PublicController-createComment"
		default:
			return nil
		}

		var tracker string
		if c.Org == nil {
			tracker = "ip_" + firstNonEmpty(forwardedFor(c), socketIP(c), "unknown")
		} else if strings.Contains(url, "/posts") {
			tracker = c.Org.ID + "_posts"
		} else {
			tracker = c.Org.ID + "_other"
		}
		return throttle(c, store, handler, apiLimit(), ThrottleTTL, tracker)
	}
}

// ThrottlerRealIpGuard is @UseGuards(ThrottlerRealIpGuard) with
// @Throttle({ default: { limit, ttl } }) for public endpoints, keyed by the
// client address the proxy forwards. handler is the "Controller-method" key
// (e.g. "AuthController-farcasterSigner"), which keeps one counter per route.
func ThrottlerRealIpGuard(store redis.Store, handler string, limit int64, ttl time.Duration) httpx.Middleware {
	return func(c *httpx.Ctx) error {
		return throttle(c, store, handler, limit, ttl, firstNonEmpty(forwardedFor(c), socketIP(c)))
	}
}

// throttle is ThrottlerGuard.handleRequest over the
// @nest-lab/throttler-storage-redis key layout, answering the same headers
// and the ThrottlerException 429.
func throttle(c *httpx.Ctx, store redis.Store, handler string, limit int64, ttl time.Duration, tracker string) error {
	sum := sha256.Sum256([]byte(handler + "-default-" + tracker))
	key := "{" + hex.EncodeToString(sum[:]) + ":default}:hits"
	hits, left, err := store.Incr(c.R.Context(), key, ttl)
	if err != nil {
		return err
	}
	if left <= 0 {
		left = ttl
	}
	seconds := strconv.FormatInt(int64(math.Ceil(left.Seconds())), 10)
	if hits > limit {
		c.SetHeader("Retry-After", seconds)
		return httpx.TooManyRequests()
	}
	c.SetHeader("X-RateLimit-Limit", strconv.FormatInt(limit, 10))
	c.SetHeader("X-RateLimit-Remaining", strconv.FormatInt(max(0, limit-hits), 10))
	c.SetHeader("X-RateLimit-Reset", seconds)
	return nil
}
