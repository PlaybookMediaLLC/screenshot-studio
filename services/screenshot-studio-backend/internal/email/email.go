// Package email is Postiz's EmailService (services/email.service.ts) and its
// providers (emails/*): Resend over HTTP, SMTP (nodemailer) and the empty
// provider, picked by EMAIL_PROVIDER.
package email

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.temporal.io/sdk/client"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
)

// Service is EmailService.
type Service struct {
	EmailService Provider
	temporal     client.Client
}

// NewService picks the provider from EMAIL_PROVIDER and reports missing
// environment variables, like the Nest constructor.
func NewService(temporal client.Client) *Service {
	s := &Service{temporal: temporal}
	s.EmailService = s.SelectProvider(os.Getenv("EMAIL_PROVIDER"))
	slog.Info("Email service provider: " + s.EmailService.Name())
	for _, key := range s.EmailService.ValidateEnvKeys() {
		if os.Getenv(key) == "" {
			slog.Error("Missing environment variable: " + key)
		}
	}
	return s
}

func (s *Service) HasProvider() bool {
	_, empty := s.EmailService.(EmptyProvider)
	return !empty
}

func (s *Service) SelectProvider(provider string) Provider {
	switch provider {
	case "resend":
		return ResendProvider{}
	case "nodemailer":
		return NodeMailerProvider{}
	}
	return EmptyProvider{}
}

// SendEmailInput is the sendSingleEmailWorkflow argument.
type SendEmailInput struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	HTML    string `json:"html"`
	ReplyTo string `json:"replyTo,omitempty"`
	AddTo   string `json:"addTo"` // top | bottom
}

// SendEmail queues the email on the sendSingleEmailWorkflow; it returns a
// nil run when to or subject is empty, or there is no Temporal client.
func (s *Service) SendEmail(ctx context.Context, to, subject, html, addTo, replyTo string) (client.WorkflowRun, error) {
	if to == "" || subject == "" || s.temporal == nil {
		return nil, nil
	}
	return s.temporal.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        "send_email_" + uuid.NewString(),
		TaskQueue: temporalx.MainQueue,
	}, "sendSingleEmailWorkflow", SendEmailInput{To: to, Subject: subject, HTML: html, ReplyTo: replyTo, AddTo: addTo})
}

// SendEmailSync wraps the html in the Postiz layout and sends it, trying
// three times; failures are logged, never returned.
func (s *Service) SendEmailSync(ctx context.Context, to, subject, html, replyTo string) {
	if !strings.Contains(to, "@") {
		return
	}

	fromAddress, fromName := os.Getenv("EMAIL_FROM_ADDRESS"), os.Getenv("EMAIL_FROM_NAME")
	if fromAddress == "" || fromName == "" {
		slog.Info("Email sender information not found in environment variables")
		return
	}

	modifiedHTML := `
    <div style="
        background: linear-gradient(to bottom right, #e6f2ff, #f0e6ff);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
    ">
        <div style="
            background-color: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(4px);
            border-radius: 0.5rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            max-width: 48rem;
            width: 100%;
            padding: 2rem;
        ">
            <h1 style="
                font-size: 1.875rem;
                font-weight: bold;
                margin-bottom: 1.5rem;
                text-align: left;
                color: #1f2937;
            ">` + subject + `</h1>

            <div style="
                margin-bottom: 2rem;
                color: #374151;
            ">
                ` + html + `
            </div>

            <div style="
                display: flex;
                align-items: center;
                border-top: 1px solid #e5e7eb;
                padding-top: 1.5rem;
            ">
                <div>
                    <h2 style="
                        font-size: 1.25rem;
                        font-weight: 600;
                        color: #1f2937;
                        margin: 0;
                    ">` + fromName + `</h2>
                    <div style="font-size: 12px">
                      You can change your notification preferences in your <a href="` + os.Getenv("FRONTEND_URL") + `/settings">account settings.</a>
                     </div>
                </div>
            </div>
        </div>
    </div>
    `

	var lastErr error
	for attempt := range 3 {
		sends, err := s.EmailService.SendEmail(ctx, to, subject, modifiedHTML, fromName, fromAddress, replyTo)
		if err == nil {
			slog.Info(fmt.Sprint(sends))
			return
		}
		lastErr = err
		slog.Info(fmt.Sprintf("Email attempt %d/3 failed:", attempt+1), "error", err)
		if attempt < 2 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(700 * time.Millisecond):
			}
		}
	}
	slog.Info(fmt.Sprintf("Email to %s failed after 3 attempts:", to), "error", lastErr)
}
