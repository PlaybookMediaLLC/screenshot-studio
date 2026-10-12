package organizations

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/organization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/database/subscriptions"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/settings"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/httpx"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
)

// NotificationService is the part of notifications.Service the organization
// service uses (an interface because notifications imports this package).
type NotificationService interface {
	HasEmailProvider() bool
	SendEmail(ctx context.Context, to, subject, html, replyTo string) error
}

type Service struct {
	repo          *Repository
	notifications NotificationService
}

func NewService(repo *Repository, notifications NotificationService) *Service {
	return &Service{repo: repo, notifications: notifications}
}

func (s *Service) CreateOrgAndUser(ctx context.Context, body *auth.CreateOrgUserDto, ip, userAgent string) (*ent.Organization, error) {
	return s.repo.CreateOrgAndUser(ctx, body, s.notifications.HasEmailProvider(), ip, userAgent)
}

func (s *Service) GetCount(ctx context.Context) (int, error) { return s.repo.GetCount(ctx) }

func (s *Service) CreateMaxUser(ctx context.Context, id, name, saasName, email string) (*CreatedMaxUser, error) {
	return s.repo.CreateMaxUser(ctx, id, name, saasName, email)
}

func (s *Service) AddUserToOrg(ctx context.Context, userID, id, orgID string, role userorganization.Role) (*ent.UserOrganization, error) {
	return s.repo.AddUserToOrg(ctx, userID, id, orgID, role)
}

func (s *Service) GetOrgByID(ctx context.Context, id string) (*ent.Organization, error) {
	return s.repo.GetOrgByID(ctx, id)
}

func (s *Service) GetOrgByIDWithSubscription(ctx context.Context, id string) (*ent.Organization, error) {
	return s.repo.GetOrgByIDWithSubscription(ctx, id)
}

func (s *Service) GetAccountOverview(ctx context.Context, orgID string) (*AccountOverview, error) {
	return s.repo.GetAccountOverview(ctx, orgID)
}

func (s *Service) GetOrgByAPIKey(ctx context.Context, api string) (*ent.Organization, error) {
	return s.repo.GetOrgByAPIKey(ctx, api)
}

// CanUseSuperAdminAPI: the organization has a super admin member and no other
// privileged member.
func (s *Service) CanUseSuperAdminAPI(ctx context.Context, orgID string) (bool, error) {
	superAdmin, err := s.repo.GetSuperAdminUser(ctx, orgID)
	if err != nil {
		return false, err
	}
	privilegedOther, err := s.repo.GetPrivilegedNonSuperAdminUser(ctx, orgID)
	if err != nil {
		return false, err
	}
	return superAdmin != nil && privilegedOther == nil, nil
}

func (s *Service) GetUserOrg(ctx context.Context, id string) (*ent.UserOrganization, error) {
	return s.repo.GetUserOrg(ctx, id)
}

func (s *Service) GetOrgsByUserID(ctx context.Context, userID string) ([]*ent.Organization, error) {
	return s.repo.GetOrgsByUserID(ctx, userID)
}

func (s *Service) UpdateAPIKey(ctx context.Context, orgID string) (*ent.Organization, error) {
	return s.repo.UpdateAPIKey(ctx, orgID)
}

func (s *Service) GetTeam(ctx context.Context, orgID string) (*Team, error) {
	return s.repo.GetTeam(ctx, orgID)
}

func (s *Service) SetStreak(ctx context.Context, organizationID, typ string) {
	s.repo.SetStreak(ctx, organizationID, typ)
}

func (s *Service) GetLastPublishDate(ctx context.Context, organizationID string) (*int64, error) {
	return s.repo.GetLastPublishDate(ctx, organizationID)
}

func (s *Service) GetOrgByCustomerID(ctx context.Context, customerID string) (*ent.Organization, error) {
	return s.repo.GetOrgByCustomerID(ctx, customerID)
}

// InviteURL is inviteTeamMember's result.
type InviteURL struct {
	URL string `json:"url"`
}

