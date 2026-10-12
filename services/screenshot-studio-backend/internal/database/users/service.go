package users

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/organizations"
	dtousers "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/users"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
)

// IntegrationRepository is the part of integration.Repository users use.
type IntegrationRepository interface {
	DeleteIntegrationsForAccount(ctx context.Context, org string) error
}

// NotificationService is the part of notifications.Service users use.
type NotificationService interface {
	HasEmailProvider() bool
	SendEmail(ctx context.Context, to, subject, html, replyTo string) error
}

type Service struct {
	repo          *Repository
	organizations *organizations.Repository
	integrations  IntegrationRepository
	notifications NotificationService
}

func NewService(repo *Repository, organizations *organizations.Repository, integrations IntegrationRepository, notifications NotificationService) *Service {
	return &Service{repo: repo, organizations: organizations, integrations: integrations, notifications: notifications}
}

func (s *Service) GetUserByEmail(ctx context.Context, email string) (*ent.User, error) {
	return s.repo.GetUserByEmail(ctx, email)
}

func (s *Service) GetUserByID(ctx context.Context, id string) (*ent.User, error) {
	return s.repo.GetUserByID(ctx, id)
}

func (s *Service) GetUserWithActiveSubscriptionByEmail(ctx context.Context, email, excludeUserID string) (*UserProvider, error) {
	return s.repo.GetUserWithActiveSubscriptionByEmail(ctx, email, excludeUserID)
}

// GetImpersonateUser searches memberships (organizations.Repository's
// getImpersonateUser, not this package's).
func (s *Service) GetImpersonateUser(ctx context.Context, name string) ([]organizations.ImpersonateUserOrg, error) {
	return s.organizations.GetImpersonateUser(ctx, name)
}

func (s *Service) GetUserByProvider(ctx context.Context, providerID string, provider user.ProviderName) (*ent.User, error) {
	return s.repo.GetUserByProvider(ctx, providerID, provider)
}

// SwitchUser swaps two accounts' logins and tells both owners.
func (s *Service) SwitchUser(ctx context.Context, currentUserID, targetUserID, adminID string) (*SwitchResult, error) {
	result, err := s.repo.SwitchUserCredentials(ctx, currentUserID, targetUserID)
	if err != nil {
		return nil, err
	}
	kept, switched := result.Kept, result.Switched

	slog.Info(fmt.Sprintf(
		"User login switch performed by admin %s: account %s login %s -> %s; account %s login %s -> %s",
		adminID, kept.ID, switched.Email, kept.Email, switched.ID, kept.Email, switched.Email,
	))

	// the swap is already committed; a notification failure must not fail it
	if s.notifications.HasEmailProvider() {
		var wg sync.WaitGroup
		for _, account := range []AccountLogin{kept, switched} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				err := s.notifications.SendEmail(ctx, account.Email, "Your Postiz login was changed",
					"An administrator changed the login for your Postiz account. "+
						"You can now sign in using "+account.Email+". "+
						"Your subscription and plan were not changed by this switch — "+
						"if you intended to cancel a subscription, please do that "+
						"separately from your billing settings.", "")
				if err != nil {
					slog.Error("Failed to notify "+account.Email, "error", err)
				}
			}()
		}
		wg.Wait()
	}

	return result, nil
}

// GetOrgsToDeleteForAccount returns the organizations the user owns, failing
// when one still has another active member.
func (s *Service) GetOrgsToDeleteForAccount(ctx context.Context, userID string) ([]*ent.Organization, error) {
	orgs, err := s.organizations.GetOrgsByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	var owned []*ent.Organization
	for _, org := range orgs {
		if org.Edges.Users[0].Role == userorganization.RoleSUPERADMIN {
			owned = append(owned, org)
		}
	}

	for _, org := range owned {
		team, err := s.organizations.GetTeam(ctx, org.ID)
		if err != nil {
			return nil, err
		}
		if team == nil {
			continue
		}
		for _, member := range team.Users {
			if member.User.ID != userID && !member.Disabled {
				return nil, httpx.HTTPException("Please remove your team members before deleting your account", 400)
			}
		}
	}

	return owned, nil
}

// DeletedOrgs is deleteAccount's result.
type DeletedOrgs struct {
	DeletedOrgs []*ent.Organization `json:"deletedOrgs"`
}

// DeleteAccount deletes the organizations the user owns (with their
// channels), leaves the others, and anonymizes the user.
func (s *Service) DeleteAccount(ctx context.Context, userID string) (*DeletedOrgs, error) {
	deletedOrgs, err := s.GetOrgsToDeleteForAccount(ctx, userID)
	if err != nil {
		return nil, err
	}
	orgs, err := s.organizations.GetOrgsByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	for _, org := range orgs {
		if org.Edges.Users[0].Role == userorganization.RoleSUPERADMIN {
			if err := s.integrations.DeleteIntegrationsForAccount(ctx, org.ID); err != nil {
				return nil, err
			}
			if _, err := s.organizations.DeleteOrganization(ctx, org.ID); err != nil {
				return nil, err
			}
		} else if _, err := s.organizations.DeleteTeamMember(ctx, org.ID, userID); err != nil {
			return nil, err
		}
	}

	if _, err := s.repo.DeleteAccount(ctx, userID); err != nil {
		return nil, err
	}

	deletedIDs := make([]string, 0, len(deletedOrgs))
	for _, org := range deletedOrgs {
		deletedIDs = append(deletedIDs, org.ID)
	}
	slog.Info(fmt.Sprintf("Account %s deleted, organizations removed: %s", userID, strings.Join(deletedIDs, ", ")))

	if deletedOrgs == nil {
		deletedOrgs = []*ent.Organization{}
	}
	return &DeletedOrgs{DeletedOrgs: deletedOrgs}, nil
}

func (s *Service) ActivateUser(ctx context.Context, id string) (*ent.User, error) {
	return s.repo.ActivateUser(ctx, id)
}

func (s *Service) UpdatePassword(ctx context.Context, id, password string) (*ent.User, error) {
	return s.repo.UpdatePassword(ctx, id, password)
}

func (s *Service) GetPersonal(ctx context.Context, userID string) (*Personal, error) {
	return s.repo.GetPersonal(ctx, userID)
}

func (s *Service) ChangePersonal(ctx context.Context, userID string, body *dtousers.UserDetailDto) error {
	return s.repo.ChangePersonal(ctx, userID, body)
}

func (s *Service) GetEmailNotifications(ctx context.Context, userID string) (*EmailNotifications, error) {
	return s.repo.GetEmailNotifications(ctx, userID)
}

func (s *Service) UpdateEmailNotifications(ctx context.Context, userID string, body *dtousers.EmailNotificationsDto) error {
	return s.repo.UpdateEmailNotifications(ctx, userID, body)
}
