package notifications

import (
	"context"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/organizations"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/temporalx"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

type NotificationType string

const (
	TypeSuccess NotificationType = "success"
	TypeFail    NotificationType = "fail"
	TypeInfo    NotificationType = "info"
)

// EmailService is the part of services/email.service.ts notifications use.
// SendEmail starts the sendSingleEmailWorkflow; addTo is "top" or "bottom".
type EmailService interface {
	HasProvider() bool
	SendEmail(ctx context.Context, to, subject, html, addTo, replyTo string) error
}

// DigestEmail is one item of the digestEmailWorkflow "email" signal payload.
type DigestEmail struct {
	Title   string           `json:"title"`
	Message string           `json:"message"`
	Type    NotificationType `json:"type"`
}

// DigestEmailWorkflowInput is digestEmailWorkflow's argument.
type DigestEmailWorkflowInput struct {
	OrganizationID string `json:"organizationId"`
}

type Service struct {
	repo          *Repository
	email         EmailService
	organizations *organizations.Repository
	temporal      client.Client
}

// NewService takes the Temporal client used for digest emails; a nil client
// skips them (TS `getRawClient()?.`).
func NewService(repo *Repository, email EmailService, organizations *organizations.Repository, temporal client.Client) *Service {
	return &Service{repo: repo, email: email, organizations: organizations, temporal: temporal}
}

func (s *Service) GetMainPageCount(ctx context.Context, organizationID, userID string) (*MainPageCount, error) {
	return s.repo.GetMainPageCount(ctx, organizationID, userID)
}

func (s *Service) GetNotificationsPaginated(ctx context.Context, organizationID string, page int) (*PaginatedNotifications, error) {
	return s.repo.GetNotificationsPaginated(ctx, organizationID, page)
}

func (s *Service) GetNotifications(ctx context.Context, organizationID, userID string) (*RecentNotifications, error) {
	return s.repo.GetNotifications(ctx, organizationID, userID)
}

// InAppNotification stores the notification and, when sendEmail is set,
// either queues it on the organization's digest workflow or emails the
// members right away. TS defaults: sendEmail=false, digest=false,
// typ="success".
func (s *Service) InAppNotification(ctx context.Context, orgID, subject, message string, sendEmail, digest bool, typ NotificationType) error {
	if err := s.repo.CreateNotification(ctx, orgID, message); err != nil {
		return err
	}
	if !sendEmail {
		return nil
	}

	if digest {
		if s.temporal != nil {
			// Errors are ignored like the TS try/catch.
			_, _ = s.temporal.SignalWithStartWorkflow(ctx, "digest_email_workflow_"+orgID, "email",
				[]DigestEmail{{Title: subject, Message: message, Type: typ}},
				client.StartWorkflowOptions{
					ID:                       "digest_email_workflow_" + orgID,
					TaskQueue:                temporalx.MainQueue,
					WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING,
					TypedSearchAttributes:    temporal.NewSearchAttributes(temporalx.OrganizationID.ValueSet(orgID)),
				},
				"digestEmailWorkflow", DigestEmailWorkflowInput{OrganizationID: orgID})
		}
		return nil
	}

	return s.SendEmailsToOrg(ctx, orgID, subject, message, typ)
}

// SendEmailsToOrg emails every member, honoring their success/failure email
// preferences ("info" is always sent; "" means no type).
func (s *Service) SendEmailsToOrg(ctx context.Context, orgID, subject, message string, typ NotificationType) error {
	members, err := s.organizations.GetAllUsersOrgs(ctx, orgID)
	if err != nil {
		return err
	}
	for _, member := range members {
		u := member.Edges.User
		// 'info' type is always sent regardless of preferences
		if typ != TypeInfo {
			// Filter users based on their email preferences
			if typ == TypeSuccess && !u.SendSuccessEmails {
				continue
			}
			if typ == TypeFail && !u.SendFailureEmails {
				continue
			}
		}
		if err := s.SendEmail(ctx, u.Email, subject, message, ""); err != nil {
			return err
		}
	}
	return nil
}

// SendEmail sends one email on top of the template; replyTo "" means none.
func (s *Service) SendEmail(ctx context.Context, to, subject, html, replyTo string) error {
	return s.email.SendEmail(ctx, to, subject, html, "top", replyTo)
}

func (s *Service) HasEmailProvider() bool { return s.email.HasProvider() }
