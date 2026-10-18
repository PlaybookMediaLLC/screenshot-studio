// Package organizations ports database/prisma/organizations: the
// OrganizationRepository and OrganizationService.
package organizations

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/dtos/auth"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/integration"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/organization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/post"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/predicate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/subscription"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ids"
)

// JSTime marshals like JavaScript's Date#toJSON, which is how Prisma `select`
// results reach clients. The users and notifications packages reuse it.
type JSTime struct{ time.Time }

func (t JSTime) MarshalJSON() ([]byte, error) { return json.Marshal(t.UTC().Format(ent.JSTime)) }

// NewJSTime wraps an optional time.
func NewJSTime(t *time.Time) *JSTime {
	if t == nil {
		return nil
	}
	return &JSTime{*t}
}

type Repository struct {
	client *ent.Client
}

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

// CreatedMaxUser is createMaxUser's `select: {id, apiKey}`.
type CreatedMaxUser struct {
	ID     string  `json:"id"`
	APIKey *string `json:"apiKey"`
}

func (r *Repository) CreateMaxUser(ctx context.Context, id, name, saasName, email string) (*CreatedMaxUser, error) {
	displayName := "Unnamed User###" + id
	if name != "" {
		displayName = name + "###" + id
	}
	userEmail := saasName + "+" + ids.Make(10) + "@postiz.com"
	if email != "" {
		userEmail = strings.ReplaceAll(email, "@", "+"+saasName+"@")
	}
	apiKey, err := helpers.FixedEncryption(ids.Secure(20))
	if err != nil {
		return nil, err
	}
	// bcrypt only reads the first 72 bytes (Node truncates silently, Go's
	// bcrypt rejects longer input), so hashing the prefix is identical.
	password, err := helpers.HashPassword(ids.Secure(500)[:72])
	if err != nil {
		return nil, err
	}
	var out *CreatedMaxUser
	err = withTx(ctx, r.client, func(tx *ent.Tx) error {
		org, err := tx.Organization.Create().SetName(displayName).SetAPIKey(apiKey).SetIsTrailing(false).Save(ctx)
		if err != nil {
			return err
		}
		if err := tx.Subscription.Create().SetOrganizationID(org.ID).SetTotalChannels(1000000).
			SetSubscriptionTier(subscription.SubscriptionTierULTIMATE).SetIsLifetime(true).
			SetPeriod(subscription.PeriodYEARLY).Exec(ctx); err != nil {
			return err
		}
		u, err := tx.User.Create().SetActivated(true).SetEmail(userEmail).SetName(displayName).
			SetProviderName(user.ProviderNameLOCAL).SetPassword(password).SetTimezone(0).Save(ctx)
		if err != nil {
			return err
		}
		if err := tx.UserOrganization.Create().SetRole(userorganization.RoleSUPERADMIN).
			SetUserID(u.ID).SetOrganizationID(org.ID).Exec(ctx); err != nil {
			return err
		}
		out = &CreatedMaxUser{ID: org.ID, APIKey: org.APIKey}
		return nil
	})
	return out, err
}

// GetOrgByAPIKey loads the organization with its subscription.
func (r *Repository) GetOrgByAPIKey(ctx context.Context, api string) (*ent.Organization, error) {
	return first(r.client.Organization.Query().
		Where(organization.APIKey(api), organization.DeletedAtIsNil()).
		WithSubscription().First(ctx))
}

func (r *Repository) GetCount(ctx context.Context) (int, error) {
	return r.client.Organization.Query().Count(ctx)
}

func (r *Repository) GetSuperAdminUser(ctx context.Context, orgID string) (*ent.UserOrganization, error) {
	return first(r.client.UserOrganization.Query().Where(
		userorganization.OrganizationID(orgID),
		userorganization.Disabled(false),
		userorganization.HasUserWith(user.IsSuperAdmin(true), user.DeletedAtIsNil()),
	).First(ctx))
}

func (r *Repository) GetPrivilegedNonSuperAdminUser(ctx context.Context, orgID string) (*ent.UserOrganization, error) {
	return first(r.client.UserOrganization.Query().Where(
		userorganization.OrganizationID(orgID),
		userorganization.Disabled(false),
		userorganization.RoleIn(userorganization.RoleSUPERADMIN, userorganization.RoleADMIN),
		userorganization.HasUserWith(user.IsSuperAdmin(false), user.DeletedAtIsNil()),
	).First(ctx))
}