func (s *Service) InviteTeamMember(ctx context.Context, org *ent.Organization, u *ent.User, body *settings.AddTeamMemberDto) (*InviteURL, error) {
	timeLimit := time.Now().AddDate(0, 0, 2).Format("2006-01-02 15:04:05")
	id := ids.Make(5)
	claims := map[string]any{"orgId": org.ID, "timeLimit": timeLimit, "id": id}
	if body.Email != nil {
		claims["email"] = *body.Email
	}
	if body.Role != nil {
		claims["role"] = *body.Role
	}
	if body.SendEmail != nil {
		claims["sendEmail"] = *body.SendEmail
	}
	token, err := helpers.SignJWT(claims)
	if err != nil {
		return nil, err
	}
	url := os.Getenv("FRONTEND_URL") + "/?org=" + token
	if body.SendEmail != nil && *body.SendEmail {
		name := ""
		if u.Name != nil {
			name = *u.Name
		}
		inviter := u.Email
		who := u.Email
		if name != "" {
			inviter = fmt.Sprintf("%s (%s)", name, u.Email)
			who = name
		}
		email := ""
		if body.Email != nil {
			email = *body.Email
		}
		if err := s.notifications.SendEmail(ctx, email,
			fmt.Sprintf(`%s invited you to join "%s"`, who, org.Name),
			fmt.Sprintf(`%s has invited you to join the "%s" team.<br /><a href="%s">Accept the invitation</a> to get started.<br />The link will expire in 2 days.`, inviter, org.Name, url),
			""); err != nil {
			return nil, err
		}
	}
	return &InviteURL{URL: url}, nil
}

// Added is addTeamMemberByEmail's result.
type Added struct {
	Added bool `json:"added"`
}

// AddTeamMemberByEmail adds an existing Postiz user to org. org must carry
// Edges.Subscription when it has one (as the auth middleware loads it).
func (s *Service) AddTeamMemberByEmail(ctx context.Context, org *ent.Organization, body *settings.AdminAddTeamMemberDto) (*Added, error) {
	tier := "FREE"
	if os.Getenv("STRIPE_PUBLISHABLE_KEY") == "" {
		tier = "ULTIMATE"
	}
	if org.Edges.Subscription != nil {
		tier = string(org.Edges.Subscription.SubscriptionTier)
	}
	if !subscriptions.Pricing[tier].TeamMembers {
		return nil, httpx.HTTPException("The organization plan does not include team members", 400)
	}

	email := ""
	if body.Email != nil {
		email = *body.Email
	}
	users, err := s.repo.GetUsersByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	if len(users) == 0 {
		return nil, httpx.HTTPException("No Postiz account found for this email", 400)
	}
	if len(users) > 1 {
		return nil, httpx.HTTPException("Multiple accounts exist for this email (different login providers)", 400)
	}
	u := users[0]

	userOrgs, err := s.repo.GetOrgsByUserID(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	for _, current := range userOrgs {
		if current.ID == org.ID {
			return nil, httpx.HTTPException("User is already a member of this organization", 400)
		}
	}

	role := ""
	if body.Role != nil {
		role = *body.Role
	}
	added, err := s.repo.AddUserToOrg(ctx, u.ID, ids.Make(5), org.ID, userorganization.Role(role))
	if err != nil {
		return nil, err
	}
	if added == nil {
		return nil, httpx.HTTPException("Could not add the user to the organization", 400)
	}
	return &Added{Added: true}, nil
}

func roleLevel(role userorganization.Role) int {
	switch role {
	case userorganization.RoleUSER:
		return 0
	case userorganization.RoleADMIN:
		return 1
	}
	return 2
}

// DeleteTeamMember removes userID from org. org.Edges.Users[0] is the
// caller's membership. The plain errors become 500s, like the TS `Error`s.
func (s *Service) DeleteTeamMember(ctx context.Context, org *ent.Organization, userID string) (*ent.UserOrganization, error) {
	userOrgs, err := s.repo.GetOrgsByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	var target *ent.Organization
	for _, o := range userOrgs {
		if o.ID == org.ID {
			target = o
			break
		}
	}
	if target == nil {
		return nil, errors.New("User is not part of this organization")
	}

	myLevel := roleLevel(org.Edges.Users[0].Role)
	userLevel := roleLevel(target.Edges.Users[0].Role)
	if myLevel < userLevel {
		return nil, errors.New("You do not have permission to delete this user")
	}

	return s.repo.DeleteTeamMember(ctx, org.ID, userID)
}

func (s *Service) DisableOrEnableNonSuperAdminUsers(ctx context.Context, orgID string, disable bool) (int, error) {
	return s.repo.DisableOrEnableNonSuperAdminUsers(ctx, orgID, disable)
}

func (s *Service) GetShortlinkPreference(ctx context.Context, orgID string) (*ShortlinkPreference, error) {
	return s.repo.GetShortlinkPreference(ctx, orgID)
}

func (s *Service) UpdateShortlinkPreference(ctx context.Context, orgID string, shortlink organization.Shortlink) (*ent.Organization, error) {
	return s.repo.UpdateShortlinkPreference(ctx, orgID, shortlink)
}
