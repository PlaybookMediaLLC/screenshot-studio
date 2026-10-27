package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/publishing"
	"github.com/lucsky/cuid"
)

var slackUserID = regexp.MustCompile(`^[UW][A-Z0-9]{1,64}$`)

func personalSlack(ctx context.Context, db queryer, org, user string) (*SlackConnection, error) {
	var c SlackConnection
	var raw []byte
	err := db.QueryRowContext(ctx, `SELECT c.id,c.slack_user_id,i.team_id,i.team_name,i.app_id,i.health,i.scopes FROM platform_slack_personal_connection c JOIN platform_slack_installation i ON i.id=c.installation_id JOIN member m ON m.id=c.member_id AND m."organizationId"=c."organizationId" AND m."userId"=c."userId" WHERE c."organizationId"=$1 AND c."userId"=$2`, org, user).Scan(&c.ID, &c.SlackUserID, &c.TeamID, &c.TeamName, &c.AppID, &c.Health, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(raw, &c.Scopes); err != nil {
		return nil, err
	}
	return &c, nil
}

// The destination comes only from Slack's OAuth response. The browser cannot
// supply another member's Slack ID, and reconnect cannot change that identity.
func (s *Service) savePersonalSlack(ctx context.Context, p Principal, g *slackGrant, existing string) (*SlackConnection, error) {
	if !slackUserID.MatchString(g.AuthedUser.ID) {
		return nil, invalid("Slack did not identify the authorizing member")
	}
	result, err := s.slackAPI(ctx, g.AccessToken, "auth.test", map[string]any{})
	if err != nil {
		return nil, err
	}
	var team string
	if json.Unmarshal(result["team_id"], &team) != nil || team != g.Team.ID {
		return nil, invalid("Slack returned a different workspace")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = lockSessionMember(ctx, tx, p, false); err != nil {
		return nil, err
	}
	// Serializes first connection, reconnect, and disconnect for this member.
	if err = lockPersonalSlack(ctx, tx, p); err != nil {
		return nil, err
	}
	current, err := personalSlack(ctx, tx, p.OrganizationID, p.UserID)
	if err != nil {
		return nil, err
	}
	if existing != "" {
		if current == nil || current.ID != existing {
			return nil, publishing.ErrNotFound
		}
		if current.TeamID != g.Team.ID || current.AppID != g.AppID || current.SlackUserID != g.AuthedUser.ID {
			return nil, invalid("reconnect the same Slack account; disconnect first to choose another account")
		}
	} else if current != nil {
		return nil, invalid("a personal Slack account is already connected")
	}
	installation, err := s.saveSlackGrantTx(ctx, tx, g)
	if err != nil {
		return nil, err
	}
	var member string
	if err = tx.QueryRowContext(ctx, `SELECT id FROM member WHERE "organizationId"=$1 AND "userId"=$2`, p.OrganizationID, p.UserID).Scan(&member); err != nil {
		return nil, err
	}
	id := existing
	if id == "" {
		id = cuid.New()
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO platform_slack_personal_connection(id,"organizationId","userId",member_id,installation_id,slack_user_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT("organizationId","userId") DO UPDATE SET installation_id=EXCLUDED.installation_id`, id, p.OrganizationID, p.UserID, member, installation, g.AuthedUser.ID)
	if err != nil {
		return nil, err
	}
	if err = audit(ctx, tx, p, "notification.personal_slack_connected", id); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &SlackConnection{ID: id, SlackUserID: g.AuthedUser.ID, TeamID: g.Team.ID, TeamName: g.Team.Name, AppID: g.AppID, Health: "CONNECTED", Scopes: strings.Split(g.Scope, ",")}, nil
}

func lockPersonalSlack(ctx context.Context, tx *sql.Tx, p Principal) error {
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "personal-slack:"+p.OrganizationID+":"+p.UserID)
	return err
}

// DisconnectPersonalSlack removes only the current member's DM destination.
func (s *Service) DisconnectPersonalSlack(ctx context.Context, p Principal, id string) error {
	if err := s.Authorize(ctx, p, false); err != nil {
		return err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = lockSessionMember(ctx, tx, p, false); err != nil {
		return err
	}
	if err = lockPersonalSlack(ctx, tx, p); err != nil {
		return err
	}
	var removed string
	err = tx.QueryRowContext(ctx, `DELETE FROM platform_slack_personal_connection WHERE id=$1 AND "organizationId"=$2 AND "userId"=$3 RETURNING id`, id, p.OrganizationID, p.UserID).Scan(&removed)
	if errors.Is(err, sql.ErrNoRows) {
		return publishing.ErrNotFound
	}
	if err != nil {
		return err
	}
	if err = audit(ctx, tx, p, "notification.personal_slack_disconnected", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) personalSlackToken(ctx context.Context, org, user, id string) (string, string, error) {
	var installation, encrypted, health string
	var expires sql.NullTime
	err := s.DB.QueryRowContext(ctx, `SELECT i.id,i.encrypted_credentials,i.health,i.expires_at FROM platform_slack_personal_connection c JOIN platform_slack_installation i ON i.id=c.installation_id JOIN member m ON m.id=c.member_id AND m."organizationId"=c."organizationId" AND m."userId"=c."userId" WHERE c.id=$1 AND c."organizationId"=$2 AND c."userId"=$3`, id, org, user).Scan(&installation, &encrypted, &health, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", publishing.ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	token, err := s.installationToken(ctx, installation, encrypted, health, expires)
	return token, installation, err
}

func (s *Service) revokeInstallation(ctx context.Context, id string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `UPDATE platform_slack_installation SET health='RECONNECT_REQUIRED',updated_at=now() WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if err = emitInstallationHealth(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) sendPersonalSlack(ctx context.Context, d Delivery, e Envelope) (Outcome, error) {
	token, installation, err := s.personalSlackToken(ctx, d.OrganizationID, d.Destination, d.connectionID)
	if err != nil {
		return personalSlackOutcome(err), nil
	}
	if err = s.paceSlack(ctx, installation, e.To); err != nil {
		return personalSlackOutcome(err), nil
	}
	// Token rotation can call Slack. Recheck recipient authority after it returns.
	fresh, out, err := s.prepare(ctx, d)
	if err != nil {
		return Outcome{Status: "BLOCKED", Code: "PRE_SEND_CHECK_FAILED"}, nil
	}
	if out.Status != "" {
		return out, nil
	}
	if fresh.To != e.To {
		return Outcome{Status: "SKIPPED", Code: "DESTINATION_CHANGED"}, nil
	}
	var claimed bool
	if err = s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM platform_notification_delivery WHERE id=$1 AND claim_token=$2 AND status='CLAIMED')`, d.ID, d.claimToken).Scan(&claimed); err != nil {
		return Outcome{Status: "BLOCKED", Code: "PRE_SEND_CHECK_FAILED"}, nil
	}
	if !claimed {
		return Outcome{Status: "SKIPPED", Code: "CLAIM_LOST"}, nil
	}
	// chat:write supports a user-ID destination in the app's one-to-one DM.
	result, err := s.slackAPI(ctx, token, "chat.postMessage", map[string]any{"channel": e.To, "text": escapeSlack(e.Workspace + ": " + e.Text + "\n" + e.Href), "parse": "none", "link_names": false, "unfurl_links": false, "unfurl_media": false})
	if err != nil {
		var provider *slackError
		if errors.As(err, &provider) && slices.Contains([]string{"invalid_auth", "token_revoked", "account_inactive"}, provider.Code) {
			if dbErr := s.revokeInstallation(ctx, installation); dbErr != nil {
				return Outcome{Status: "BLOCKED", Code: "SLACK_HEALTH_UPDATE_FAILED"}, nil
			}
		}
		if errors.As(err, &provider) && provider.RetryAfter > 0 {
			if _, dbErr := s.DB.ExecContext(ctx, `UPDATE platform_slack_pacing SET next_at=GREATEST(next_at,$2) WHERE id=$1`, installation+":"+e.To, time.Now().Add(provider.RetryAfter)); dbErr != nil {
				return Outcome{Status: "PENDING", Code: provider.Code, RetryAfter: provider.RetryAfter}, nil
			}
		}
		return personalSlackOutcome(err), nil
	}
	var ts, channel string
	_ = json.Unmarshal(result["ts"], &ts)
	_ = json.Unmarshal(result["channel"], &channel)
	if ts == "" || !slackID.MatchString(channel) || !strings.HasPrefix(channel, "D") {
		return Outcome{Status: "UNCERTAIN", Code: "SLACK_RECEIPT_MISSING"}, nil
	}
	return Outcome{Status: "SUCCEEDED", Receipt: channel + ":" + ts}, nil
}

func personalSlackOutcome(err error) Outcome {
	var provider *slackError
	if errors.As(err, &provider) {
		if provider.RetryAfter > 0 {
			return Outcome{Status: "PENDING", Code: provider.Code, RetryAfter: provider.RetryAfter}
		}
		if provider.Uncertain {
			return Outcome{Status: "UNCERTAIN", Code: provider.Code}
		}
		return Outcome{Status: "BLOCKED", Code: provider.Code}
	}
	return Outcome{Status: "BLOCKED", Code: "SLACK_DESTINATION_UNAVAILABLE"}
}
