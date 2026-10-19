package notifications

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

var slackScopes = []string{"chat:write", "channels:read", "groups:read", "files:write", "channels:join"}
var slackID = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,64}$`)

type SlackConnection struct {
	ID       string   `json:"id"`
	TeamID   string   `json:"teamId"`
	TeamName string   `json:"teamName"`
	AppID    string   `json:"appId"`
	Health   string   `json:"health"`
	Scopes   []string `json:"scopes"`
}
type SlackChannel struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	IsPrivate  bool   `json:"isPrivate"`
	IsMember   bool   `json:"isMember"`
	IsArchived bool   `json:"isArchived"`
}
type SlackChannels struct {
	Channels   []SlackChannel `json:"channels"`
	NextCursor string         `json:"nextCursor"`
}
type slackCredentials struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken,omitempty"`
}
type slackGrant struct {
	OK           bool                      `json:"ok"`
	Error        string                    `json:"error"`
	AppID        string                    `json:"app_id"`
	AccessToken  string                    `json:"access_token"`
	RefreshToken string                    `json:"refresh_token"`
	ExpiresIn    int                       `json:"expires_in"`
	Scope        string                    `json:"scope"`
	Team         struct{ ID, Name string } `json:"team"`
	Enterprise   *struct{ ID string }      `json:"enterprise"`
}
type slackError struct {
	Code       string
	Uncertain  bool
	RetryAfter time.Duration
}

