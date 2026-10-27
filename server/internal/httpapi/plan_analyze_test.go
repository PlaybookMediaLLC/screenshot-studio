package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/product"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
)

type planAnalyzeFake struct {
	fakeConfiguration
	actor   product.Actor
	command product.CalendarCommand
	query   product.AnalyticsQuery
	denied  bool
}

func (f *planAnalyzeFake) MutateCalendar(_ context.Context, actor product.Actor, command product.CalendarCommand) (*product.CalendarResult, error) {
	f.actor, f.command = actor, command
	if f.denied {
		return nil, publishing.ErrForbidden
	}
	return &product.CalendarResult{Cancelled: []string{"old"}, Scheduled: []*ent.ScheduledPost{{ID: "new", OrganizationID: actor.OrganizationID, ScheduledFor: time.Now()}}}, nil
}
func (f *planAnalyzeFake) GetAnalytics(_ context.Context, actor product.Actor, id string, q product.AnalyticsQuery) (*product.AnalyticsReport, error) {
	f.actor, f.query = actor, q
	return &product.AnalyticsReport{AccountID: id}, nil
}
func (f *planAnalyzeFake) GetPublicAnalytics(_ context.Context, token string, q product.AnalyticsQuery) (*product.AnalyticsReport, error) {
	f.query = q
	return &product.AnalyticsReport{}, nil
}
func TestPlanAnalyzeHTTPAuthorityContracts(t *testing.T) {
	config, scheduler := &planAnalyzeFake{}, &fakeScheduler{}
	handler := NewWithConfiguration(&fakeStore{}, scheduler, &fakeVerifier{}, "secret", config)
	t.Run("P34 committed calendar result wakes replacement workflows", func(t *testing.T) {
		response := configurationRequest(handler, http.MethodPost, "/v1/calendar/mutations", `{"key":"one","action":"move","items":[]}`)
		if response.Code != 200 || config.actor.OrganizationID != "org-1" || config.command.Key != "one" || scheduler.cancelled != "old" || scheduler.started.PostID != "new" {
			t.Fatalf("response=%d actor=%+v scheduler=%+v", response.Code, config.actor, scheduler)
		}
	})
	t.Run("P35 denied action returns 403 and unknown payload fields fail", func(t *testing.T) {
		config.denied = true
		response := configurationRequest(handler, http.MethodPost, "/v1/calendar/mutations", `{"key":"two","action":"move","items":[]}`)
		if response.Code != 403 {
			t.Fatal(response.Code)
		}
		response = configurationRequest(handler, http.MethodPost, "/v1/calendar/mutations", `{"organizationId":"foreign"}`)
		if response.Code != 400 {
			t.Fatal(response.Code)
		}
	})
	t.Run("A12 query forwards exact scope and rejects malformed cutoff", func(t *testing.T) {
		response := configurationRequest(handler, http.MethodGet, "/v1/analytics/c123456789012345678901234?from=2026-01-01&to=2026-01-31&scope=replies&sort=likes&limit=2", "")
		if response.Code != 200 || config.query.Scope != "replies" || config.query.Limit != 2 || response.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("status=%d query=%+v", response.Code, config.query)
		}
		response = configurationRequest(handler, http.MethodGet, "/v1/analytics/c123456789012345678901234?asOf=invalid", "")
		if response.Code != 400 {
			t.Fatal(response.Code)
		}
	})
	t.Run("A37 public backend requires service authentication and prevents caching", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/v1/internal/analytics/token?limit=2", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 401 {
			t.Fatal(response.Code)
		}
		request.Header.Set("Authorization", "Bearer secret")
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store, max-age=0" || config.query.Limit != 2 {
			t.Fatalf("status=%d query=%+v", response.Code, config.query)
		}
	})
}
