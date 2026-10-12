// Package users ports database/prisma/users: the UsersRepository and
// UsersService.
package users

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/media"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/organization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/predicate"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/subscription"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/ent/userorganization"
	dtousers "github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/dtos/users"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/helpers"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/screenshot-studio-backend/internal/ids"
)

type Repository struct {
	client *ent.Client
}

func NewRepository(client *ent.Client) *Repository { return &Repository{client: client} }

// AccountLogin is a {id, email} pair of switchUserCredentials' result.
type AccountLogin struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

// SwitchResult: Kept is the current account now holding the target's login,
// Switched the target account now holding the current login.
type SwitchResult struct {
	Kept     AccountLogin `json:"kept"`
	Switched AccountLogin `json:"switched"`
}

type credentials struct {
	email            string
	password         *string
	providerName     user.ProviderName
	providerID       *string
	account          *string
	connectedAccount bool
	activated        bool
}

func credentialsOf(u *ent.User) credentials {
	return credentials{u.Email, u.Password, u.ProviderName, u.ProviderID, u.Account, u.ConnectedAccount, u.Activated}
}

// set writes the credentials, clearing what Prisma would set to null.
func (c credentials) set(update *ent.UserUpdateOne) *ent.UserUpdateOne {
	update.SetEmail(c.email).SetProviderName(c.providerName).
		SetConnectedAccount(c.connectedAccount).SetActivated(c.activated)
	if c.password != nil {
		update.SetPassword(*c.password)
	} else {
		update.ClearPassword()
	}
	if c.providerID != nil {
		update.SetProviderID(*c.providerID)
	} else {
		update.ClearProviderID()
	}
	if c.account != nil {
		update.SetAccount(*c.account)
	} else {
		update.ClearAccount()
	}
	return update
}

// SwitchUserCredentials swaps the login credentials of two users.
func (r *Repository) SwitchUserCredentials(ctx context.Context, currentUserID, targetUserID string) (*SwitchResult, error) {
	current, err := first(r.client.User.Get(ctx, currentUserID))
	if err != nil {
		return nil, err
	}
	target, err := first(r.client.User.Get(ctx, targetUserID))
	if err != nil {
		return nil, err
	}
	if current == nil || target == nil {
		return nil, errors.New("User not found")
	}
	currentCredentials, targetCredentials := credentialsOf(current), credentialsOf(target)

	// (email, providerName) is unique and checked per-statement, so park the
	// current user on a throwaway email first, then fill each freed slot
	err = withTx(ctx, r.client, func(tx *ent.Tx) error {
		if err := tx.User.UpdateOneID(current.ID).SetEmail(fmt.Sprintf("switch-%s-%s", ids.Make(10), current.Email)).Exec(ctx); err != nil {
			return err
		}
		if err := currentCredentials.set(tx.User.UpdateOneID(target.ID)).Exec(ctx); err != nil {
			return err
		}
		return targetCredentials.set(tx.User.UpdateOneID(current.ID)).Exec(ctx)
	})
	if err != nil {
		return nil, err
	}

	return &SwitchResult{
		Kept:     AccountLogin{ID: current.ID, Email: targetCredentials.email},
		Switched: AccountLogin{ID: target.ID, Email: currentCredentials.email},
	}, nil
}

// ImpersonateUser is getImpersonateUser's select.
type ImpersonateUser struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Email string  `json:"email"`
}

func (r *Repository) GetImpersonateUser(ctx context.Context, name string) ([]ImpersonateUser, error) {
	rows, err := r.client.User.Query().Where(
		user.DeletedAtIsNil(),
		user.Or(user.NameContains(name), user.EmailContains(name), predicate.User(entsql.FieldContains(user.FieldID, name))),
	).Limit(10).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ImpersonateUser, 0, len(rows))
	for _, u := range rows {
		out = append(out, ImpersonateUser{ID: u.ID, Name: u.Name, Email: u.Email})
	}
	return out, nil
}

func (r *Repository) GetUserByID(ctx context.Context, id string) (*ent.User, error) {
	return first(r.client.User.Query().Where(user.ID(id), user.DeletedAtIsNil()).First(ctx))
}

// GetUserByEmail finds the live LOCAL user by email (case insensitive), with
// Edges.Picture loaded.
func (r *Repository) GetUserByEmail(ctx context.Context, email string) (*ent.User, error) {
	return first(r.client.User.Query().Where(
		user.EmailEqualFold(email),
		user.ProviderNameEQ(user.ProviderNameLOCAL),
		user.DeletedAtIsNil(),
	).WithPicture().First(ctx))
}

// UserProvider is getUserWithActiveSubscriptionByEmail's select.
type UserProvider struct {
	ID           string            `json:"id"`
	Email        string            `json:"email"`
	ProviderName user.ProviderName `json:"providerName"`
}

// GetUserWithActiveSubscriptionByEmail finds another live user with this
// email who owns an organization with a live subscription.
func (r *Repository) GetUserWithActiveSubscriptionByEmail(ctx context.Context, email, excludeUserID string) (*UserProvider, error) {
	u, err := first(r.client.User.Query().Where(
		user.Email(email),
		user.IDNEQ(excludeUserID),
		user.DeletedAtIsNil(),
		user.HasOrganizationsWith(
			userorganization.RoleEQ(userorganization.RoleSUPERADMIN),
			userorganization.HasOrganizationWith(organization.HasSubscriptionWith(subscription.DeletedAtIsNil())),
		),
	).First(ctx))
	if err != nil || u == nil {
		return nil, err
	}
	return &UserProvider{ID: u.ID, Email: u.Email, ProviderName: u.ProviderName}, nil
}

