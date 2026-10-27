// Package credentialbackfill upgrades credentials in the existing integration store.
package credentialbackfill

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/credentialcipher"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/ent"
	"github.com/PlaybookMediaLLC/screenshot-studio/services/internal/social/helpers"
)

var errBackfill = errors.New("social credential backfill failed; no changes in the current batch were committed")

// Run locks bounded batches and commits only after every value authenticates.
// Rerunning verifies current envelopes and rotates legacy/previous-key values.
func Run(ctx context.Context, client *ent.Client) (updated int, err error) {
	if err := credentialcipher.ValidateKey(); err != nil {
		return 0, err
	}
	after := ""
	for {
		last, changed, err := batch(ctx, client, after)
		if err != nil {
			return updated, err
		}
		updated += changed
		if last == "" {
			return updated, nil
		}
		after = last
	}
}

type credentialRow struct {
	id               string
	token            string
	refresh, details sql.NullString
	erased           bool
}

func batch(ctx context.Context, client *ent.Client, after string) (string, int, error) {
	tx, err := client.Tx(ctx)
	if err != nil {
		return "", 0, errBackfill
	}
	defer tx.Rollback()
	rows, err := tx.Client().QueryContext(ctx, `SELECT i.id,i.token,i."refreshToken",i."customInstanceDetails",i."deletedAt" IS NOT NULL AND o."deletedAt" IS NOT NULL FROM "Integration" i JOIN "Organization" o ON o.id=i."organizationId" WHERE i.id>$1 ORDER BY i.id LIMIT 100 FOR UPDATE OF i`, after)
	if err != nil {
		return "", 0, errBackfill
	}
	var records []credentialRow
	for rows.Next() {
		var record credentialRow
		if err := rows.Scan(&record.id, &record.token, &record.refresh, &record.details, &record.erased); err != nil {
			rows.Close()
			return "", 0, errBackfill
		}
		records = append(records, record)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return "", 0, errBackfill
	}
	updated, last := 0, ""
	for _, record := range records {
		last = record.id
		token, err := upgrade(record.token, "integration.token")
		if err != nil {
			return "", 0, fmt.Errorf("integration %s token: %w", record.id, errBackfill)
		}
		refresh, details := record.refresh, record.details
		if refresh.Valid {
			refresh.String, err = upgrade(refresh.String, "integration.refresh_token")
			if err != nil {
				return "", 0, fmt.Errorf("integration %s refresh token: %w", record.id, errBackfill)
			}
		}
		if details.Valid {
			details.String, err = upgrade(details.String, "custom-instance")
			// Account erasure historically replaced credentials with MD5 tombstones.
			if err != nil && record.erased && len(record.details.String) == 32 {
				if _, decodeErr := hex.DecodeString(record.details.String); decodeErr == nil {
					details.String, err = credentialcipher.Seal(record.details.String, "custom-instance")
				}
			}
			if err != nil {
				return "", 0, fmt.Errorf("integration %s custom credentials: %w", record.id, errBackfill)
			}
		}
		if token == record.token && refresh == record.refresh && details == record.details {
			continue
		}
		if _, err := tx.Client().ExecContext(ctx, `UPDATE "Integration" SET token=$1,"refreshToken"=$2,"customInstanceDetails"=$3 WHERE id=$4`, token, refresh, details, record.id); err != nil {
			return "", 0, errBackfill
		}
		updated++
	}
	if err := tx.Commit(); err != nil {
		return "", 0, errBackfill
	}
	return last, updated, nil
}

func upgrade(value, purpose string) (string, error) {
	if value == "" {
		return value, nil
	}
	var plain string
	var err error
	if purpose == "custom-instance" {
		plain, err = helpers.FixedDecryption(value)
	} else {
		plain, err = credentialcipher.Open(value, purpose)
	}
	if err != nil {
		return "", credentialcipher.ErrUnavailable
	}
	if credentialcipher.UsesCurrentKey(value) {
		return value, nil
	}
	return credentialcipher.Seal(plain, purpose)
}