// GetUserOrg loads a membership with its user and its organization (members
// and subscription included), for impersonation.
func (r *Repository) GetUserOrg(ctx context.Context, id string) (*ent.UserOrganization, error) {
	return first(r.client.UserOrganization.Query().Where(userorganization.ID(id)).
		WithUser().
		WithOrganization(func(q *ent.OrganizationQuery) { q.WithUsers().WithSubscription() }).
		First(ctx))
}

// ImpersonateUserOrg is one row of getImpersonateUser's select.
type ImpersonateUserOrg struct {
	ID           string                `json:"id"`
	Role         userorganization.Role `json:"role"`
	Disabled     bool                  `json:"disabled"`
	Organization ImpersonateOrg        `json:"organization"`
	User         ImpersonateUser       `json:"user"`
}

type ImpersonateOrg struct {
	ID           string                   `json:"id"`
	Name         string                   `json:"name"`
	PaymentID    *string                  `json:"paymentId"`
	DeletedAt    *JSTime                  `json:"deletedAt"`
	Subscription *ImpersonateSubscription `json:"subscription"`
}

type ImpersonateSubscription struct {
	SubscriptionTier subscription.SubscriptionTier `json:"subscriptionTier"`
	Identifier       *string                       `json:"identifier"`
	IsLifetime       bool                          `json:"isLifetime"`
	Period           subscription.Period           `json:"period"`
	CancelAt         *JSTime                       `json:"cancelAt"`
}

type ImpersonateUser struct {
	ID           string            `json:"id"`
	Name         *string           `json:"name"`
	Email        string            `json:"email"`
	Activated    bool              `json:"activated"`
	ProviderName user.ProviderName `json:"providerName"`
	DeletedAt    *JSTime           `json:"deletedAt"`
}

func (r *Repository) GetImpersonateUser(ctx context.Context, name string) ([]ImpersonateUserOrg, error) {
	rows, err := r.client.UserOrganization.Query().Where(userorganization.Or(
		userorganization.OrganizationIDContains(name),
		userorganization.HasOrganizationWith(organization.Or(
			organization.PaymentIDEQ(name),
			organization.HasSubscriptionWith(subscription.IdentifierEQ(name)),
			organization.HasIntegrationWith(integration.ID(name)),
			organization.HasPostWith(post.ID(name)),
		)),
		userorganization.HasUserWith(user.Or(
			user.NameContainsFold(name),
			user.EmailContainsFold(name),
			predicate.User(entsql.FieldContains(user.FieldID, name)),
		)),
	)).
		WithOrganization(func(q *ent.OrganizationQuery) { q.WithSubscription() }).
		WithUser().
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ImpersonateUserOrg, 0, len(rows))
	for _, row := range rows {
		org, u := row.Edges.Organization, row.Edges.User
		item := ImpersonateUserOrg{
			ID: row.ID, Role: row.Role, Disabled: row.Disabled,
			Organization: ImpersonateOrg{ID: org.ID, Name: org.Name, PaymentID: org.PaymentID, DeletedAt: NewJSTime(org.DeletedAt)},
			User: ImpersonateUser{
				ID: u.ID, Name: u.Name, Email: u.Email, Activated: u.Activated,
				ProviderName: u.ProviderName, DeletedAt: NewJSTime(u.DeletedAt),
			},
		}
		if s := org.Edges.Subscription; s != nil {
			item.Organization.Subscription = &ImpersonateSubscription{
				SubscriptionTier: s.SubscriptionTier, Identifier: s.Identifier, IsLifetime: s.IsLifetime,
				Period: s.Period, CancelAt: NewJSTime(s.CancelAt),
			}
		}
		out = append(out, item)
	}
	return out, nil
}

func (r *Repository) UpdateAPIKey(ctx context.Context, orgID string) (*ent.Organization, error) {
	apiKey, err := helpers.FixedEncryption(ids.Secure(20))
	if err != nil {
		return nil, err
	}
	return r.client.Organization.UpdateOneID(orgID).SetAPIKey(apiKey).Save(ctx)
}

// GetOrgsByUserID returns the user's live organizations. Edges.Users holds
// only the caller's membership (disabled, role) and Edges.Subscription the
// subscription, when there is one.
func (r *Repository) GetOrgsByUserID(ctx context.Context, userID string) ([]*ent.Organization, error) {
	return r.client.Organization.Query().
		Where(organization.DeletedAtIsNil(), organization.HasUsersWith(userorganization.UserID(userID))).
		WithUsers(func(q *ent.UserOrganizationQuery) { q.Where(userorganization.UserID(userID)) }).
		WithSubscription().
		All(ctx)
}

