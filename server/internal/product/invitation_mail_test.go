package product

import (
	"context"
	"encoding/json"
	"errors"
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

func TestReviewMailerReportsUnavailableUntilConfiguredThenUsesTheWebhook(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("AUTH_EMAIL_WEBHOOK_URL", "")
	message := ReviewNotification{ActorName: "Ada", CampaignName: "Launch", CampaignURL: "https://shots.example.test/campaigns/c1/copy",
		Decision: "request_changes", Email: "author@example.test", Note: "<b>Shorter</b>", PostCount: 2}
	if err := (EnvReviewMailer{}).SendReviewNotification(context.Background(), message); !errors.Is(err, errEmailNotConfigured) {
		t.Fatalf("unconfigured mailer outcome: %v", err)
	}
	var delivered struct{ To, Subject, Text, HTML string }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&delivered)
	}))
	defer server.Close()
	t.Setenv("AUTH_EMAIL_WEBHOOK_URL", server.URL)
	if err := (EnvReviewMailer{}).SendReviewNotification(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	if delivered.To != "author@example.test" || delivered.Subject != "Changes requested in Launch" ||
		!strings.Contains(delivered.Text, "Ada asked for changes to 2 posts") || !strings.Contains(delivered.HTML, "&lt;b&gt;Shorter") {
		t.Fatalf("review email=%+v", delivered)
	}
}
