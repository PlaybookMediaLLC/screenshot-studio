package content

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/backend/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

func TestMain(m *testing.M) {
	// Postiz runs with TZ=UTC; timestamp(3) columns are written as local time.
	time.Local = time.UTC
	os.Exit(m.Run())
}

// as is the auth middleware stand-in: the request runs as user in org.
func as(user *ent.User, org *ent.Organization) httpx.Middleware {
	return func(c *httpx.Ctx) error {
		c.User = user
		c.Org = org
		return nil
	}
}

type fakeSubscriptions struct{}

func (fakeSubscriptions) GetSubscriptionByOrganizationID(context.Context, string) (*ent.Subscription, error) {
	return nil, nil
}
func (fakeSubscriptions) GetSubscription(context.Context, string) (*ent.Subscription, error) {
	return nil, nil
}

type fakePostCounts struct{}

func (fakePostCounts) CountPostsFromDay(context.Context, string, time.Time) (int, error) {
	return 0, nil
}

func newPerms() *auth.PermissionsService {
	return auth.NewPermissionsService(fakeSubscriptions{}, fakePostCounts{}, nil, nil)
}

type response struct {
	status int
	header http.Header
	body   string
}

func (r response) json(t *testing.T) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(r.body), &out); err != nil {
		t.Fatalf("body %q: %v", r.body, err)
	}
	return out
}

func do(t *testing.T, h http.Handler, req *http.Request) response {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	body, _ := io.ReadAll(rec.Result().Body)
	return response{status: rec.Code, header: rec.Header(), body: string(body)}
}

func jsonRequest(method, target, body string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}