func (r *Repository) GetOrgByID(ctx context.Context, id string) (*ent.Organization, error) {
	return first(r.client.Organization.Query().Where(organization.ID(id)).First(ctx))
}

func (r *Repository) GetOrgByIDWithSubscription(ctx context.Context, id string) (*ent.Organization, error) {
	return first(r.client.Organization.Query().Where(organization.ID(id)).WithSubscription().First(ctx))
}

// AccountOverview is getAccountOverview's result.
type AccountOverview struct {
	Organization AccountOrganization  `json:"organization"`
	Subscription *AccountSubscription `json:"subscription"`
	Owner        *AccountOwner        `json:"owner"`
	Users        AccountUsers         `json:"users"`
}

type AccountOrganization struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	CreatedAt  JSTime  `json:"createdAt"`
	DeletedAt  *JSTime `json:"deletedAt"`
	AllowTrial bool    `json:"allowTrial"`
	IsTrailing bool    `json:"isTrailing"`
}

type AccountSubscription struct {
	SubscriptionTier subscription.SubscriptionTier `json:"subscriptionTier"`
	Period           subscription.Period           `json:"period"`
	Identifier       *string                       `json:"identifier"`
	TotalChannels    int                           `json:"totalChannels"`
	IsLifetime       bool                          `json:"isLifetime"`
	CancelAt         *JSTime                       `json:"cancelAt"`
	CreatedAt        JSTime                        `json:"createdAt"`
	UpdatedAt        JSTime                        `json:"updatedAt"`
	DeletedAt        *JSTime                       `json:"deletedAt"`
}

type AccountOwner struct {
	ID           string                `json:"id"`
	Email        string                `json:"email"`
	Activated    bool                  `json:"activated"`
	ProviderName user.ProviderName     `json:"providerName"`
	LastOnline   JSTime                `json:"lastOnline"`
	CreatedAt    JSTime                `json:"createdAt"`
	Role         userorganization.Role `json:"role"`
	MemberSince  JSTime                `json:"memberSince"`
}

type AccountUsers struct {
	Total         int     `json:"total"`
	Activated     int     `json:"activated"`
	Disabled      int     `json:"disabled"`
	LastOnlineMax *JSTime `json:"lastOnlineMax"`
}

func (r *Repository) GetAccountOverview(ctx context.Context, orgID string) (*AccountOverview, error) {
	org, err := first(r.client.Organization.Query().Where(organization.ID(orgID)).WithSubscription().First(ctx))
	if err != nil || org == nil {
		return nil, err
	}
	members, err := r.client.UserOrganization.Query().Where(userorganization.OrganizationID(orgID)).
		Order(ent.Asc(userorganization.FieldCreatedAt)).WithUser().All(ctx)
	if err != nil {
		return nil, err
	}

	out := &AccountOverview{
		Organization: AccountOrganization{
			ID: org.ID, Name: org.Name, CreatedAt: JSTime{org.CreatedAt}, DeletedAt: NewJSTime(org.DeletedAt),
			AllowTrial: org.AllowTrial, IsTrailing: org.IsTrailing,
		},
		Users: AccountUsers{Total: len(members)},
	}
	if s := org.Edges.Subscription; s != nil {
		out.Subscription = &AccountSubscription{
			SubscriptionTier: s.SubscriptionTier, Period: s.Period, Identifier: s.Identifier,
			TotalChannels: s.TotalChannels, IsLifetime: s.IsLifetime, CancelAt: NewJSTime(s.CancelAt),
			CreatedAt: JSTime{s.CreatedAt}, UpdatedAt: JSTime{s.UpdatedAt}, DeletedAt: NewJSTime(s.DeletedAt),
		}
	}
	for _, m := range members {
		u := m.Edges.User
		if out.Owner == nil && m.Role == userorganization.RoleSUPERADMIN {
			out.Owner = &AccountOwner{
				ID: u.ID, Email: u.Email, Activated: u.Activated, ProviderName: u.ProviderName,
				LastOnline: JSTime{u.LastOnline}, CreatedAt: JSTime{u.CreatedAt}, Role: m.Role, MemberSince: JSTime{m.CreatedAt},
			}
		}
		if out.Users.LastOnlineMax == nil || u.LastOnline.After(out.Users.LastOnlineMax.Time) {
			out.Users.LastOnlineMax = &JSTime{u.LastOnline}
		}
		if u.Activated {
			out.Users.Activated++
		}
		if m.Disabled {
			out.Users.Disabled++
		}
	}
	return out, nil
}

