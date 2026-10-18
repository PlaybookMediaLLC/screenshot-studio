package googleapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDoRetriesTransientErrors(t *testing.T) {
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	RetryUnit = 0
	calls := 0
	status := http.StatusServiceUnavailable
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(status)
			return
		}
		w.Write([]byte(`{"id":"1"}`))
	}))
	defer srv.Close()

	var out struct{ ID string }
	if err := Do(context.Background(), http.MethodGet, srv.URL, "t", "", nil, &out); err != nil || out.ID != "1" || calls != 2 {
		t.Fatalf("503: err=%v id=%q calls=%d", err, out.ID, calls)
	}

	calls, status = 0, http.StatusBadRequest
	err := Do(context.Background(), http.MethodGet, srv.URL, "t", "", nil, &out)
	var gErr *Error
	if !errors.As(err, &gErr) || gErr.Status != 400 || calls != 1 {
		t.Fatalf("400: err=%v calls=%d", err, calls)
	}
}

func TestEncodeURIComponent(t *testing.T) {
	if got := EncodeURIComponent("a b/c:d!'()*~"); got != "a%20b%2Fc%3Ad!'()*~" {
		t.Fatal(got)
	}
}
