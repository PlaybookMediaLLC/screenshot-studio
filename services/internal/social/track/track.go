// Package track is Postiz's TrackService: server-side Facebook Conversions
// API events (what facebook-nodejs-business-sdk's EventRequest sends).
package track

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
)

// Enum is TrackEnum.
type Enum int

const (
	ViewContent Enum = iota
	CompleteRegistration
	InitiateCheckout
	StartTrial
	Purchase
)

// String is TrackEnum[tt]: the Facebook event name.
func (e Enum) String() string {
	names := []string{"ViewContent", "CompleteRegistration", "InitiateCheckout", "StartTrial", "Purchase"}
	if e < 0 || int(e) >= len(names) {
		return ""
	}
	return names[e]
}

// graphURL is the Graph API version facebook-nodejs-business-sdk 21 calls;
// overridden in tests.
var graphURL = "https://graph.facebook.com/v21.0"

// Service is TrackService.
type Service struct{}

func NewService() *Service { return &Service{} }

func hashValue(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

// Track sends one event; it does nothing when FACEBOOK_PIXEL_ACCESS_TOKEN or
// NEXT_PUBLIC_FACEBOOK_PIXEL is unset. user may be nil.
func (s *Service) Track(ctx context.Context, uniqueID, ip, agent string, tt Enum, additional map[string]any, fbclid string, user *ent.User) error {
	accessToken := os.Getenv("FACEBOOK_PIXEL_ACCESS_TOKEN")
	pixelID := os.Getenv("NEXT_PUBLIC_FACEBOOK_PIXEL")
	if accessToken == "" || pixelID == "" {
		return nil
	}

	userData := map[string]any{}
	if ip == "" && user != nil && user.IP != nil {
		ip = *user.IP
	}
	if ip != "" {
		userData["client_ip_address"] = ip
	}
	if agent == "" && user != nil && user.Agent != nil {
		agent = *user.Agent
	}
	if agent != "" {
		userData["client_user_agent"] = agent
	}
	if fbclid != "" {
		userData["fbc"] = fbclid
	}
	if user != nil && user.Email != "" {
		// already a sha256, so the SDK sends it as is
		userData["em"] = []string{hashValue(user.Email)}
	}

	event := map[string]any{
		"event_name":    tt.String(),
		"event_time":    time.Now().Unix(),
		"action_source": "website",
		"user_data":     userData,
	}
	if user != nil && user.ID != "" {
		eventID := uniqueID
		if eventID == "" {
			eventID = user.ID
		}
		event["event_id"] = eventID
	}
	if value, ok := additional["value"]; ok && truthy(value) {
		event["custom_data"] = map[string]any{"value": value, "currency": "USD"}
	}

	body, _ := json.Marshal(map[string]any{"data": []any{event}})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		graphURL+"/"+url.PathEscape(pixelID)+"/events?access_token="+url.QueryEscape(accessToken), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		data, _ := io.ReadAll(res.Body)
		return fmt.Errorf("facebook conversions api %d: %s", res.StatusCode, data)
	}
	return nil
}

func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return t != ""
	}
	return true
}