func (e *slackError) Error() string             { return "Slack: " + e.Code }
func (e *slackError) MayHaveBeenAccepted() bool { return e.Uncertain }
func (s *Service) slackConfigured() bool {
	_, err := encryptionKey("PLATFORM_NOTIFICATION_ENCRYPTION_KEY")
	return err == nil && os.Getenv("SLACK_CLIENT_ID") != "" && os.Getenv("SLACK_CLIENT_SECRET") != "" && s.slackCallback() != ""
}
func (s *Service) slackCallback() string {
	callback := os.Getenv("PLATFORM_SLACK_CALLBACK_URL")
	if callback == "" {
		callback = appURL("/api/integrations/slack/callback")
	}
	u, err := url.Parse(callback)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1") {
		return ""
	}
	return u.String()
}
func (s *Service) Connections(ctx context.Context, org string) ([]SlackConnection, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT c.id,i.team_id,i.team_name,i.app_id,i.health,i.scopes FROM platform_slack_connection c JOIN platform_slack_installation i ON i.id=c.installation_id WHERE c."organizationId"=$1 ORDER BY c.created_at`, org)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []SlackConnection{}
	for rows.Next() {
		var c SlackConnection
		var raw []byte
		if err = rows.Scan(&c.ID, &c.TeamID, &c.TeamName, &c.AppID, &c.Health, &raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &c.Scopes); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}
func (s *Service) Connect(ctx context.Context, p Principal, purpose string, reconnect ...string) (string, error) {
	if err := s.Authorize(ctx, p, true); err != nil {
		return "", err
	}
	if purpose != "notifications" && purpose != "design" && purpose != "publishing" {
		return "", ErrInvalid
	}
	if !s.slackConfigured() {
		return "", ErrUnavailable
	}
	connectionID := ""
	if len(reconnect) > 0 && reconnect[0] != "" {
		connectionID = reconnect[0]
		var exists bool
		if err := s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM platform_slack_connection WHERE id=$1 AND "organizationId"=$2)`, connectionID, p.OrganizationID).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return "", publishing.ErrNotFound
		}
	}
	intent, _ := json.Marshal(slackIntent{Purpose: purpose, ConnectionID: connectionID})
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	state := base64.RawURLEncoding.EncodeToString(random)
	_, err := s.DB.ExecContext(ctx, `INSERT INTO social_oauth_start(state,"organizationId","userId","sessionId",provider,"secretReference","expiresAt","createdAt") VALUES($1,$2,$3,$4,'platform-slack',$5,now()+interval '10 minutes',now())`, state, p.OrganizationID, p.UserID, p.SessionID, string(intent))
	if err != nil {
		return "", err
	}
	query := url.Values{"client_id": {os.Getenv("SLACK_CLIENT_ID")}, "scope": {strings.Join(slackScopesFor(purpose), ",")}, "state": {state}, "redirect_uri": {s.slackCallback()}}
	return strings.TrimRight(s.SlackBase, "/") + "/oauth/v2/authorize?" + query.Encode(), nil
}
func (s *Service) Callback(ctx context.Context, p Principal, state, code string) (*SlackConnection, error) {
	if err := s.Authorize(ctx, p, true); err != nil {
		return nil, err
	}
	if len(state) != 43 || code == "" || len(code) > 4096 {
		return nil, ErrInvalid
	}
	if !s.slackConfigured() {
		return nil, ErrUnavailable
	}
	var encodedIntent string
	err := s.DB.QueryRowContext(ctx, `DELETE FROM social_oauth_start WHERE state=$1 AND "organizationId"=$2 AND "userId"=$3 AND "sessionId"=$4 AND provider='platform-slack' AND "expiresAt">now() RETURNING "secretReference"`, state, p.OrganizationID, p.UserID, p.SessionID).Scan(&encodedIntent)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, invalid("authorization state expired or already used")
	}
	if err != nil {
		return nil, err
	}
	intent := slackIntent{Purpose: encodedIntent}
	if strings.HasPrefix(encodedIntent, "{") {
		if json.Unmarshal([]byte(encodedIntent), &intent) != nil {
			return nil, ErrInvalid
		}
	}
	purpose := intent.Purpose
	if purpose != "notifications" && purpose != "design" && purpose != "publishing" {
		return nil, ErrInvalid
	}
	grant, err := s.oauth(ctx, url.Values{"code": {code}, "redirect_uri": {s.slackCallback()}})
	if err != nil {
		return nil, err
	}
	if grant.AppID == "" || grant.Team.ID == "" || grant.AccessToken == "" {
		return nil, &slackError{Code: "invalid_installation_identity", Uncertain: true}
	}
	scopes := strings.Split(grant.Scope, ",")
	for _, scope := range slackScopesFor(purpose) {
		if !slices.Contains(scopes, scope) {
			return nil, &slackError{Code: "missing_scope"}
		}
	}
	// Permission and active workspace may have changed while the provider was responding.
	if err = s.Authorize(ctx, p, true); err != nil {
		return nil, err
	}
	return s.saveInstallation(ctx, p, grant, intent.ConnectionID, false, purpose == "publishing")
}
func (s *Service) oauth(ctx context.Context, values url.Values) (*slackGrant, error) {
	values.Set("client_id", os.Getenv("SLACK_CLIENT_ID"))
	values.Set("client_secret", os.Getenv("SLACK_CLIENT_SECRET"))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.SlackBase, "/")+"/api/oauth.v2.access", strings.NewReader(values.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := s.HTTP.Do(req)
	if err != nil {
		return nil, &slackError{Code: "oauth_transport_uncertain", Uncertain: true}
	}
	defer response.Body.Close()
	if response.StatusCode == 429 {
		return nil, &slackError{Code: "ratelimited", RetryAfter: retryAfter(response.Header.Get("Retry-After"))}
	}
	if response.StatusCode >= 500 {
		return nil, &slackError{Code: "oauth_server_uncertain", Uncertain: true}
	}
	var grant slackGrant
	if json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&grant) != nil {
		return nil, &slackError{Code: "invalid_oauth_response", Uncertain: true}
	}
	if !grant.OK {
		return nil, &slackError{Code: safeSlackCode(grant.Error)}
	}
	if response.StatusCode != 200 || grant.AccessToken == "" {
		return nil, &slackError{Code: "invalid_oauth_response", Uncertain: true}
	}
	if grant.ExpiresIn > 0 && grant.RefreshToken == "" {
		return nil, &slackError{Code: "missing_refresh_token", Uncertain: true}
	}
	return &grant, nil
}
func (s *Service) saveInstallation(ctx context.Context, p Principal, g *slackGrant, existingID string, options ...bool) (*SlackConnection, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	connection, err := s.saveInstallationTx(ctx, tx, p, g, existingID, options...)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return connection, nil
}
func (s *Service) saveInstallationTx(ctx context.Context, tx *sql.Tx, p Principal, g *slackGrant, existingID string, options ...bool) (*SlackConnection, error) {
	if !(len(options) > 0 && options[0]) {
		if err := lockSessionMember(ctx, tx, p, true); err != nil {
			return nil, err
		}
	}
	credentials, err := json.Marshal(slackCredentials{g.AccessToken, g.RefreshToken})
	if err != nil {
		return nil, err
	}
	encrypted, err := seal(credentials)
	if err != nil {
		return nil, err
	}
	enterprise := ""
	if g.Enterprise != nil {
		enterprise = g.Enterprise.ID
	}
	scopes := strings.Split(g.Scope, ",")
	raw, _ := json.Marshal(scopes)
	var expires any
	if g.ExpiresIn > 0 {
		expires = time.Now().Add(time.Duration(g.ExpiresIn) * time.Second)
	}
	var installationID string
	err = tx.QueryRowContext(ctx, `INSERT INTO platform_slack_installation(id,app_id,team_id,enterprise_id,team_name,encrypted_credentials,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(app_id,team_id,enterprise_id) DO UPDATE SET team_name=EXCLUDED.team_name,encrypted_credentials=EXCLUDED.encrypted_credentials,scopes=EXCLUDED.scopes,expires_at=EXCLUDED.expires_at,health='CONNECTED',refresh_claim='',refresh_started_at=NULL,updated_at=now() RETURNING id`, cuid.New(), g.AppID, g.Team.ID, enterprise, g.Team.Name, encrypted, raw, expires).Scan(&installationID)
	if err != nil {
		return nil, err
	}
	historical, publish := len(options) > 0 && options[0], len(options) > 1 && options[1]
	connectionID := existingID
	legacySocial := ""
	if existingID != "" && !historical {
		var oldTeam string
		err = tx.QueryRowContext(ctx, `SELECT i.team_id,c.legacy_social_id FROM platform_slack_connection c JOIN platform_slack_installation i ON i.id=c.installation_id WHERE c.id=$1 AND c."organizationId"=$2 FOR UPDATE OF c`, existingID, p.OrganizationID).Scan(&oldTeam, &legacySocial)
		if err != nil {
			return nil, err
		}
		if oldTeam != g.Team.ID {
			return nil, invalid("reconnect the same Slack workspace")
		}
		publish = publish || legacySocial != ""
	}
	if connectionID == "" {
		err = tx.QueryRowContext(ctx, `SELECT id,legacy_social_id FROM platform_slack_connection WHERE "organizationId"=$1 AND installation_id=$2`, p.OrganizationID, installationID).Scan(&connectionID, &legacySocial)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if connectionID == "" {
			connectionID = cuid.New()
		}
	}
	if publish {
		legacySocial, err = attachSlackPublishing(ctx, tx, p.OrganizationID, legacySocial, g.Team.ID, g.Team.Name)
		if err != nil {
			return nil, err
		}
	} else {
		err = tx.QueryRowContext(ctx, `INSERT INTO integration_connection(id,"organizationId",provider,"externalId","displayName","encryptedCredentials",scopes,"tokenExpiresAt","createdByUserId","createdAt","updatedAt") VALUES($1,$2,'SLACK',$3,$4,'backend-owned',$5,$6,NULLIF($7,''),now(),now()) ON CONFLICT("organizationId",provider,"externalId") DO UPDATE SET "displayName"=EXCLUDED."displayName","encryptedCredentials"='backend-owned',scopes=EXCLUDED.scopes,"tokenExpiresAt"=EXCLUDED."tokenExpiresAt","updatedAt"=now() RETURNING id`, connectionID, p.OrganizationID, g.Team.ID, g.Team.Name, raw, expires, p.UserID).Scan(&connectionID)
		if err != nil {
			return nil, err
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO platform_slack_connection(id,"organizationId",installation_id,legacy_social_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET installation_id=EXCLUDED.installation_id,legacy_social_id=EXCLUDED.legacy_social_id`, connectionID, p.OrganizationID, installationID, legacySocial)
	if err != nil {
		return nil, err
	}
	if err = audit(ctx, tx, p, "notification.slack_connected", connectionID); err != nil {
		return nil, err
	}
	if !historical {
		if err = emitSQL(ctx, tx, p.OrganizationID, "integration.connected", "integration_connection", connectionID, p.UserID, map[string]any{"ownerUserId": p.UserID}); err != nil {
			return nil, err
		}
	}
	return &SlackConnection{connectionID, g.Team.ID, g.Team.Name, g.AppID, "CONNECTED", scopes}, nil
}
func (s *Service) Disconnect(ctx context.Context, p Principal, id string) error {
	if err := s.Authorize(ctx, p, true); err != nil {
		return err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = lockSessionMember(ctx, tx, p, true); err != nil {
		return err
	}
	var installation, legacySocial string
	err = tx.QueryRowContext(ctx, `DELETE FROM platform_slack_connection WHERE id=$1 AND "organizationId"=$2 RETURNING installation_id,legacy_social_id`, id, p.OrganizationID).Scan(&installation, &legacySocial)
	if errors.Is(err, sql.ErrNoRows) {
		var legacy string
		err = tx.QueryRowContext(ctx, `SELECT id FROM integration_connection WHERE id=$1 AND "organizationId"=$2 AND provider='SLACK' FOR UPDATE`, id, p.OrganizationID).Scan(&legacy)
		if errors.Is(err, sql.ErrNoRows) {
			return publishing.ErrNotFound
		}
	}
	if err != nil {
		return err
	}
	if legacySocial != "" {
		if _, err = tx.ExecContext(ctx, `UPDATE "Integration" SET disabled=true,token='backend-owned',"refreshToken"=NULL WHERE id=$1 AND "organizationId"=(SELECT "goOrganizationId" FROM social_tenant_binding WHERE "organizationId"=$2)`, legacySocial, p.OrganizationID); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM integration_connection WHERE id=$1 AND "organizationId"=$2 AND provider='SLACK'`, id, p.OrganizationID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE platform_notification_policy SET slack_connection_id='',slack_channel_id='',slack_channel_name='',generation=generation+1,updated_at=now() WHERE "organizationId"=$1 AND slack_connection_id=$2`, p.OrganizationID, id)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE platform_notification_delivery SET status=CASE WHEN status='CLAIMED' AND send_started_at IS NOT NULL THEN 'UNCERTAIN' ELSE 'SKIPPED' END,failure_code='DISCONNECTED',encrypted_payload='',claim_token='',updated_at=now() WHERE "organizationId"=$1 AND connection_id=$2 AND status IN ('PENDING','BLOCKED','CLAIMED')`, p.OrganizationID, id)
	if err != nil {
		return err
	}
	// An installation can serve several platform workspaces; disconnect is local, never auth.revoke.
	_, err = tx.ExecContext(ctx, `DELETE FROM platform_slack_installation i WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM platform_slack_connection c WHERE c.installation_id=i.id)`, installation)
	if err != nil {
		return err
	}
	if err = audit(ctx, tx, p, "notification.slack_disconnected", id); err != nil {
		return err
	}
	if err = emitSQL(ctx, tx, p.OrganizationID, "integration.disconnected", "integration_connection", id, p.UserID, nil); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) Token(ctx context.Context, org, connectionID string) (string, error) {
	var id, encrypted, health string
	var expires sql.NullTime
	err := s.DB.QueryRowContext(ctx, `SELECT i.id,i.encrypted_credentials,i.health,i.expires_at FROM platform_slack_connection c JOIN platform_slack_installation i ON i.id=c.installation_id WHERE c.id=$1 AND c."organizationId"=$2`, connectionID, org).Scan(&id, &encrypted, &health, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		if err = s.importLegacy(ctx, org, connectionID); err != nil {
			return "", err
		}
		return s.Token(ctx, org, connectionID)
	}
	if err != nil {
		return "", err
	}
	if health != "CONNECTED" {
		return "", &slackError{Code: "reconnect_required"}
	}
	clear, err := unseal(encrypted)
	if err != nil {
		return "", ErrUnavailable
	}
	var credentials slackCredentials
	if json.Unmarshal(clear, &credentials) != nil || credentials.AccessToken == "" {
		return "", ErrUnavailable
	}
	if !expires.Valid || time.Until(expires.Time) > 2*time.Minute {
		return credentials.AccessToken, nil
	}
	if credentials.RefreshToken == "" {
		if err = s.revoke(ctx, org, connectionID); err != nil {
			return "", err
		}
		return "", &slackError{Code: "reconnect_required"}
	}
	claim := cuid.New()
	res, err := s.DB.ExecContext(ctx, `UPDATE platform_slack_installation SET refresh_claim=$2,refresh_started_at=now() WHERE id=$1 AND health='CONNECTED' AND refresh_claim='' AND encrypted_credentials=$3`, id, claim, encrypted)
	if err != nil {
		return "", err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return "", err
	}
	if n != 1 {
		// Stale ownership is not retried: rotating refresh tokens may already have been consumed.
		err = s.failRefresh(ctx, id, "", "REFRESH_UNCERTAIN")
		if err != nil {
			return "", err
		}
		return "", &slackError{Code: "refresh_in_progress", RetryAfter: 5 * time.Second}
	}
	grant, err := s.oauth(ctx, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {credentials.RefreshToken}})
	if err != nil {
		status := "RECONNECT_REQUIRED"
		var provider *slackError
		if errors.As(err, &provider) && provider.Uncertain {
			status = "REFRESH_UNCERTAIN"
		}
		// A rate-limit refusal did not consume the refresh token.
		if errors.As(err, &provider) && provider.RetryAfter > 0 {
			_, dbErr := s.DB.ExecContext(ctx, `UPDATE platform_slack_installation SET refresh_claim='',refresh_started_at=NULL WHERE id=$1 AND refresh_claim=$2`, id, claim)
			if dbErr != nil {
				return "", dbErr
			}
			return "", err
		}
		dbErr := s.failRefresh(ctx, id, claim, status)
		if dbErr != nil {
			return "", dbErr
		}
		return "", err
	}
	if grant.RefreshToken == "" || grant.ExpiresIn <= 0 {
		err = s.failRefresh(ctx, id, claim, "REFRESH_UNCERTAIN")
		if err != nil {
			return "", err
		}
		return "", &slackError{Code: "invalid_refresh_response", Uncertain: true}
	}
	raw, _ := json.Marshal(slackCredentials{grant.AccessToken, grant.RefreshToken})
	sealed, err := seal(raw)
	if err != nil {
		return "", err
	}
	res, err = s.DB.ExecContext(ctx, `UPDATE platform_slack_installation SET encrypted_credentials=$3,expires_at=$4,refresh_claim='',refresh_started_at=NULL,updated_at=now() WHERE id=$1 AND refresh_claim=$2 AND health='CONNECTED'`, id, claim, sealed, time.Now().Add(time.Duration(grant.ExpiresIn)*time.Second))
	if err != nil {
		return "", err
	}
	n, err = res.RowsAffected()
	if err != nil {
		return "", err
	}
	if n != 1 {
		return "", &slackError{Code: "refresh_ownership_lost", Uncertain: true}
	}
	return grant.AccessToken, nil
}

func safeSlackCode(code string) string {
	switch code {
	case "invalid_auth", "token_revoked", "account_inactive", "missing_scope", "not_authed", "invalid_client_id", "bad_client_secret", "invalid_code", "bad_redirect_uri", "invalid_refresh_token", "ratelimited", "channel_not_found", "not_in_channel", "is_archived", "restricted_action", "internal_error", "fatal_error":
		return code
	}
	return "provider_rejected"
}
func (s *Service) slackAPI(ctx context.Context, token, method string, payload map[string]any) (map[string]json.RawMessage, error) {
	readOnly := slices.Contains([]string{"auth.test", "conversations.info", "conversations.list", "chat.getPermalink"}, method)
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	contentType := "application/json; charset=utf-8"
	if readOnly {
		// Slack ignores JSON request bodies on its read endpoints.
		form := url.Values{}
		for key, value := range payload {
			form.Set(key, fmt.Sprint(value))
		}
		raw = []byte(form.Encode())
		contentType = "application/x-www-form-urlencoded"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.SlackBase, "/")+"/api/"+method, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", contentType)
	response, err := s.HTTP.Do(req)
	if err != nil {
		return nil, &slackError{Code: "transport_uncertain", Uncertain: !readOnly}
	}
	defer response.Body.Close()
	if response.StatusCode == 429 {
		return nil, &slackError{Code: "ratelimited", RetryAfter: retryAfter(response.Header.Get("Retry-After"))}
	}
	if response.StatusCode >= 500 {
		return nil, &slackError{Code: "server_uncertain", Uncertain: !readOnly}
	}
	var result map[string]json.RawMessage
	if json.NewDecoder(io.LimitReader(response.Body, 2*1024*1024)).Decode(&result) != nil {
		return nil, &slackError{Code: "malformed_response", Uncertain: !readOnly}
	}
	var ok bool
	if json.Unmarshal(result["ok"], &ok) != nil {
		return nil, &slackError{Code: "malformed_response", Uncertain: !readOnly}
	}
	if !ok {
		var code string
		_ = json.Unmarshal(result["error"], &code)
		return nil, &slackError{Code: safeSlackCode(code), Uncertain: !readOnly && (code == "internal_error" || code == "fatal_error")}
	}
	if response.StatusCode != 200 {
		return nil, &slackError{Code: "unexpected_status", Uncertain: !readOnly}
	}
	return result, nil
}
func (s *Service) connectionCall(ctx context.Context, org, id, method string, payload map[string]any) (map[string]json.RawMessage, error) {
	token, err := s.Token(ctx, org, id)
	if err != nil {
		return nil, err
	}
	result, err := s.slackAPI(ctx, token, method, payload)
	var provider *slackError
	if errors.As(err, &provider) && slices.Contains([]string{"invalid_auth", "token_revoked", "account_inactive"}, provider.Code) {
		if dbErr := s.revoke(ctx, org, id); dbErr != nil {
			return nil, dbErr
		}
	}
	return result, err
}
func (s *Service) revoke(ctx context.Context, org, id string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var installation string
	err = tx.QueryRowContext(ctx, `UPDATE platform_slack_installation i SET health='RECONNECT_REQUIRED',updated_at=now() FROM platform_slack_connection c WHERE c.installation_id=i.id AND c.id=$1 AND c."organizationId"=$2 AND i.health='CONNECTED' RETURNING i.id`, id, org).Scan(&installation)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = emitInstallationHealth(ctx, tx, installation); err != nil {
		return err
	}
	return tx.Commit()
}
func emitInstallationHealth(ctx context.Context, tx *sql.Tx, installation string) error {
	rows, err := tx.QueryContext(ctx, `SELECT id,"organizationId" FROM platform_slack_connection WHERE installation_id=$1`, installation)
	if err != nil {
		return err
	}
	type connection struct{ id, org string }
	connections := []connection{}
	for rows.Next() {
		var c connection
		if err = rows.Scan(&c.id, &c.org); err != nil {
			rows.Close()
			return err
		}
		connections = append(connections, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, c := range connections {
		if err = emitSQL(ctx, tx, c.org, "integration.reconnect_required", "integration_connection", c.id, "", nil); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) Channels(ctx context.Context, p Principal, id, cursor string) (*SlackChannels, error) {
	if err := s.Authorize(ctx, p, true); err != nil {
		return nil, err
	}
	return s.ConnectionChannels(ctx, p.OrganizationID, id, cursor)
}

// ConnectionChannels is used after the design or publishing service has authorized its principal.
func (s *Service) ConnectionChannels(ctx context.Context, org, id, cursor string) (*SlackChannels, error) {
	if len(cursor) > 2048 {
		return nil, ErrInvalid
	}
	result, err := s.connectionCall(ctx, org, id, "conversations.list", map[string]any{"limit": 200, "types": "public_channel,private_channel", "exclude_archived": true, "cursor": cursor})
	if err != nil {
		return nil, err
	}
	var channels []struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Private  bool   `json:"is_private"`
		Member   bool   `json:"is_member"`
		Archived bool   `json:"is_archived"`
	}
	if json.Unmarshal(result["channels"], &channels) != nil {
		return nil, &slackError{Code: "malformed_channels"}
	}
	var meta struct {
		NextCursor string `json:"next_cursor"`
	}
	if value := result["response_metadata"]; len(value) > 0 && json.Unmarshal(value, &meta) != nil {
		return nil, &slackError{Code: "malformed_cursor"}
	}
	page := &SlackChannels{Channels: []SlackChannel{}, NextCursor: meta.NextCursor}
	for _, c := range channels {
		if c.ID == "" || c.Name == "" {
			return nil, &slackError{Code: "malformed_channels"}
		}
		if !c.Archived {
			page.Channels = append(page.Channels, SlackChannel{c.ID, c.Name, c.Private, c.Member, c.Archived})
		}
	}
	return page, nil
}
func (s *Service) ValidateChannel(ctx context.Context, org, id, channel string) (*SlackChannel, error) {
	if id == "" || !slackID.MatchString(channel) {
		return nil, invalid("select a Slack connection and channel")
	}
	result, err := s.connectionCall(ctx, org, id, "conversations.info", map[string]any{"channel": channel})
	if err != nil {
		return nil, err
	}
	var c struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Private  bool   `json:"is_private"`
		Member   bool   `json:"is_member"`
		Archived bool   `json:"is_archived"`
	}
	if json.Unmarshal(result["channel"], &c) != nil || c.ID != channel || c.Name == "" {
		return nil, &slackError{Code: "malformed_channel"}
	}
	if c.Archived {
		return nil, &slackError{Code: "is_archived"}
	}
	if !c.Member {
		return nil, &slackError{Code: "not_in_channel"}
	}
	return &SlackChannel{c.ID, c.Name, c.Private, c.Member, c.Archived}, nil
}
func escapeSlack(text string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(text)
}
func (s *Service) sendSlack(ctx context.Context, d Delivery, e Envelope) (Outcome, error) {
	result, err := s.pacedSlackCall(ctx, d.OrganizationID, d.connectionID, d.Destination, "chat.postMessage", map[string]any{"channel": d.Destination, "text": escapeSlack(e.Workspace + ": " + e.Text), "parse": "none", "link_names": false, "unfurl_links": false, "unfurl_media": false})
	if err != nil {
		var provider *slackError
		if errors.As(err, &provider) {
			if provider.RetryAfter > 0 {
				return Outcome{Status: "PENDING", Code: provider.Code, RetryAfter: provider.RetryAfter}, nil
			}
			if provider.Uncertain {
				return Outcome{Status: "UNCERTAIN", Code: provider.Code}, nil
			}
			return Outcome{Status: "BLOCKED", Code: provider.Code}, nil
		}
		return Outcome{Status: "UNCERTAIN", Code: "SLACK_TRANSPORT_UNCERTAIN"}, nil
	}
	var ts, channel string
	_ = json.Unmarshal(result["ts"], &ts)
	_ = json.Unmarshal(result["channel"], &channel)
	if ts == "" || channel != d.Destination {
		return Outcome{Status: "UNCERTAIN", Code: "SLACK_RECEIPT_MISSING"}, nil
	}
	return Outcome{Status: "SUCCEEDED", Receipt: channel + ":" + ts}, nil
}

func emitSQL(ctx context.Context, tx *sql.Tx, org, kind, resourceType, id, actor string, payload map[string]any) error {
	if payload == nil {
		payload = map[string]any{}
	}
	payload["actorUserId"] = actor
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	eventID := cuid.New()
	_, err = tx.ExecContext(ctx, `INSERT INTO outbox_event(id,"organizationId",type,"aggregateType","aggregateId",payload,"idempotencyKey",notification_version) VALUES($1,$2,$3,$4,$5,$6,$1,1)`, eventID, org, "activity."+kind, resourceType, id, raw)
	return err
}

// SlackConfigured reports provider availability without exposing configuration.
func (s *Service) SlackConfigured() bool { return s.slackConfigured() }

// SlackFailureMessage exposes only actionable, redacted provider outcomes.
func SlackFailureMessage(err error) string {
	var failure *slackError
	if !errors.As(err, &failure) {
		return ""
	}
	if failure.Uncertain {
		return "Slack may have accepted this request. Check Slack before trying again."
	}
	switch failure.Code {
	case "not_in_channel", "channel_not_found":
		return "Invite the Slack app to this channel, then select it again."
	case "is_archived":
		return "Select a channel that is not archived."
	case "ratelimited", "refresh_in_progress":
		return "Slack is busy. Wait before trying again."
	case "missing_scope":
		return "Reconnect Slack to grant the required permissions."
	default:
		return "Slack is unavailable. Check the connection and reconnect if needed."
	}
}

type slackIntent struct {
	Purpose      string `json:"purpose"`
	ConnectionID string `json:"connectionId,omitempty"`
}

func slackScopesFor(purpose string) []string {
	if purpose == "publishing" {
		return append(append([]string{}, slackScopes...), "chat:write.customize")
	}
	return slackScopes
}

func (s *Service) failRefresh(ctx context.Context, id, claim, status string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var changed string
	err = tx.QueryRowContext(ctx, `UPDATE platform_slack_installation SET health=$3,refresh_claim='',updated_at=now() WHERE id=$1 AND health='CONNECTED' AND (refresh_claim=$2 AND $2<>'' OR $2='' AND refresh_claim<>'' AND refresh_started_at<now()-interval '2 minutes') RETURNING id`, id, claim, status).Scan(&changed)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = emitInstallationHealth(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit()
}
