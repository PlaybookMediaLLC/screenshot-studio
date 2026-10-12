package auth

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/redis"
)

func TestThrottlerBehindProxyGuard(t *testing.T) {
	t.Setenv("API_LIMIT", "2")
	store := redis.NewMemory()
	setOrg := func(id string) httpx.Middleware {
		return func(c *httpx.Ctx) error { c.Org = &ent.Organization{ID: id}; return nil }
	}
	post := func(target, orgID string) (int, http.Header, string) {
		var m []httpx.Middleware
		if orgID != "" {
			m = append(m, setOrg(orgID))
		}
		m = append(m, ThrottlerBehindProxyGuard(store))
		rec, _ := serve(t, "POST", target, func(r *http.Request) { r.Header.Set("X-Forwarded-For", "1.1.1.1, 2.2.2.2") }, m...)
		return rec.Code, rec.Header(), strings.TrimSpace(rec.Body.String())
	}

	for i, wantRemaining := range []string{"1", "0"} {
		code, h, _ := post("/public/v1/posts", "o1")
		if code != 201 || h.Get("X-RateLimit-Limit") != "2" || h.Get("X-RateLimit-Remaining") != wantRemaining || h.Get("X-RateLimit-Reset") != "3600" {
			t.Fatalf("request %d: %d %v", i, code, h)
		}
	}
	code, h, body := post("/public/v1/posts", "o1")
	if code != 429 || body != `{"statusCode":429,"message":"ThrottlerException: Too Many Requests"}` || h.Get("Retry-After") == "" {
		t.Fatalf("third: %d %s %v", code, body, h)
	}
	// another organization has its own counter
	if code, _, _ := post("/public/v1/posts", "o2"); code != 201 {
		t.Fatalf("o2: %d", code)
	}
	// other routes are not throttled
	for i := 0; i < 3; i++ {
		if code, h, _ := post("/public/v1/upload", "o1"); code != 201 || h.Get("X-RateLimit-Limit") != "" {
			t.Fatalf("upload throttled: %d", code)
		}
	}
	// public comments are tracked by forwarded ip
	for i := 0; i < 2; i++ {
		post("/public/posts/p1/comments", "")
	}
	if code, _, _ := post("/public/posts/p2/comments", ""); code != 429 {
		t.Fatalf("comments: %d", code)
	}
}

func TestThrottlerRealIpGuard(t *testing.T) {
	store := redis.NewMemory()
	guard := ThrottlerRealIpGuard(store, "AuthController-farcasterSigner", 1, time.Hour)
	call := func(ip string) int {
		rec, _ := serve(t, "POST", "/auth/farcaster/signer", func(r *http.Request) { r.Header.Set("X-Forwarded-For", ip) }, guard)
		return rec.Code
	}
	if call("1.1.1.1") != 201 || call("1.1.1.1") != 429 || call("3.3.3.3") != 201 {
		t.Fatal("unexpected throttling")
	}
	other := ThrottlerRealIpGuard(store, "OAuthController-authorizeSelfHosted", 1, time.Hour)
	rec, _ := serve(t, "POST", "/oauth/authorize/self-hosted", func(r *http.Request) { r.Header.Set("X-Forwarded-For", "1.1.1.1") }, other)
	if rec.Code != 201 {
		t.Fatal("handlers must not share counters")
	}
}

func TestAPILimit(t *testing.T) {
	for raw, want := range map[string]int64{"": 90, "30": 30, "abc": 1<<63 - 1} {
		t.Setenv("API_LIMIT", raw)
		if got := apiLimit(); got != want {
			t.Fatalf("%q: %d", raw, got)
		}
	}
}
