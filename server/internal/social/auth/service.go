package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/user"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent/userorganization"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
)

// EmailService is the part of the email service AuthService uses.
type EmailService interface {
	SendEmailSync(ctx context.Context, to, subject, html string) error
}

// NewsletterService is NewsletterService.register.
type NewsletterService interface {
	Register(ctx context.Context, email string) error
}

// AuthBody holds the CreateOrgUserDto / LoginUserDto fields routeAuth reads.
type AuthBody struct {
	Email             string
	Password          string
	Provider          user.ProviderName
	ProviderToken     string
	Company           string
	DatafastVisitorID string
}

// OrgCookie is the signed `org` invite cookie (getOrgFromCookie).
type OrgCookie struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	OrgID string `json:"orgId"`
	ID    string `json:"id"`
}

// RouteAuthResult is routeAuth's { addedOrg, jwt }; AddedOrg nil is false.
type RouteAuthResult struct {
	AddedOrg *ent.UserOrganization
	JWT      string
}

// CheckExistsResult is checkExists' { jwt } or { token }.
type CheckExistsResult struct {
	JWT   string
	Token string
}

// AuthService is the auth service.
type AuthService struct {
	users      UsersService
	orgs       OrganizationService
	email      EmailService
	providers  *AuthProviderManager
	newsletter NewsletterService
}

func NewAuthService(users UsersService, orgs OrganizationService, email EmailService, providers *AuthProviderManager, newsletter NewsletterService) *AuthService {
	return &AuthService{users: users, orgs: orgs, email: email, providers: providers, newsletter: newsletter}
}

func (s *AuthService) CanRegister(ctx context.Context, provider string) (bool, error) {
	if os.Getenv("DISABLE_REGISTRATION") != "true" || provider == string(user.ProviderNameGENERIC) {
		return true, nil
	}
	count, err := s.orgs.GetCount(ctx)
	return count == 0, err
}

// RouteAuth registers (register = body is a CreateOrgUserDto) or logs in.
func (s *AuthService) RouteAuth(ctx context.Context, provider user.ProviderName, body AuthBody, register bool, ip, userAgent string, addToOrg *OrgCookie) (*RouteAuthResult, error) {
	if provider != user.ProviderNameLOCAL {
		u, err := s.loginOrRegisterProvider(ctx, provider, body, ip, userAgent)
		if err != nil {
			return nil, err
		}
		added, err := s.addToOrg(ctx, u.ID, addToOrg)
		if err != nil {
			return nil, err
		}
		token, err := s.jwt(u)
		if err != nil {
			return nil, err
		}
		return &RouteAuthResult{AddedOrg: added, JWT: token}, nil
	}

	if os.Getenv("DISALLOW_PLUS") != "" && strings.Contains(body.Email, "+") {
		return nil, errors.New("Email with plus sign is not allowed")
	}
	if register {
		body.Email = strings.ToLower(body.Email)
	}
	existing, err := s.users.GetUserByEmail(ctx, body.Email)
	if err != nil {
		return nil, err
	}

	if register {
		if existing != nil {
			return nil, errors.New("Email already exists")
		}
		ok, err := s.CanRegister(ctx, string(provider))
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errors.New("Registration is disabled")
		}
		create, err := s.orgs.CreateOrgAndUser(ctx, CreateOrgAndUserBody{
			Company:           body.Company,
			Email:             body.Email,
			Password:          body.Password,
			Provider:          body.Provider,
			DatafastVisitorID: body.DatafastVisitorID,
		}, ip, userAgent)
		if err != nil {
			return nil, err
		}
		created, err := createdUser(create)
		if err != nil {
			return nil, err
		}
		added, err := s.addToOrg(ctx, created.ID, addToOrg)
		if err != nil {
			return nil, err
		}
		token, err := s.jwt(created)
		if err != nil {
			return nil, err
		}
		if err := s.email.SendEmailSync(ctx, body.Email, "Activate your account",
			`Click <a href="`+os.Getenv("FRONTEND_URL")+`/auth/activate/`+token+`">here</a> to activate your account`); err != nil {
			return nil, err
		}
		return &RouteAuthResult{AddedOrg: added, JWT: token}, nil
	}

	password := ""
	if existing != nil && existing.Password != nil {
		password = *existing.Password
	}
	if existing == nil || !helpers.ComparePassword(body.Password, password) {
		return nil, errors.New("Invalid user name or password")
	}
	if !existing.Activated {
		return nil, errors.New("User is not activated")
	}
	token, err := s.jwt(existing)
	if err != nil {
		return nil, err
	}
	return &RouteAuthResult{JWT: token}, nil
}

func (s *AuthService) addToOrg(ctx context.Context, userID string, addToOrg *OrgCookie) (*ent.UserOrganization, error) {
	if addToOrg == nil {
		return nil, nil
	}
	return s.orgs.AddUserToOrg(ctx, userID, addToOrg.ID, addToOrg.OrgID, userorganization.Role(addToOrg.Role))
}

