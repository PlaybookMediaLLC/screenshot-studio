package track

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
)

func TestTrack(t *testing.T) {
	var body map[string]any
	var token string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token = r.URL.Query().Get("access_token")
		json.NewDecoder(r.Body).Decode(&body)
		w.Write([]byte(`{"events_received":1}`))
	}))
	defer srv.Close()
	graphURL = srv.URL

	t.Setenv("FACEBOOK_PIXEL_ACCESS_TOKEN", "")
	if err := NewService().Track(context.Background(), "u", "1.1.1.1", "ua", Purchase, nil, "", nil); err != nil || body != nil {
		t.Fatal("no-op without a token")
	}

	t.Setenv("FACEBOOK_PIXEL_ACCESS_TOKEN", "tok")
	t.Setenv("NEXT_PUBLIC_FACEBOOK_PIXEL", "px")
	ip := "2.2.2.2"
	user := &ent.User{ID: "user-1", Email: "a@b.c", IP: &ip}
	if err := NewService().Track(context.Background(), "", "", "ua", Purchase, map[string]any{"value": 10.0}, "fb.1", user); err != nil {
		t.Fatal(err)
	}
	event := body["data"].([]any)[0].(map[string]any)
	userData := event["user_data"].(map[string]any)
	if token != "tok" || event["event_name"] != "Purchase" || event["event_id"] != "user-1" || event["action_source"] != "website" ||
		userData["client_ip_address"] != "2.2.2.2" || userData["fbc"] != "fb.1" ||
		userData["em"].([]any)[0] != hashValue("a@b.c") ||
		event["custom_data"].(map[string]any)["currency"] != "USD" {
		t.Errorf("event %v", event)
	}
}
