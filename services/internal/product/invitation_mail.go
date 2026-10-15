package product

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"strings"
	"time"
)

type InvitationMessage struct {
	Email            string
	InvitationID     string
	InviterName      string
	OrganizationName string
}

type InvitationMailer interface {
	SendInvitation(context.Context, InvitationMessage) error
}

// EnvInvitationMailer uses the same Resend or webhook transport as the
// existing authentication email flow. The backend owns delivery after cutover.
type EnvInvitationMailer struct{}

func (EnvInvitationMailer) SendInvitation(ctx context.Context, message InvitationMessage) error {
	base := strings.TrimSpace(os.Getenv("BETTER_AUTH_URL"))
	if base == "" {
		return fmt.Errorf("BETTER_AUTH_URL is required for invitation delivery")
	}
	acceptURL, err := url.Parse(base)
	if err != nil || acceptURL.Scheme == "" || acceptURL.Host == "" {
		return fmt.Errorf("invalid BETTER_AUTH_URL")
	}
	acceptURL.Path = "/accept-invitation"
	acceptURL.RawQuery = url.Values{"invitationId": {message.InvitationID}}.Encode()
	from := strings.TrimSpace(os.Getenv("AUTH_EMAIL_FROM"))
	if from == "" {
		from = "Screenshot Studio <noreply@oppulence.app>"
	}
	if _, err := mail.ParseAddress(from); err != nil {
		return fmt.Errorf("invalid AUTH_EMAIL_FROM: %w", err)
	}
	subject := "Join " + message.OrganizationName + " on Screenshot Studio"
	text := fmt.Sprintf("%s invited you to the %s workspace on Screenshot Studio. Accept the invitation: %s",
		message.InviterName, message.OrganizationName, acceptURL.String())
	htmlBody := fmt.Sprintf("<p>%s invited you to join %s on Screenshot Studio.</p><p><a href=\"%s\">Accept invitation</a></p><p>%s</p>",
		html.EscapeString(message.InviterName), html.EscapeString(message.OrganizationName),
		html.EscapeString(acceptURL.String()), html.EscapeString(acceptURL.String()))
	endpoint := strings.TrimSpace(os.Getenv("AUTH_EMAIL_WEBHOOK_URL"))
	payload := map[string]any{"to": message.Email, "subject": subject, "text": text, "html": htmlBody}
	headers := map[string]string{"Content-Type": "application/json"}
	if key := strings.TrimSpace(os.Getenv("RESEND_API_KEY")); key != "" {
		endpoint = "https://api.resend.com/emails"
		payload["to"] = []string{message.Email}
		payload["from"] = from
		headers["Authorization"] = "Bearer " + key
	}
	if endpoint == "" {
		return fmt.Errorf("invitation email is not configured")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return fmt.Errorf("invalid invitation email endpoint")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 1024))
		return fmt.Errorf("invitation email delivery failed (%d): %s", response.StatusCode, strings.TrimSpace(string(detail)))
	}
	return nil
}
