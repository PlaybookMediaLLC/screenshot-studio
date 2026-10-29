package httpapi

import (
	"context"
	"encoding/json"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type frontendConfiguration struct {
	fakeConfiguration
	frontendStore
	body, signature string
	err             error
	calls           int
}

func (f *frontendConfiguration) AcceptFrontendWebhook(_ context.Context, _ string, signature string, body []byte) error {
	f.calls++
	f.body = string(body)
	f.signature = signature
	return f.err
}

func TestFrontendWebhookRequiresServiceAndPreservesBody(t *testing.T) {
	f := &frontendConfiguration{}
	h := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", f)
	raw := "{ \"id\": \"event\", \"note\": \"é\" }\n"
	payload, _ := json.Marshal(map[string]string{"signature": "original-signature", "body": raw})
	req := httptest.NewRequest("POST", "/v1/internal/frontend-webhooks/source1", strings.NewReader(string(payload)))
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized || f.calls != 0 {
		t.Fatalf("unauthorized %d calls %d", res.Code, f.calls)
	}
	req = httptest.NewRequest("POST", "/v1/internal/frontend-webhooks/source1", strings.NewReader(string(payload)))
	req.Header.Set("Authorization", "Bearer secret")
	res = httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != 202 || f.body != raw || f.signature != "original-signature" {
		t.Fatalf("body changed or not accepted %d %s", res.Code, res.Body)
	}
	f.err = publishing.ErrUnauthorized
	req = httptest.NewRequest("POST", "/v1/internal/frontend-webhooks/source1", strings.NewReader(string(payload)))
	req.Header.Set("Authorization", "Bearer secret")
	res = httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != 401 {
		t.Fatalf("signature rejection=%d", res.Code)
	}
}
func TestFrontendPreviewIsReadOnlyAndRechecksAccess(t *testing.T) {
	f := &frontendConfiguration{}
	h := NewWithConfiguration(&fakeStore{}, &fakeScheduler{}, &fakeVerifier{}, "secret", f)
	body := `{"policy":{"schemaVersion":1,"environments":["production"]},"observation":{"provider":"vercel","environment":"production","deploymentId":"dep1","production":"active","status":"success"}}`
	res := configurationRequest(h, "POST", "/v1/frontend-sources/preview", body)
	if res.Code != 200 || !strings.Contains(res.Body.String(), `"state":"matched"`) || f.calls != 0 {
		t.Fatalf("preview %d %s", res.Code, res.Body)
	}
	f.readError = publishing.ErrForbidden
	res = configurationRequest(h, "POST", "/v1/frontend-sources/preview", body)
	if res.Code != 403 {
		t.Fatalf("removed membership preview=%d", res.Code)
	}
}
