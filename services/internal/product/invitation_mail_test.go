package product

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInvitationMailerDeliversAcceptLinkThroughWebhook(t *testing.T) {
	var delivered struct {
		To      string `json:"to"`
		Subject string `json:"subject"`
		Text    string `json:"text"`
		HTML    string `json:"html"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&delivered) != nil {
			t.Errorf("invalid invitation webhook request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("AUTH_EMAIL_WEBHOOK_URL", server.URL)
	t.Setenv("AUTH_EMAIL_FROM", "Screenshot Studio <noreply@example.test>")
	t.Setenv("BETTER_AUTH_URL", "https://shots.example.test")
	if err := (EnvInvitationMailer{}).SendInvitation(context.Background(), InvitationMessage{
		Email: "invitee@example.test", InvitationID: "invite +1", InviterName: "Owner",
		OrganizationName: "Studio",
	}); err != nil {
		t.Fatal(err)
	}
	if delivered.To != "invitee@example.test" || !strings.Contains(delivered.Subject, "Studio") ||
		!strings.Contains(delivered.Text, "https://shots.example.test/accept-invitation?invitationId=invite+%2B1") ||
		!strings.Contains(delivered.HTML, "Accept invitation") {
		t.Fatalf("incomplete invitation email: %#v", delivered)
	}
}