func (r *Repository) GetUsersByEmail(ctx context.Context, email string) ([]*ent.User, error) {
	return r.client.User.Query().Where(user.Email(email)).All(ctx)
}

// AddUserToOrg returns nil (TS `false`) when the invite was already used or
// the organization's plan has no team members.
func (r *Repository) AddUserToOrg(ctx context.Context, userID, id, orgID string, role userorganization.Role) (*ent.UserOrganization, error) {
	exists, err := r.client.User.Query().Where(user.InviteID(id)).Exist(ctx)
	if err != nil || exists {
		return nil, err
	}

	sub, err := first(r.client.Subscription.Query().Where(subscription.OrganizationID(orgID)).First(ctx))
	if err != nil {
		return nil, err
	}
	if os.Getenv("STRIPE_PUBLISHABLE_KEY") != "" && sub != nil && sub.SubscriptionTier == subscription.SubscriptionTierSTANDARD {
		return nil, nil
	}

	created, err := r.client.UserOrganization.Create().SetRole(role).SetUserID(userID).SetOrganizationID(orgID).Save(ctx)
	if err != nil {
		return nil, err
	}
	if err := r.client.User.UpdateOneID(userID).SetInviteID(id).Exec(ctx); err != nil {
		return nil, err
	}
	return created, nil
}

// CreateOrgAndUser creates the organization, its SUPERADMIN user and the
// membership. The result's Edges.Users[0].Edges.User is the new user.
func (r *Repository) CreateOrgAndUser(ctx context.Context, body *auth.CreateOrgUserDto, hasEmail bool, ip, userAgent string) (*ent.Organization, error) {
	apiKey, err := helpers.FixedEncryption(ids.Secure(20))
	if err != nil {
		return nil, err
	}
	password := ""
	if body.Password != nil && *body.Password != "" {
		if password, err = helpers.HashPassword(*body.Password); err != nil {
			return nil, err
		}
	}
	provider := deref(body.Provider)

	var out *ent.Organization
	err = withTx(ctx, r.client, func(tx *ent.Tx) error {
		org, err := tx.Organization.Create().SetName(deref(body.Company)).SetAPIKey(apiKey).
			SetAllowTrial(true).SetIsTrailing(true).Save(ctx)
		if err != nil {
			return err
		}
		u, err := tx.User.Create().
			SetActivated(provider != string(user.ProviderNameLOCAL) || !hasEmail).
			SetEmail(deref(body.Email)).
			SetPassword(password).
			SetProviderName(user.ProviderName(provider)).
			SetProviderID(body.ProviderID).
			SetTimezone(0).
			SetIP(ip).
			SetAgent(userAgent).
			Save(ctx)
		if err != nil {
			return err
		}
		member, err := tx.UserOrganization.Create().SetRole(userorganization.RoleSUPERADMIN).
			SetUserID(u.ID).SetOrganizationID(org.ID).Save(ctx)
		if err != nil {
			return err
		}
		member.Edges.User = u
		org.Edges.Users = []*ent.UserOrganization{member}
		out = org
		return nil
	})
	return out, err
}

func (r *Repository) GetOrgByCustomerID(ctx context.Context, customerID string) (*ent.Organization, error) {
	return first(r.client.Organization.Query().Where(organization.PaymentID(customerID)).First(ctx))
}

// SetStreak starts (only when no streak is running) or ends the streak.
// Errors are swallowed like the TS try/catch.
func (r *Repository) SetStreak(ctx context.Context, organizationID, typ string) {
	update := r.client.Organization.UpdateOneID(organizationID)
	if typ == "start" {
		update = update.Where(organization.StreakSinceIsNil()).SetStreakSince(time.Now())
	}
	if typ == "end" {
		update = update.ClearStreakSince()
	}
	_ = update.Exec(ctx)
}

// GetLastPublishDate returns the newest published post's date in Unix
// milliseconds, capped at now (the streak workflow sleeps until a day after
// it), or nil.
func (r *Repository) GetLastPublishDate(ctx context.Context, organizationID string) (*int64, error) {
	p, err := first(r.client.Post.Query().
		Where(post.OrganizationID(organizationID), post.StateEQ(post.StatePUBLISHED)).
		Order(ent.Desc(post.FieldPublishDate)).
		Select(post.FieldPublishDate).
		First(ctx))
	if err != nil || p == nil {
		return nil, err
	}
	ms := min(p.PublishDate.UnixMilli(), time.Now().UnixMilli())
	return &ms, nil
}

