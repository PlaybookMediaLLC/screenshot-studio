package autodm

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/lucsky/cuid"
)

// SQLLedger keeps campaign offers immutable and claims permanent. It is a
// storage primitive, not an authenticated public API. Its callers must verify
// workspace/account ownership and provider event evidence before recording it.
// No production route currently activates this infrastructure.
type SQLLedger struct{ DB *sql.DB }

func accountLock(ctx context.Context, tx *sql.Tx, account string) error {
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "platform-auto-dm:"+account)
	return err
}
func (l SQLLedger) transaction(ctx context.Context, account string, fn func(*sql.Tx) error) error {
	if l.DB == nil || account == "" {
		return ErrUnavailable
	}
	tx, err := l.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = accountLock(ctx, tx, account); err != nil {
		return err
	}
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// Register records a confirmed publication and enforces the active-campaign cap
// across all workspaces using the same native account. Replays cannot alter an
// existing offer or revive a cancelled campaign.
func (l SQLLedger) Register(ctx context.Context, c Campaign, now time.Time, limits Limits) error {
	if c.ID == "" || c.OrganizationID == "" || c.AccountID == "" || c.PostID == "" || c.PublishedAt.IsZero() || c.PublishedAt.After(now) || !now.Before(c.PublishedAt.Add(Window)) || !offer.MatchString(c.PostText) || c.Disabled || c.SourceRemoved || c.Config.Validate() != nil || !validLimits(limits) {
		return fmt.Errorf("invalid Auto-DM campaign")
	}
	raw, _ := json.Marshal(c)
	return l.transaction(ctx, c.AccountID, func(tx *sql.Tx) error {
		var same bool
		err := tx.QueryRowContext(ctx, `SELECT snapshot=$2::jsonb FROM platform_auto_dm_campaign WHERE id=$1`, c.ID, string(raw)).Scan(&same)
		if err == nil {
			if !same {
				return fmt.Errorf("campaign identity or immutable offer differs")
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var active int
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM platform_auto_dm_campaign WHERE account_id=$1 AND NOT disabled AND NOT source_removed AND published_at>$2`, c.AccountID, now.Add(-Window)).Scan(&active); err != nil {
			return err
		}
		if active >= limits.ActiveCampaigns {
			return fmt.Errorf("active Auto-DM campaign limit reached")
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO platform_auto_dm_campaign(id,"organizationId",account_id,post_id,snapshot,published_at) VALUES($1,$2,$3,$4,$5,$6)`, c.ID, c.OrganizationID, c.AccountID, c.PostID, string(raw), c.PublishedAt)
		return err
	})
}

// RecordRecipient is called only after an authorized provider source verifies
// this complete action/consent snapshot. Older events cannot undo new evidence.
// A separate sticky opt-out is always authoritative over later snapshots.
func (l SQLLedger) RecordRecipient(ctx context.Context, c Campaign, r Recipient, observed time.Time) error {
	if r.ID == "" || observed.IsZero() || r.ConsentEvidenceID == "" || r.ConsentPostID != c.PostID || r.ConsentAt.After(observed) {
		return fmt.Errorf("verified consent evidence required")
	}
	raw, _ := json.Marshal(r)
	return l.transaction(ctx, c.AccountID, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO platform_auto_dm_recipient(id,"organizationId",account_id,campaign_id,recipient_id,snapshot,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT(campaign_id,recipient_id) DO UPDATE SET snapshot=excluded.snapshot,observed_at=excluded.observed_at
   WHERE platform_auto_dm_recipient."organizationId"=excluded."organizationId" AND platform_auto_dm_recipient.account_id=excluded.account_id AND platform_auto_dm_recipient.observed_at<excluded.observed_at`, cuid.New(), c.OrganizationID, c.AccountID, c.ID, r.ID, string(raw), observed)
		return err
	})
}

// OptOut persists a verified STOP event for every campaign on this account.
// No campaign edit, engagement event or redelivery can clear it.
func (l SQLLedger) OptOut(ctx context.Context, account, recipient, evidence string, observed time.Time) error {
	if recipient == "" || evidence == "" || observed.IsZero() {
		return fmt.Errorf("verified opt-out evidence required")
	}
	return l.transaction(ctx, account, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO platform_auto_dm_opt_out(id,account_id,recipient_id,evidence_id,observed_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,recipient_id) DO NOTHING`, cuid.New(), account, recipient, evidence, observed)
		return err
	})
}

// Stop cancels a campaign or records removal of its source publication.
func (l SQLLedger) Stop(ctx context.Context, organization, account, campaign string, sourceRemoved bool) error {
	return l.transaction(ctx, account, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE platform_auto_dm_campaign SET disabled=true,source_removed=source_removed OR $4 WHERE id=$1 AND "organizationId"=$2 AND account_id=$3`, campaign, organization, account, sourceRemoved)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err == nil && n != 1 {
			return sql.ErrNoRows
		}
		return err
	})
}

// Claim rechecks the persisted offer, consent, cancellation, expiry, opt-out and
// rolling quotas under one native-account lock. All attempts count against the
// quota, including unknown outcomes and crashed reservations. Nothing expires a
// reservation into a retry: the remote provider has no idempotent send key.
func (l SQLLedger) Claim(ctx context.Context, c Campaign, r Recipient, now time.Time, limits Limits) (bool, error) {
	if !validLimits(limits) || !Eligible(c, r, now) {
		return false, nil
	}
	claimed := false
	err := l.transaction(ctx, c.AccountID, func(tx *sql.Tx) error {
		var storedCampaign, storedRecipient []byte
		var disabled, removed bool
		var observed time.Time
		err := tx.QueryRowContext(ctx, `SELECT c.snapshot,c.disabled,c.source_removed,r.snapshot,r.observed_at
   FROM platform_auto_dm_campaign c JOIN platform_auto_dm_recipient r ON r.campaign_id=c.id AND r."organizationId"=c."organizationId" AND r.account_id=c.account_id
   WHERE c.id=$1 AND c."organizationId"=$2 AND c.account_id=$3 AND r.recipient_id=$4`, c.ID, c.OrganizationID, c.AccountID, r.ID).Scan(&storedCampaign, &disabled, &removed, &storedRecipient, &observed)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if disabled || removed || observed.After(now) {
			return nil
		}
		var savedC Campaign
		var savedR Recipient
		if json.Unmarshal(storedCampaign, &savedC) != nil || json.Unmarshal(storedRecipient, &savedR) != nil {
			return fmt.Errorf("invalid persisted Auto-DM evidence")
		}
		// Never send a caller's stale message/configuration or unpersisted consent.
		wantC, _ := json.Marshal(c)
		haveC, _ := json.Marshal(savedC)
		wantR, _ := json.Marshal(r)
		haveR, _ := json.Marshal(savedR)
		if string(wantC) != string(haveC) || string(wantR) != string(haveR) || !Eligible(savedC, savedR, now) {
			return nil
		}
		var stopped bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM platform_auto_dm_opt_out WHERE account_id=$1 AND recipient_id=$2)`, c.AccountID, r.ID).Scan(&stopped); err != nil {
			return err
		}
		if stopped {
			return nil
		}
		var minute, hour, day, active int
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FILTER(WHERE created_at>$2),count(*) FILTER(WHERE created_at>$3),count(*) FROM platform_auto_dm_delivery WHERE account_id=$1 AND created_at>$4`, c.AccountID, now.Add(-time.Minute), now.Add(-time.Hour), now.Add(-24*time.Hour)).Scan(&minute, &hour, &day); err != nil {
			return err
		}
		if minute >= limits.PerMinute || hour >= limits.PerHour || day >= limits.PerDay {
			return nil
		}
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM platform_auto_dm_campaign WHERE account_id=$1 AND NOT disabled AND NOT source_removed AND published_at>$2`, c.AccountID, now.Add(-Window)).Scan(&active); err != nil {
			return err
		}
		if active > limits.ActiveCampaigns {
			return nil
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO platform_auto_dm_delivery(id,"organizationId",account_id,campaign_id,recipient_id,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(campaign_id,recipient_id) DO NOTHING`, cuid.New(), c.OrganizationID, c.AccountID, c.ID, r.ID, now)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		claimed = n == 1
		return err
	})
	return claimed, err
}

// Complete never turns an unknown/reserved attempt into a new attempt. A
// confirmed receipt may resolve an unknown result, but cannot replace another ID.
func (l SQLLedger) Complete(ctx context.Context, c Campaign, r Recipient, remote, status string) error {
	if status != "unknown" && status != "sent" || status == "sent" && remote == "" || status == "unknown" && remote != "" {
		return fmt.Errorf("invalid Auto-DM receipt")
	}
	return l.transaction(ctx, c.AccountID, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `UPDATE platform_auto_dm_delivery SET status=$5,remote_id=$6 WHERE campaign_id=$1 AND "organizationId"=$2 AND account_id=$3 AND recipient_id=$4 AND (status IN ('reserved','unknown') OR (status=$5 AND remote_id=$6))`, c.ID, c.OrganizationID, c.AccountID, r.ID, status, remote)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err == nil && n != 1 {
			return fmt.Errorf("Auto-DM claim missing or receipt conflicts")
		}
		return err
	})
}