func createdUser(org *ent.Organization) (*ent.User, error) {
	if org == nil || len(org.Edges.Users) == 0 || org.Edges.Users[0].Edges.User == nil {
		return nil, errors.New("createOrgAndUser returned no user")
	}
	return org.Edges.Users[0].Edges.User, nil
}

// GetOrgFromCookie returns the invite in the `org` cookie, or nil when it is
// missing, invalid, or has no valid timeLimit or a past one.
func (s *AuthService) GetOrgFromCookie(cookie string) *OrgCookie {
	if cookie == "" {
		return nil
	}
	claims, err := helpers.VerifyJWT(cookie)
	if err != nil {
		return nil
	}
	if !notExpired(claims["timeLimit"]) {
		return nil
	}
	data, err := json.Marshal(claims)
	if err != nil {
		return nil
	}
	org := &OrgCookie{}
	if err := json.Unmarshal(data, org); err != nil {
		return nil
	}
	return org
}

func (s *AuthService) loginOrRegisterProvider(ctx context.Context, provider user.ProviderName, body AuthBody, ip, userAgent string) (*ent.User, error) {
	instance, err := s.providers.GetProvider(string(provider))
	if err != nil {
		return nil, err
	}
	providerUser, err := instance.GetUser(ctx, body.ProviderToken)
	if err != nil {
		return nil, err
	}
	if providerUser == nil {
		return nil, errors.New("Invalid provider token")
	}

	existing, err := s.users.GetUserByProvider(ctx, providerUser.ID, provider)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}

	ok, err := s.CanRegister(ctx, string(provider))
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errors.New("Registration is disabled")
	}

	create, err := s.orgs.CreateOrgAndUser(ctx, CreateOrgAndUserBody{
		Company:           body.Company,
		Email:             providerUser.Email,
		Password:          "",
		Provider:          provider,
		ProviderID:        providerUser.ID,
		DatafastVisitorID: body.DatafastVisitorID,
	}, ip, userAgent)
	if err != nil {
		return nil, err
	}

	go s.track(context.WithoutCancel(ctx), "register", providerUser.Email, body.DatafastVisitorID)

	if err := s.newsletter.Register(ctx, providerUser.Email); err != nil {
		return nil, err
	}
	return createdUser(create)
}

var datafastURL = "https://datafa.st/api/v1/goals"

