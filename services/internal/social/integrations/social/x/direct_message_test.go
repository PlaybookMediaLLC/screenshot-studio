package x

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/autodm"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/temporalx"
)

func TestDirectMessageDefaultOffAndVerifiedGrantRequired(t *testing.T) {
	in := publishingAccount()
	if _, err := New().SendDirectMessage(context.Background(), in, "2", "Hello"); !errors.Is(err, autodm.ErrUnavailable) {
		t.Fatalf("default gate=%v", err)
	}
	t.Setenv("PLATFORM_X_AUTO_DM_DELIVERY_ENABLED", "true")
	calls, done := fakePublishingX(t, func(r recorded) (int, string) { t.Error("missing DM grant reached message mutation"); return 201, `{}` })
	defer done()
	_, err := New().SendDirectMessage(context.Background(), in, "2", "Hello")
	if temporalx.FailureType(err) != temporalx.TypeBadBody || len(*calls) != 1 {
		t.Fatalf("unapproved send err=%v calls=%+v", err, *calls)
	}
}
func TestDirectMessageNativeProtocolAndUncertainDeliveryNeverRetries(t *testing.T) {
	for _, status := range []int{201, 403, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			t.Setenv("PLATFORM_X_AUTO_DM_DELIVERY_ENABLED", "true")
			mutations := 0
			connectionServer(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/2/users/me" {
					w.Header().Set("x-access-level", "read-write-directmessages")
					_, _ = w.Write([]byte(`{"data":{"id":"1","name":"Me","username":"me"}}`))
					return
				}
				mutations++
				if r.Method != "POST" || r.URL.Path != "/2/dm_conversations/with/2/messages" || !strings.Contains(r.Header.Get("Authorization"), "OAuth ") {
					t.Errorf("wrong native request %s %s", r.Method, r.URL.Path)
				}
				var body map[string]string
				if json.NewDecoder(r.Body).Decode(&body) != nil || body["text"] != "Your requested guide\n\nReply STOP to opt out." {
					t.Errorf("wrong DM body %v", body)
				}
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"data":{"dm_event_id":"99","dm_conversation_id":"1-2"}}`))
			})
			id, err := New().SendDirectMessage(context.Background(), publishingAccount(), "2", "Your requested guide\n\nReply STOP to opt out.")
			if mutations != 1 {
				t.Fatalf("duplicate attempts=%d", mutations)
			}
			if status == 201 {
				if err != nil || id != "99" {
					t.Fatalf("receipt=%s %v", id, err)
				}
			} else if status == 500 && temporalx.FailureType(err) != temporalx.TypeUnknownDelivery {
				t.Fatalf("ambiguous send retryable: %v", err)
			} else if err == nil {
				t.Fatal("rejected send reported success")
			}
		})
	}
}