func (r *Repository) ActivateUser(ctx context.Context, id string) (*ent.User, error) {
	return r.client.User.UpdateOneID(id).SetActivated(true).Save(ctx)
}

func (r *Repository) GetUserByProvider(ctx context.Context, providerID string, provider user.ProviderName) (*ent.User, error) {
	return first(r.client.User.Query().Where(
		user.ProviderID(providerID), user.ProviderNameEQ(provider), user.DeletedAtIsNil(),
	).First(ctx))
}

func md5Hex(value string) string {
	sum := md5.Sum([]byte(value))
	return hex.EncodeToString(sum[:])
}

func hashOptional(value *string) *string {
	if value == nil || *value == "" {
		return nil
	}
	h := md5Hex(*value)
	return &h
}

// DeleteAccount anonymizes the user: the identifying fields are hashed
// instead of removing the row, the random suffix keeps [email, providerName]
// unique if the same email is deleted more than once. It returns nil when
// the user is missing or already deleted.
func (r *Repository) DeleteAccount(ctx context.Context, userID string) (*ent.User, error) {
	u, err := first(r.client.User.Get(ctx, userID))
	if err != nil || u == nil || u.DeletedAt != nil {
		return nil, err
	}
	update := r.client.User.UpdateOneID(userID).
		SetEmail(fmt.Sprintf("deleted_%s_%s", md5Hex(strings.ToLower(u.Email)), ids.Make(5))).
		ClearPassword().
		ClearBio().
		ClearIP().
		ClearAgent().
		ClearAccount().
		ClearPictureID().
		SetDeletedAt(time.Now())
	if h := hashOptional(u.Name); h != nil {
		update.SetName(*h)
	} else {
		update.ClearName()
	}
	if h := hashOptional(u.LastName); h != nil {
		update.SetLastName(*h)
	} else {
		update.ClearLastName()
	}
	if h := hashOptional(u.ProviderID); h != nil {
		update.SetProviderID(*h)
	} else {
		update.ClearProviderID()
	}
	return update.Save(ctx)
}

// UpdatePassword only applies to LOCAL users; otherwise it fails like
// Prisma's update.
func (r *Repository) UpdatePassword(ctx context.Context, id, password string) (*ent.User, error) {
	hash, err := helpers.HashPassword(password)
	if err != nil {
		return nil, err
	}
	return r.client.User.UpdateOneID(id).Where(user.ProviderNameEQ(user.ProviderNameLOCAL)).SetPassword(hash).Save(ctx)
}

func (r *Repository) ChangeAudienceSize(ctx context.Context, userID string, audience int) (*ent.User, error) {
	return r.client.User.UpdateOneID(userID).SetAudience(audience).Save(ctx)
}

// Personal is getPersonal's select.
type Personal struct {
	ID      string   `json:"id"`
	Name    *string  `json:"name"`
	Bio     *string  `json:"bio"`
	Picture *Picture `json:"picture"`
}

type Picture struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

func (r *Repository) GetPersonal(ctx context.Context, userID string) (*Personal, error) {
	u, err := first(r.client.User.Query().Where(user.ID(userID)).
		WithPicture(func(q *ent.MediaQuery) { q.Select(media.FieldID, media.FieldPath) }).First(ctx))
	if err != nil || u == nil {
		return nil, err
	}
	out := &Personal{ID: u.ID, Name: u.Name, Bio: u.Bio}
	if p := u.Edges.Picture; p != nil {
		out.Picture = &Picture{ID: p.ID, Path: p.Path}
	}
	return out, nil
}

// ChangePersonal updates name, bio (when sent) and the picture (connected
// when sent, disconnected otherwise).
func (r *Repository) ChangePersonal(ctx context.Context, userID string, body *dtousers.UserDetailDto) error {
	update := r.client.User.UpdateOneID(userID).SetName(body.Fullname).SetNillableBio(body.Bio)
	if body.Picture != nil && body.Picture.ID != nil {
		update.SetPictureID(*body.Picture.ID)
	} else {
		update.ClearPicture()
	}
	return update.Exec(ctx)
}

// EmailNotifications is getEmailNotifications' select.
type EmailNotifications struct {
	SendSuccessEmails bool `json:"sendSuccessEmails"`
	SendFailureEmails bool `json:"sendFailureEmails"`
	SendStreakEmails  bool `json:"sendStreakEmails"`
}

func (r *Repository) GetEmailNotifications(ctx context.Context, userID string) (*EmailNotifications, error) {
	u, err := first(r.client.User.Query().Where(user.ID(userID)).
		Select(user.FieldSendSuccessEmails, user.FieldSendFailureEmails, user.FieldSendStreakEmails).First(ctx))
	if err != nil || u == nil {
		return nil, err
	}
	return &EmailNotifications{SendSuccessEmails: u.SendSuccessEmails, SendFailureEmails: u.SendFailureEmails, SendStreakEmails: u.SendStreakEmails}, nil
}

// UpdateEmailNotifications sets the preferences that were sent.
func (r *Repository) UpdateEmailNotifications(ctx context.Context, userID string, body *dtousers.EmailNotificationsDto) error {
	return r.client.User.UpdateOneID(userID).
		SetNillableSendSuccessEmails(body.SendSuccessEmails).
		SetNillableSendFailureEmails(body.SendFailureEmails).
		SetNillableSendStreakEmails(body.SendStreakEmails).
		Exec(ctx)
}

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