// Team is getTeam's select. It is also the getUserOrgs activity result the
// digest and streak workflows read.
type Team struct {
	Users []TeamMember `json:"users"`
}

type TeamMember struct {
	Role     userorganization.Role `json:"role"`
	Disabled bool                  `json:"disabled"`
	User     TeamUser              `json:"user"`
}

type TeamUser struct {
	Email             string `json:"email"`
	ID                string `json:"id"`
	SendSuccessEmails bool   `json:"sendSuccessEmails"`
	SendFailureEmails bool   `json:"sendFailureEmails"`
	SendStreakEmails  bool   `json:"sendStreakEmails"`
}

// GetTeam returns nil when the organization does not exist.
func (r *Repository) GetTeam(ctx context.Context, orgID string) (*Team, error) {
	exists, err := r.client.Organization.Query().Where(organization.ID(orgID)).Exist(ctx)
	if err != nil || !exists {
		return nil, err
	}
	members, err := r.client.UserOrganization.Query().Where(userorganization.OrganizationID(orgID)).WithUser().All(ctx)
	if err != nil {
		return nil, err
	}
	team := &Team{Users: make([]TeamMember, 0, len(members))}
	for _, m := range members {
		u := m.Edges.User
		team.Users = append(team.Users, TeamMember{Role: m.Role, Disabled: m.Disabled, User: TeamUser{
			Email: u.Email, ID: u.ID, SendSuccessEmails: u.SendSuccessEmails,
			SendFailureEmails: u.SendFailureEmails, SendStreakEmails: u.SendStreakEmails,
		}})
	}
	return team, nil
}

// GetAllUsersOrgs returns the organization's members, each with Edges.User
// loaded, or nil when the organization does not exist.
func (r *Repository) GetAllUsersOrgs(ctx context.Context, orgID string) ([]*ent.UserOrganization, error) {
	exists, err := r.client.Organization.Query().Where(organization.ID(orgID)).Exist(ctx)
	if err != nil || !exists {
		return nil, err
	}
	return r.client.UserOrganization.Query().Where(userorganization.OrganizationID(orgID)).WithUser().All(ctx)
}

// DeleteOrganization soft deletes the organization.
func (r *Repository) DeleteOrganization(ctx context.Context, orgID string) (*ent.Organization, error) {
	return r.client.Organization.UpdateOneID(orgID).SetDeletedAt(time.Now()).Save(ctx)
}

// DeleteTeamMember removes the membership; it fails when there is none, like
// Prisma's delete.
func (r *Repository) DeleteTeamMember(ctx context.Context, orgID, userID string) (*ent.UserOrganization, error) {
	member, err := r.client.UserOrganization.Query().
		Where(userorganization.UserID(userID), userorganization.OrganizationID(orgID)).Only(ctx)
	if err != nil {
		return nil, err
	}
	if err := r.client.UserOrganization.DeleteOne(member).Exec(ctx); err != nil {
		return nil, err
	}
	return member, nil
}

func (r *Repository) DisableOrEnableNonSuperAdminUsers(ctx context.Context, orgID string, disable bool) (int, error) {
	return r.client.UserOrganization.Update().
		Where(userorganization.OrganizationID(orgID), userorganization.RoleNEQ(userorganization.RoleSUPERADMIN)).
		SetDisabled(disable).Save(ctx)
}

// ShortlinkPreference is getShortlinkPreference's select.
type ShortlinkPreference struct {
	Shortlink organization.Shortlink `json:"shortlink"`
}

func (r *Repository) GetShortlinkPreference(ctx context.Context, orgID string) (*ShortlinkPreference, error) {
	org, err := first(r.client.Organization.Query().Where(organization.ID(orgID)).Select(organization.FieldShortlink).First(ctx))
	if err != nil || org == nil {
		return nil, err
	}
	return &ShortlinkPreference{Shortlink: org.Shortlink}, nil
}

func (r *Repository) UpdateShortlinkPreference(ctx context.Context, orgID string, shortlink organization.Shortlink) (*ent.Organization, error) {
	return r.client.Organization.UpdateOneID(orgID).SetShortlink(shortlink).Save(ctx)
}

// first turns Prisma's findFirst/findUnique null into a nil result.
func first[T any](v *T, err error) (*T, error) {
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return v, err
}

func withTx(ctx context.Context, client *ent.Client, fn func(tx *ent.Tx) error) error {
	tx, err := client.Tx(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		if rerr := tx.Rollback(); rerr != nil {
			return fmt.Errorf("%w (rollback: %v)", err, rerr)
		}
		return err
	}
	return tx.Commit()
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
