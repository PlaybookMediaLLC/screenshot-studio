package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/lucsky/cuid"
)

// SocialSlackCall resolves a verified tenant binding; caller-supplied access tokens are never used.
func (s *Service) SocialSlackCall(ctx context.Context, socialOrg, id, method string, payload map[string]any) (map[string]json.RawMessage, error) {
	switch method {
	case "conversations.list", "chat.postMessage", "chat.getPermalink":
	default:
		return nil, ErrInvalid
	}
	var org string
	err := s.DB.QueryRowContext(ctx, `SELECT b."organizationId" FROM social_tenant_binding b JOIN "Integration" i ON i."organizationId"=b."goOrganizationId" WHERE b."goOrganizationId"=$1 AND i.id=$2 AND i."providerIdentifier"='slack' AND i."deletedAt" IS NULL AND NOT i.disabled AND NOT i."refreshNeeded" AND NOT EXISTS(SELECT 1 FROM workspace_deletion d WHERE d."organizationId"=b."organizationId" AND d.status<>'CANCELLED')`, socialOrg, id).Scan(&org)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, &slackError{Code: "reconnect_required"}
	}
	if err != nil {
		return nil, err
	}
	if err = s.importSocialSlack(ctx, org, socialOrg, id); err != nil {
		return nil, err
	}
	var connectionID string
	if err = s.DB.QueryRowContext(ctx, `SELECT id FROM platform_slack_connection WHERE "organizationId"=$1 AND legacy_social_id=$2`, org, id).Scan(&connectionID); err != nil {
		return nil, err
	}
	id = connectionID
	if method == "chat.postMessage" {
		channel, _ := payload["channel"].(string)
		_, err = s.ValidateChannel(ctx, org, id, channel)
		var provider *slackError
		if errors.As(err, &provider) && provider.Code == "not_in_channel" {
			_, err = s.connectionCall(ctx, org, id, "conversations.join", map[string]any{"channel": channel})
			if err == nil {
				_, err = s.ValidateChannel(ctx, org, id, channel)
			}
		}
		if err != nil {
			return nil, err
		}
		return s.pacedSlackCall(ctx, org, id, channel, method, payload)
	}
	return s.connectionCall(ctx, org, id, method, payload)
}
func (s *Service) importSocialSlack(ctx context.Context, org, socialOrg, id string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var token, team, name string
	var refresh sql.NullString
	var expires sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT token,"internalId",name,"refreshToken","tokenExpiration" FROM "Integration" WHERE id=$1 AND "organizationId"=$2 AND "providerIdentifier"='slack' AND NOT disabled AND "deletedAt" IS NULL FOR UPDATE`, id, socialOrg).Scan(&token, &team, &name, &refresh, &expires)
	if err != nil {
		return err
	}
	var exists bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM platform_slack_connection WHERE legacy_social_id=$1 AND "organizationId"=$2)`, id, org).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	if token == "" || token == "backend-owned" {
		return &slackError{Code: "reconnect_required"}
	}
	result, err := s.slackAPI(ctx, token, "auth.test", map[string]any{})
	if err != nil {
		return err
	}
	var verifiedTeam string
	if json.Unmarshal(result["team_id"], &verifiedTeam) != nil || verifiedTeam != team {
		return &slackError{Code: "installation_identity_mismatch"}
	}
	if refresh.String == "null" {
		refresh.String = ""
	}
	raw, err := json.Marshal(slackCredentials{AccessToken: token, RefreshToken: refresh.String})
	if err != nil {
		return err
	}
	encrypted, err := seal(raw)
	if err != nil {
		return err
	}
	installation := cuid.New()
	_, err = tx.ExecContext(ctx, `INSERT INTO platform_slack_installation(id,app_id,team_id,team_name,encrypted_credentials,scopes,expires_at) VALUES($1,$2,$3,$4,$5,'["channels:read","chat:write","groups:read","channels:join","chat:write.customize"]',$6)`, installation, "legacy-social:"+id, team, name, encrypted, expires)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO platform_slack_connection(id,"organizationId",installation_id,legacy_social_id) VALUES($1,$2,$3,$1)`, id, org, installation); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE "Integration" SET token='backend-owned',"refreshToken"=NULL,"tokenExpiration"=NULL WHERE id=$1 AND "organizationId"=$2`, id, socialOrg); err != nil {
		return err
	}
	return tx.Commit()
}

// pacedSlackCall shares one destination clock across every workspace using an installation.
func (s *Service) pacedSlackCall(ctx context.Context, org, id, channel, method string, payload map[string]any) (map[string]json.RawMessage, error) {
	var installation string
	if err := s.DB.QueryRowContext(ctx, `SELECT installation_id FROM platform_slack_connection WHERE id=$1 AND "organizationId"=$2`, id, org).Scan(&installation); err != nil {
		return nil, err
	}
	key := installation + ":" + channel
	var next time.Time
	err := s.DB.QueryRowContext(ctx, `INSERT INTO platform_slack_pacing(id,installation_id,channel_id,next_at) VALUES($1,$2,$3,now()+interval '1 second') ON CONFLICT(id) DO UPDATE SET next_at=now()+interval '1 second' WHERE platform_slack_pacing.next_at<=now() RETURNING next_at`, key, installation, channel).Scan(&next)
	if errors.Is(err, sql.ErrNoRows) {
		if err = s.DB.QueryRowContext(ctx, `SELECT next_at FROM platform_slack_pacing WHERE id=$1`, key).Scan(&next); err != nil {
			return nil, err
		}
		return nil, &slackError{Code: "channel_pacing", RetryAfter: max(time.Second, time.Until(next))}
	}
	if err != nil {
		return nil, err
	}
	result, err := s.connectionCall(ctx, org, id, method, payload)
	var provider *slackError
	if errors.As(err, &provider) && provider.RetryAfter > 0 {
		if _, dbErr := s.DB.ExecContext(ctx, `UPDATE platform_slack_pacing SET next_at=GREATEST(next_at,$2) WHERE id=$1`, key, time.Now().Add(provider.RetryAfter)); dbErr != nil {
			return nil, dbErr
		}
	}
	return result, err
}

func attachSlackPublishing(ctx context.Context, tx *sql.Tx, org, existingID, team, name string) (string, error) {
	var socialOrg string
	if err := tx.QueryRowContext(ctx, `SELECT "goOrganizationId" FROM social_tenant_binding WHERE "organizationId"=$1`, org).Scan(&socialOrg); err != nil {
		return "", invalid("set up workspace publishing before connecting a Slack publishing account")
	}
	id := existingID
	if id == "" {
		err := tx.QueryRowContext(ctx, `SELECT id FROM "Integration" WHERE "organizationId"=$1 AND "providerIdentifier"='slack' AND "internalId"=$2 AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1`, socialOrg, team).Scan(&id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if id == "" {
			id = cuid.New()
		}
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO "Integration"(id,"organizationId","internalId",name,"providerIdentifier",type,token,"createdAt","updatedAt") VALUES($1,$2,$3,$4,'slack','social','backend-owned',now(),now()) ON CONFLICT(id) DO UPDATE SET token='backend-owned',"refreshToken"=NULL,"tokenExpiration"=NULL,"refreshNeeded"=false,disabled=false,name=EXCLUDED.name,"updatedAt"=now() WHERE "Integration"."organizationId"=EXCLUDED."organizationId" AND "Integration"."internalId"=EXCLUDED."internalId"`, id, socialOrg, team, name)
	return id, err
}
