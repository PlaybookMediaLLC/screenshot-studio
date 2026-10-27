package moltbook

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/integrations"
)

func setup(t *testing.T, h http.HandlerFunc) {
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	t.Setenv("DISABLE_SSRF_PROTECTION", "true")
	old := moltbookAPIBase
	moltbookAPIBase = srv.URL
	t.Cleanup(func() { moltbookAPIBase = old })
}

func TestPost(t *testing.T) {
	var got map[string]any
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/posts" || r.Header.Get("Authorization") != "Bearer key" {
			t.Errorf("request %s", r.URL.Path)
		}
		json.NewDecoder(r.Body).Decode(&got)
		io.WriteString(w, `{"success":true,"post":{"id":7}}`)
	})
	res, err := New().Post(t.Context(), "", "key", []integrations.PostDetails{{ID: "p1", Message: "hello"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got["submolt"] != "general" || got["title"] != "hello" || got["content"] != "hello" {
		t.Fatalf("body %v", got)
	}
	if res[0].PostID != "7" || res[0].ReleaseURL != "https://www.moltbook.com/post/7" {
		t.Fatalf("%+v", res)
	}
}

func TestRegisterAgentErrors(t *testing.T) {
	status := http.StatusBadRequest
	setup(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		io.WriteString(w, `{"success":false,"error":"name taken"}`)
	})
	if _, err := New().RegisterAgent(t.Context(), "n", "d"); err == nil || err.Error() != "Request failed with status code 400" {
		t.Fatalf("err %v", err)
	}
	status = http.StatusOK
	if _, err := New().RegisterAgent(t.Context(), "n", "d"); err == nil || err.Error() != "name taken" {
		t.Fatalf("err %v", err)
	}
}
