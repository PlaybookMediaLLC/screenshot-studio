package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestSlackValidationRetriesBeforeSending(t *testing.T) {
	for _, mode := range []string{"rate_limit", "server_error", "refresh_in_progress", "archived"} {
		t.Run(mode, func(t *testing.T) {
			f := notificationFixture(t)
			ctx := context.Background()
			connection := testSlackConnection(t, f)
			var recovered atomic.Bool
			var sends atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/chat.postMessage" {
					sends.Add(1)
					_, _ = fmt.Fprint(w, `{"ok":true,"channel":"C123","ts":"123.456"}`)
					return
				}
				if !recovered.Load() {
					switch mode {
					case "rate_limit":
						w.Header().Set("Retry-After", "7")
						w.WriteHeader(http.StatusTooManyRequests)
						return
					case "server_error":
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					case "archived":
						_, _ = fmt.Fprint(w, `{"ok":true,"channel":{"id":"C123","name":"activity","is_member":true,"is_archived":true}}`)
						return
					}
				}
				_, _ = fmt.Fprint(w, `{"ok":true,"channel":{"id":"C123","name":"activity","is_member":true}}`)
			}))
			defer server.Close()
			f.s.SlackBase = server.URL
			execFixture(t, f, `INSERT INTO platform_notification_policy("organizationId",events,slack_connection_id,slack_channel_id) VALUES($1,'{"generation.completed":{"inApp":true,"email":false,"slack":true}}',$2,'C123')`, f.owner.OrganizationID, connection.ID)
			if mode == "refresh_in_progress" {
				raw, _ := json.Marshal(slackCredentials{AccessToken: "old", RefreshToken: "refresh"})
				encrypted, err := seal(raw)
				if err != nil {
					t.Fatal(err)
				}
				execFixture(t, f, `UPDATE platform_slack_installation SET encrypted_credentials=$2,expires_at=now(),refresh_claim='other-worker',refresh_started_at=now() WHERE id=(SELECT installation_id FROM platform_slack_connection WHERE id=$1)`, connection.ID, encrypted)
			}
			event := f.event(t, "generation.completed", f.creator.UserID)
			if err := f.s.Process(ctx); err != nil {
				t.Fatal(err)
			}
			var status string
			var next time.Time
			var notSent bool
			if err := f.s.DB.QueryRow(`SELECT status,next_attempt_at,send_started_at IS NULL FROM platform_notification_delivery WHERE event_id=$1 AND channel='slack'`, event).Scan(&status, &next, &notSent); err != nil {
				t.Fatal(err)
			}
			if sends.Load() != 0 || !notSent {
				t.Fatal("failed validation crossed the send boundary")
			}
			if mode == "archived" {
				if status != "BLOCKED" {
					t.Fatalf("permanent destination failure was not blocked: %s", status)
				}
				return
			}
			if status != "PENDING" || !next.After(time.Now()) {
				t.Fatalf("transient validation did not schedule retry: %s %s", status, next)
			}
			if mode == "rate_limit" && time.Until(next) < 6*time.Second {
				t.Fatal("provider Retry-After was discarded")
			}
			recovered.Store(true)
			execFixture(t, f, `UPDATE platform_slack_installation SET expires_at=NULL,refresh_claim='',refresh_started_at=NULL WHERE id=(SELECT installation_id FROM platform_slack_connection WHERE id=$1)`, connection.ID)
			execFixture(t, f, `UPDATE platform_notification_delivery SET next_attempt_at=now() WHERE event_id=$1 AND channel='slack'`, event)
			if err := f.s.Process(ctx); err != nil {
				t.Fatal(err)
			}
			if err := f.s.DB.QueryRow(`SELECT status FROM platform_notification_delivery WHERE event_id=$1 AND channel='slack'`, event).Scan(&status); err != nil || status != "SUCCEEDED" || sends.Load() != 1 {
				t.Fatalf("recovered delivery: status=%s sends=%d err=%v", status, sends.Load(), err)
			}
		})
	}
}