// track reports a DataFast goal; failures are ignored like the original app's catch.
func (s *AuthService) track(ctx context.Context, name, email, datafastVisitorID string) {
	if email == "" || datafastVisitorID == "" || os.Getenv("DATAFAST_API_KEY") == "" {
		return
	}
	body, _ := json.Marshal(map[string]any{
		"datafast_visitor_id": datafastVisitorID,
		"name":                name,
		"metadata":            map[string]any{"email": email},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, datafastURL, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("DATAFAST_API_KEY"))
	req.Header.Set("Content-Type", "application/json")
	if res, err := http.DefaultClient.Do(req); err == nil {
		res.Body.Close()
	}
}

// Forgot emails a 20 minute password reset link to a local user.
func (s *AuthService) Forgot(ctx context.Context, email string) error {
	u, err := s.users.GetUserByEmail(ctx, email)
	if err != nil {
		return err
	}
	if u == nil || u.ProviderName != user.ProviderNameLOCAL {
		return nil
	}
	resetValues, err := helpers.SignJWT(map[string]any{
		"id":      u.ID,
		"expires": time.Now().UTC().Add(20 * time.Minute).Format(time.DateTime),
	})
	if err != nil {
		return err
	}
	return s.email.SendEmailSync(ctx, u.Email, "Reset your password",
		`You have requested to reset your password. <br />Click <a href="`+os.Getenv("FRONTEND_URL")+`/auth/forgot/`+resetValues+`">here</a> to reset your password<br />The link will expire in 20 minutes`)
}

// ForgotReturn sets the new password when the reset token is still valid: it
// must carry a valid `expires` that is not past. An invalid token is an error
// (the original app lets verifyJWT throw).
func (s *AuthService) ForgotReturn(ctx context.Context, token, password string) (bool, error) {
	claims, err := helpers.VerifyJWT(token)
	if err != nil {
		return false, err
	}
	if !notExpired(claims["expires"]) {
		return false, nil
	}
	id, _ := claims["id"].(string)
	updated, err := s.users.UpdatePassword(ctx, id, password)
	if err != nil {
		return false, err
	}
	return updated != nil, nil
}

// Activate activates the account in the activation code and returns a fresh
// auth JWT, or "" when there is nothing to activate.
func (s *AuthService) Activate(ctx context.Context, code, tracking string) (string, error) {
	claims, err := helpers.VerifyJWT(code)
	if err != nil {
		return "", err
	}
	id, _ := claims["id"].(string)
	activated, _ := claims["activated"].(bool)
	if id == "" || activated {
		return "", nil
	}
	email, _ := claims["email"].(string)
	again, err := s.users.GetUserByEmail(ctx, email)
	if err != nil {
		return "", err
	}
	if again == nil {
		return "", errors.New("Cannot read properties of null (reading 'activated')")
	}
	if again.Activated {
		return "", nil
	}
	if _, err := s.users.ActivateUser(ctx, id); err != nil {
		return "", err
	}
	claims["activated"] = true
	go s.track(context.WithoutCancel(ctx), "register", email, tracking)
	if err := s.newsletter.Register(ctx, email); err != nil {
		return "", err
	}
	return signUserClaims(claims)
}

func (s *AuthService) ResendActivationEmail(ctx context.Context, email string) (bool, error) {
	u, err := s.users.GetUserByEmail(ctx, email)
	if err != nil {
		return false, err
	}
	if u == nil {
		return false, errors.New("User not found")
	}
	if u.Activated {
		return false, errors.New("Account is already activated")
	}
	token, err := s.jwt(u)
	if err != nil {
		return false, err
	}
	if err := s.email.SendEmailSync(ctx, u.Email, "Activate your account",
		`Click <a href="`+os.Getenv("FRONTEND_URL")+`/auth/activate/`+token+`">here</a> to activate your account`); err != nil {
		return false, err
	}
	return true, nil
}

func (s *AuthService) OAuthLink(ctx context.Context, provider string, query map[string]string) (string, error) {
	instance, err := s.providers.GetProvider(provider)
	if err != nil {
		return "", err
	}
	return instance.GenerateLink(ctx, query)
}

// CheckExists exchanges the OAuth code; existing users get a JWT, new ones
// get the provider token to finish registration with.
func (s *AuthService) CheckExists(ctx context.Context, provider, code, redirectURI, state, stateCookie string) (*CheckExistsResult, error) {
	// the mobile app passes redirect_uri and keeps no cookies, the web flow
	// never passes it, so the state nonce is only enforced for the web flow
	if os.Getenv("NOT_SECURED") == "" && redirectURI == "" && (state == "" || state != stateCookie) {
		return nil, errors.New("Invalid state")
	}

	instance, err := s.providers.GetProvider(provider)
	if err != nil {
		return nil, err
	}
	token, err := instance.GetToken(ctx, code, redirectURI)
	if err != nil {
		return nil, err
	}
	providerUser, err := instance.GetUser(ctx, token)
	if err != nil {
		return nil, err
	}
	if providerUser == nil {
		return nil, errors.New("Invalid user")
	}
	existing, err := s.users.GetUserByProvider(ctx, providerUser.ID, user.ProviderName(provider))
	if err != nil {
		return nil, err
	}
	if existing != nil {
		jwt, err := s.jwt(existing)
		if err != nil {
			return nil, err
		}
		return &CheckExistsResult{JWT: jwt}, nil
	}
	return &CheckExistsResult{Token: token}, nil
}

// jwt signs the user row as Prisma serializes it, without the password.
func (s *AuthService) jwt(u *ent.User) (string, error) {
	data, err := json.Marshal(u)
	if err != nil {
		return "", err
	}
	claims := map[string]any{}
	if err := json.Unmarshal(data, &claims); err != nil {
		return "", err
	}
	return signUserClaims(claims)
}

// signUserClaims never signs a `password` key. (the original app only deleted a truthy
// password, so provider users' JWTs carried `password: ""`.)
func signUserClaims(claims map[string]any) (string, error) {
	delete(claims, "password")
	return helpers.SignJWT(claims)
}

// dayjsFormat is dayjs's REGEX_PARSE for strings without a Z/offset (parsed
// as local time, which is UTC in the original app).
var dayjsFormat = regexp.MustCompile(`^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$`)

// notExpired reports whether a JWT date claim is present, valid and not in
// the past. (the original app read a missing claim as "now" and an invalid one as an
// Invalid Date that compares false, so both passed its expiry checks.)
func notExpired(claim any) bool {
	t, ok := dayjs(claim)
	return ok && !t.Before(time.Now())
}

// dayjs parses a JWT date claim like dayjs(value). ok is false for a missing
// or invalid date.
func dayjs(value any) (time.Time, bool) {
	switch v := value.(type) {
	case float64:
		return time.UnixMilli(int64(v)).UTC(), true
	case string:
		if m := dayjsFormat.FindStringSubmatch(v); m != nil {
			n := func(i, def int) int {
				if m[i] == "" {
					return def
				}
				x, _ := strconv.Atoi(m[i])
				return x
			}
			ms := 0
			if m[7] != "" {
				ms, _ = strconv.Atoi((m[7] + "00")[:3])
			}
			return time.Date(n(1, 0), time.Month(n(2, 1)), n(3, 1), n(4, 0), n(5, 0), n(6, 0), ms*int(time.Millisecond), time.UTC), true
		}
		for _, layout := range []string{time.RFC3339Nano, time.RFC1123, time.RFC1123Z} {
			if t, err := time.Parse(layout, v); err == nil {
				return t, true
			}
		}
	}
	return time.Time{}, false
}
